<?php

use App\Models\Draft;
use App\Models\Setting;
use App\Services\Workspace;
use Illuminate\Support\Str;
use App\Services\Attachments;
use App\Services\Synchronizer;
use Native\Desktop\Facades\Shell;
use Native\Desktop\Facades\System;
use Illuminate\Support\Facades\Http;
use Illuminate\Auth\AuthenticationException;

beforeEach(function (): void {
    config(['sendae.service_url' => 'https://service.example']);
    Http::preventStrayRequests();
});

test('local https uses the configured ca without disabling verification', function (): void {
    config(['sendae.service_url' => 'https://sendae-server.test', 'sendae.service_ca' => '/local/herd-ca.pem']);
    Http::fake(['sendae-server.test/api/register' => function ($request, $options) {
        $this->assertSame('/local/herd-ca.pem', $options['verify']);

        return Http::response(['message' => 'Account created. Sign in to Sendae to continue.'], 201);
    }]);
    $this->postJson('/local/registration', ['name' => 'Test', 'email' => 'test@example.com', 'password' => 'secure-password', 'password_confirmation' => 'secure-password'])->assertOk();
    Http::assertSentCount(1);
});

test('sign in uses fixed endpoint and hides encrypted token', function (): void {
    config(['sendae.service_url' => 'https://api.sendae.app']);
    Setting::write('server_url', 'https://untrusted.example');
    Http::fake(['api.sendae.app/api/session' => Http::response(['token' => 'private-token', 'workspace_id' => str_repeat('a', 64), 'email' => 'owner@example.com'])]);
    $this->postJson('/local/signIn', ['email' => 'owner@example.com', 'password' => 'private-password', 'server_url' => 'https://untrusted.example'])->assertOk()->assertJsonPath('signed_in', true);
    $this->assertSame('private-token', Setting::read('server_token'));
    $this->assertStringNotContainsString('private-token', Setting::find('server_token')->getRawOriginal('value'));
    $this->assertDatabaseMissing('settings', ['key' => 'server_url']);
    $this->getJson('/local/state')->assertJsonPath('settings.paired', true)->assertDontSee('private-token')->assertDontSee('private-password')->assertJsonMissingPath('settings.server_url');
    Http::assertSent(fn ($request) => $request->url() === 'https://api.sendae.app/api/session' && ! isset($request['server_url']));
    $this->postJson('/local/settings', ['server_url' => 'https://untrusted.example'])->assertNotFound();
});

test('failed sign in does not replace existing connection', function (): void {
    Setting::write('server_token', 'old-token');
    Http::fake(['service.example/api/session' => Http::response(['message' => 'The sign-in details did not match.'], 401)]);
    $this->postJson('/local/signIn', ['email' => 'owner@example.com', 'password' => 'wrong'])->assertUnauthorized();
    $this->assertSame('old-token', Setting::read('server_token'));
    Http::assertSentCount(1);
});

test('switching workspace keeps old local data private', function (): void {
    Setting::write('workspace_id', str_repeat('a', 64));
    $draft = Draft::create(['title' => 'Account A private', 'content' => ['items' => [], 'overrides' => [], 'account_ids' => []]]);
    Http::fake(['service.example/api/session' => Http::response(['token' => 'other-token', 'workspace_id' => str_repeat('b', 64), 'email' => 'other@example.com'])]);
    $this->postJson('/local/signIn', ['email' => 'other@example.com', 'password' => 'password'])->assertOk()->assertJsonPath('workspace_changed', true);
    $this->getJson('/local/state')->assertOk()->assertJsonCount(0, 'drafts');
    $this->getJson('/local/media/'.$draft->id)->assertNotFound();
    $this->assertDatabaseHas('drafts', ['id' => $draft->id, 'workspace_id' => str_repeat('a', 64)]);
    Http::assertSent(fn ($request) => ! isset($request['workspace_id']));
    Setting::write('workspace_id', str_repeat('a', 64));
    $this->getJson('/local/state')->assertOk()->assertJsonPath('drafts.0.title', 'Account A private');
});

