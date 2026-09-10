<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Draft extends Model
{
    use BelongsToWorkspace, HasUuids, SoftDeletes;

    protected $hidden = ['workspace_id'];

    protected $guarded = [];

    protected function casts(): array
    {
        return ['content' => 'array', 'dirty' => 'boolean'];
    }
}
