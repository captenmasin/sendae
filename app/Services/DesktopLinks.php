<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Validator;

class DesktopLinks
{
    public function receive(string $url): void
    {
        $parts = parse_url($url);
        if (! $parts || ($parts['scheme'] ?? '') !== 'sendae' || isset($parts['user']) || isset($parts['pass']) || ! empty($parts['path'])) {
            return;
        }
        parse_str($parts['query'] ?? '', $data);
        $action = $parts['host'] ?? '';
        $rules = match ($action) {
            'connection', 'authorize' => ['ticket' => 'required|string|regex:/^[A-Za-z0-9]{64}$/'],
            'reset-password' => ['token' => 'required|string|regex:/^[A-Za-z0-9]{64}$/', 'email' => 'required|email|max:255'],
            default => null,
        };
        if ($rules === null) {
            return;
        }
        $validator = Validator::make($data, $rules);
        if ($validator->fails()) {
            return;
        }
        Cache::put('desktop_link', ['action' => $action, ...$validator->validated()], now()->addMinutes(10));
    }

    public function take(): array
    {
        return Cache::pull('desktop_link', []);
    }
}
