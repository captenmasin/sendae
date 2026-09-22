<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Concerns\HasUuids;

class Account extends Model
{
    use BelongsToWorkspace, HasUuids;

    protected $guarded = [];

    protected $hidden = ['workspace_id', 'credentials'];

    protected function casts(): array
    {
        return ['slots' => 'array', 'credentials' => 'encrypted:array', 'verified' => 'boolean'];
    }
}