test('sign out revokes session but preserves drafts and workspace binding', function (): void {
    Setting::write('server_token', 'private-token');
    Setting::write('session_origin', 'https://service.example');
    Setting::write('workspace_id', str_repeat('a', 64));
    $draft = Draft::create(['title' => 'Keep me', 'content' => ['items' => [], 'overrides' => [], 'account_ids' => []]]);
    Http::fake(['service.example/api/session' => Http::response(['signed_out' => true])]);
    $this->postJson('/local/signOut')->assertOk();
    $this->assertNull(Setting::read('server_token'));
    $this->assertSame(str_repeat('a', 64), Setting::read('workspace_id'));
    $this->assertDatabaseHas('drafts', ['id' => $draft->id]);
    Http::assertSent(fn ($request) => $request->method() === 'DELETE' && $request->hasHeader('Authorization', 'Bearer private-token'));
});

test('endpoint change does not send an existing token to another service', function (): void {
    Setting::write('server_token', 'private-token');
    Setting::write('session_origin', 'https://old.example');
    $this->postJson('/local/sync')->assertUnauthorized();
    $this->getJson('/local/state')->assertUnauthorized();
    Http::assertNothingSent();
});

test('offline sign in keeps drafts and reports reachable error', function (): void {
    Http::fake(['service.example/api/session' => Http::failedConnection()]);
    $this->postJson('/local/signIn', ['email' => 'owner@example.com', 'password' => 'password'])->assertStatus(503);
    $this->assertDatabaseMissing('settings', ['key' => 'server_token']);
    Http::assertSentCount(1);
});

test('signed out profile cannot read or modify the workspace', function (): void {
    $draft = Draft::create(['title' => 'Private draft', 'content' => ['items' => [], 'overrides' => [], 'account_ids' => []]]);
    $this->get('/')->assertOk();
    $this->getJson('/local/csrf')->assertOk();
    $this->getJson('/local/state')->assertUnauthorized()->assertDontSee('Private draft');
    $this->get('/local/media/'.Str::uuid())->assertUnauthorized();
    $this->get('/local/workspaceImage/'.str_repeat('a', 64))->assertUnauthorized();
    foreach (['drafts', 'media', 'schedule', 'cancel', 'recover', 'sync', 'account', 'disconnect', 'analytics', 'connect', 'profile', 'saveWorkspaceImage', 'deleteWorkspaceImage'] as $action) {
        $this->postJson('/local/'.$action, [])->assertUnauthorized();
    }
    $this->assertDatabaseHas('drafts', ['id' => $draft->id, 'title' => 'Private draft']);
    Http::assertNothingSent();
});

test('mcp services require authentication even without http middleware', function (): void {
    foreach ([fn () => app(Workspace::class)->state(), fn () => app(Workspace::class)->save([]), fn () => app(Attachments::class)->base64([]), fn () => app(Synchronizer::class)->remote('schedule', [])] as $operation) {
        try {
            $operation();
            $this->fail('Signed-out access must be rejected.');
        } catch (AuthenticationException $e) {
            $this->assertSame('Sign in to Sendae to continue.', $e->getMessage());
        }
    }
    $this->assertDatabaseCount('drafts', 0);
    $this->assertDatabaseCount('media', 0);
});

test('revoked session locks the workspace again', function (): void {
    Setting::write('server_token', 'revoked-token');
    Setting::write('session_origin', 'https://service.example');
    Http::fake(['service.example/api/state' => Http::response(['message' => 'Unauthenticated.'], 401)]);
    $this->postJson('/local/sync')->assertUnauthorized();
    $this->getJson('/local/state')->assertUnauthorized();
    $this->postJson('/local/verification', [])->assertNotFound();
    $this->assertNull(Setting::read('server_token'));
    Http::assertSentCount(1);
});

test('expired passport session cannot unlock local drafts', function (): void {
    Setting::write('server_token', 'header.'.base64_encode(json_encode(['exp' => 1])).'.signature');
    Setting::write('session_origin', 'https://service.example');
    $this->getJson('/local/state')->assertUnauthorized();
    $this->postJson('/local/drafts', [])->assertUnauthorized();
    Http::assertNothingSent();
});

