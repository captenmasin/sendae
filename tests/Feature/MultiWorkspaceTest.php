<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Draft;
use App\Models\Setting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
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

    public function test_a_workspace_without_an_icon_uses_the_first_letter_of_its_name(): void
    {
        config(['sendae.service_url' => 'https://service.example']);
        $id = str_repeat('b', 64);
        Setting::write('server_token', 'token');
        Setting::write('session_origin', 'https://service.example');
        Setting::write('workspace_id', $id);
        Http::preventStrayRequests();
        Http::fake([
            'service.example/api/workspaces' => function ($request) use ($id) {
                $workspace = ['id' => $id, 'name' => $request['name'] ?? 'Personal', 'icon' => $request['icon'] ?? 'P', 'has_image' => false];

                return Http::response($request->method() === 'GET' ? [$workspace] : $workspace, $request->method() === 'POST' ? 201 : 200);
            },
        ]);

        $this->postJson('/local/saveWorkspace', ['name' => 'Personal'])->assertOk()->assertJsonPath('icon', 'P');
        Http::assertSent(fn ($request) => $request->method() === 'POST' && $request['name'] === 'Personal' && $request['icon'] === 'P');
    }

    public function test_workspace_images_are_stored_locally_and_removed_with_the_remote_copy(): void
    {
        config(['sendae.service_url' => 'https://service.example']);
        $id = str_repeat('a', 64);
        Setting::write('server_token', 'token');
        Setting::write('session_origin', 'https://service.example');
        Setting::write('workspace_id', $id);
        Http::preventStrayRequests();
        $withImage = ['id' => $id, 'name' => 'Sitepulse', 'icon' => 'S', 'has_image' => true];
        $withoutImage = ['id' => $id, 'name' => 'Sitepulse', 'icon' => 'S', 'has_image' => false];
        Http::fake([
            'service.example/api/workspaces/'.$id.'/image' => function ($request) use ($withImage) {
                if ($request->method() === 'DELETE') {
                    return Http::response(['deleted' => true]);
                }

                return Http::response($withImage);
            },
            'service.example/api/workspaces' => Http::sequence()->push([$withImage])->push([$withoutImage]),
        ]);
        Storage::fake('local');

        $this->post('/local/saveWorkspaceImage', ['id' => $id, 'file' => UploadedFile::fake()->image('mark.png')])->assertOk()->assertJsonPath('has_image', true);
        $this->get('/local/workspaceImage/'.$id)->assertOk()->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->postJson('/local/deleteWorkspaceImage', ['id' => $id])->assertOk();
        $this->get('/local/workspaceImage/'.$id)->assertNotFound();
        $this->post('/local/saveWorkspaceImage', ['id' => $id, 'file' => UploadedFile::fake()->create('notes.txt', 10, 'text/plain')])->assertUnprocessable();
    }
}
