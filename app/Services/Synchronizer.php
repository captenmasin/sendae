<?php

namespace App\Services;

use App\Models\Account;
use App\Models\Draft;
use App\Models\Media;
use App\Models\Publication;
use App\Models\Setting;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Native\Desktop\Facades\Shell;

class Synchronizer
{
    public function signedIn(): bool
    {
        $token = Setting::read('server_token');
        if (! $token || Setting::read('session_origin') !== rtrim(config('sendae.service_url'), '/')) {
            return false;
        }
        $parts = explode('.', $token);
        if (count($parts) === 3) {
            $claims = json_decode(base64_decode(strtr($parts[1], '-_', '+/')), true);

            return is_numeric($claims['exp'] ?? null) && $claims['exp'] > time();
        }

        return true;
    }

    public function requireAuth(): void
    {
        if (! $this->signedIn()) {
            throw new AuthenticationException('Sign in to Sendae to continue.');
        }
    }

    private function client(): PendingRequest
    {
        $url = rtrim(config('sendae.service_url'), '/');
        $parts = parse_url($url);
        $local = ($parts['scheme'] ?? '') === 'http' && in_array($parts['host'] ?? '', ['127.0.0.1', 'localhost', '::1']);
        if ((! $local && ($parts['scheme'] ?? '') !== 'https') || isset($parts['user']) || isset($parts['query']) || isset($parts['fragment'])) {
            app(Workspace::class)->invalid('service', 'This Sendae build has an invalid service address.');
        }

        return Http::baseUrl($url.'/api/')->withOptions(['verify' => config('sendae.service_ca') ?: true])->acceptJson()->withoutRedirecting()->connectTimeout(5)->timeout(60);
    }

    public function request(): PendingRequest
    {
        $this->requireAuth();
        $token = Setting::read('server_token');

        return $this->client()->withToken($token)->withHeaders(['X-Workspace-Id' => Setting::read('workspace_id', '')])->afterResponse(function ($response) use ($token) {
            if ($response->status() === 401 && Setting::read('server_token') === $token) {
                Setting::where('key', 'server_token')->delete();
            }
        });
    }

    public function signIn(array $credentials): array
    {
        return Cache::lock('sendae-sync', 180)->block(2, function () use ($credentials) {
            $response = $this->client()->post('session', $credentials)->throw();
            abort_unless($response->successful(), 502, 'Sendae sign-in could not be completed.');
            $data = Validator::make($response->json(), [
                'token' => 'required|string|max:10000', 'workspace_id' => 'required|string|size:64', 'email' => 'required|email',
            ])->validate();
            $changed = Setting::read('workspace_id') !== $data['workspace_id'];
            DB::transaction(function () use ($data, $changed) {
                if ($changed) {
                    Setting::whereIn('key', ['providers', 'workspaces'])->delete();
                }
                // Adopt only legacy drafts written before accounts were required.
                foreach (['accounts', 'drafts', 'media', 'publications'] as $table) {
                    DB::table($table)->whereNull('workspace_id')->update(['workspace_id' => $data['workspace_id']]);
                }
                Setting::write('server_token', $data['token']);
                Setting::write('workspace_id', $data['workspace_id']);
                Setting::write('session_origin', rtrim(config('sendae.service_url'), '/'));
                Setting::write('account_email', $data['email']);
                Setting::where('key', 'server_url')->delete();
            });

            return ['signed_in' => true, 'workspace_changed' => $changed];
        });
    }

    public function saveWorkspace(array $data): array
    {
        $this->requireAuth();

        return Cache::lock('sendae-sync', 180)->block(2, function () use ($data) {
            $response = isset($data['id'])
                ? $this->request()->patch('workspaces/'.$data['id'], collect($data)->only(['name', 'icon'])->all())
                : $this->request()->post('workspaces', $data);
            $workspace = $response->throw()->json();
            $workspaces = $this->request()->get('workspaces')->throw()->json();
            Setting::write('workspaces', json_encode($workspaces));

            return $workspace;
        });
    }

