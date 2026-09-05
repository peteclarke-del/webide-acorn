<?php

declare(strict_types=1);

namespace App\Build;

use App\Http\ApiProblem;

final class CSDKDocumentService
{
    private const MAXIMUM_BYTES = 262144;

    /** @param list<array{root: string, source: string, licence: string}>|null $roots */
    public function __construct(private readonly ?array $roots = null)
    {
    }

    /** @return array<string, int|string|bool> */
    public function read(string $requested): array
    {
        if (!$this->safePath($requested)) {
            throw new ApiProblem(400, 'SDK_PATH_INVALID', 'SDK document paths must be relative, bounded and free of traversal.', false, ['path' => 'Unsafe SDK path']);
        }

        foreach ($this->configuredRoots() as $entry) {
            $root = realpath($entry['root']);
            $candidate = $root === false ? false : realpath($root.'/'.$requested);
            if ($root === false || $candidate === false || !str_starts_with($candidate, $root.'/') || !is_file($candidate) || !is_readable($candidate)) continue;
            $bytes = filesize($candidate);
            if ($bytes === false || $bytes > self::MAXIMUM_BYTES) throw new ApiProblem(413, 'SDK_DOCUMENT_TOO_LARGE', 'SDK documents are limited to 256 KiB.', false, ['path' => 'Document exceeds the viewer limit']);
            $content = file_get_contents($candidate);
            if ($content === false || !mb_check_encoding($content, 'UTF-8')) throw new ApiProblem(422, 'SDK_DOCUMENT_NOT_TEXT', 'The selected SDK document is not readable UTF-8 source.', false, ['path' => 'Text source required']);

            return [
                'schema' => '8bit-net.sdk-document',
                'version' => 1,
                'toolchainId' => CBuildManifest::ADAPTER_ID,
                'toolchainVersion' => CBuildManifest::ADAPTER_VERSION,
                'path' => $requested,
                'source' => $entry['source'].'/'.$requested,
                'licence' => $entry['licence'],
                'readOnly' => true,
                'bytes' => $bytes,
                'sha256' => hash('sha256', $content),
                'content' => $content,
            ];
        }

        throw new ApiProblem(404, 'SDK_DOCUMENT_NOT_FOUND', 'The requested file is not present in the immutable cc65 or WebIDE BBC SDK.', false, ['path' => 'Unknown SDK document']);
    }

    /** @return list<array{root: string, source: string, licence: string}> */
    private function configuredRoots(): array
    {
        if ($this->roots !== null) return $this->roots;
        $webIde = (string) (ToolLocator::configured('CC65_BBC_INCLUDE') ?? '/usr/local/share/8bit-net/cc65-bbc/include');
        return [
            ['root' => $webIde, 'source' => '8bit-net BBC C SDK include', 'licence' => 'Project runtime source, see repository licensing and third-party notices.'],
            ['root' => '/usr/share/cc65/include', 'source' => 'cc65 2.19-1 include', 'licence' => 'cc65 zlib-style licence; original notice is retained in source files where supplied.'],
        ];
    }

    private function safePath(string $path): bool
    {
        if ($path === '' || strlen($path) > BuildLimits::PATH_BYTES || str_starts_with($path, '/') || str_contains($path, '\\') || str_contains($path, "\0")) return false;
        $segments = explode('/', $path);
        return count($segments) <= BuildLimits::PATH_SEGMENTS && !array_filter($segments, static fn (string $segment): bool => $segment === '' || $segment === '.' || $segment === '..');
    }
}
