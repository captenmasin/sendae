<?php

namespace App\Providers;

use Native\Desktop\Contracts\ProvidesPhpIni;
use Native\Desktop\Facades\Window;

class NativeAppServiceProvider implements ProvidesPhpIni
{
    /**
     * Executed once the native application has been booted.
     * Use this method to open windows, register global shortcuts, etc.
     */
    public function boot(): void
    {
        Window::open()->title('Sendae')->width(1280)->height(850)->minWidth(900)->minHeight(640);
    }

    /**
     * Return an array of php.ini directives to be set.
     */
    public function phpIni(): array
    {
        return ['upload_max_filesize' => '100M', 'post_max_size' => '105M', 'memory_limit' => '512M'];
    }
}
