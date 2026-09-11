<?php

return [
    'mode' => 'desktop',
    // Set by the developer when packaging Sendae, never by an end user.
    'service_url' => env('SENDAE_SERVICE_URL', 'https://sendae.app'),
    'service_ca' => env('SENDAE_SERVICE_CA'),
    'providers' => [
        'x' => ['label' => 'X'],
        'bluesky' => ['label' => 'Bluesky'],
        'threads' => ['label' => 'Threads'],
        'facebook' => ['label' => 'Facebook Page'],
        'linkedin' => ['label' => 'LinkedIn profile'],
        'linkedin_page' => ['label' => 'LinkedIn Company Page'],
    ],
];
