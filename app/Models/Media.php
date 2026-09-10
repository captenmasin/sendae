<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class Media extends Model
{
    use BelongsToWorkspace, HasUuids;

    protected $table = 'media';

    protected $guarded = [];

    protected $hidden = ['workspace_id', 'path'];

    protected function casts(): array
    {
        return ['synced' => 'boolean'];
    }
}
