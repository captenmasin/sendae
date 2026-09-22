<?php

namespace App\Mcp\Tools;

use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use App\Services\Workspace;
use Laravel\Mcp\Server\Tool;
use Illuminate\Contracts\JsonSchema\JsonSchema;

class SaveDraft extends Tool
{
    protected string $name = 'save_draft';

    protected string $description = 'Create or edit a draft. Supply a new UUID and version 0 to create. Otherwise send the current version. A stale version overwrites the existing draft. Content includes items, overrides, and account_ids.';

    public function schema(JsonSchema $s): array
    {
        return ['id' => $s->string()->required(), 'title' => $s->string()->required(), 'version' => $s->integer()->required(), 'content' => $s->object()->required()];
    }

    public function handle(Request $r): Response
    {
        return Response::json(app(Workspace::class)->save($r->all(), false));
    }
}
