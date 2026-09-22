<?php

use App\Models\Setting;
use Illuminate\Support\Facades\Http;

function linkPreviewSignIn(): void
{
    config(['sendae.service_url' => 'https://service.example']);
    Setting::write('server_token', 'token');
    Setting::write('session_origin', 'https://service.example');
    Http::preventStrayRequests();
}

test('preview requires sign in', function (): void {
    Http::preventStrayRequests();

    $this->getJson('/local/linkPreview?url=https://example.com&provider=x')->assertUnauthorized();

    Http::assertNothingSent();
});

test('x metadata overrides open graph and resolves images after redirects', function (): void {
    linkPreviewSignIn();
    $image = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=');
    Http::fake([
        'https://93.184.216.34/start' => Http::response('', 302, ['Location' => '/news/article']),
        'https://93.184.216.34/news/article' => function ($request, $options) {
            $this->assertSame(['93.184.216.34:443:93.184.216.34'], $options['curl'][CURLOPT_RESOLVE]);
            $this->assertFalse($options['allow_redirects']);
            $this->assertFalse($request->hasHeader('Authorization'));

            return Http::response('<meta property="og:title" content="Generic title"><meta name="twitter:title" content="X &amp; news"><meta name="twitter:description" content="Details"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="../image.png">', 200, ['Content-Type' => 'text/html']);
        },
        'https://93.184.216.34/image.png' => Http::response($image, 200, ['Content-Type' => 'image/png']),
    ]);

    $response = $this->getJson('/local/linkPreview?url=https://93.184.216.34/start&provider=x');

    $response->assertJsonPath('card.title', 'X & news')->assertJsonPath('card.description', 'Details')->assertJsonPath('card.large', true)->assertJsonPath('card.image', 'data:image/png;base64,'.base64_encode($image));
    $this->getJson('/local/linkPreview?url=https://93.184.216.34/start&provider=x')->assertJsonPath('card.title', 'X & news');
    Http::assertSentCount(3);
});

test('open graph card survives an unsafe image address', function (): void {
    linkPreviewSignIn();
    Http::fake(['https://93.184.216.34/' => Http::response('<meta property="og:title" content="News"><meta property="og:image" content="http://127.0.0.1/private">', 200, ['Content-Type' => 'text/html'])]);

    $this->getJson('/local/linkPreview?url=https://93.184.216.34/&provider=threads')->assertJsonPath('card.title', 'News')->assertJsonPath('card.image', null)->assertJsonPath('card.large', true);

    Http::assertSentCount(1);
});

test('private urls and redirects never reach local services', function (): void {
    linkPreviewSignIn();
    Http::fake(['https://93.184.216.34/' => Http::response('', 302, ['Location' => 'http://127.0.0.1/private'])]);

    foreach (['http://127.0.0.1/', 'http://10.0.0.1/', 'http://100.64.0.1/', 'http://169.254.169.254/', 'http://[::1]/', 'https://user:secret@93.184.216.34/', 'https://93.184.216.34:8080/', 'https://93.184.216.34/'] as $url) {
        $this->getJson('/local/linkPreview?'.http_build_query(['url' => $url, 'provider' => 'x']))->assertJsonPath('card', null);
    }

    Http::assertSentCount(1);
});

test('unavailable or missing metadata returns a text link fallback', function (): void {
    linkPreviewSignIn();
    Http::fake([
        'https://93.184.216.34/offline' => Http::failedConnection(),
        'https://93.184.216.34/missing' => Http::response('<title>No social metadata</title>', 200, ['Content-Type' => 'text/html']),
        'https://93.184.216.34/error' => Http::response('Unavailable', 503),
        'https://93.184.216.34/large' => Http::response(str_repeat('x', 1048577), 200, ['Content-Type' => 'text/html']),
        'https://93.184.216.34/pdf' => Http::response('PDF', 200, ['Content-Type' => 'application/pdf']),
        'https://93.184.216.34/empty' => Http::response('', 200, ['Content-Type' => 'text/html']),
    ]);

    foreach (['offline', 'missing', 'error', 'large', 'pdf', 'empty'] as $path) {
        $this->getJson('/local/linkPreview?url=https://93.184.216.34/'.$path.'&provider=x')->assertJsonPath('card', null);
    }

    Http::assertSentCount(6);
});

test('invalid protocol is rejected', function (): void {
    linkPreviewSignIn();

    $this->getJson('/local/linkPreview?url=file:///etc/passwd&provider=x')->assertUnprocessable()->assertJsonValidationErrors('url');

    Http::assertNothingSent();
});

test('all other networks receive open graph cards instead of x metadata', function (): void {
    linkPreviewSignIn();
    $image = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=');
    Http::fake([
        'https://93.184.216.34/' => Http::response('<meta property="og:title" content="Gaming news"><meta property="og:description" content="Latest articles"><meta property="og:image" content="/image.png"><meta name="twitter:title" content="X title"><meta name="twitter:card" content="summary">', 200, ['Content-Type' => 'text/html']),
        'https://93.184.216.34/image.png' => Http::response($image, 200, ['Content-Type' => 'image/png']),
    ]);

    foreach (['threads', 'facebook', 'linkedin', 'linkedin_page', 'bluesky'] as $provider) {
        $this->getJson('/local/linkPreview?url=https://93.184.216.34/&provider='.$provider)
            ->assertJsonPath('card.title', 'Gaming news')
            ->assertJsonPath('card.description', 'Latest articles')
            ->assertJsonPath('card.image', 'data:image/png;base64,'.base64_encode($image))
            ->assertJsonPath('card.large', true);
    }

    Http::assertSentCount(10);
});
