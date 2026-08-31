<?php

declare(strict_types=1);

namespace App\Build;

use App\Http\ApiProblem;

use App\Observability\StructuredLogger;

final class NativeBuildService
{
    public function __construct(
        private readonly ToolchainManifest $toolchain,
        private readonly SourcePolicy $sourcePolicy,
        private readonly NativeProcessRunner $runner,
        private readonly Cc65OutputParser $parser,
        private readonly StructuredLogger $logger,
        private readonly JobWorkspace $workspace,
        private readonly BuildCache $cache,
    ) {
    }

    /** @return array<string, mixed> */
    public function build(NativeBuildRequest $request): array
    {
        $started = hrtime(true);
        $manifest = $this->toolchain->detect();
        if (!$manifest['ready']) {
            throw new ApiProblem(503, 'TOOLCHAIN_UNAVAILABLE', 'The pinned ca65/ld65 toolchain is not ready.', true);
        }
        $this->sourcePolicy->validate($request);
        /*
         * Answered from the cache when the same inputs, toolchain and target
         * have been built before. The key is checked against the entry's own
         * record of those inputs on the way out, so a hit is a hit because the
         * build matches and not because a hash did.
         */
        $cacheKey = BuildCache::key(BuildCache::LOCAL_OWNER, ToolchainManifest::ADAPTER_ID, ToolchainManifest::ADAPTER_VERSION, (string) $manifest['digest'], $request);
        if (!$request->cacheBypass) {
            $cached = $this->cache->read(BuildCache::LOCAL_OWNER, $cacheKey, $request->files);
            if ($cached !== null) {
                return $this->cache->hitEnvelope($cached, BuildCache::LOCAL_OWNER, $cacheKey, max(0.0, (hrtime(true) - $started) / 1_000_000.0));
            }
        }
        $job = $this->workspace->allocate();

        $documents = [];
        $documentBytes = 0;
        $invocations = [];
        $diagnostics = [];
        $logs = [];
        $stageTerminal = null;
        try {
            foreach ($request->files as $file) {
                $path = $job.'/'.$file['name'];
                $directory = dirname($path);
                if (!is_dir($directory) && !mkdir($directory, 0700, true)) {
                    throw new \RuntimeException('Unable to create project workspace directory.');
                }
                if (file_put_contents($path, $file['content'], LOCK_EX) !== strlen($file['content'])) {
                    throw new \RuntimeException('Unable to materialize a declared project input.');
                }
                chmod($path, 0600);
            }
            if (!mkdir($job.'/.build', 0700)) {
                throw new \RuntimeException('Unable to create generated-output workspace.');
            }
            $linkerConfiguration = $this->linkerConfiguration($request->origin, $request->maximumAddress);
            file_put_contents($job.'/.build/linker.cfg', $linkerConfiguration, LOCK_EX);
            $this->addDocument($documents, $documentBytes, 'linker-config', 'Effective linker configuration', $request->outputName.'.linker.cfg', $linkerConfiguration);

            $sourceById = [];
            foreach ($request->files as $file) {
                $sourceById[$file['id']] = $file;
            }
            $objects = [];
            foreach ($request->sourceUnitIds as $index => $sourceId) {
                $source = $sourceById[$sourceId];
                $object = ".build/unit-$index.o";
                $listing = ".build/unit-$index.lst";
                $dependency = ".build/unit-$index.d";
                $argv = [
                    (string) ($_SERVER['CA65_PATH'] ?? $_ENV['CA65_PATH'] ?? '/usr/bin/ca65'),
                    '--cpu', $request->processor,
                    '--debug-info',
                    '--include-dir', $job,
                    '--listing', $listing,
                    '--list-bytes', '255',
                    '--create-full-dep', $dependency,
                    '-o', $object,
                ];
                foreach ($this->profileDefines($request->profile) + $request->defines as $name => $value) {
                    $argv[] = '-D';
                    $argv[] = $name.'='.$value;
                }
                $argv[] = $source['name'];
                $execution = $this->runner->run($argv, $job);
                $invocations[] = ['stage' => 'assemble', 'unitId' => $sourceId, ...$execution];
                $diagnostics = [...$diagnostics, ...$this->parser->diagnostics($execution['stdout']."\n".$execution['stderr'], $request->files, 'assemble')];
                $logs[] = sprintf('ca65 unit %d/%d · %s · %.1f ms · exit %s', $index + 1, count($request->sourceUnitIds), $execution['reason'], $execution['durationMs'], $execution['exitCode'] === null ? 'none' : (string) $execution['exitCode']);
                $this->collectTextDocument($job, $listing, $documents, $documentBytes, "listing-$index", 'ca65 listing · '.$source['name'], $request->outputName.'.'.$index.'.listing.txt');
                $this->collectTextDocument($job, $dependency, $documents, $documentBytes, "dependencies-$index", 'ca65 dependencies · '.$source['name'], $request->outputName.'.'.$index.'.dependencies.mk');
                if ($execution['reason'] !== 'succeeded') {
                    $stageTerminal = $execution['reason'];
                    break;
                }
                $this->requireRegularOutput($job.'/'.$object, 'ca65 object');
                $objects[] = $object;
            }

            $outputPath = '.build/output.bin';
            if ($stageTerminal === null) {
                $argv = [
                    (string) ($_SERVER['LD65_PATH'] ?? $_ENV['LD65_PATH'] ?? '/usr/bin/ld65'),
                    '--config', '.build/linker.cfg',
                    '--mapfile', '.build/output.map',
                    '--dbgfile', '.build/output.dbg',
                    '-Ln', '.build/output.lbl',
                    '-o', $outputPath,
                    ...$objects,
                ];
                $execution = $this->runner->run($argv, $job);
                $invocations[] = ['stage' => 'link', ...$execution];
                $diagnostics = [...$diagnostics, ...$this->parser->diagnostics($execution['stdout']."\n".$execution['stderr'], $request->files, 'link')];
                $logs[] = sprintf('ld65 link · %s · %.1f ms · exit %s', $execution['reason'], $execution['durationMs'], $execution['exitCode'] === null ? 'none' : (string) $execution['exitCode']);
                if ($execution['reason'] !== 'succeeded') {
                    $stageTerminal = $execution['reason'];
                }
            }

            $this->collectTextDocument($job, '.build/output.map', $documents, $documentBytes, 'linker-map', 'ld65 linker map', $request->outputName.'.map');
            $this->collectTextDocument($job, '.build/output.lbl', $documents, $documentBytes, 'labels', 'VICE label file', $request->outputName.'.labels.txt');
            $this->collectTextDocument($job, '.build/output.dbg', $documents, $documentBytes, 'debug-info', 'ld65 pinned debug data', $request->outputName.'.dbg');
            $debug = is_file($job.'/.build/output.dbg') && !is_link($job.'/.build/output.dbg') ? $this->parser->debugFile((string) file_get_contents($job.'/.build/output.dbg'), $request->files) : ['symbols' => [], 'sourceLocations' => [], 'segments' => []];
            if ($stageTerminal !== null && !$diagnostics) {
                $diagnostics[] = ['severity' => 'error', 'message' => $this->terminalMessage($stageTerminal), 'line' => 1, 'column' => 1, 'stage' => 'adapter'];
            }
            $errors = count(array_filter($diagnostics, static fn (array $item): bool => $item['severity'] === 'error'));
            $warnings = count(array_filter($diagnostics, static fn (array $item): bool => $item['severity'] === 'warning'));
            $artifact = null;
            $artifactRecord = [];
            $outputBytes = '';
            if ($stageTerminal === null && $errors === 0) {
                $this->requireRegularOutput($job.'/'.$outputPath, 'linked executable');
                $size = filesize($job.'/'.$outputPath);
                if ($size === false || $size > BuildLimits::ARTIFACT_BYTES) {
                    throw new ApiProblem(400, 'BUILD_ARTIFACT_TOO_LARGE', sprintf('Native executable exceeds the %d-byte artifact limit.', BuildLimits::ARTIFACT_BYTES));
                }
                $outputBytes = (string) file_get_contents($job.'/'.$outputPath);
                $origin = $this->outputOrigin($debug['segments'], $request->origin);
                $entryPoint = $this->entryPoint($request, $debug['symbols'], $origin, strlen($outputBytes));
                $listingRows = $this->listingRows($outputBytes, $origin, $debug['sourceLocations'], $request->files);
                $artifact = [
                    'kind' => '6502-binary',
                    'bytesBase64' => base64_encode($outputBytes),
                    'origin' => $origin,
                    'entryPoint' => $entryPoint,
                    'processor' => $request->processor === '6502' ? '6502' : '65c02',
                    'symbols' => $debug['symbols'],
                    'sourceLocations' => $debug['sourceLocations'],
                    'sourceMap' => array_map(static fn (array $location): int => $location['line'], $debug['sourceLocations']),
                    'entryFileId' => $request->sourceUnitIds[0],
                    'dependencies' => array_values(array_map(static fn (array $file): string => $file['name'], $request->files)),
                    'listing' => $listingRows,
                    'diagnostics' => $diagnostics,
                ];
                $artifactRecord[] = ['name' => $request->outputName, 'kind' => '6502-binary', 'bytes' => strlen($outputBytes), 'fingerprint' => $this->fingerprint($outputBytes), 'sha256' => hash('sha256', $outputBytes)];
            }

            $inputs = array_map(fn (array $file): array => ['id' => $file['id'], 'name' => $file['name'], 'bytes' => strlen($file['content']), 'fingerprint' => $this->fingerprint($file['content']), 'sha256' => hash('sha256', $file['content'])], $request->files);
            $inputs[] = ['id' => '@linker-config', 'name' => 'generated linker configuration', 'bytes' => strlen($linkerConfiguration), 'fingerprint' => $this->fingerprint($linkerConfiguration), 'sha256' => hash('sha256', $linkerConfiguration)];
            $mappedBytes = $artifact === null ? 0 : count($debug['sourceLocations']);
            $durationMs = max(0.0, (hrtime(true) - $started) / 1_000_000);
            $exitReason = $artifact !== null ? 'succeeded' : match ($stageTerminal) {
                'timeout' => 'timeout',
                'output-limit' => 'output-limit',
                default => 'diagnostics',
            };
            $metadata = [
                'schema' => '8bit-net.build-result',
                'version' => 1,
                'invocation' => ['adapterId' => ToolchainManifest::ADAPTER_ID, 'adapterVersion' => ToolchainManifest::ADAPTER_VERSION, 'toolchainDigest' => $manifest['digest'], 'engine' => 'server-native', 'profile' => $request->profile, 'machineId' => $request->machineId, 'dependencyTargetIds' => []],
                'exit' => ['reason' => $exitReason, 'errors' => $errors, 'warnings' => $warnings],
                'timing' => ['durationMs' => $durationMs],
                'cache' => ['status' => 'bypassed', 'reason' => 'The first native adapter has no cross-request cache', 'entries' => 0, 'hits' => 0, 'misses' => 0, 'corruptions' => 0, 'evictions' => 0],
                'inputs' => $inputs,
                'artifacts' => $artifactRecord,
                'size' => ['outputBytes' => strlen($outputBytes), 'mappedBytes' => $mappedBytes, 'unmappedBytes' => max(0, strlen($outputBytes) - $mappedBytes), ...($artifact === null ? [] : ['origin' => $artifact['origin'], 'end' => strlen($outputBytes) ? $artifact['origin'] + strlen($outputBytes) - 1 : $artifact['origin']]), 'symbols' => count($debug['symbols']), 'sourceFiles' => count($request->files)],
                'diagnostics' => $diagnostics,
                'logs' => $logs,
            ];
            $provenance = [
                'schema' => '8bit-net.build-provenance', 'version' => 2, 'fingerprintAlgorithm' => 'fnv1a32', 'digestAlgorithm' => 'sha256',
                'fingerprint' => $this->fingerprint(ToolchainManifest::canonicalJson(['targetId' => $request->targetId, 'machineId' => $request->machineId, 'profile' => $request->profile, 'processor' => $request->processor, 'inputs' => $inputs, 'output' => $artifactRecord[0] ?? null])),
                'toolchain' => $manifest, 'toolchainDigest' => $manifest['digest'], 'inputs' => $inputs, 'output' => $artifactRecord[0] ?? null,
            ];
            if ($artifact !== null) {
                $artifact['provenance'] = $provenance;
            }

            $this->structuredLog($request, $exitReason, $durationMs, strlen($outputBytes), $errors, $warnings);

            $response = ['schema' => '8bit-net.native-build-response', 'version' => 1, 'requestId' => $request->requestId, 'result' => $metadata, 'artifact' => $artifact, 'documents' => $documents, 'invocations' => $invocations, 'provenance' => $provenance];
            $this->cache->write(BuildCache::LOCAL_OWNER, $cacheKey, $request->files, $response);

            return $this->cache->storedEnvelope($response, BuildCache::LOCAL_OWNER, $cacheKey, $request->cacheBypass);
        } finally {
            $this->workspace->remove($job);
        }
    }