test('registration uses fixed service and requires sign in', function (): void {
    Http::fake(['service.example/api/register' => Http::response(['message' => 'Account created. Sign in to Sendae to continue.'], 201)]);
    $this->postJson('/local/registration', ['name' => 'New customer', 'email' => 'new@example.com', 'password' => '1234567', 'password_confirmation' => '1234567'])->assertUnprocessable()->assertJsonValidationErrors(['password' => 'The password field must be at least 8 characters.']);
    Http::assertNothingSent();
    $this->postJson('/local/registration', ['name' => 'New customer', 'email' => 'new@example.com', 'password' => '12345678', 'password_confirmation' => '12345678', 'server_url' => 'https://untrusted.example'])->assertOk()->assertJsonPath('message', 'Account created. Sign in to Sendae to continue.');
    $this->getJson('/local/state')->assertUnauthorized();
    $this->postJson('/local/verification', [])->assertNotFound();
    $this->assertNull(Setting::read('server_token'));
    Http::assertSent(fn ($request) => $request->url() === 'https://service.example/api/register' && ! isset($request['server_url']));
});

test('native api requires the electron bridge secret even when signed in', function (): void {
    System::shouldReceive('canEncrypt')->andReturn(true);
    System::shouldReceive('encrypt')->with('private-token')->andReturn('os-encrypted');
    System::shouldReceive('decrypt')->with('os-encrypted')->andReturn('private-token');
    config(['nativephp-internal.running' => true, 'nativephp-internal.secret' => 'test-bridge-secret']);
    Setting::write('server_token', 'private-token');
    Setting::write('session_origin', 'https://service.example');
    $this->getJson('/local/state')->assertForbidden();
    $this->postJson('/local/signIn', ['email' => 'other@example.com', 'password' => 'password'])->assertForbidden();
    $this->withHeader('X-NativePHP-Secret', 'test-bridge-secret')->getJson('/local/state')->assertOk();
    Http::assertNothingSent();
});

test('native sessions are sealed by the operating system', function (): void {
    config(['nativephp-internal.running' => true]);
    System::shouldReceive('canEncrypt')->once()->andReturn(true);
    System::shouldReceive('encrypt')->once()->with('private-token')->andReturn('os-encrypted');
    System::shouldReceive('decrypt')->once()->with('os-encrypted')->andReturn('private-token');
    Setting::write('server_token', 'private-token');
    $this->assertSame('native:os-encrypted', Setting::findOrFail('server_token')->value);
    $this->assertSame('private-token', Setting::read('server_token'));
    config(['nativephp-internal.running' => false]);
    $this->assertNull(Setting::read('server_token'));
});

test('local upload problems do not block cancelling hosted work', function (): void {
    Setting::write('server_token', 'private-token');
    Setting::write('session_origin', 'https://service.example');
    $draft = Draft::create(['title' => 'Waiting to sync', 'content' => ['items' => [], 'overrides' => [], 'account_ids' => []]]);
    Http::fake([
        'service.example/api/state' => Http::response(['drafts' => [], 'accounts' => [], 'media' => [], 'publications' => []]),
        'service.example/api/cancel' => Http::response(['cancelled' => true]),
    ]);
    $this->postJson('/local/cancel', ['id' => (string) Str::uuid()])->assertOk()->assertJsonPath('cancelled', true);
    $this->assertTrue($draft->fresh()->dirty);
    Http::assertNotSent(fn ($request) => str_ends_with($request->url(), '/drafts'));
});

test('connect opens the hosted ticket in the system browser', function (): void {
    Setting::write('server_token', 'private-token');
    Setting::write('session_origin', 'https://service.example');
    $url = 'https://service.example/connections/'.str_repeat('a', 64);
    Http::fake(['service.example/api/connect' => Http::response(['url' => $url])]);
    $shell = Shell::fake();

    $this->postJson('/local/connect', ['provider' => 'x'])->assertOk()->assertJsonPath('opened', true);

    $shell->assertOpenedExternal($url);
    Http::assertSent(fn ($request) => $request->url() === 'https://service.example/api/connect' && $request['provider'] === 'x');
});

