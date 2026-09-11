<?php

namespace App\Services;

use App\Models\Publication;
use Native\Desktop\Facades\Notification;

class DesktopNotifications
{
    public function published(Publication $publication): void
    {
        if (! config('nativephp-internal.running')) {
            return;
        }

        $title = trim((string) ($publication->snapshot['title'] ?? '')) ?: 'Your post';
        Notification::title('Post published')->message($title.' is live.')->show();
    }
}