    private function linkerConfiguration(int $origin, int $maximumAddress): string
    {
        $originHex = sprintf('$%04X', $origin);
        $sizeHex = sprintf('$%04X', $maximumAddress - $origin + 1);

        return <<<CFG
MEMORY {
    ZP: start = \$0000, size = \$0100, type = rw, define = yes;
    RAM: start = {$originHex}, size = {$sizeHex}, file = %O, define = yes;
}
SEGMENTS {
    ZEROPAGE: load = ZP, type = zp, optional = yes;
    STARTUP: load = RAM, type = ro, optional = yes;
    LOWCODE: load = RAM, type = ro, optional = yes;
    ONCE: load = RAM, type = ro, optional = yes;
    CODE: load = RAM, type = ro;
    RODATA: load = RAM, type = ro, optional = yes;
    DATA: load = RAM, type = rw, optional = yes;
    BSS: load = RAM, type = bss, optional = yes, define = yes;
}
CFG;
    }

    /** @return array<string, int> */
    private function profileDefines(string $profile): array
    {
        return ['BUILD_PROFILE_DEBUG' => $profile === 'debug' ? 1 : 0, 'BUILD_PROFILE_SIZE' => $profile === 'size' ? 1 : 0, 'BUILD_PROFILE_SPEED' => $profile === 'speed' ? 1 : 0, 'BUILD_PROFILE_CUSTOM' => $profile === 'custom' ? 1 : 0];
    }