    public function switchWorkspace(string $id): array
    {
        $this->requireAuth();

        return Cache::lock('sendae-sync', 180)->block(2, function () use ($id) {
            $workspaces = $this->request()->get('workspaces')->throw()->json();
            abort_unless(collect($workspaces)->contains('id', $id), 404);
            DB::transaction(function () use ($id, $workspaces) {
                Setting::write('workspaces', json_encode($workspaces));
                Setting::write('workspace_id', $id);
                Setting::where('key', 'providers')->delete();
            });

            return ['workspace_id' => $id];
        });
    }

    public function accountRequest(string $action, array $data): array
    {
        abort_unless(in_array($action, ['register', 'forgot-password', 'reset-password']), 404);
        $response = $this->client()->post($action, $data)->throw();
        abort_unless($response->successful(), 502, 'Sendae could not complete this request.');

        return ['message' => $response->json('message')];
    }

    public function signOut(): array
    {
        return Cache::lock('sendae-sync', 180)->block(2, function () {
            if ($this->signedIn()) {
                $response = $this->request()->delete('session');
                if ($response->status() !== 401) {
                    $response->throw();
                    abort_unless($response->successful(), 502, 'Sendae sign-out could not be completed.');
                }
            }
            Setting::whereIn('key', ['server_token', 'session_origin', 'account_email'])->delete();

            return ['signed_out' => true];
        });
    }

    public function deleteDraft(string $id): array
    {
        $this->requireAuth();

        return Cache::lock('sendae-sync', 180)->block(2, function () use ($id) {
            $draft = Draft::withTrashed()->findOrFail($id);
            $response = $this->request()->post('deleteDraft', ['id' => $id, 'version' => $draft->synced_version])->throw();
            abort_unless($response->json('deleted') === true, 502, 'Sendae could not delete this draft.');
            $draft->delete();

            return ['deleted' => true];
        });
    }

    public function run(bool $push = true): array
    {
        $this->requireAuth();

        return Cache::lock('sendae-sync', 180)->block(2, function () use ($push) {
            $conflicts = 0;
            if ($push) {
                foreach (Media::where('synced', false)->whereNotNull('path')->get() as $m) {
                    $file = Storage::disk('local')->readStream($m->path);
                    try {
                        $this->request()->attach('file', $file, $m->name)->post('media', ['id' => $m->id])->throw();
                        $m->update(['synced' => true]);
                    } finally {
                        if (is_resource($file)) {
                            fclose($file);
                        }
                    }
                }
                foreach (Draft::where('dirty', true)->get() as $draft) {
                    $version = $draft->version;
                    $response = $this->request()->post('drafts', ['id' => $draft->id, 'title' => $draft->title, 'content' => $draft->content, 'version' => $draft->synced_version]);
                    if ($response->status() === 410) {
                        $draft->delete();

                        continue;
                    }
                    $result = $response->throw()->json();
                    DB::transaction(function () use ($draft, $version, $result, &$conflicts) {
                        $current = Draft::lockForUpdate()->find($draft->id);
                        if ($result['conflict']) {
                            $copy = $result['conflict'];
                            Draft::updateOrCreate(['id' => $copy['id']], ['title' => $copy['title'], 'content' => $copy['content'], 'version' => $copy['version'], 'synced_version' => $copy['version'], 'dirty' => false]);
                            $conflicts++;
                        }
                        if ($current->version === $version) {
                            $current->update(['title' => $result['draft']['title'], 'content' => $result['draft']['content'], 'version' => $result['draft']['version'], 'synced_version' => $result['draft']['version'], 'dirty' => false]);
                        } else {
                            $current->update(['synced_version' => $result['draft']['version']]);
                        }
                    });
                }
            }
            $state = $this->request()->get('state')->throw()->json();
            DB::transaction(function () use ($state) {
                Setting::write('providers', json_encode($state['settings']['providers'] ?? []));
                if (isset($state['settings']['workspaces'])) {
                    Setting::write('workspaces', json_encode($state['settings']['workspaces']));
                }
                Draft::whereIn('id', $state['deleted_draft_ids'] ?? [])->delete();
                foreach ($state['drafts'] as $d) {
                    $current = Draft::withTrashed()->lockForUpdate()->find($d['id']);
                    if ($current?->trashed()) {
                        continue;
                    }
                    if (! $current || ! $current->dirty) {
                        Draft::updateOrCreate(['id' => $d['id']], ['title' => $d['title'], 'content' => $d['content'], 'version' => $d['version'], 'synced_version' => $d['version'], 'dirty' => false]);
                    }
                }
                foreach ($state['accounts'] as $a) {
                    Account::updateOrCreate(['id' => $a['id']], collect($a)->only(['name', 'provider', 'provider_id', 'timezone', 'slots', 'status'])->all() + ['avatar_url' => $a['avatar_url'] ?? null]);
                }
                Account::whereNotIn('id', array_column($state['accounts'], 'id'))->delete();
                foreach ($state['publications'] as $p) {
                    Publication::updateOrCreate(['id' => $p['id']], collect($p)->except(['id', 'created_at', 'updated_at'])->all());
                }
                Publication::whereNotIn('id', array_column($state['publications'], 'id'))->delete();
                foreach ($state['media'] as $m) {
                    Media::firstOrCreate(['id' => $m['id']], collect($m)->only(['name', 'mime', 'size'])->all() + ['synced' => true]);
                }
            });
            foreach (Media::whereNull('path')->get() as $m) {
                $path = 'media/'.$m->id;
                $response = $this->request()->get('media/'.$m->id)->throw();
                Storage::disk('local')->put($path, $response->body());
                $m->update(['path' => $path]);
            }

            return ['synced' => true, 'conflicts' => $conflicts];
        });
    }

