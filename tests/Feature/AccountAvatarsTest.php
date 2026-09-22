<?php

use App\Models\Setting;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Http;

test('sync keeps account pictures for the local accounts screen', function (): void {
    config(['sendae.service_url' => 'https://service.example']);
    Setting::write('server_token', 'session-token');
    Setting::write('session_origin', 'https://service.example');
    Setting::write('workspace_id', str_repeat('a', 64));
    Http::preventStrayRequests();
    $id = (string) Str::uuid();
    $account = ['id' => $id, 'name' => 'Page', 'provider' => 'facebook', 'provider_id' => '123', 'timezone' => 'UTC', 'slots' => [], 'status' => 'connected', 'avatar_url' => 'https://images.example/page.jpg', 'verified' => true];
    $state = ['drafts' => [], 'accounts' => [$account], 'media' => [], 'publications' => [], 'settings' => []];
    $withoutPicture = $state;
    unset($withoutPicture['accounts'][0]['avatar_url']);
    $withoutPicture['accounts'][0]['verified'] = false;
    Http::fake(['service.example/api/state' => Http::sequence()->push($state)->push($withoutPicture)]);
    $this->postJson('/local/sync')->assertOk();
    $this->assertDatabaseHas('accounts', ['id' => $id, 'avatar_url' => 'https://images.example/page.jpg', 'verified' => 1]);
    $this->getJson('/local/state')->assertOk()->assertJsonPath('accounts.0.avatar_url', 'https://images.example/page.jpg')->assertJsonPath('accounts.0.verified', true);
    $this->postJson('/local/sync')->assertOk();
    $this->getJson('/local/state')->assertOk()->assertJsonPath('accounts.0.avatar_url', null)->assertJsonPath('accounts.0.verified', false);
    Http::assertSentCount(2);
});
