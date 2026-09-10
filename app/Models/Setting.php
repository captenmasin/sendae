<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Native\Desktop\Facades\System;

class Setting extends Model
{
    public $timestamps = false;

    public $incrementing = false;

    protected $primaryKey = 'key';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['value' => 'encrypted'];
    }

    public static function read(string $key, mixed $default = null): mixed
    {
        $value = static::find($key)?->value;
        if ($key === 'server_token' && is_string($value)) {
            if (str_starts_with($value, 'native:')) {
                return config('nativephp-internal.running') ? (System::decrypt(substr($value, 7)) ?? $default) : $default;
            }
            if (config('nativephp-internal.running')) {
                static::write($key, $value);
            }
        }

        return $value ?? $default;
    }

    public static function write(string $key, ?string $value): void
    {
        if ($key === 'server_token' && $value !== null && config('nativephp-internal.running')) {
            abort_unless(System::canEncrypt(), 503, 'Secure storage is unavailable. Unlock your Mac and try again.');
            $encrypted = System::encrypt($value);
            abort_unless(is_string($encrypted) && $encrypted !== '', 503, 'Sendae could not securely save your session.');
            $value = 'native:'.$encrypted;
        }
        static::updateOrCreate(['key' => $key], ['value' => $value]);
    }
}
