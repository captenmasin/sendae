<?php

namespace Tests\Feature;

use App\Models\Setting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ProfileSettingsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['sendae.service_url' => 'https://service.example']);
        Http::preventStrayRequests();
    }

    public function test_profile_updates_are_saved_on_the_service_and_shown_in_settings(): void
    {
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
    }

    public function test_profile_update_rejects_missing_name_and_invalid_email(): void
    {
        Setting::write('server_token', 'token');
        Setting::write('session_origin', 'https://service.example');

        $this->postJson('/local/profile', ['name' => '', 'email' => 'not-an-email'])->assertUnprocessable()->assertJsonValidationErrors(['name', 'email']);
        Http::assertNothingSent();
    }

    public function test_signed_out_users_cannot_update_their_profile(): void
    {
        $this->postJson('/local/profile', ['name' => 'Ada', 'email' => 'ada@example.com'])->assertUnauthorized();
        Http::assertNothingSent();
    }
}