    /** @param list<array<string, mixed>> $documents */
    private function addDocument(array &$documents, int &$totalBytes, string $id, string $label, string $filename, string $content): void
    {
        if (count($documents) >= BuildLimits::DOCUMENTS || strlen($content) > BuildLimits::FILE_BYTES || $totalBytes + strlen($content) > BuildLimits::DOCUMENT_BYTES) {
            throw new ApiProblem(400, 'BUILD_DOCUMENT_LIMIT', 'Generated native documents exceeded the collection limit.');
        }
        $documents[] = ['id' => $id, 'label' => $label, 'filename' => $filename, 'content' => $content, 'bytes' => strlen($content), 'sha256' => hash('sha256', $content)];
        $totalBytes += strlen($content);
    }

    /** @param list<array<string, mixed>> $documents */
    private function collectTextDocument(string $job, string $relative, array &$documents, int &$totalBytes, string $id, string $label, string $filename): void
    {
        $path = $job.'/'.$relative;
        if (!file_exists($path)) {
            return;
        }
        $this->requireRegularOutput($path, $label);
        $size = filesize($path);
        if ($size === false || $size > BuildLimits::FILE_BYTES) {
            throw new ApiProblem(400, 'BUILD_DOCUMENT_LIMIT', "$label exceeded the generated-document limit.");
        }
        $content = (string) file_get_contents($path);
        $this->addDocument($documents, $totalBytes, $id, $label, $filename, $this->redactJobPaths($content, $job));
    }

