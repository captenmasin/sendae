<?php

namespace Tests\Feature;

use App\Models\Setting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class WorkspaceImagesTest extends TestCase
{
    use RefreshDatabase;

    public function test_uploaded_avatar_remains_available_after_sync_and_is_removed_only_on_request(): void
    {
        config(['sendae.service_url' => 'https://service.example']);
        Setting::write('server_token', 'token');
        Setting::write('session_origin', 'https://service.example');
        $id = str_repeat('a', 64);
        Setting::write('workspace_id', $id);
        Storage::fake('local');
        Http::preventStrayRequests();
        $workspace = ['id' => $id, 'name' => 'Studio', 'has_image' => true, 'updated_at' => '2026-09-11T12:00:00Z'];
        $removed = [...$workspace, 'has_image' => false];
        Http::fake([
            'service.example/api/workspaces/'.$id.'/image' => Http::sequence()->push($workspace)->pushStatus(204),
            'service.example/api/workspaces' => Http::sequence()->push([$workspace])->push([$removed]),
            'service.example/api/state' => Http::response(['drafts' => [], 'accounts' => [], 'publications' => [], 'media' => [], 'settings' => ['workspaces' => [$workspace]]]),
        ]);

        $this->post('/local/saveWorkspaceImage', ['id' => $id, 'file' => UploadedFile::fake()->image('avatar.png')])->assertOk();
        $this->postJson('/local/sync')->assertOk();

        $this->getJson('/local/state')->assertJsonPath('settings.workspaces.0.has_image', true);
        $this->get('/local/workspaceImage/'.$id)->assertOk()->assertHeader('Content-Type', 'image/png');
        Storage::disk('local')->assertExists('workspace-images/'.$id);
        $this->postJson('/local/deleteWorkspaceImage', ['id' => $id])->assertOk();
        $this->getJson('/local/state')->assertJsonPath('settings.workspaces.0.has_image', false);
        $this->get('/local/workspaceImage/'.$id)->assertNotFound();
        Storage::disk('local')->assertMissing('workspace-images/'.$id);
        Http::assertSentCount(5);
    }
}
