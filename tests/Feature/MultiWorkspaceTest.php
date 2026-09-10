<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Draft;
use App\Models\Setting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class MultiWorkspaceTest extends TestCase
{
    use RefreshDatabase;

    public function test_switching_workspaces_preserves_private_local_data_and_scopes_requests(): void
    {
        config(['sendae.service_url' => 'https://service.example']);
        $a = str_repeat('a', 64);
        $b = str_repeat('b', 64);
        Setting::write('server_token', 'token');
        Setting::write('session_origin', 'https://service.example');
        Setting::write('workspace_id', $a);
        $draft = Draft::create(['title' => 'Sitepulse only', 'content' => []]);
        Account::create(['name' => 'Sitepulse X', 'provider' => 'x', 'provider_id' => '123']);
        Http::preventStrayRequests();
        Http::fake(['service.example/api/workspaces' => Http::response([['id' => $a, 'name' => 'Sitepulse', 'icon' => 'SP'], ['id' => $b, 'name' => 'Novogamer', 'icon' => '★']])]);

        $this->postJson('/local/switchWorkspace', ['id' => str_repeat('c', 64)])->assertNotFound();
        $this->assertSame($a, Setting::read('workspace_id'));
        $this->postJson('/local/switchWorkspace', ['id' => $b])->assertJsonPath('workspace_id', $b);
        $this->getJson('/local/state')->assertJsonCount(0, 'drafts')->assertJsonCount(0, 'accounts')->assertJsonPath('settings.workspaces.1.name', 'Novogamer');
        $this->withHeader('X-Workspace-Id', $a)->postJson('/local/drafts', [])->assertConflict();
        $this->withHeader('X-Workspace-Id', $b)->postJson('/local/deleteDraft', ['id' => $draft->id])->assertNotFound();
        $this->postJson('/local/switchWorkspace', ['id' => $a])->assertOk();
        $this->withHeader('X-Workspace-Id', $a)->getJson('/local/state')->assertJsonPath('drafts.0.title', 'Sitepulse only')->assertJsonPath('accounts.0.name', 'Sitepulse X');
        Http::assertSent(fn ($request) => $request->hasHeader('X-Workspace-Id', $b));
    }

    public function test_workspace_creation_and_edits_are_saved_on_the_service(): void
    {
        config(['sendae.service_url' => 'https://service.example']);
        $id = str_repeat('a', 64);
        Setting::write('server_token', 'token');
        Setting::write('session_origin', 'https://service.example');
        Setting::write('workspace_id', $id);
        $workspace = ['id' => $id, 'name' => 'Sitepulse', 'icon' => 'SP'];
        Http::preventStrayRequests();
        Http::fake([
            'service.example/api/workspaces' => fn ($request) => Http::response($request->method() === 'GET' ? [$workspace] : $workspace),
            'service.example/api/workspaces/'.$id => Http::response($workspace),
        ]);

        $this->postJson('/local/saveWorkspace', ['name' => '', 'icon' => ''])->assertUnprocessable();
        $this->postJson('/local/saveWorkspace', ['name' => 'Sitepulse', 'icon' => 'SP'])->assertJsonPath('id', $id);
        $this->postJson('/local/saveWorkspace', $workspace)->assertJsonPath('name', 'Sitepulse');
        $this->getJson('/local/state')->assertJsonPath('settings.workspaces.0.icon', 'SP');
        Http::assertSent(fn ($request) => $request->method() === 'PATCH' && $request->url() === 'https://service.example/api/workspaces/'.$id && $request['name'] === 'Sitepulse');
    }
}
