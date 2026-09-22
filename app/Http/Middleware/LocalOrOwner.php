<?php

namespace App\Http\Middleware;

use Closure;
use App\Models\Setting;
use Illuminate\Http\Request;
use App\Services\Synchronizer;

class LocalOrOwner
{
    public function handle(Request $request, Closure $next)
    {
        abort_unless(in_array($request->ip(), ['127.0.0.1', '::1']) && in_array($request->getHost(), ['localhost', '127.0.0.1', 'sendae.test']), 403);

        if (! $request->is('/', 'local/csrf', 'local/link', 'local/signIn', 'local/signOut', 'local/registration', 'local/forgotPassword', 'local/resetPassword')) {
            app(Synchronizer::class)->requireAuth();
            if ($request->header('X-Workspace-Id')) {
                abort_unless($request->header('X-Workspace-Id') === Setting::read('workspace_id'), 409, 'The active workspace changed. Reopen this window before editing.');
            }
        }

        return $next($request);
    }
}
