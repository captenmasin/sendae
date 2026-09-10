<?php

use App\Models\Setting;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        foreach (['accounts', 'drafts', 'media', 'publications'] as $name) {
            Schema::table($name, fn (Blueprint $table) => $table->string('workspace_id', 64)->nullable()->index());
            DB::table($name)->update(['workspace_id' => Setting::read('workspace_id')]);
        }
        Schema::table('accounts', function (Blueprint $table) {
            $table->dropUnique(['provider', 'provider_id']);
            $table->unique(['workspace_id', 'provider', 'provider_id']);
        });
    }

    public function down(): void
    {
        throw new RuntimeException('Restore a backup to undo workspace isolation safely.');
    }
};
