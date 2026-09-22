<?php

use App\Models\Draft;
use App\Models\Media;
use App\Models\Account;
use App\Models\Setting;
use App\Models\Publication;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;

function workspaceDeletionSignIn(string $workspaceId): void
{
    config(['sendae.service_url' => 'https://service.example']);
    Setting::write('server_token', 'token');
    Setting::write('session_origin', 'https://service.example');
    Setting::write('workspace_id', $workspaceId);
}

test('confirmed deletion removes only the deleted workspaces local data', function (): void {
    $id = str_repeat('a', 64);
    $remaining = str_repeat('b', 64);
    workspaceDeletionSignIn($remaining);
    $kept = Draft::create(['title' => 'Keep', 'content' => []]);
    Setting::write('workspace_id', $id);
    $draft = Draft::create(['title' => 'Delete', 'content' => []]);
    $draft->delete();
    $account = Account::create(['name' => 'Delete', 'provider' => 'x', 'provider_id' => '1']);
    $media = Media::create(['name' => 'Delete.png', 'mime' => 'image/png', 'size' => 10, 'path' => 'media/delete.png']);
    $publication = Publication::create(['draft_id' => $draft->id, 'account_id' => $account->id, 'snapshot' => [], 'scheduled_at' => now()->addDay()]);
    Storage::fake('local');
    Storage::disk('local')->put($media->path, 'image');
    Storage::disk('local')->put('workspace-images/'.$id, 'avatar');
    Http::preventStrayRequests();
    Http::fake(['service.example/api/workspaces/'.$id => Http::response(['deleted' => true, 'workspace_id' => $remaining, 'workspaces' => [['id' => $remaining, 'name' => 'Keep']]])]);

    $this->postJson('/local/deleteWorkspace', ['id' => $id])->assertOk()->assertJsonPath('workspace_id', $remaining);

    $this->assertDatabaseMissing('drafts', ['id' => $draft->id]);
    $this->assertDatabaseMissing('accounts', ['id' => $account->id]);
    $this->assertDatabaseMissing('media', ['id' => $media->id]);
    $this->assertDatabaseMissing('publications', ['id' => $publication->id]);
    $this->assertDatabaseHas('drafts', ['id' => $kept->id]);
    Storage::disk('local')->assertMissing([$media->path, 'workspace-images/'.$id]);
    $this->getJson('/local/state')->assertOk()->assertJsonPath('drafts.0.id', $kept->id)->assertJsonPath('settings.workspace_id', $remaining);
    Http::assertSent(fn ($request): bool => $request->method() === 'DELETE' && $request->hasHeader('X-Workspace-Id', $id));
});

test('unconfirmed deletion preserves local workspace data', function (int $status, array $response, int $expectedStatus): void {
    $id = str_repeat('a', 64);
    workspaceDeletionSignIn($id);
    $draft = Draft::create(['title' => 'Keep', 'content' => []]);
    Http::preventStrayRequests();
    Http::fake(['service.example/api/workspaces/'.$id => Http::response($response, $status)]);

    $this->postJson('/local/deleteWorkspace', ['id' => $id])->assertStatus($expectedStatus);

    $this->assertSame($id, Setting::read('workspace_id'));
    $this->assertDatabaseHas('drafts', ['id' => $draft->id]);
    Http::assertSentCount(1);
})->with([
    [403, ['message' => 'Denied'], 403],
    [200, ['deleted' => false], 502],
]);

test('workspace deletion requires sign in and a valid id', function (): void {
    Http::preventStrayRequests();
    $this->postJson('/local/deleteWorkspace', ['id' => str_repeat('a', 64)])->assertUnauthorized();
    workspaceDeletionSignIn(str_repeat('a', 64));
    $this->postJson('/local/deleteWorkspace', ['id' => 'invalid'])->assertUnprocessable()->assertJsonValidationErrors('id');
    Http::assertNothingSent();
});
