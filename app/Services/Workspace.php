<?php

namespace App\Services;

use App\Models\Account;
use App\Models\Draft;
use App\Models\Media;
use App\Models\Publication;
use App\Models\Setting;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

class Workspace
{
    public function state(): array
    {
        app(Synchronizer::class)->requireAuth();

        return ['drafts' => Draft::orderByDesc('updated_at')->get(), 'accounts' => Account::orderBy('name')->get(),
            'media' => Media::latest()->get(), 'publications' => Publication::orderByDesc('scheduled_at')->get(),
            'settings' => ['workspace_id' => Setting::read('workspace_id'), 'workspaces' => json_decode(Setting::read('workspaces', '[]'), true), 'mode' => 'desktop', 'paired' => app(Synchronizer::class)->signedIn(),
                'email' => Setting::read('account_email', ''),
                'mcp_url' => rtrim(config('sendae.service_url'), '/').'/mcp',
                'connections_url' => rtrim(config('sendae.service_url'), '/'),
                'providers' => Setting::read('providers') ? json_decode(Setting::read('providers'), true) : []]];

    }

    public function save(array $data, bool $sync = false): array
    {
        app(Synchronizer::class)->requireAuth();
        $data = Validator::make($data, [
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

        abort_if(Draft::onlyTrashed()->whereKey($data['id'])->exists(), 410, 'This draft was deleted.');

        return $this->once('save', $data, function () use ($data, $sync) {
            $draft = Draft::withTrashed()->lockForUpdate()->find($data['id']);
            abort_if($draft?->trashed(), 410, 'This draft was deleted.');
            if ($draft && $draft->version !== $data['version']) {
                // Preserve both complete versions; conflicts never overwrite the scheduled snapshot.
                $copy = Draft::create(['title' => $data['title'].' (conflict copy)', 'content' => $data['content'], 'dirty' => ! $sync]);

                return ['draft' => $draft, 'conflict' => $copy];
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
