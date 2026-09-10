<?php

namespace Tests\Feature;

use App\Models\Draft;
use App\Models\Setting;
use App\Services\Attachments;
use App\Services\Synchronizer;
use App\Services\Workspace;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Native\Desktop\Facades\Shell;
use Native\Desktop\Facades\System;
use Tests\TestCase;

class ConnectionTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['sendae.service_url' => 'https://service.example']);
        Http::preventStrayRequests();
    }

    public function test_local_https_uses_the_configured_ca_without_disabling_verification(): void
    {
        config(['sendae.service_url' => 'https://sendae-server.test', 'sendae.service_ca' => '/local/herd-ca.pem']);
        Http::fake(['sendae-server.test/api/register' => function ($request, $options) {
            $this->assertSame('/local/herd-ca.pem', $options['verify']);

            return Http::response(['message' => 'Account created. Sign in to Sendae to continue.'], 201);
        }]);
        $this->postJson('/local/registration', ['name' => 'Test', 'email' => 'test@example.com', 'password' => 'secure-password', 'password_confirmation' => 'secure-password'])->assertOk();
        Http::assertSentCount(1);
    }

    public function test_sign_in_uses_fixed_endpoint_and_hides_encrypted_token(): void
    {
        Setting::write('server_url', 'https://untrusted.example');
        Http::fake(['service.example/api/session' => Http::response(['token' => 'private-token', 'workspace_id' => str_repeat('a', 64), 'email' => 'owner@example.com'])]);
        $this->postJson('/local/signIn', ['email' => 'owner@example.com', 'password' => 'private-password', 'server_url' => 'https://untrusted.example'])->assertOk()->assertJsonPath('signed_in', true);
        $this->assertSame('private-token', Setting::read('server_token'));
        $this->assertStringNotContainsString('private-token', Setting::find('server_token')->getRawOriginal('value'));
        $this->assertDatabaseMissing('settings', ['key' => 'server_url']);
        $this->getJson('/local/state')->assertJsonPath('settings.paired', true)->assertDontSee('private-token')->assertDontSee('private-password')->assertJsonMissingPath('settings.server_url');
        Http::assertSent(fn ($request) => $request->url() === 'https://service.example/api/session' && ! isset($request['server_url']));
        $this->postJson('/local/settings', ['server_url' => 'https://untrusted.example'])->assertNotFound();
    }

    public function test_failed_sign_in_does_not_replace_existing_connection(): void
    {
        Setting::write('server_token', 'old-token');
        Http::fake(['service.example/api/session' => Http::response(['message' => 'The sign-in details did not match.'], 401)]);
        $this->postJson('/local/signIn', ['email' => 'owner@example.com', 'password' => 'wrong'])->assertUnauthorized();
        $this->assertSame('old-token', Setting::read('server_token'));
        Http::assertSentCount(1);
    }

    public function test_switching_workspace_keeps_old_local_data_private(): void
    {
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
    }

    public function test_sign_out_revokes_session_but_preserves_drafts_and_workspace_binding(): void
    {
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
    }

    public function test_endpoint_change_does_not_send_an_existing_token_to_another_service(): void
    {
        Setting::write('server_token', 'private-token');
        Setting::write('session_origin', 'https://old.example');
        $this->postJson('/local/sync')->assertUnauthorized();
        $this->getJson('/local/state')->assertUnauthorized();
        Http::assertNothingSent();
    }

    public function test_offline_sign_in_keeps_drafts_and_reports_reachable_error(): void
    {
        Http::fake(['service.example/api/session' => Http::failedConnection()]);
        $this->postJson('/local/signIn', ['email' => 'owner@example.com', 'password' => 'password'])->assertStatus(503);
        $this->assertDatabaseMissing('settings', ['key' => 'server_token']);
        Http::assertSentCount(1);
    }

    public function test_signed_out_profile_cannot_read_or_modify_the_workspace(): void
    {
        $draft = Draft::create(['title' => 'Private draft', 'content' => ['items' => [], 'overrides' => [], 'account_ids' => []]]);
        $this->get('/')->assertOk();
        $this->getJson('/local/csrf')->assertOk();
        $this->getJson('/local/state')->assertUnauthorized()->assertDontSee('Private draft');
        $this->get('/local/media/'.Str::uuid())->assertUnauthorized();
        foreach (['drafts', 'media', 'schedule', 'cancel', 'recover', 'sync', 'account', 'disconnect', 'analytics', 'connect'] as $action) {
            $this->postJson('/local/'.$action, [])->assertUnauthorized();
        }
        $this->assertDatabaseHas('drafts', ['id' => $draft->id, 'title' => 'Private draft']);
        Http::assertNothingSent();
    }

    public function test_mcp_services_require_authentication_even_without_http_middleware(): void
    {
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
    }

    public function test_revoked_session_locks_the_workspace_again(): void
    {
        Setting::write('server_token', 'revoked-token');
        Setting::write('session_origin', 'https://service.example');
        Http::fake(['service.example/api/state' => Http::response(['message' => 'Unauthenticated.'], 401)]);
        $this->postJson('/local/sync')->assertUnauthorized();
        $this->getJson('/local/state')->assertUnauthorized();
        $this->postJson('/local/verification', [])->assertNotFound();
        $this->assertNull(Setting::read('server_token'));
        Http::assertSentCount(1);
    }

    public function test_expired_passport_session_cannot_unlock_local_drafts(): void
    {
        Setting::write('server_token', 'header.'.base64_encode(json_encode(['exp' => 1])).'.signature');
        Setting::write('session_origin', 'https://service.example');
        $this->getJson('/local/state')->assertUnauthorized();
        $this->postJson('/local/drafts', [])->assertUnauthorized();
        Http::assertNothingSent();
    }

    public function test_registration_uses_fixed_service_and_requires_sign_in(): void
    {
        Http::fake(['service.example/api/register' => Http::response(['message' => 'Account created. Sign in to Sendae to continue.'], 201)]);
        $this->postJson('/local/registration', ['name' => 'New customer', 'email' => 'new@example.com', 'password' => '1234567', 'password_confirmation' => '1234567'])->assertUnprocessable()->assertJsonValidationErrors(['password' => 'The password field must be at least 8 characters.']);
        Http::assertNothingSent();
        $this->postJson('/local/registration', ['name' => 'New customer', 'email' => 'new@example.com', 'password' => '12345678', 'password_confirmation' => '12345678', 'server_url' => 'https://untrusted.example'])->assertOk()->assertJsonPath('message', 'Account created. Sign in to Sendae to continue.');
        $this->getJson('/local/state')->assertUnauthorized();
        $this->postJson('/local/verification', [])->assertNotFound();
        $this->assertNull(Setting::read('server_token'));
        Http::assertSent(fn ($request) => $request->url() === 'https://service.example/api/register' && ! isset($request['server_url']));
    }

    public function test_native_api_requires_the_electron_bridge_secret_even_when_signed_in(): void
    {
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
    }

    public function test_native_sessions_are_sealed_by_the_operating_system(): void
    {
        config(['nativephp-internal.running' => true]);
        System::shouldReceive('canEncrypt')->once()->andReturn(true);
        System::shouldReceive('encrypt')->once()->with('private-token')->andReturn('os-encrypted');
        System::shouldReceive('decrypt')->once()->with('os-encrypted')->andReturn('private-token');
        Setting::write('server_token', 'private-token');
        $this->assertSame('native:os-encrypted', Setting::findOrFail('server_token')->value);
        $this->assertSame('private-token', Setting::read('server_token'));
        config(['nativephp-internal.running' => false]);
        $this->assertNull(Setting::read('server_token'));
    }

    public function test_local_upload_problems_do_not_block_cancelling_hosted_work(): void
    {
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
    }

    public function test_connect_opens_the_hosted_ticket_in_the_system_browser(): void
    {
        Setting::write('server_token', 'private-token');
        Setting::write('session_origin', 'https://service.example');
        $url = 'https://service.example/connections/'.str_repeat('a', 64);
        Http::fake(['service.example/api/connect' => Http::response(['url' => $url])]);
        $shell = Shell::fake();

        $this->postJson('/local/connect', ['provider' => 'x'])->assertOk()->assertJsonPath('opened', true);

        $shell->assertOpenedExternal($url);
        Http::assertSent(fn ($request) => $request->url() === 'https://service.example/api/connect' && $request['provider'] === 'x');
    }

    public function test_connect_rejects_an_unexpected_connection_address(): void
    {
        Setting::write('server_token', 'private-token');
        Setting::write('session_origin', 'https://service.example');
        Http::fake(['service.example/api/connect' => Http::response(['url' => 'https://evil.example/connections/'.str_repeat('a', 64)])]);
        $shell = Shell::fake();

        $this->postJson('/local/connect', ['provider' => 'x'])->assertStatus(422);
        $this->assertSame([], $shell->openExternalCalls);
    }
}
