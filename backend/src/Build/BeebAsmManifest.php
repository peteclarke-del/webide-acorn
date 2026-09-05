<?php

declare(strict_types=1);

namespace App\Build;

use Symfony\Component\Process\Process;

final class BeebAsmManifest
{
    public const ADAPTER_ID = 'stardot.beebasm';
    public const ADAPTER_VERSION = '2026.08.1';
    public const UPSTREAM_VERSION = '1.11';
    public const COMMIT = 'ca2cc5fd2fa3f73da3b0682ad004b2aca99840c3';

    public function executablePath(): string
    {
        return ToolLocator::locate('BEEBASM_PATH', 'beebasm', '/usr/local/bin/beebasm');
    }

    /** @return array<string, mixed> */
    public function detect(): array
    {
        $path = $this->executablePath();
        $source = ToolLocator::configured('BEEBASM_SOURCE_PATH') ?? '/usr/share/source/beebasm-source.tar';
        $licence = ToolLocator::configured('BEEBASM_LICENCE_PATH') ?? '/usr/share/licenses/beebasm/COPYING.txt';
        $version = $this->version($path);
        $readiness = (new Readiness())
            ->executable('beebasm', $path)
            ->version('beebasm', $version, self::UPSTREAM_VERSION)
            ->file('BeebAsm source archive', $source)
            ->file('BeebAsm licence', $licence);
        $manifest = [
            'schema' => '8bit-net.toolchain-manifest', 'version' => 1, 'id' => self::ADAPTER_ID,
            'adapterVersion' => self::ADAPTER_VERSION, 'label' => 'BeebAsm 1.11 · BBC-style assembler',
            'execution' => 'server-native', 'language' => '6502', 'dialect' => 'beebasm', 'artifactKind' => '6502-binary',
            'processors' => ['6502', '65c02'], 'profiles' => ['debug', 'size', 'speed', 'custom'], 'deterministic' => true,
            /* Every other manifest carries this and this one did not, so a
             * client reading four manifests of the same declared schema found
             * the field missing from one of them. */
            'packageVersion' => ToolLocator::configured('BEEBASM_PACKAGE_VERSION') ?? 'host-development',
            'upstream' => ['version' => self::UPSTREAM_VERSION, 'commit' => self::COMMIT, 'repository' => 'https://github.com/stardot/beebasm'],
            'binary' => ['path' => $path, 'sha256' => is_file($path) ? hash_file('sha256', $path) : null],
            'licence' => ['spdx' => 'GPL-3.0-or-later', 'path' => $licence, 'sourceArchive' => $source, 'sourceSha256' => is_file($source) ? hash_file('sha256', $source) : null],
            'limits' => BuildLimits::manifest(),
            'sandbox' => ['network' => 'none', 'filesystem' => 'read-only-root+job-tmpfs', 'identity' => 'non-root', 'shell' => false, 'persistence' => 'none'],
            'ready' => $readiness->ready(),
            'readiness' => $readiness->checks(),
        ];
        $manifest['digestAlgorithm'] = 'sha256';
        $manifest['digest'] = hash('sha256', ToolchainManifest::canonicalJson($manifest));

        return $manifest;
    }

    private function version(string $path): ?string
    {
        if (!is_file($path) || !is_executable($path)) return null;
        $process = new Process([$path, '--help'], null, ['LANG' => 'C', 'LC_ALL' => 'C']);
        $process->setTimeout(2.0); $process->run();
        $output = $process->getOutput().$process->getErrorOutput();
        return preg_match('/\bbeebasm\s+([0-9.]+)/i', $output, $match) ? $match[1] : null;
    }
}
