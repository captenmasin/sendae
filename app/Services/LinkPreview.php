<?php

namespace App\Services;

use Dom\HTMLDocument;
use GuzzleHttp\Psr7\Uri;
use GuzzleHttp\Psr7\UriResolver;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Psr\Http\Message\ResponseInterface;
use RuntimeException;

class LinkPreview
{
    /** @return array{title: string, description: string, domain: string, image: ?string, large: bool}|null */
    public function get(string $url, string $provider): ?array
    {
        return Cache::remember('link-preview:'.hash('sha256', $provider.$url), 600, function () use ($url, $provider): ?array {
            $page = $this->fetch($url, 1048576);
            if (! $page || ! str_contains($page['type'], 'text/html') || trim($page['body']) === '') {
                return null;
            }
            $document = HTMLDocument::createFromString($page['body'], LIBXML_NOERROR, 'UTF-8');
            $meta = [];
            foreach ($document->getElementsByTagName('meta') as $tag) {
                $key = strtolower($tag->getAttribute('property') ?: $tag->getAttribute('name'));
                $meta[$key] ??= trim($tag->getAttribute('content'));
            }
            $twitter = $provider === 'x';
            $title = ($twitter ? ($meta['twitter:title'] ?? null) : null) ?: ($meta['og:title'] ?? '');
            $description = ($twitter ? ($meta['twitter:description'] ?? null) : null) ?: ($meta['og:description'] ?? '');
            $image = ($twitter ? ($meta['twitter:image'] ?? null) : null) ?: ($meta['og:image'] ?? '');
            if ($title === '') {
                return null;
            }
            $imageData = null;
            if ($image !== '') {
                try {
                    $picture = $this->fetch((string) UriResolver::resolve(new Uri($page['url']), new Uri($image)), 5242880);
                    $info = $picture ? @getimagesizefromstring($picture['body']) : false;
                    if ($info && in_array($info['mime'], ['image/jpeg', 'image/png', 'image/gif', 'image/webp'], true)) {
                        $imageData = 'data:'.$info['mime'].';base64,'.base64_encode($picture['body']);
                    }
                } catch (\InvalidArgumentException) {
                    $imageData = null;
                }
            }

            return ['title' => mb_substr($title, 0, 300), 'description' => mb_substr($description, 0, 500), 'domain' => (string) parse_url($page['url'], PHP_URL_HOST), 'image' => $imageData, 'large' => ! $twitter || ($meta['twitter:card'] ?? 'summary') === 'summary_large_image'];
        });
    }

    /** @return array{body: string, type: string, url: string}|null */
    private function fetch(string $url, int $limit): ?array
    {
        try {
            for ($redirect = 0; $redirect < 4; $redirect++) {
                $parts = parse_url($url);
                if (! $parts || ! in_array($parts['scheme'] ?? '', ['http', 'https'], true) || isset($parts['user']) || isset($parts['pass']) || preg_match('/[\x00-\x20\\\\]/', $url)) {
                    return null;
                }
                $host = $parts['host'] ?? '';
                $port = $parts['port'] ?? ($parts['scheme'] === 'https' ? 443 : 80);
                if (! in_array($port, [80, 443], true)) {
                    return null;
                }
                $addresses = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : $this->addresses($host);
                if (! $addresses) {
                    return null;
                }
                foreach ($addresses as $address) {
                    if (! filter_var($address, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 | FILTER_FLAG_GLOBAL_RANGE)) {
                        return null;
                    }
                }
                $response = Http::withoutRedirecting()->connectTimeout(3)->timeout(8)->withHeaders(['Accept' => '*/*', 'User-Agent' => 'Sendae/1.0 (link preview)'])->withOptions([
                    'proxy' => '',
                    'curl' => [CURLOPT_RESOLVE => [$host.':'.$port.':'.$addresses[0]]],
                    'on_headers' => function (ResponseInterface $response) use ($limit): void {
                        if ((int) $response->getHeaderLine('Content-Length') > $limit) {
                            throw new RuntimeException('Preview response too large.');
                        }
                    },
                    'progress' => function (float $total, float $downloaded) use ($limit): void {
                        if ($total > $limit || $downloaded > $limit) {
                            throw new RuntimeException('Preview response too large.');
                        }
                    },
                ])->get($url);
                if ($response->redirect()) {
                    $url = (string) UriResolver::resolve(new Uri($url), new Uri($response->header('Location')));

                    continue;
                }
                if (! $response->successful() || strlen($response->body()) > $limit) {
                    return null;
                }

                return ['body' => $response->body(), 'type' => strtolower($response->header('Content-Type')), 'url' => $url];
            }
        } catch (ConnectionException|RuntimeException|\InvalidArgumentException) {
            return null;
        }

        return null;
    }

    /** @return list<string> */
    protected function addresses(string $host): array
    {
        return gethostbynamel($host) ?: [];
    }
}
