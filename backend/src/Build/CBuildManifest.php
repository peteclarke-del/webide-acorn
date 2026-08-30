<?php

declare(strict_types=1);

namespace App\Build;

use Symfony\Component\Process\Process;

final class CBuildManifest
{
    public const ADAPTER_ID = 'cc65.c-bbc';
    public const ADAPTER_VERSION = '2026.08.1';
    public const RUNTIME_VERSION = '2026.08.1';

    /** @return array<string, mixed> */
    public function detect(): array
    {
        $cc65 = $this->environment('CC65_PATH', '/usr/bin/cc65');
        $ca65 = $this->environment('CA65_PATH', '/usr/bin/ca65');
        $ld65 = $this->environment('LD65_PATH', '/usr/bin/ld65');
        $runtime = $this->environment('CC65_BBC_RUNTIME', '/usr/local/lib/8bit-net/cc65-bbc');
        $include = $this->environment('CC65_BBC_INCLUDE', '/usr/local/share/8bit-net/cc65-bbc/include');
        $binaries = ['cc65' => $cc65, 'ca65' => $ca65, 'ld65' => $ld65];
        $versions = array_map(fn (string $path): ?string => $this->version($path), $binaries);
        $runtimeFiles = ['crt0' => $runtime.'/crt0.o', 'platform' => $runtime.'/platform.o', 'library' => '/usr/share/cc65/lib/none.lib', 'header' => $include.'/acorn.h'];
        $licence = '/usr/share/doc/cc65/copyright';
        $readiness = new Readiness();
        foreach ($binaries as $name => $binaryPath) {
            $readiness->executable($name, $binaryPath)->version($name, $versions[$name]);
        }
        foreach ($runtimeFiles as $name => $runtimePath) {
            $readiness->file('BBC runtime '.$name, $runtimePath);
        }
        $readiness->file('cc65 licence', $licence);
        $manifest = [
            'schema' => '8bit-net.toolchain-manifest', 'version' => 1,
            'id' => self::ADAPTER_ID, 'adapterVersion' => self::ADAPTER_VERSION,
            'label' => 'cc65 C + WebIDE BBC runtime', 'execution' => 'server-native',
            'language' => 'c', 'artifactKind' => '6502-binary',
            'processors' => ['6502', '65c02'], 'profiles' => ['debug', 'size', 'speed', 'custom'],
            'machines' => ['bbc-b', 'bbc-b-plus', 'master'],
            'deterministic' => true,
            'packageVersion' => $_SERVER['TOOLCHAIN_PACKAGE_VERSION'] ?? $_ENV['TOOLCHAIN_PACKAGE_VERSION'] ?? 'host-development',
            'compiler' => ['version' => $versions['cc65'], 'sha256' => $this->digest($cc65)],
            'assembler' => ['version' => $versions['ca65'], 'sha256' => $this->digest($ca65)],
            'linker' => ['version' => $versions['ld65'], 'sha256' => $this->digest($ld65)],
            'runtime' => ['id' => '8bit-net.cc65-bbc-runtime', 'version' => self::RUNTIME_VERSION, 'files' => array_map(fn (string $path): ?string => $this->digest($path), $runtimeFiles)],
            'licence' => ['spdx' => 'LicenseRef-cc65-BSD-3-zlib', 'path' => $licence, 'sha256' => $this->digest($licence), 'upstream' => 'https://github.com/cc65/cc65'],
            'standard' => 'cc65',
            'limits' => BuildLimits::manifest(),
            'sandbox' => ['network' => 'none', 'filesystem' => 'read-only-root+job-tmpfs', 'identity' => 'non-root', 'shell' => false, 'persistence' => 'none'],
            'ready' => $readiness->ready(),
            'readiness' => $readiness->checks(),
        ];
        $manifest['digestAlgorithm'] = 'sha256';
        $manifest['digest'] = hash('sha256', ToolchainManifest::canonicalJson($manifest));

        return $manifest;
    }

    private function environment(string $name, string $fallback): string
    {
        return (string) ($_SERVER[$name] ?? $_ENV[$name] ?? $fallback);
    }

    private function digest(string $path): ?string
    {
        return is_file($path) ? hash_file('sha256', $path) ?: null : null;
    }

    private function version(string $path): ?string
    {
        if (!is_file($path) || !is_executable($path)) return null;
        $process = new Process([$path, '--version'], null, ['LANG' => 'C', 'LC_ALL' => 'C']);
        $process->setTimeout(2.0);
        $process->run();
        $value = trim($process->getOutput().$process->getErrorOutput());
        return $process->isSuccessful() && $value !== '' ? preg_replace('/\s+/', ' ', $value) : null;
    }
}
