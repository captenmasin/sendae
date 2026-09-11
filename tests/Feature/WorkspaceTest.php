<?php

namespace Tests\Feature;

use App\Mcp\Servers\SendaeServer;
use App\Mcp\Tools\SaveDraft;
use App\Mcp\Tools\WorkspaceTool;
use App\Models\Account;
use App\Models\Draft;
use App\Models\Setting;
use App\Services\Attachments;
use App\Services\Synchronizer;
use App\Services\Workspace;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class WorkspaceTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['sendae.service_url' => 'https://sendae.example']);
        Setting::write('server_token', 'test-token');
        Setting::write('session_origin', 'https://sendae.example');
        Http::preventStrayRequests();
    }

    private function account(string $provider = 'x'): Account
    {
        return Account::create(['provider' => $provider, 'provider_id' => (string) random_int(1000, 9999), 'name' => 'Test account', 'status' => 'connected', 'timezone' => 'Europe/London', 'slots' => [['day' => 1, 'time' => '09:00']], 'credentials' => ['access_token' => 'test-secret']]);
    }

    private function draft(?Account $a = null, array $items = []): Draft
    {
        return Draft::create(['title' => 'Test draft', 'content' => ['items' => $items ?: [['text' => 'Hello world', 'media_ids' => []]], 'overrides' => [], 'account_ids' => $a ? [$a->id] : []]]);
    }

    public function test_desktop_drafts_persist_empty_text_and_conflicting_versions(): void
    {
        config(['sendae.mode' => 'desktop']);
        $payload = ['id' => (string) Str::uuid(), 'title' => 'My draft', 'version' => 0, 'content' => ['items' => [['text' => '', 'media_ids' => []]], 'overrides' => [], 'account_ids' => []]];
        $this->postJson('/local/drafts', $payload)->assertOk()->assertJsonPath('draft.version', 1);
        $payload['version'] = 1;
        $payload['content']['items'][0]['text'] = 'First edit';
        $this->postJson('/local/drafts', $payload)->assertOk()->assertJsonPath('draft.version', 2);
        $payload['content']['items'][0]['text'] = 'Offline edit';
        $response = $this->postJson('/local/drafts', $payload)->assertOk()->assertJsonPath('conflict.title', 'My draft (conflict copy)');
        $this->assertDatabaseCount('drafts', 2);
        $this->assertSame('First edit', Draft::find($payload['id'])->content['items'][0]['text']);
        $this->assertSame('Offline edit', $response->json('conflict.content.items.0.text'));
        $this->postJson('/local/drafts', $payload)->assertOk();
        $this->assertDatabaseCount('drafts', 2);
    }

    public function test_bluesky_connection_forwards_credentials_without_storing_them_locally(): void
    {
        Http::fake(['sendae.example/api/connectBluesky' => Http::response(['connected' => true])]);
        $this->postJson('/local/connectBluesky', ['identifier' => '@sendae.bsky.social', 'password' => 'app-secret', 'timezone' => 'UTC'])
            ->assertOk()->assertExactJson(['connected' => true]);
        Http::assertSent(fn ($request) => $request->url() === 'https://sendae.example/api/connectBluesky' && $request['password'] === 'app-secret' && $request->hasHeader('Authorization', 'Bearer test-token'));
        $this->assertDatabaseCount('accounts', 0);
        $this->assertDatabaseCount('operation_receipts', 0);
        $this->postJson('/local/connectBluesky', [])->assertUnprocessable()->assertJsonValidationErrors(['identifier', 'password', 'timezone']);
        Setting::where('key', 'server_token')->delete();
        $this->postJson('/local/connectBluesky', ['identifier' => 'sendae.bsky.social', 'password' => 'app-secret', 'timezone' => 'UTC'])->assertUnauthorized();
        Http::assertSentCount(1);
    }

    public function test_bluesky_network_overrides_can_be_saved(): void
    {
        $content = ['items' => [['text' => 'Shared text', 'media_ids' => []]], 'overrides' => ['bluesky' => [['text' => 'Bluesky text', 'media_ids' => []]]], 'account_ids' => []];
        $this->postJson('/local/drafts', ['id' => (string) Str::uuid(), 'title' => 'Bluesky draft', 'version' => 0, 'content' => $content])
            ->assertOk()->assertJsonPath('draft.content.overrides.bluesky.0.text', 'Bluesky text');
    }

    public function test_credentials_are_encrypted_and_never_returned_in_state(): void
    {
        $a = $this->account();
        $this->assertStringNotContainsString('test-secret', $a->getRawOriginal('credentials'));
        $this->assertArrayNotHasKey('credentials', app(Workspace::class)->state()['accounts'][0]->toArray());
        $this->assertSame('test-secret', $a->fresh()->credentials['access_token']);
    }

    public function test_local_access_rejects_non_loopback_and_untrusted_hosts(): void
    {
        config(['sendae.mode' => 'desktop']);
        $this->withServerVariables(['REMOTE_ADDR' => '10.0.0.12'])->getJson('/local/state')->assertForbidden();
        $this->withServerVariables(['REMOTE_ADDR' => '127.0.0.1', 'HTTP_HOST' => 'attacker.example'])->getJson('http://attacker.example/local/state')->assertForbidden();
    }

    public function test_upload_is_durable_and_rejects_executable_media(): void
    {
        Storage::fake('local');
        $m = app(Attachments::class)->store(UploadedFile::fake()->image('picture.png'));
        Storage::disk('local')->assertExists($m->path);
        $this->expectException(ValidationException::class);
        app(Attachments::class)->store(UploadedFile::fake()->createWithContent('bad.php', '<?php echo "bad";'));
    }

    public function test_sync_downloads_remote_drafts_and_preserves_conflicts(): void
    {
        config(['sendae.mode' => 'desktop']);
        Setting::write('session_origin', 'https://sendae.example');
        Setting::write('server_token', 'test-token');
        $d = $this->draft();
        $copy = (string) Str::uuid();
        $remote = ['id' => $d->id, 'title' => 'Remote edit', 'version' => 2, 'content' => $d->content];
        $conflict = ['id' => $copy, 'title' => 'Local edit (conflict copy)', 'version' => 1, 'content' => $d->content];
        Http::fake(['sendae.example/api/drafts' => Http::response(['draft' => $remote, 'conflict' => $conflict]), 'sendae.example/api/state' => Http::response(['drafts' => [$remote, $conflict], 'accounts' => [], 'media' => [], 'publications' => []])]);
        $this->assertSame(1, app(Synchronizer::class)->run()['conflicts']);
        $this->assertDatabaseCount('drafts', 2);
        $this->assertFalse($d->fresh()->dirty);
        $this->assertSame('Remote edit', $d->fresh()->title);
    }

    public function test_mcp_tools_share_draft_operations(): void
    {
        SendaeServer::tool(SaveDraft::class, ['id' => (string) Str::uuid(), 'title' => 'From an agent', 'version' => 0, 'content' => ['items' => [['text' => 'Agent-created draft', 'media_ids' => []]], 'overrides' => [], 'account_ids' => []]])->assertOk();
        $this->assertDatabaseHas('drafts', ['title' => 'From an agent']);
        SendaeServer::tool(WorkspaceTool::class, [])->assertOk();
    }

    public function test_sync_keeps_published_post_links_available_in_local_state(): void
    {
        $account = $this->account('threads');
        $draft = $this->draft($account);
        $draft->update(['dirty' => false]);
        $url = 'https://www.threads.com/@author/post/ABC';
        $publication = ['id' => (string) Str::uuid(), 'draft_id' => $draft->id, 'account_id' => $account->id, 'status' => 'published', 'scheduled_at' => now()->toIso8601String(), 'receipts' => ['123'], 'snapshot' => ['title' => $draft->title, 'items' => $draft->content['items'], 'post_urls' => ['123' => $url]]];
        Http::fake(['sendae.example/api/state' => Http::response(['drafts' => [], 'accounts' => [$account->toArray()], 'media' => [], 'publications' => [$publication]])]);

        app(Synchronizer::class)->run();

        $this->getJson('/local/state')->assertOk()->assertJsonPath('publications.0.snapshot.post_urls.123', $url)
            ->assertJsonPath('publications.0.receipts', ['123']);
        Http::assertSentCount(1);
    }

    public function test_scheduling_never_silently_uses_a_new_remote_edit(): void
    {
        config(['sendae.mode' => 'desktop']);
        Setting::write('session_origin', 'https://sendae.example');
        Setting::write('server_token', 'test-token');
        $draft = $this->draft();
        $draft->update(['dirty' => false, 'synced_version' => 1]);
        $content = $draft->content;
        $content['items'][0]['text'] = 'A different remote edit';
        $remote = ['id' => $draft->id, 'title' => $draft->title, 'version' => 2, 'content' => $content];
        Http::fake(['sendae.example/api/state' => Http::response(['drafts' => [$remote], 'accounts' => [], 'media' => [], 'publications' => []])]);
        try {
            app(Synchronizer::class)->remote('schedule', ['draft_id' => $draft->id, 'version' => 1, 'mode' => 'now']);
            $this->fail('Must review remote changes first.');
        } catch (ValidationException $e) {
            $this->assertArrayHasKey('conflict', $e->errors());
        }
        Http::assertSentCount(1);
        $this->assertSame('A different remote edit', $draft->fresh()->content['items'][0]['text']);
    }
}
