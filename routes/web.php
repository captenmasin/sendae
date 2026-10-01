<?php

use App\Services\DesktopLinks;
use App\Http\Middleware\LocalOrOwner;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\LinkPreviewController;
use App\Http\Controllers\WorkspaceController as W;

Route::middleware(LocalOrOwner::class)->group(function () {
    Route::get('/', fn () => view('app'));
    Route::get('/local/csrf', fn () => response()->json(['token' => csrf_token()]));
    Route::get('/local/link', fn (DesktopLinks $links): array => $links->take());
    Route::get('/local/state', [W::class, 'state']);
    Route::get('/local/linkPreview', LinkPreviewController::class)->middleware('throttle:60,1');
    Route::post('/local/openPost', [W::class, 'openPost']);
    Route::post('/local/openLink', [W::class, 'openLink']);
    Route::post('/local/drafts', [W::class, 'save']);
    Route::post('/local/media', [W::class, 'upload']);
    Route::get('/local/media/{media}', [W::class, 'media']);
    Route::get('/local/workspaceImage/{id}', [W::class, 'workspaceImage']);
    foreach (['saveWorkspace', 'switchWorkspace', 'deleteWorkspace', 'deleteDraft', 'schedule', 'schedulePreview', 'cancel', 'deletePublication', 'recover', 'sync', 'signIn', 'socialSignIn', 'finishSocialSignIn', 'signOut', 'registration', 'forgotPassword', 'resetPassword', 'connectionChoices', 'selectConnection', 'authorization', 'decideAuthorization', 'account', 'disconnect', 'analytics', 'connect', 'connectBluesky', 'profile', 'saveWorkspaceImage', 'deleteWorkspaceImage'] as $action) {
        Route::post('/local/'.$action, [W::class, $action]);
    }
});
