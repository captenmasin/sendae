<?php

use App\Mcp\Servers\SendaeServer;
use Laravel\Mcp\Facades\Mcp;

Mcp::local('sendae', SendaeServer::class);