    private function requireRegularOutput(string $path, string $label): void
    {
        if (is_link($path) || !is_file($path) || filetype($path) !== 'file') {
            throw new ApiProblem(400, 'BUILD_OUTPUT_INVALID', "$label was not a regular generated file.");
        }
    }

    private function redactJobPaths(string $content, string $job): string
    {
        return str_replace([$job.'/', $job], ['', '<job>'], $content);
    }

    /** @param list<array{name: string, start: int, size: int, outputOffset?: int}> $segments */
    private function outputOrigin(array $segments, int $fallback): int
    {
        $starts = array_map(static fn (array $segment): int => $segment['start'], array_filter($segments, static fn (array $segment): bool => $segment['size'] > 0 && isset($segment['outputOffset'])));

        return $starts ? min($starts) : $fallback;
    }

    /** @param array<string, int> $symbols */
    private function entryPoint(NativeBuildRequest $request, array $symbols, int $origin, int $size): int
    {
        $entry = $origin;
        if ($request->entryMode === 'address') {
            $value = $request->entryValue;
            $entry = str_starts_with(strtolower($value), '0x') ? intval(substr($value, 2), 16) : ((str_starts_with($value, '$') || str_starts_with($value, '&')) ? intval(substr($value, 1), 16) : intval($value, 10));
        } elseif ($request->entryMode === 'symbol') {
            if (!array_key_exists($request->entryValue, $symbols)) {
                throw new ApiProblem(400, 'BUILD_ENTRY_MISSING', 'The selected entry symbol was not produced by ld65.', false, ['target.entry.value' => 'Unknown linked symbol']);
            }
            $entry = $symbols[$request->entryValue];
        }
        if ($size === 0 || $entry < $origin || $entry >= $origin + $size) {
            throw new ApiProblem(400, 'BUILD_ENTRY_RANGE', 'The selected entry point is outside the linked executable.');
        }

        return $entry;
    }

