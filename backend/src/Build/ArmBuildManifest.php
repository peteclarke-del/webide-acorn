<?php

declare(strict_types=1);

namespace App\Build;

use Symfony\Component\Process\Process;

final class ArmBuildManifest
{
    public const ADAPTER_ID = 'gnu.arm-none-eabi-binutils';
    public const ADAPTER_VERSION = '2026.08.1';

    /** @return array<string, mixed> */
    public function detect(): array
    {
        $tools = [];
        foreach (['as', 'ld', 'objcopy', 'objdump', 'nm', 'readelf'] as $name) {
            $path = $this->path($name);
            $tools[$name] = ['version' => $this->version($path), 'sha256' => is_file($path) ? hash_file('sha256', $path) : null];
        }
        $readiness = new Readiness();
        foreach (['as', 'ld', 'objcopy', 'objdump', 'nm', 'readelf'] as $name) {
            $readiness->executable('arm-none-eabi-'.$name, $this->path($name))->version('arm-none-eabi-'.$name, $tools[$name]['version']);
        }
        $manifest = [
            'schema' => '8bit-net.toolchain-manifest', 'version' => 1,
            'id' => self::ADAPTER_ID, 'adapterVersion' => self::ADAPTER_VERSION,
            'label' => 'GNU ARM binutils · ARM2 bare-machine-code', 'execution' => 'server-native',
            'language' => 'arm', 'artifactKind' => 'arm-binary', 'processors' => ['arm2'],
            'profiles' => ['debug', 'size', 'speed', 'custom'], 'deterministic' => true,
            'packageVersion' => ToolLocator::configured('ARM_BINUTILS_PACKAGE_VERSION') ?? 'host-development',
            'tools' => $tools,
            'licence' => [
                'spdx' => 'GPL-3.0-or-later', 'component' => 'GNU Binutils',
                'path' => '/usr/share/doc/binutils-arm-none-eabi/copyright',
                'sha256' => is_file('/usr/share/doc/binutils-arm-none-eabi/copyright') ? hash_file('sha256', '/usr/share/doc/binutils-arm-none-eabi/copyright') : null,
            ],
            'output' => ['format' => 'raw-little-endian-arm', 'elfMetadataRetained' => true, 'riscOsApplication' => false, 'filetype' => null],
            'limits' => BuildLimits::manifest(),
            'sandbox' => ['network' => 'none', 'filesystem' => 'read-only-root+job-tmpfs', 'identity' => 'non-root', 'shell' => false, 'persistence' => 'none'],
            'ready' => $readiness->ready(),
            'readiness' => $readiness->checks(),
        ];
        $manifest['digestAlgorithm'] = 'sha256';
        $manifest['digest'] = hash('sha256', ToolchainManifest::canonicalJson($manifest));

        return $manifest;
    }

    public function path(string $tool): string
    {
        $key = 'ARM_'.strtoupper($tool).'_PATH';
        return ToolLocator::locate($key, 'arm-none-eabi-'.$tool, '/usr/bin/arm-none-eabi-'.$tool);
    }

    private function version(string $path): ?string
    {
        if (!is_file($path) || !is_executable($path)) return null;
        $process = new Process([$path, '--version'], null, ['LANG' => 'C', 'LC_ALL' => 'C']);
        $process->setTimeout(2.0); $process->run();
        $value = trim($process->getOutput().$process->getErrorOutput());
        return $process->isSuccessful() && $value !== '' ? preg_replace('/\s+/', ' ', $value) : null;
    }
}