test('connect rejects an unexpected connection address', function (): void {
    Setting::write('server_token', 'private-token');
    Setting::write('session_origin', 'https://service.example');
    Http::fake(['service.example/api/connect' => Http::response(['url' => 'https://evil.example/connections/'.str_repeat('a', 64)])]);
    $shell = Shell::fake();

    $this->postJson('/local/connect', ['provider' => 'x'])->assertStatus(422);
    $this->assertSame([], $shell->openExternalCalls);
});

test('social login opens the fixed service and exchanges a device bound ticket', function (string $provider): void {
    $ticket = str_repeat('t', 64);
    $shell = Shell::fake();
    Http::fake([
        'service.example/api/social-login/'.$provider => Http::response(['ticket' => $ticket, 'url' => 'https://service.example/sign-in/'.$ticket]),
        'service.example/api/social-login/finish/'.$ticket => Http::sequence()
            ->push(['needs_profile' => true, 'name' => 'Person', 'email' => 'person@example.com'])
            ->push(['token' => 'private-token', 'workspace_id' => str_repeat('b', 64), 'name' => 'Person', 'email' => 'person@example.com', 'has_password' => false]),
    ]);
    Setting::write('workspace_id', str_repeat('a', 64));
    $draft = Draft::create(['title' => 'Keep private', 'content' => ['items' => [], 'overrides' => [], 'account_ids' => []]]);

    $this->postJson('/local/socialSignIn', ['provider' => $provider])->assertOk()->assertExactJson(['opened' => true]);
    $shell->assertOpenedExternal('https://service.example/sign-in/'.$ticket);
    $this->postJson('/local/finishSocialSignIn', ['ticket' => str_repeat('z', 64)])->assertForbidden();
    $this->postJson('/local/finishSocialSignIn', ['ticket' => $ticket])->assertOk()->assertJsonPath('needs_profile', true);
    $this->assertNull(Setting::read('server_token'));
    $this->postJson('/local/finishSocialSignIn', ['ticket' => $ticket, 'name' => 'Person', 'email' => 'person@example.com', 'verifier' => 'injected'])->assertOk()->assertJsonPath('signed_in', true)->assertDontSee('private-token');
    $this->assertSame('private-token', Setting::read('server_token'));
    $this->getJson('/local/state')->assertJsonCount(0, 'drafts')->assertJsonPath('settings.has_password', false);
    $this->assertDatabaseHas('drafts', ['id' => $draft->id, 'workspace_id' => str_repeat('a', 64)]);
    $this->postJson('/local/finishSocialSignIn', ['ticket' => $ticket])->assertForbidden();
    Http::assertSent(fn ($request) => str_contains($request->url(), '/finish/') && strlen($request['verifier']) === 64 && $request['verifier'] !== 'injected');
    Http::assertSentCount(3);
})->with(['google', 'facebook', 'x']);

test('social login cannot open a foreign service or exchange an unsolicited ticket', function (): void {
    $shell = Shell::fake();
    Http::fake(['service.example/api/social-login/google' => Http::response(['ticket' => str_repeat('t', 64), 'url' => 'https://evil.example/login'])]);
    $this->postJson('/local/socialSignIn', ['provider' => 'unknown'])->assertUnprocessable();
    $this->postJson('/local/finishSocialSignIn', ['ticket' => str_repeat('t', 64)])->assertForbidden();
    Http::assertNothingSent();
    $this->postJson('/local/socialSignIn', ['provider' => 'google'])->assertStatus(502);
    $this->assertSame([], $shell->openExternalCalls);
    $this->assertNull(Setting::read('server_token'));
    Http::assertSentCount(1);
});

test('sign out cancels a pending provider sign in', function (): void {
    $ticket = str_repeat('t', 64);
    Shell::fake();
    Http::fake(['service.example/api/social-login/google' => Http::response(['ticket' => $ticket, 'url' => 'https://service.example/sign-in/'.$ticket])]);
    $this->postJson('/local/socialSignIn', ['provider' => 'google'])->assertOk();
    $this->postJson('/local/signOut')->assertOk();
    $this->postJson('/local/finishSocialSignIn', ['ticket' => $ticket])->assertForbidden();
    $this->assertNull(Setting::read('server_token'));
    Http::assertSentCount(1);
});
