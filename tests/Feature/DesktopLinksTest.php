<?php

use App\Models\Setting;
use App\Services\DesktopLinks;
use Native\Desktop\Facades\Shell;
use Illuminate\Support\Facades\Http;
use Native\Desktop\Events\App\OpenedFromURL;

test('post links open in the system browser', function (string $url): void {
    Setting::write('server_token', 'test-token');
    Setting::write('session_origin', rtrim(config('sendae.service_url'), '/'));
    $shell = Shell::fake();

    $this->postJson('/local/openPost', ['url' => $url])->assertOk()->assertExactJson(['opened' => true]);

    $shell->assertOpenedExternal($url);
})->with([
    ['https://bsky.app/profile/did%3Aplc%3Aabc123/post/first'],
    ['https://x.com/i/web/status/123'],
    ['https://www.facebook.com/123_456'],
    ['https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A123'],
    ['https://www.threads.com/@author/post/ABC'],
    ['https://www.threads.net/@author/post/ABC'],
]);

test('unsafe post links are not opened', function (string $url): void {
    Setting::write('server_token', 'test-token');
    Setting::write('session_origin', rtrim(config('sendae.service_url'), '/'));
    $shell = Shell::fake();

    $this->postJson('/local/openPost', ['url' => $url])->assertUnprocessable();

    $this->assertSame([], $shell->openExternalCalls);
})->with([
    ['https://bsky.app.evil.example/profile/sendae/post/first'],
    ['file:///tmp/post.html'],
    ['javascript:alert(1)'],
    ['http://www.threads.com/@author/post/ABC'],
    ['https://www.threads.com.evil.example/post/ABC'],
    ['https://user:password@www.threads.com/post/ABC'],
]);

test('connector links open in the system browser', function (string $url): void {
    Setting::write('server_token', 'test-token');
    Setting::write('session_origin', rtrim(config('sendae.service_url'), '/'));
    $shell = Shell::fake();

    $this->postJson('/local/openLink', ['url' => $url])->assertOk()->assertExactJson(['opened' => true]);

    $shell->assertOpenedExternal($url);
})->with([
    ['https://chatgpt.com/#settings/Security'],
    ['https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins'],
    ['https://claude.ai/new?modal=add-custom-connector#customize/connectors'],
]);

test('unlisted connector links are not opened', function (string $url): void {
    Setting::write('server_token', 'test-token');
    Setting::write('session_origin', rtrim(config('sendae.service_url'), '/'));
    $shell = Shell::fake();

    $this->postJson('/local/openLink', ['url' => $url])->assertUnprocessable();

    $this->assertSame([], $shell->openExternalCalls);
})->with([
    ['https://chatgpt.com.evil.example/#settings/Security'],
    ['https://claude.ai/new?modal=add-custom-connector#customize/connectors/extra'],
    ['http://chatgpt.com/#settings/Security'],
]);

test('post links require sign in', function (): void {
    $shell = Shell::fake();

    $this->postJson('/local/openPost', ['url' => 'https://x.com/i/web/status/123'])->assertUnauthorized();

    $this->assertSame([], $shell->openExternalCalls);
});

test('native links are validated and consumed once without sign in', function (): void {
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
});

test('reset form submits to the fixed api without a session', function (): void {
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
});

test('selection and consent use authenticated api calls', function (): void {
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
});

test('consent cannot open an unsafe callback', function (): void {
    config(['sendae.service_url' => 'https://service.example']);
    Setting::write('server_token', 'private-token');
    Setting::write('session_origin', 'https://service.example');
    $ticket = str_repeat('a', 64);
    Http::preventStrayRequests();
    Http::fake(['service.example/api/authorizations/'.$ticket => Http::response(['redirect_url' => 'file:///tmp/unsafe'])]);
    $shell = Shell::fake();

    $this->postJson('/local/decideAuthorization', ['ticket' => $ticket, 'approved' => true])->assertUnprocessable();
    $this->assertSame([], $shell->openExternalCalls);
});

test('social sign in handoffs expose only the ticket and are consumed once', function (): void {
    $ticket = str_repeat('t', 64);
    app(DesktopLinks::class)->receive('sendae://sign-in?ticket='.$ticket.'&token=secret');
    $this->getJson('/local/link')->assertExactJson(['action' => 'sign-in', 'ticket' => $ticket]);
    $this->getJson('/local/link')->assertExactJson([]);
    app(DesktopLinks::class)->receive('sendae://sign-in?ticket=bad');
    $this->getJson('/local/link')->assertExactJson([]);
});
