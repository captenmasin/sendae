<?php

namespace Tests\Feature;

use App\Models\Setting;
use App\Services\DesktopNotifications;
use App\Services\Synchronizer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

class PublishedNotificationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['sendae.service_url' => 'https://sendae.example']);
        Setting::write('server_token', 'test-token');
        Setting::write('session_origin', 'https://sendae.example');
        Setting::write('workspace_id', str_repeat('a', 64));
        Http::preventStrayRequests();
    }

    public function test_first_sync_does_not_notify_for_already_published_posts(): void
    {
        $id = (string) Str::uuid();
        $this->mock(DesktopNotifications::class, function ($mock) {
            $mock->shouldReceive('published')->never();
        });
        $this->fakeState([$this->published($id)]);

        app(Synchronizer::class)->run();

        $this->assertSame(json_encode([$id]), Setting::read('notified_publications:'.str_repeat('a', 64)));
    }

    public function test_a_newly_published_post_notifies_once(): void
    {
        $id = (string) Str::uuid();
        $this->mock(DesktopNotifications::class, function ($mock) {
            $mock->shouldReceive('published')->once();
        });
        $empty = ['drafts' => [], 'accounts' => [], 'media' => [], 'publications' => [], 'settings' => []];
        $published = ['drafts' => [], 'accounts' => [], 'media' => [], 'publications' => [$this->published($id)], 'settings' => []];
        Http::fake(['sendae.example/api/state' => Http::sequence()->push($empty)->push($published)->push($published)]);

        app(Synchronizer::class)->run();
        app(Synchronizer::class)->run();
        app(Synchronizer::class)->run();

        $this->assertSame(json_encode([$id]), Setting::read('notified_publications:'.str_repeat('a', 64)));
    }

    /**
     * @param  list<array<string, mixed>>  $publications
     */
    private function fakeState(array $publications): void
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
    private function published(string $id): array
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
}
