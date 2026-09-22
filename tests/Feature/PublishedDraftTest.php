<?php

use App\Models\Draft;
use App\Models\Account;
use App\Models\Setting;
use App\Models\Publication;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Http;

beforeEach(function (): void {
    config(['sendae.service_url' => 'https://sendae.example']);
    Setting::write('server_token', 'test-token');
    Setting::write('session_origin', 'https://sendae.example');
    Setting::write('workspace_id', str_repeat('a', 64));
    Http::preventStrayRequests();
});

test('deleted drafts with schedules appear with queued content and can be edited', function (): void {
    $account = Account::create(['name' => 'Threads', 'provider' => 'threads', 'provider_id' => '123']);
    $draft = Draft::create(['title' => 'Old title', 'version' => 1, 'content' => ['items' => [['text' => 'Unscheduled edits', 'media_ids' => []]], 'overrides' => [], 'account_ids' => []]]);
    $publication = Publication::create(['draft_id' => $draft->id, 'account_id' => $account->id, 'status' => 'scheduled', 'snapshot' => ['title' => 'Scheduled title', 'items' => [['text' => 'Queued text', 'media_ids' => []]]], 'scheduled_at' => now()->addDay(), 'receipts' => []]);
    $draft->delete();

    $payload = $this->getJson('/local/state')->assertJsonCount(1, 'drafts')
        ->assertJsonPath('drafts.0.title', 'Scheduled title')
        ->assertJsonPath('drafts.0.content.items.0.text', 'Queued text')
        ->assertJsonPath('drafts.0.content.account_ids.0', $account->id)
        ->assertJsonPath('drafts.0.content.overrides.threads.0.text', 'Queued text')
        ->assertJsonPath('drafts.0.restore_scheduled', true)->json('drafts.0');
    $this->assertSoftDeleted($draft);
    $this->postJson('/local/drafts', [...$payload, 'restore_scheduled' => false])->assertGone();
    $payload['content']['items'][0]['text'] = 'Edited';
    $this->postJson('/local/drafts', $payload)->assertOk();

    $this->assertNotSoftDeleted($draft);
    $this->assertSame('Edited', $draft->fresh()->content['items'][0]['text']);
    $this->assertSame('Queued text', $publication->fresh()->snapshot['items'][0]['text']);
    $draft->delete();
    $publication->update(['status' => 'cancelled']);
    $this->getJson('/local/state')->assertJsonCount(0, 'drafts');
    $payload['content']['items'][0]['text'] = 'Another edit';
    $this->postJson('/local/drafts', $payload)->assertGone();
});

test('published drafts return 409 without changing content or replaying an old save', function (): void {
    $payload = ['id' => (string) Str::uuid(), 'title' => 'Original', 'version' => 0, 'content' => ['items' => [['text' => 'Original text', 'media_ids' => []]], 'overrides' => [], 'account_ids' => []]];
    $this->postJson('/local/drafts', $payload)->assertOk();
    $publication = Publication::create(['draft_id' => $payload['id'], 'account_id' => (string) Str::uuid(), 'status' => 'published', 'snapshot' => $payload['content'], 'scheduled_at' => now(), 'published_at' => now()]);

    $this->postJson('/local/drafts', $payload)->assertConflict()->assertJsonPath('message', 'Published posts cannot be edited. Create a new post instead.');
    $payload['content']['items'][0]['text'] = 'Edited after publishing';
    $this->postJson('/local/drafts', $payload)->assertConflict();

    $this->assertSame('Original text', Draft::findOrFail($payload['id'])->content['items'][0]['text']);
    $this->assertSame('Original text', $publication->fresh()->snapshot['items'][0]['text']);
    $this->assertDatabaseCount('operation_receipts', 1);
});

test('scheduled drafts remain editable without changing the scheduled snapshot', function (): void {
    $draft = Draft::create(['version' => 0, 'title' => 'Scheduled', 'content' => ['items' => [['text' => 'Scheduled text', 'media_ids' => []]], 'overrides' => [], 'account_ids' => []]]);
    $publication = Publication::create(['draft_id' => $draft->id, 'account_id' => (string) Str::uuid(), 'status' => 'scheduled', 'snapshot' => $draft->content, 'scheduled_at' => now()->addDay()]);
    $payload = $draft->only(['id', 'title', 'version', 'content']);
    $payload['content']['items'][0]['text'] = 'Revised draft';

    $this->postJson('/local/drafts', $payload)->assertOk()->assertJsonPath('draft.content.items.0.text', 'Revised draft');

    $this->assertSame('Revised draft', $draft->fresh()->content['items'][0]['text']);
    $this->assertSame('Scheduled text', $publication->fresh()->snapshot['items'][0]['text']);
});

test('partial publications allow draft edits without changing live snapshots', function (): void {
    $draft = Draft::create(['version' => 1, 'title' => 'Partial', 'content' => ['items' => [['text' => 'Original', 'media_ids' => []]], 'overrides' => [], 'account_ids' => []]]);
    $live = Publication::create(['draft_id' => $draft->id, 'account_id' => (string) Str::uuid(), 'status' => 'published', 'snapshot' => $draft->content, 'scheduled_at' => now(), 'receipts' => ['123']]);
    Publication::create(['draft_id' => $draft->id, 'account_id' => (string) Str::uuid(), 'status' => 'scheduled', 'snapshot' => $draft->content, 'scheduled_at' => now()->addDay()]);
    $payload = $draft->only(['id', 'title', 'version', 'content']);
    $payload['content']['items'][0]['text'] = 'Next destination';

    $this->postJson('/local/drafts', $payload)->assertOk()->assertJsonPath('draft.content.items.0.text', 'Next destination');

    $this->assertSame('Original', $live->fresh()->snapshot['items'][0]['text']);
    $this->assertSame(['123'], $live->fresh()->receipts);
});
