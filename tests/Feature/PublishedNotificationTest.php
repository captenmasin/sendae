<?php

use App\Models\Setting;
use Illuminate\Support\Str;
use App\Services\Synchronizer;
use Illuminate\Support\Facades\Http;
use App\Services\DesktopNotifications;

/**
 * @param  list<array<string, mixed>>  $publications
 */
function fakeState(array $publications): void
{
    Http::fake(['sendae.example/api/state' => Http::response([
        'drafts' => [],
        'accounts' => [],
        'media' => [],
        'publications' => $publications,
        'settings' => [],
    ])]);
}

/**
 * @return array<string, mixed>
 */
function published(string $id): array
{
    return [
        'id' => $id,
        'draft_id' => (string) Str::uuid(),
        'account_id' => (string) Str::uuid(),
        'status' => 'published',
        'scheduled_at' => now()->toIso8601String(),
        'published_at' => now()->toIso8601String(),
        'snapshot' => ['title' => 'Live post', 'items' => [['text' => 'Hello', 'media_ids' => []]]],
        'receipts' => [],
    ];
}

beforeEach(function (): void {
    config(['sendae.service_url' => 'https://sendae.example']);
    Setting::write('server_token', 'test-token');
    Setting::write('session_origin', 'https://sendae.example');
    Setting::write('workspace_id', str_repeat('a', 64));
    Http::preventStrayRequests();
});

test('first sync does not notify for already published posts', function (): void {
    $id = (string) Str::uuid();
    $this->mock(DesktopNotifications::class, function ($mock) {
        $mock->shouldReceive('published')->never();
    });
    fakeState([published($id)]);

    app(Synchronizer::class)->run();

    $this->assertSame(json_encode([$id]), Setting::read('notified_publications:'.str_repeat('a', 64)));
});

test('a newly published post notifies once', function (): void {
    $id = (string) Str::uuid();
    $this->mock(DesktopNotifications::class, function ($mock) {
        $mock->shouldReceive('published')->once();
    });
    $empty = ['drafts' => [], 'accounts' => [], 'media' => [], 'publications' => [], 'settings' => []];
    $published = ['drafts' => [], 'accounts' => [], 'media' => [], 'publications' => [published($id)], 'settings' => []];
    Http::fake(['sendae.example/api/state' => Http::sequence()->push($empty)->push($published)->push($published)]);

    app(Synchronizer::class)->run();
    app(Synchronizer::class)->run();
    app(Synchronizer::class)->run();

    $this->assertSame(json_encode([$id]), Setting::read('notified_publications:'.str_repeat('a', 64)));
});
