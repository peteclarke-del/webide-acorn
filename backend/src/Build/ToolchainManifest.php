<?php

declare(strict_types=1);

namespace App\Build;

use Symfony\Component\Process\Process;

final class ToolchainManifest
{
    public const ADAPTER_ID = 'cc65.ca65-ld65';
    public const ADAPTER_VERSION = '2026.08.1';

    /** @return array<string, mixed> */
    public function detect(): array
    {
        $ca65 = ToolLocator::locate('CA65_PATH', 'ca65', '/usr/bin/ca65');
        $ld65 = ToolLocator::locate('LD65_PATH', 'ld65', '/usr/bin/ld65');
        $caVersion = $this->version($ca65);
        $ldVersion = $this->version($ld65);
        $readiness = (new Readiness())
            ->executable('ca65', $ca65)
            ->executable('ld65', $ld65)
            ->version('ca65', $caVersion)
            ->version('ld65', $ldVersion);
        $manifest = [
            'schema' => '8bit-net.toolchain-manifest',
            'version' => 1,
            'id' => self::ADAPTER_ID,
            'adapterVersion' => self::ADAPTER_VERSION,
            'label' => 'ca65 + ld65 native toolchain',
            'execution' => 'server-native',
            'language' => '6502',
            'artifactKind' => '6502-binary',
            'processors' => ['6502', '65sc02', '65c02', 'w65c02'],
            'profiles' => ['debug', 'size', 'speed', 'custom'],
            'deterministic' => true,
            'packageVersion' => ToolLocator::configured('TOOLCHAIN_PACKAGE_VERSION') ?? 'host-development',
            'ca65' => ['version' => $caVersion, 'sha256' => is_file($ca65) ? hash_file('sha256', $ca65) : null],
            'ld65' => ['version' => $ldVersion, 'sha256' => is_file($ld65) ? hash_file('sha256', $ld65) : null],
            'limits' => BuildLimits::manifest(),
            'sandbox' => ['network' => 'none', 'filesystem' => 'read-only-root+job-tmpfs', 'identity' => 'non-root', 'shell' => false, 'persistence' => 'none'],
            'ready' => $readiness->ready(),
            'readiness' => $readiness->checks(),
        ];
        $manifest['digestAlgorithm'] = 'sha256';
        $manifest['digest'] = hash('sha256', self::canonicalJson($manifest));

        return $manifest;
    }

    private function version(string $path): ?string
    {
        if (!is_file($path) || !is_executable($path)) {
            return null;
        }
        $process = new Process([$path, '--version'], null, ['LANG' => 'C', 'LC_ALL' => 'C']);
        $process->setTimeout(2.0);
        $process->run();
        $value = trim($process->getOutput().$process->getErrorOutput());

        return $process->isSuccessful() && $value !== '' ? preg_replace('/\s+/', ' ', $value) : null;
    }

    public static function canonicalJson(mixed $value): string
    {
        if (is_array($value)) {
            if (array_is_list($value)) {
                return '['.implode(',', array_map(self::canonicalJson(...), $value)).']';
            }
            ksort($value, SORT_STRING);
            $items = [];
            foreach ($value as $key => $item) {
                $items[] = json_encode((string) $key, JSON_THROW_ON_ERROR).':'.self::canonicalJson($item);
            }

            return '{'.implode(',', $items).'}';
        }

        return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
}
