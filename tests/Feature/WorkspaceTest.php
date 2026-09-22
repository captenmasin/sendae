<?php

use App\Models\Draft;
use App\Models\Account;
use App\Models\Setting;
use App\Services\Workspace;
use Illuminate\Support\Str;
use App\Mcp\Tools\SaveDraft;
use App\Services\Attachments;
use App\Services\Synchronizer;
use App\Mcp\Tools\WorkspaceTool;
use App\Mcp\Servers\SendaeServer;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Illuminate\Contracts\Cache\LockTimeoutException;

function account(string $provider = 'x'): Account
{
    return Account::create(['provider' => $provider, 'provider_id' => (string) random_int(1000, 9999), 'name' => 'Test account', 'status' => 'connected', 'timezone' => 'Europe/London', 'slots' => [['day' => 1, 'time' => '09:00']], 'credentials' => ['access_token' => 'test-secret']]);
}

function draft(?Account $a = null, array $items = []): Draft
{
    return Draft::create(['title' => 'Test draft', 'content' => ['items' => $items ?: [['text' => 'Hello world', 'media_ids' => []]], 'overrides' => [], 'account_ids' => $a ? [$a->id] : []]]);
}

beforeEach(function (): void {
    config(['sendae.service_url' => 'https://sendae.example']);
    Setting::write('server_token', 'test-token');
    Setting::write('session_origin', 'https://sendae.example');
    Http::preventStrayRequests();
});

test('desktop drafts persist empty text and stale saves overwrite', function (): void {
    config(['sendae.mode' => 'desktop']);
    $payload = ['id' => (string) Str::uuid(), 'title' => 'My draft', 'version' => 0, 'content' => ['items' => [['text' => '', 'media_ids' => []]], 'overrides' => [], 'account_ids' => []]];
    $this->postJson('/local/drafts', $payload)->assertOk()->assertJsonPath('draft.version', 1);
    $payload['version'] = 1;
    $payload['content']['items'][0]['text'] = 'First edit';
    $this->postJson('/local/drafts', $payload)->assertOk()->assertJsonPath('draft.version', 2);
    $payload['content']['items'][0]['text'] = 'Offline edit';
    $this->postJson('/local/drafts', $payload)->assertOk()->assertJsonPath('draft.version', 3)->assertJsonPath('draft.content.items.0.text', 'Offline edit')->assertJsonPath('conflict', null);
    $this->assertDatabaseCount('drafts', 1);
    $this->assertSame('Offline edit', Draft::find($payload['id'])->content['items'][0]['text']);
    $this->postJson('/local/drafts', $payload)->assertOk();
    $this->assertDatabaseCount('drafts', 1);
});

test('bluesky connection forwards credentials without storing them locally', function (): void {
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
});

test('bluesky network overrides can be saved', function (): void {
    $content = ['items' => [['text' => 'Shared text', 'media_ids' => []]], 'overrides' => ['bluesky' => [['text' => 'Bluesky text', 'media_ids' => []]]], 'account_ids' => []];
    $this->postJson('/local/drafts', ['id' => (string) Str::uuid(), 'title' => 'Bluesky draft', 'version' => 0, 'content' => $content])
        ->assertOk()->assertJsonPath('draft.content.overrides.bluesky.0.text', 'Bluesky text');
});

test('credentials are encrypted and never returned in state', function (): void {
    $a = account();
    $this->assertStringNotContainsString('test-secret', $a->getRawOriginal('credentials'));
    $this->assertArrayNotHasKey('credentials', app(Workspace::class)->state()['accounts'][0]->toArray());
    $this->assertSame('test-secret', $a->fresh()->credentials['access_token']);
});

test('local access rejects non loopback and untrusted hosts', function (): void {
    config(['sendae.mode' => 'desktop']);
    $this->withServerVariables(['REMOTE_ADDR' => '10.0.0.12'])->getJson('/local/state')->assertForbidden();
    $this->withServerVariables(['REMOTE_ADDR' => '127.0.0.1', 'HTTP_HOST' => 'attacker.example'])->getJson('http://attacker.example/local/state')->assertForbidden();
});

test('upload is durable and rejects executable media', function (): void {
    Storage::fake('local');
    $m = app(Attachments::class)->store(UploadedFile::fake()->image('picture.png'));
    Storage::disk('local')->assertExists($m->path);
    $this->expectException(ValidationException::class);
    app(Attachments::class)->store(UploadedFile::fake()->createWithContent('bad.php', '<?php echo "bad";'));
});

