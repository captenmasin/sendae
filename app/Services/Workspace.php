<?php

namespace App\Services;

use App\Models\Account;
use App\Models\Draft;
use App\Models\Media;
use App\Models\Publication;
use App\Models\Setting;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

class Workspace
{
    public function state(): array
    {
        app(Synchronizer::class)->requireAuth();

        $accounts = Account::orderBy('name')->get();
        $publications = Publication::orderByDesc('scheduled_at')->get();

        return ['drafts' => $this->draftsForEditing($publications, $accounts), 'accounts' => $accounts,
            'media' => Media::latest()->get(), 'publications' => $publications,
            'settings' => ['workspace_id' => Setting::read('workspace_id'), 'workspaces' => json_decode(Setting::read('workspaces', '[]'), true), 'mode' => 'desktop', 'paired' => app(Synchronizer::class)->signedIn(),
                'email' => Setting::read('account_email', ''),
                'name' => Setting::read('account_name', ''),
                'mcp_url' => rtrim(config('sendae.service_url'), '/').'/mcp',
                'connections_url' => rtrim(config('sendae.service_url'), '/'),
                'providers' => Setting::read('providers') ? json_decode(Setting::read('providers'), true) : []]];

    }

    private function draftsForEditing(Collection $publications, Collection $accounts): Collection
    {
        $queued = $publications->whereIn('status', ['scheduled', 'retry', 'publishing'])->groupBy('draft_id');

        return Draft::withTrashed()->where(function ($query) use ($queued) {
            $query->whereNull('deleted_at')->orWhereIn('id', $queued->keys());
        })->orderByDesc('updated_at')->get()->map(function (Draft $draft) use ($queued, $accounts): array {
            $data = $draft->toArray();
            if ($draft->trashed()) {
                $posts = $queued->get($draft->id);
                $overrides = [];
                foreach ($posts as $post) {
                    if ($account = $accounts->firstWhere('id', $post->account_id)) {
                        $overrides[$account->provider] = $post->snapshot['items'];
                    }
                }
                $data['title'] = $posts->first()->snapshot['title'] ?? '';
                $data['content'] = ['items' => $posts->first()->snapshot['items'], 'overrides' => (object) $overrides, 'account_ids' => $posts->pluck('account_id')->unique()->values()->all()];
                $data['restore_scheduled'] = true;
            }

            return $data;
        });
    }

    public function save(array $data, bool $sync = false): array
    {
        app(Synchronizer::class)->requireAuth();
        $data = Validator::make($data, [
            'restore_scheduled' => 'sometimes|boolean',
            'id' => 'required|uuid', 'title' => 'nullable|string|max:200', 'version' => 'required|integer|min:0',
            'content' => 'required|array:items,overrides,account_ids', 'content.items' => 'required|array|min:1|max:30',
            'content.items.*' => 'required|array:text,media_ids', 'content.items.*.text' => 'present|nullable|string|max:65000',
            'content.items.*.media_ids' => 'present|array|max:20', 'content.items.*.media_ids.*' => 'uuid',
            'content.overrides' => 'present|array', 'content.overrides.*' => 'array|min:1|max:30',
            'content.overrides.*.*' => 'array:text,media_ids', 'content.overrides.*.*.text' => 'present|nullable|string|max:65000',
            'content.overrides.*.*.media_ids' => 'present|array|max:20', 'content.overrides.*.*.media_ids.*' => 'uuid',
            'content.account_ids' => 'present|array|max:30', 'content.account_ids.*' => 'uuid',
        ])->validate();
        $data['title'] = ($data['title'] ?? '') ?: 'Untitled draft';
        foreach ($data['content']['items'] as &$item) {
            $item['text'] ??= '';
        }
        unset($item);
        foreach ($data['content']['overrides'] as &$items) {
            foreach ($items as &$item) {
                $item['text'] ??= '';
            } unset($item);
        }
        unset($items);
        foreach (array_keys($data['content']['overrides']) as $network) {
            if (! array_key_exists($network, config('sendae.providers'))) {
                $this->invalid('content.overrides', 'Unknown network override.');
            }
        }

        abort_if(Draft::onlyTrashed()->whereKey($data['id'])->exists() && ! ($data['restore_scheduled'] ?? false), 410, 'This draft was deleted.');
        abort_if(Publication::where('draft_id', $data['id'])->where('status', 'published')->exists(), 409, 'Published posts cannot be edited. Create a new post instead.');

        return $this->once('save', $data, function () use ($data, $sync) {
            $draft = Draft::withTrashed()->lockForUpdate()->find($data['id']);
            if ($draft?->trashed()) {
                $queued = Publication::where('draft_id', $draft->id)->whereIn('status', ['scheduled', 'retry'])->lockForUpdate()->get();
                abort_unless(($data['restore_scheduled'] ?? false) && $queued->isNotEmpty() && $queued->every(fn ($post) => empty($post->receipts)), 410, 'This draft was deleted.');
                $draft->restore();
            }
            $draft ??= new Draft(['id' => $data['id'], 'version' => 0]);
            $draft->fill(['title' => $data['title'], 'content' => $data['content'], 'version' => $draft->version + 1, 'dirty' => ! $sync])->save();

            return ['draft' => $draft, 'conflict' => null];
        });
    }

    private function once(string $operation, array $data, callable $action): array
    {
        $key = hash('sha256', Setting::read('workspace_id').'|'.$operation.json_encode($data, JSON_THROW_ON_ERROR));

        return DB::transaction(function () use ($key, $action) {
            if ($receipt = DB::table('operation_receipts')->where('id', $key)->first()) {
                return json_decode($receipt->response, true, 512, JSON_THROW_ON_ERROR);
            }
            $result = $action();
            DB::table('operation_receipts')->insert(['id' => $key, 'response' => json_encode($result, JSON_THROW_ON_ERROR), 'created_at' => now()]);

            return $result;
        });
    }

    public function invalid(string $key, string $message): never
    {
        throw ValidationException::withMessages([$key => $message]);
    }
}