    public function startConnection(string $provider): array
    {
        $result = Validator::make($this->request()->post('connect', ['provider' => $provider])->throw()->json(), [
            'url' => 'required|url',
        ])->validate();
        $prefix = rtrim(config('sendae.service_url'), '/').'/connections/';
        abort_unless(str_starts_with($result['url'], $prefix), 422, 'Sendae returned an invalid connection address.');
        Shell::openExternal($result['url']);

        return ['opened' => true];
    }

    public function connectionChoices(string $ticket): array
    {
        return $this->request()->get('connections/'.$ticket)->throw()->json();
    }

    public function selectConnection(string $ticket, array $data): array
    {
        return $this->request()->post('connections/'.$ticket, $data)->throw()->json();
    }

    public function authorization(string $ticket): array
    {
        return $this->request()->get('authorizations/'.$ticket)->throw()->json();
    }

    public function decideAuthorization(string $ticket, bool $approved): array
    {
        $result = $this->request()->post('authorizations/'.$ticket, ['approved' => $approved])->throw()->json();
        $url = $result['redirect_url'] ?? '';
        abort_unless(is_string($url) && in_array(parse_url($url, PHP_URL_SCHEME), ['https', 'http', 'cursor', 'vscode', 'vscode-insiders']), 422, 'The client returned an unsupported callback address.');
        Shell::openExternal($url);

        return ['completed' => true];
    }

    public function remote(string $action, array $data): mixed
    {
        $this->requireAuth();
        $draft = isset($data['draft_id']) ? Draft::findOrFail($data['draft_id']) : null;
        if ($draft && ($data['version'] ?? null) !== $draft->version) {
            app(Workspace::class)->invalid('version', 'This draft changed. Reload it before scheduling.');
        }
        $snapshot = $draft?->only(['title', 'content']);
        $this->run($draft !== null);
        if ($draft) {
            $draft->refresh();
            if ($draft->only(['title', 'content']) !== $snapshot) {
                app(Workspace::class)->invalid('conflict', 'Synchronization found a different draft version. Reload and review the preserved copies before scheduling.');
            }
            $data['version'] = $draft->synced_version;
        }
        $result = $this->request()->post($action, $data)->throw()->json();
        $this->run(false);

        return $result;
    }
}
