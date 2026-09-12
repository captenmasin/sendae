<?php

namespace App\Http\Controllers;

use App\Models\Media;
use App\Services\Attachments;
use App\Services\Synchronizer;
use App\Services\Workspace;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Native\Desktop\Facades\Shell;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class WorkspaceController extends Controller
{
    public function openPost(Request $request): array
    {
        $url = $request->validate(['url' => 'required|string|url:https|max:2048'])['url'];
        abort_unless(in_array(parse_url($url, PHP_URL_HOST), ['bsky.app', 'x.com', 'www.facebook.com', 'www.linkedin.com', 'threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'], true) && ! parse_url($url, PHP_URL_USER), 422, 'Invalid post address.');
        Shell::openExternal($url);

        return ['opened' => true];
    }

    public function saveWorkspace(Request $request, Synchronizer $sync): array
    {
        return $sync->saveWorkspace($request->validate(['id' => 'nullable|string|size:64', 'name' => 'required|string|max:100', 'icon' => 'nullable|string|max:32']));
    }

    public function switchWorkspace(Request $request, Synchronizer $sync): array
    {
        return $sync->switchWorkspace($request->validate(['id' => 'required|string|size:64'])['id']);
    }

    public function deleteWorkspace(Request $request, Synchronizer $sync): array
    {
        return $sync->deleteWorkspace($request->validate(['id' => 'required|string|size:64'])['id']);
    }

    public function state(Workspace $workspace)
    {
        return $workspace->state();
    }

    public function save(Request $r, Workspace $w)
    {
        return $w->save($r->all(), false);
    }

    public function deleteDraft(Request $request, Synchronizer $sync): array
    {
        $data = $request->validate(['id' => 'required|uuid']);

        return $sync->deleteDraft($data['id']);
    }

    public function upload(Request $r, Attachments $a)
    {
        $r->validate(['file' => 'required|file', 'id' => 'nullable|uuid']);

        return $a->store($r->file('file'), $r->input('id'));
    }

    public function media(Media $media)
    {
        abort_unless($media->path && Storage::disk('local')->exists($media->path), 404);

        return response()->file(Storage::disk('local')->path($media->path), ['Content-Type' => $media->mime, 'X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'private, max-age=3600']);
    }

    public function schedule(Request $r, Synchronizer $sync)
    {
        return $sync->remote('schedule', $r->all());
    }

    public function cancel(Request $r, Synchronizer $sync)
    {
        $r->validate(['id' => 'required|uuid']);

        return $sync->remote('cancel', $r->all());
    }

    public function deletePublication(Request $request, Synchronizer $sync): array
    {
        return $sync->remote('deletePublication', $request->validate(['id' => 'required|uuid']));
    }

    public function recover(Request $r, Synchronizer $s)
    {
        return $s->remote('recover', $r->all());
    }

    public function sync(Synchronizer $s)
    {
        return $s->run();
    }

    public function signIn(Request $r, Synchronizer $s): array
    {
        $data = $r->validate(['email' => 'required|email|max:255', 'password' => 'required|string|max:1000']);

        return $s->signIn($data);
    }

    public function registration(Request $r, Synchronizer $s): array
    {
        return $s->accountRequest('register', $r->validate(['name' => 'required|string|max:100', 'email' => 'required|email|max:255', 'password' => 'required|string|min:8|max:128|confirmed', 'password_confirmation' => 'required|string|max:128']));
    }

    public function forgotPassword(Request $r, Synchronizer $s): array
    {
        return $s->accountRequest('forgot-password', $r->validate(['email' => 'required|email|max:255']));
    }

    public function resetPassword(Request $request, Synchronizer $sync): array
    {
        return $sync->accountRequest('reset-password', $request->validate(['token' => 'required|string|size:64', 'email' => 'required|email|max:255', 'password' => 'required|string|min:8|max:128|confirmed', 'password_confirmation' => 'required|string|max:128']));
    }

    public function connectionChoices(Request $request, Synchronizer $sync): array
    {
        return $sync->connectionChoices($request->validate(['ticket' => 'required|string|regex:/^[A-Za-z0-9]{64}$/'])['ticket']);
    }

    public function selectConnection(Request $request, Synchronizer $sync): array
    {
        $data = $request->validate(['ticket' => 'required|string|regex:/^[A-Za-z0-9]{64}$/', 'accounts' => 'required|array|min:1', 'accounts.*' => 'integer|min:0|distinct', 'timezone' => 'required|timezone']);

        return $sync->selectConnection($data['ticket'], $data);
    }

    public function authorization(Request $request, Synchronizer $sync): array
    {
        return $sync->authorization($request->validate(['ticket' => 'required|string|regex:/^[A-Za-z0-9]{64}$/'])['ticket']);
    }

    public function decideAuthorization(Request $request, Synchronizer $sync): array
    {
        $data = $request->validate(['ticket' => 'required|string|regex:/^[A-Za-z0-9]{64}$/', 'approved' => 'required|boolean']);

        return $sync->decideAuthorization($data['ticket'], $data['approved']);
    }

    public function signOut(Synchronizer $s): array
    {
        return $s->signOut();
    }

    public function account(Request $r, Synchronizer $s)
    {
        return $s->remote('account', $r->all());
    }

    public function disconnect(Request $r, Synchronizer $s)
    {
        return $s->remote('disconnect', $r->all());
    }

    public function analytics(Request $r, Synchronizer $s)
    {
        return $s->remote('analytics', $r->all());
    }

    public function connectBluesky(Request $request, Synchronizer $sync): array
    {
        $data = $request->validate(['identifier' => 'required|string|max:253', 'password' => 'required|string|max:100', 'timezone' => 'required|timezone']);

        return $sync->request()->post('connectBluesky', $data)->throw()->json();
    }

    public function connect(Request $r, Synchronizer $s): array
    {
        return $s->startConnection($r->validate(['provider' => 'required|string|in:x,threads,facebook,linkedin,linkedin_page'])['provider']);
    }

    public function profile(Request $request, Synchronizer $sync): array
    {
        return $sync->updateProfile($request->validate([
            'name' => 'required|string|max:100',
            'email' => 'required|email|max:255',
            'password' => 'nullable|string|min:8|max:128|confirmed',
            'password_confirmation' => 'nullable|string|max:128',
            'current_password' => 'nullable|string|max:1000',
        ]));
    }

    public function saveWorkspaceImage(Request $request, Synchronizer $sync): array
    {
        $data = $request->validate(['id' => 'required|string|size:64', 'file' => 'required|file|mimetypes:image/jpeg,image/png,image/webp|max:2048']);

        return $sync->saveWorkspaceImage($data['id'], $data['file']);
    }

    public function deleteWorkspaceImage(Request $request, Synchronizer $sync): array
    {
        return $sync->deleteWorkspaceImage($request->validate(['id' => 'required|string|size:64'])['id']);
    }

    public function workspaceImage(string $id, Synchronizer $sync): BinaryFileResponse
    {
        abort_unless(strlen($id) === 64 && ctype_xdigit($id), 404);

        return $sync->workspaceImage($id);
    }
}
