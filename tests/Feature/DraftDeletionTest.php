<?php

namespace Tests\Feature;

use App\Models\Draft;
use App\Models\Publication;
use App\Models\Setting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

class DraftDeletionTest extends TestCase
{
    use RefreshDatabase;

    public function test_deletion_requires_auth_and_keeps_the_draft_when_the_server_refuses(): void
    {
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
    }

    public function test_unsynced_and_conflict_copies_delete_with_version_zero(): void
    {
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
    }

    public function test_sync_removes_remote_deletions_even_with_pending_local_edits(): void
    {
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
    }
}
