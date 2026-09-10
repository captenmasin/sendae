<?php

namespace App\Providers;

use App\Services\DesktopLinks;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;
use Native\Desktop\Events\App\OpenedFromURL;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Event::listen(OpenedFromURL::class, fn (OpenedFromURL $event) => app(DesktopLinks::class)->receive($event->url));
    }
}
