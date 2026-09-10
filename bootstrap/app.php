<?php

use App\Http\Middleware\LocalOrOwner;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Native\Desktop\Http\Middleware\PreventRegularBrowserAccess;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->append(PreventRegularBrowserAccess::class);
        $middleware->redirectGuestsTo('/');
        $middleware->prependToPriorityList(SubstituteBindings::class, LocalOrOwner::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->render(function (RequestException $e, Request $r) {
            return response()->json(['message' => $e->response->json('message') ?? 'The hosted server could not complete this request.', 'errors' => $e->response->json('errors') ?? []], $e->response->status());
        });
        $exceptions->render(function (ConnectionException $e, Request $r) {
            return response()->json(['message' => 'The server could not be reached. Your local drafts are safe.'], 503);
        });
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*', 'local/*') || $request->expectsJson(),
        );
    })->create();
