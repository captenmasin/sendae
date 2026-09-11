<?php

namespace Tests\Feature;

use App\Models\Setting;
use App\Services\DesktopLinks;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Native\Desktop\Events\App\OpenedFromURL;
use Native\Desktop\Facades\Shell;
use PHPUnit\Framework\Attributes\TestWith;
use Tests\TestCase;

class DesktopLinksTest extends TestCase
{
    use RefreshDatabase;

    #[TestWith(['https://bsky.app/profile/did%3Aplc%3Aabc123/post/first'])]
    #[TestWith(['https://x.com/i/web/status/123'])]
    #[TestWith(['https://www.facebook.com/123_456'])]
    #[TestWith(['https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A123'])]
    #[TestWith(['https://www.threads.com/@author/post/ABC'])]
    #[TestWith(['https://www.threads.net/@author/post/ABC'])]
    public function test_post_links_open_in_the_system_browser(string $url): void
    {
        Setting::write('server_token', 'test-token');
        Setting::write('session_origin', rtrim(config('sendae.service_url'), '/'));
        $shell = Shell::fake();

        $this->postJson('/local/openPost', ['url' => $url])->assertOk()->assertExactJson(['opened' => true]);

        $shell->assertOpenedExternal($url);
    }

    #[TestWith(['https://bsky.app.evil.example/profile/sendae/post/first'])]
    #[TestWith(['file:///tmp/post.html'])]
    #[TestWith(['javascript:alert(1)'])]
    #[TestWith(['http://www.threads.com/@author/post/ABC'])]
    #[TestWith(['https://www.threads.com.evil.example/post/ABC'])]
    #[TestWith(['https://user:password@www.threads.com/post/ABC'])]
    public function test_unsafe_post_links_are_not_opened(string $url): void
    {
        Setting::write('server_token', 'test-token');
        Setting::write('session_origin', rtrim(config('sendae.service_url'), '/'));
        $shell = Shell::fake();

        $this->postJson('/local/openPost', ['url' => $url])->assertUnprocessable();

        $this->assertSame([], $shell->openExternalCalls);
    }

    public function test_post_links_require_sign_in(): void
    {
        $shell = Shell::fake();

        $this->postJson('/local/openPost', ['url' => 'https://x.com/i/web/status/123'])->assertUnauthorized();

        $this->assertSame([], $shell->openExternalCalls);
    }

    public function test_native_links_are_validated_and_consumed_once_without_sign_in(): void
    {
        $ticket = str_repeat('a', 64);
        event(new OpenedFromURL('sendae://authorize?ticket='.$ticket));
        $this->getJson('/local/link')->assertExactJson(['action' => 'authorize', 'ticket' => $ticket]);
        $this->getJson('/local/link')->assertExactJson([]);
        foreach (['https://authorize?ticket='.$ticket, 'sendae://authorize?ticket=bad', 'sendae://reset-password?token='.$ticket.'&email=bad', 'sendae://unknown', 'sendae://verified', 'sendae://user@authorize?ticket='.$ticket] as $url) {
            app(DesktopLinks::class)->receive($url);
            $this->getJson('/local/link')->assertExactJson([]);
        }
        app(DesktopLinks::class)->receive('sendae://authorize?ticket='.$ticket);
        $this->travel(11)->minutes();
        $this->getJson('/local/link')->assertExactJson([]);
    }

    public function test_reset_form_submits_to_the_fixed_api_without_a_session(): void
    {
        config(['sendae.service_url' => 'https://service.example']);
        Http::preventStrayRequests();
        Http::fake(['service.example/api/reset-password' => Http::response(['message' => 'Password updated.'])]);
        $token = str_repeat('a', 64);
        app(DesktopLinks::class)->receive('sendae://reset-password?'.http_build_query(['token' => $token, 'email' => 'person@example.com']));
        $this->getJson('/local/link')->assertJsonPath('action', 'reset-password')->assertJsonPath('token', $token);
        $this->postJson('/local/resetPassword', ['token' => $token, 'email' => 'person@example.com', 'password' => '1234567', 'password_confirmation' => '1234567'])->assertUnprocessable()->assertJsonValidationErrors(['password' => 'The password field must be at least 8 characters.']);
        Http::assertNothingSent();
        $this->postJson('/local/resetPassword', ['token' => $token, 'email' => 'person@example.com', 'password' => '12345678', 'password_confirmation' => '12345678'])->assertOk()->assertJsonPath('message', 'Password updated.');
        Http::assertSent(fn ($request) => $request->url() === 'https://service.example/api/reset-password' && $request['token'] === $token);
    }

    public function test_selection_and_consent_use_authenticated_api_calls(): void
    {
        config(['sendae.service_url' => 'https://service.example']);
        Setting::write('server_token', 'private-token');
        Setting::write('session_origin', 'https://service.example');
        $ticket = str_repeat('a', 64);
        Http::preventStrayRequests();
        Http::fake([
            'service.example/api/connections/'.$ticket => Http::response(['connected' => true]),
            'service.example/api/authorizations/'.$ticket => Http::response(['redirect_url' => 'https://client.example/callback?code=code']),
        ]);
        $shell = Shell::fake();
        $this->postJson('/local/selectConnection', ['ticket' => $ticket, 'accounts' => [0], 'timezone' => 'UTC'])->assertJsonPath('connected', true);
        $this->postJson('/local/decideAuthorization', ['ticket' => $ticket, 'approved' => true])->assertJsonPath('completed', true);
        $shell->assertOpenedExternal('https://client.example/callback?code=code');
        Http::assertSent(fn ($request) => $request->url() === 'https://service.example/api/authorizations/'.$ticket && $request->hasHeader('Authorization', 'Bearer private-token') && $request['approved'] === true);
    }

    public function test_consent_cannot_open_an_unsafe_callback(): void
    {
        config(['sendae.service_url' => 'https://service.example']);
        Setting::write('server_token', 'private-token');
        Setting::write('session_origin', 'https://service.example');
        $ticket = str_repeat('a', 64);
        Http::preventStrayRequests();
        Http::fake(['service.example/api/authorizations/'.$ticket => Http::response(['redirect_url' => 'file:///tmp/unsafe'])]);
        $shell = Shell::fake();

        $this->postJson('/local/decideAuthorization', ['ticket' => $ticket, 'approved' => true])->assertUnprocessable();
        $this->assertSame([], $shell->openExternalCalls);
    }
}
