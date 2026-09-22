<?php

use App\Models\Setting;
use App\Models\Publication;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Http;

test('deletion requires authentication and server confirmation and stays deleted after sync', function (): void {
    config(['sendae.service_url' => 'https://service.example']);
    Http::preventStrayRequests();
    $this->postJson('/local/deletePublication', [])->assertUnauthorized();
    Setting::write('server_token', 'token');
    Setting::write('session_origin', 'https://service.example');
    Setting::write('workspace_id', str_repeat('a', 64));
    $this->postJson('/local/deletePublication', [])->assertUnprocessable();
    $this->postJson('/local/deletePublication', ['id' => 'invalid'])->assertUnprocessable();
    $publication = Publication::create(['draft_id' => (string) Str::uuid(), 'account_id' => (string) Str::uuid(), 'snapshot' => ['title' => 'Cancelled post'], 'scheduled_at' => now(), 'status' => 'cancelled']);
    $state = ['drafts' => [], 'accounts' => [], 'media' => [], 'publications' => [$publication->toArray()]];
    $empty = [...$state, 'publications' => []];
    Http::fake([
        'service.example/api/state' => Http::sequence()->push($state)->push($state)->push($empty)->push($empty),
        'service.example/api/deletePublication' => Http::sequence()->push(['message' => 'Only cancelled publications can be deleted.'], 422)->push(['deleted' => true]),
    ]);

    $this->postJson('/local/deletePublication', ['id' => $publication->id])->assertUnprocessable();
    $this->assertModelExists($publication);
    $this->postJson('/local/deletePublication', ['id' => $publication->id])->assertJsonPath('deleted', true);
    $this->assertModelMissing($publication);
    $this->postJson('/local/sync')->assertOk();
    $this->getJson('/local/state')->assertJsonCount(0, 'publications');
    Http::assertSent(fn ($request) => $request->url() === 'https://service.example/api/deletePublication' && $request['id'] === $publication->id && $request->hasHeader('X-Workspace-Id', str_repeat('a', 64)));
});

test('sync removes deleted publications only in the current workspace and preserves them on failure', function (): void {
    config(['sendae.service_url' => 'https://service.example']);
    Setting::write('server_token', 'token');
    Setting::write('session_origin', 'https://service.example');
    Setting::write('workspace_id', str_repeat('b', 64));
    $other = Publication::create(['draft_id' => (string) Str::uuid(), 'account_id' => (string) Str::uuid(), 'snapshot' => [], 'scheduled_at' => now(), 'status' => 'cancelled']);
    Setting::write('workspace_id', str_repeat('a', 64));
    $deleted = Publication::create(['draft_id' => (string) Str::uuid(), 'account_id' => (string) Str::uuid(), 'snapshot' => [], 'scheduled_at' => now(), 'status' => 'cancelled']);
    $retained = Publication::create(['draft_id' => (string) Str::uuid(), 'account_id' => (string) Str::uuid(), 'snapshot' => [], 'scheduled_at' => now(), 'status' => 'published']);
    Http::preventStrayRequests();
    Http::fake(['service.example/api/state' => Http::sequence()->push([], 503)->push(['drafts' => [], 'accounts' => [], 'media' => [], 'publications' => [$retained->toArray()]])]);

    $this->postJson('/local/sync')->assertStatus(503);
    $this->assertModelExists($deleted);
    $this->postJson('/local/sync')->assertOk();
    $this->assertModelMissing($deleted);
    $this->assertModelExists($retained);
    $this->assertDatabaseHas('publications', ['id' => $other->id, 'workspace_id' => str_repeat('b', 64)]);
    Http::assertSentCount(2);
});
