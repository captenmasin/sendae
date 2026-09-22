<?php

use App\Models\Draft;
use App\Models\Setting;
use App\Models\Publication;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Http;

test('deletion requires auth and keeps the draft when the server refuses', function (): void {
    config(['sendae.service_url' => 'https://sendae-server.test']);
    Http::preventStrayRequests();
    $this->postJson('/local/deleteDraft', [])->assertUnauthorized();
    Setting::write('server_token', 'token');
    Setting::write('session_origin', 'https://sendae-server.test');
    Setting::write('workspace_id', str_repeat('a', 64));
    $draft = Draft::create(['content' => [], 'synced_version' => 2]);
    $this->postJson('/local/deleteDraft', [])->assertUnprocessable();
    Setting::write('workspace_id', str_repeat('b', 64));
    $this->postJson('/local/deleteDraft', ['id' => $draft->id])->assertNotFound();
    Setting::write('workspace_id', str_repeat('a', 64));
    $publication = Publication::create(['draft_id' => $draft->id, 'account_id' => (string) Str::uuid(), 'status' => 'scheduled', 'snapshot' => [], 'scheduled_at' => '2027-01-01 12:00:00']);
    Http::fake(['sendae-server.test/api/deleteDraft' => Http::sequence()->push(['message' => 'Sync before deleting.'], 409)->push(['deleted' => true, 'cancelled_publication_ids' => [$publication->id]])]);

    $this->postJson('/local/deleteDraft', ['id' => $draft->id])->assertConflict();
    $this->assertNotSoftDeleted($draft);
    $this->assertSame('scheduled', $publication->fresh()->status);
    $this->postJson('/local/deleteDraft', ['id' => $draft->id])->assertJsonPath('deleted', true)->assertJsonPath('cancelled_publication_ids.0', $publication->id);
    $this->assertSoftDeleted($draft);
    $this->assertSame('cancelled', $publication->fresh()->status);
    $this->getJson('/local/state')->assertJsonCount(0, 'drafts');
    Http::assertSent(fn ($request) => $request->url() === 'https://sendae-server.test/api/deleteDraft' && $request['version'] === 2);
});

test('unsynced and conflict copies delete with version zero', function (): void {
    config(['sendae.service_url' => 'https://sendae-server.test']);
    Http::preventStrayRequests();
    Setting::write('server_token', 'token');
    Setting::write('session_origin', 'https://sendae-server.test');
    Setting::write('workspace_id', str_repeat('a', 64));
    $draft = Draft::create(['title' => 'Local only', 'content' => ['items' => [['text' => 'Unsynced', 'media_ids' => []]], 'overrides' => [], 'account_ids' => []]]);
    Http::fake(['sendae-server.test/api/deleteDraft' => Http::response(['deleted' => true])]);

    $this->postJson('/local/deleteDraft', ['id' => $draft->id])->assertJsonPath('deleted', true);
    $this->assertSoftDeleted($draft);
    Http::assertSent(fn ($request) => $request->url() === 'https://sendae-server.test/api/deleteDraft' && $request['version'] === 0);
});

test('sync removes remote deletions even with pending local edits', function (): void {
    config(['sendae.service_url' => 'https://sendae-server.test']);
    Setting::write('server_token', 'token');
    Setting::write('session_origin', 'https://sendae-server.test');
    $dirty = Draft::create(['content' => [], 'dirty' => true]);
    $clean = Draft::create(['content' => [], 'dirty' => false]);
    Http::preventStrayRequests();
    Http::fake([
        'sendae-server.test/api/drafts' => Http::response(['message' => 'This draft was deleted.'], 410),
        'sendae-server.test/api/state' => Http::response(['drafts' => [], 'deleted_draft_ids' => [$dirty->id, $clean->id], 'accounts' => [], 'media' => [], 'publications' => []]),
    ]);

    $this->postJson('/local/sync')->assertOk();
    $this->assertSoftDeleted($dirty);
    $this->assertSoftDeleted($clean);
    $this->getJson('/local/state')->assertJsonCount(0, 'drafts');
    $this->postJson('/local/sync')->assertOk();
    Http::assertSentCount(3);
});