test('sync uploads dirty local drafts and ignores a server fork', function (): void {
    config(['sendae.mode' => 'desktop']);
    Setting::write('session_origin', 'https://sendae.example');
    Setting::write('server_token', 'test-token');
    $d = draft();
    $d->update(['title' => 'Local edit', 'dirty' => true, 'synced_version' => 1]);
    $copy = (string) Str::uuid();
    $remote = ['id' => $d->id, 'title' => 'Remote edit', 'version' => 2, 'content' => $d->content];
    $conflict = ['id' => $copy, 'title' => 'Local edit (conflict copy)', 'version' => 1, 'content' => $d->content];
    $uploaded = ['id' => $d->id, 'title' => 'Local edit', 'version' => 2, 'content' => $d->content];
    Http::fake(['sendae.example/api/drafts' => Http::sequence()->push(['draft' => $remote, 'conflict' => $conflict])->push(['draft' => $uploaded, 'conflict' => null]), 'sendae.example/api/state' => Http::response(['drafts' => [$uploaded], 'accounts' => [], 'media' => [], 'publications' => []])]);

    $this->assertSame(0, app(Synchronizer::class)->run()['conflicts']);
    $this->assertDatabaseCount('drafts', 1);
    $this->assertTrue($d->fresh()->dirty);
    $this->assertSame('Local edit', $d->fresh()->title);
    $this->assertSame(2, $d->fresh()->synced_version);

    $this->assertSame(0, app(Synchronizer::class)->run()['conflicts']);
    $this->assertDatabaseCount('drafts', 1);
    $this->assertFalse($d->fresh()->dirty);
    $this->assertSame('Local edit', $d->fresh()->title);
    $this->assertSame(2, $d->fresh()->version);
});

test('mcp tools share draft operations', function (): void {
    SendaeServer::tool(SaveDraft::class, ['id' => (string) Str::uuid(), 'title' => 'From an agent', 'version' => 0, 'content' => ['items' => [['text' => 'Agent-created draft', 'media_ids' => []]], 'overrides' => [], 'account_ids' => []]])->assertOk();
    $this->assertDatabaseHas('drafts', ['title' => 'From an agent']);
    SendaeServer::tool(WorkspaceTool::class, [])->assertOk();
});

test('sync keeps published post links available in local state', function (): void {
    $account = account('threads');
    $draft = draft($account);
    $draft->update(['dirty' => false]);
    $url = 'https://www.threads.com/@author/post/ABC';
    $publication = ['id' => (string) Str::uuid(), 'draft_id' => $draft->id, 'account_id' => $account->id, 'status' => 'published', 'scheduled_at' => now()->toIso8601String(), 'receipts' => ['123'], 'snapshot' => ['title' => $draft->title, 'items' => $draft->content['items'], 'post_urls' => ['123' => $url]]];
    Http::fake(['sendae.example/api/state' => Http::response(['drafts' => [], 'accounts' => [$account->toArray()], 'media' => [], 'publications' => [$publication]])]);

    app(Synchronizer::class)->run();

    $this->getJson('/local/state')->assertOk()->assertJsonPath('publications.0.snapshot.post_urls.123', $url)
        ->assertJsonPath('publications.0.receipts', ['123']);
    Http::assertSentCount(1);
});

test('sync lock timeout returns an actionable message', function (): void {
    $this->partialMock(Synchronizer::class)->shouldReceive('run')->once()->andThrow(new LockTimeoutException);

    $this->postJson('/local/sync')->assertServiceUnavailable()
        ->assertJsonPath('message', 'Sendae is still syncing. Please try again when syncing finishes.');
});

test('scheduling accepts version changes when the saved content matches', function (): void {
    $draft = draft(items: [['text' => '', 'media_ids' => []]]);
    $draft->update(['title' => '', 'version' => 7, 'synced_version' => 7, 'dirty' => false]);
    $remote = ['id' => $draft->id, 'title' => '', 'version' => 8, 'content' => $draft->content];
    Http::fake([
        'sendae.example/api/state' => Http::response(['drafts' => [$remote], 'accounts' => [], 'media' => [], 'publications' => []]),
        'sendae.example/api/schedule' => Http::response(['updated' => true]),
    ]);
    $requestId = (string) Str::uuid();

    $this->postJson('/local/schedule', ['draft_id' => $draft->id, 'version' => 2, 'mode' => 'preserve', 'update' => true, 'request_id' => $requestId,
        'draft_snapshot' => json_encode($draft->only(['title', 'content']), JSON_THROW_ON_ERROR)])
        ->assertOk()->assertExactJson(['updated' => true]);

    Http::assertSent(fn ($request) => $request->url() === 'https://sendae.example/api/schedule'
        && $request['version'] === 8 && $request['request_id'] === $requestId && ! isset($request['draft_snapshot']));
});

