<?php

namespace App\Http\Controllers;

use App\Services\LinkPreview;
use Illuminate\Http\Request;

class LinkPreviewController extends Controller
{
    public function __invoke(Request $request, LinkPreview $preview): array
    {
        $data = $request->validate(['url' => 'required|string|url:http,https|max:2048', 'provider' => 'required|in:x,threads,linkedin,linkedin_page,facebook,bluesky']);

        return ['card' => $preview->get($data['url'], $data['provider'])];
    }
}
