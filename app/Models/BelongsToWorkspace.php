<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

trait BelongsToWorkspace
{
    public static function bootBelongsToWorkspace(): void
    {
        static::addGlobalScope('workspace', fn (Builder $query) => $query->where($query->getModel()->qualifyColumn('workspace_id'), Setting::read('workspace_id')));
        static::creating(function (Model $model) {
            $model->workspace_id = Setting::read('workspace_id');
            abort_if($model->id && static::withoutGlobalScope('workspace')->whereKey($model->id)->exists(), 404);
        });
    }
}