test('schedule preview forwards the current draft without creating a schedule', function (): void {
    $draft = draft();
    $draft->update(['dirty' => false, 'synced_version' => 1]);
    $preview = [['account_id' => (string) Str::uuid(), 'name' => 'Test account', 'timezone' => 'Europe/London', 'scheduled_at' => '2026-10-26T09:00:00+00:00']];
    Http::fake([
        'sendae.example/api/state' => Http::response(['drafts' => [$draft->fresh()->only(['id', 'title', 'version', 'content'])], 'accounts' => [], 'media' => [], 'publications' => []]),
        'sendae.example/api/schedulePreview' => Http::response($preview),
    ]);

    $this->postJson('/local/schedulePreview', [
        'draft_id' => $draft->id,
        'version' => 1,
        'draft_snapshot' => json_encode($draft->only(['title', 'content']), JSON_THROW_ON_ERROR),
    ])->assertOk()->assertExactJson($preview);

    Http::assertSent(fn ($request) => $request->url() === 'https://sendae.example/api/schedulePreview'
        && $request['draft_id'] === $draft->id && $request['version'] === 1 && ! isset($request['draft_snapshot']));
    $this->assertDatabaseCount('publications', 0);
});

test('scheduling rejects mismatched or invalid content without publishing', function (): void {
    $draft = draft();
    $payload = ['draft_id' => $draft->id, 'version' => $draft->version, 'mode' => 'preserve', 'update' => true];
    $snapshot = $draft->only(['title', 'content']);
    $snapshot['content']['items'][0]['text'] = 'Unsaved edit';

    $this->postJson('/local/schedule', $payload + ['draft_snapshot' => json_encode($snapshot, JSON_THROW_ON_ERROR)])
        ->assertUnprocessable()->assertJsonValidationErrors('content');
    $this->postJson('/local/schedule', $payload + ['draft_snapshot' => '{invalid'])
        ->assertUnprocessable()->assertJsonValidationErrors('draft_snapshot');

    Http::assertNothingSent();
    $this->assertSame('Hello world', $draft->fresh()->content['items'][0]['text']);
});

test('scheduling never silently uses a new remote edit', function (): void {
    config(['sendae.mode' => 'desktop']);
    Setting::write('session_origin', 'https://sendae.example');
    Setting::write('server_token', 'test-token');
    $draft = draft();
    $draft->update(['dirty' => false, 'synced_version' => 1]);
    $content = $draft->content;
    $content['items'][0]['text'] = 'A different remote edit';
    $remote = ['id' => $draft->id, 'title' => $draft->title, 'version' => 2, 'content' => $content];
    Http::fake(['sendae.example/api/state' => Http::response(['drafts' => [$remote], 'accounts' => [], 'media' => [], 'publications' => []])]);
    try {
        app(Synchronizer::class)->remote('schedule', ['draft_id' => $draft->id, 'version' => 1, 'mode' => 'now', 'draft_snapshot' => json_encode($draft->only(['title', 'content']), JSON_THROW_ON_ERROR)]);
        $this->fail('Must review remote changes first.');
    } catch (ValidationException $e) {
        $this->assertArrayHasKey('conflict', $e->errors());
    }
    Http::assertSentCount(1);
    $this->assertSame('A different remote edit', $draft->fresh()->content['items'][0]['text']);
});

test('destination splitting syncs dirty drafts first', function (string $action, array $data): void {
    $draft = draft();
    $draft->update(['dirty' => true, 'content' => [...$draft->content, 'account_ids' => ['one', 'two']]]);
    $remote = $draft->fresh()->only(['id', 'title', 'version', 'content']);
    $calls = [];
    Http::fake(function ($request) use (&$remote, &$calls, $action) {
        $path = basename(parse_url($request->url(), PHP_URL_PATH));
        $calls[] = $path;
        if ($path === 'drafts') {
            $remote['content'] = $request['content'];

            return Http::response(['draft' => $remote]);
        }
        if ($path === $action) {
            $remote['content']['account_ids'] = ['two'];
            $remote['version']++;

            return Http::response(['id' => 'publication']);
        }

        return Http::response(['drafts' => [$remote], 'accounts' => [], 'media' => [], 'publications' => []]);
    });

    $this->postJson('/local/'.$action, ['id' => (string) Str::uuid(), ...$data])->assertOk();

    $this->assertSame(['drafts', 'state', $action, 'state'], $calls);
    $this->assertSame(['two'], $draft->fresh()->content['account_ids']);
    $this->assertFalse($draft->fresh()->dirty);
})->with([
    ['recover', ['action' => 'reschedule']],
    ['cancel', ['separate' => true]],
]);