    /**
     * @param array<int, array{fileId: string, fileName: string, line: int}> $locations
     * @param list<array{id: string, name: string, content: string}> $files
     * @return list<string>
     */
    private function listingRows(string $bytes, int $origin, array $locations, array $files): array
    {
        $contents = [];
        foreach ($files as $file) {
            $contents[$file['id']] = preg_split('/\R/u', $file['content']) ?: [];
        }
        $rows = [];
        $address = $origin;
        $end = $origin + strlen($bytes);
        while ($address < $end) {
            $location = $locations[$address] ?? null;
            $length = 1;
            while ($length < 12 && $address + $length < $end && ($locations[$address + $length] ?? null) === $location) {
                ++$length;
            }
            $hex = strtoupper(implode(' ', str_split(bin2hex(substr($bytes, $address - $origin, $length)), 2)));
            $source = $location === null ? '' : trim((string) ($contents[$location['fileId']][$location['line'] - 1] ?? ''));
            $rows[] = sprintf('[%s] &%04X  %-35s %s', $location === null ? 'unmapped' : $location['fileName'].':'.$location['line'], $address, $hex, $source);
            $address += $length;
        }

        return $rows;
    }

    private function terminalMessage(string $reason): string
    {
        return match ($reason) {
            'timeout' => 'Native toolchain stage exceeded its wall-clock limit.',
            'output-limit' => 'Native toolchain stage exceeded its captured-output limit.',
            default => 'Native toolchain exited without a normalized diagnostic.',
        };
    }

    private function fingerprint(string $bytes): string
    {
        $hash = 0x811c9dc5;
        $length = strlen($bytes);
        for ($index = 0; $index < $length; ++$index) {
            $hash ^= ord($bytes[$index]);
            $hash = ($hash * 0x01000193) & 0xffffffff;
        }

        return str_pad(dechex($hash), 8, '0', STR_PAD_LEFT);
    }

    private function structuredLog(NativeBuildRequest $request, string $outcome, float $durationMs, int $outputBytes, int $errors, int $warnings): void
    {
        $this->logger->info('native-build-completed', ['targetIdHash' => substr(hash('sha256', $request->targetId), 0, 16), 'adapter' => ToolchainManifest::ADAPTER_ID, 'outcome' => $outcome, 'durationMs' => round($durationMs, 2), 'outputByteCount' => $outputBytes, 'errors' => $errors, 'warnings' => $warnings]);
    }
}
