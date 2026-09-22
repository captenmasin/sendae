<?php

use App\Models\Setting;
use Illuminate\Support\Facades\Http;

beforeEach(function (): void {
    config(['sendae.service_url' => 'https://service.example']);
    Http::preventStrayRequests();
});

test('profile updates are saved on the service and shown in settings', function (): void {
    Setting::write('server_token', 'token');
    Setting::write('session_origin', 'https://service.example');
    Setting::write('workspace_id', str_repeat('a', 64));
    Setting::write('account_name', 'Old');
    Setting::write('account_email', 'old@example.com');
    Http::fake(['service.example/api/profile' => Http::response(['name' => 'Ada Lovelace', 'email' => 'ada@example.com'])]);

    $this->postJson('/local/profile', [
        'name' => 'Ada Lovelace',
        'email' => 'ada@example.com',
        'current_password' => 'secret-password',
    ])->assertOk()->assertJsonPath('name', 'Ada Lovelace')->assertJsonPath('email', 'ada@example.com');

    $this->getJson('/local/state')
        ->assertJsonPath('settings.name', 'Ada Lovelace')
        ->assertJsonPath('settings.email', 'ada@example.com');
    Http::assertSent(fn ($request) => $request->method() === 'PATCH' && $request->url() === 'https://service.example/api/profile' && $request['name'] === 'Ada Lovelace');
});

test('profile update rejects missing name and invalid email', function (): void {
    Setting::write('server_token', 'token');
    Setting::write('session_origin', 'https://service.example');

    $this->postJson('/local/profile', ['name' => '', 'email' => 'not-an-email'])->assertUnprocessable()->assertJsonValidationErrors(['name', 'email']);
    Http::assertNothingSent();
});

test('signed out users cannot update their profile', function (): void {
    $this->postJson('/local/profile', ['name' => 'Ada', 'email' => 'ada@example.com'])->assertUnauthorized();
    Http::assertNothingSent();
});
