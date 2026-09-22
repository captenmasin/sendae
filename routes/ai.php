<?php

use Laravel\Mcp\Facades\Mcp;
use App\Mcp\Servers\SendaeServer;

Mcp::local('sendae', SendaeServer::class);
