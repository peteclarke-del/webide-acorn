<?php

declare(strict_types=1);

namespace App\Build;

use App\Http\ApiProblem;

use App\Observability\StructuredLogger;

final class CBuildService
{
    public function __construct(
        private readonly CBuildManifest $toolchain,
        private readonly CSourcePolicy $sourcePolicy,
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
        if (!$manifest['ready']) throw new ApiProblem(503, 'TOOLCHAIN_UNAVAILABLE', 'The pinned cc65 C toolchain and WebIDE BBC runtime are not ready.', true);
        $this->sourcePolicy->validate($request);
        /*
         * Answered from the cache when the same inputs, toolchain and target
         * have been built before. The key is checked against the entry's own
         * record of those inputs on the way out, so a hit is a hit because the
         * build matches and not because a hash did.
         */
        $cacheKey = BuildCache::key(BuildCache::LOCAL_OWNER, CBuildManifest::ADAPTER_ID, CBuildManifest::ADAPTER_VERSION, (string) $manifest['digest'], $request);
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
        $terminal = null;
        $outputBytes = '';
        try {
            $this->materialize($job, $request->files);
            if (!mkdir($job.'/.build', 0700)) throw new \RuntimeException('Unable to create generated-output workspace.');
            $configuration = $this->linkerConfiguration($request->origin, $request->maximumAddress);
            file_put_contents($job.'/.build/linker.cfg', $configuration, LOCK_EX);
            $this->addDocument($documents, $documentBytes, 'linker-config', 'Effective BBC C linker configuration', $request->outputName.'.linker.cfg', $configuration);

            $byId = [];
            foreach ($request->files as $file) $byId[$file['id']] = $file;
            $objects = [];
            foreach ($request->sourceUnitIds as $index => $sourceId) {
                $source = $byId[$sourceId];
                $assembly = ".build/unit-$index.s";
                $object = ".build/unit-$index.o";
                $listing = ".build/unit-$index.lst";
                $compile = [
                    $this->environment('CC65_PATH', '/usr/bin/cc65'), '--target', 'bbc', '--cpu', $request->processor,
                    '--standard', 'cc65', ...($request->debugMetadata === 'full' ? ['--debug-info'] : []), '--add-source', '--include-dir', $job,
                    '--include-dir', $this->environment('CC65_BBC_INCLUDE', '/usr/local/share/8bit-net/cc65-bbc/include'),
                    ...$this->profileArguments($request->profile, $request->profileGoal),
                ];
                foreach ($this->profileDefines($request->profile) + $request->defines as $name => $value) { $compile[] = '-D'; $compile[] = $name.'='.$value; }
                array_push($compile, '-o', $assembly, $source['name']);
                $execution = $this->runner->run($compile, $job);
                $invocations[] = ['stage' => 'compile', 'unitId' => $sourceId, ...$execution];
                $diagnostics = [...$diagnostics, ...$this->parser->diagnostics($execution['stdout']."\n".$execution['stderr'], $request->files, 'compile')];
                $logs[] = sprintf('cc65 compile %d/%d · %s · %.1f ms · exit %s', $index + 1, count($request->sourceUnitIds), $execution['reason'], $execution['durationMs'], $execution['exitCode'] === null ? 'none' : (string) $execution['exitCode']);
                if ($execution['reason'] !== 'succeeded') { $terminal = $execution['reason']; break; }
                $this->requireRegularOutput($job.'/'.$assembly, 'cc65 generated assembly');
                $this->collectTextDocument($job, $assembly, $documents, $documentBytes, "generated-assembly-$index", 'cc65 generated assembly · '.$source['name'], $request->outputName.'.'.$index.'.s');

                $assemble = [
                    $this->environment('CA65_PATH', '/usr/bin/ca65'), '--target', 'bbc', '--cpu', $request->processor,
                    ...($request->debugMetadata === 'full' ? ['--debug-info'] : []), '--listing', $listing, '--list-bytes', '255', '-o', $object, $assembly,
                ];
                $execution = $this->runner->run($assemble, $job);
                $invocations[] = ['stage' => 'assemble', 'unitId' => $sourceId, ...$execution];
                $diagnostics = [...$diagnostics, ...$this->parser->diagnostics($execution['stdout']."\n".$execution['stderr'], $request->files, 'assemble')];
                $logs[] = sprintf('ca65 generated unit %d/%d · %s · %.1f ms · exit %s', $index + 1, count($request->sourceUnitIds), $execution['reason'], $execution['durationMs'], $execution['exitCode'] === null ? 'none' : (string) $execution['exitCode']);
                $this->collectTextDocument($job, $listing, $documents, $documentBytes, "listing-$index", 'ca65 listing · '.$source['name'], $request->outputName.'.'.$index.'.listing.txt');
                if ($execution['reason'] !== 'succeeded') { $terminal = $execution['reason']; break; }
                $this->requireRegularOutput($job.'/'.$object, 'ca65 C object');
                $objects[] = $object;
            }

            $output = '.build/output.bin';
            if ($terminal === null) {
                $runtime = $this->environment('CC65_BBC_RUNTIME', '/usr/local/lib/8bit-net/cc65-bbc');
                $link = [
                    $this->environment('LD65_PATH', '/usr/bin/ld65'), '--config', '.build/linker.cfg', '--mapfile', '.build/output.map',
                    ...($request->debugMetadata === 'full' ? ['--dbgfile', '.build/output.dbg'] : []), '-Ln', '.build/output.lbl', '-o', $output,
                    $runtime.'/crt0.o', $runtime.'/platform.o', ...$objects, '/usr/share/cc65/lib/none.lib',
                ];
                $execution = $this->runner->run($link, $job);
                $invocations[] = ['stage' => 'link', ...$execution];
                $diagnostics = [...$diagnostics, ...$this->parser->diagnostics($execution['stdout']."\n".$execution['stderr'], $request->files, 'link')];
                $logs[] = sprintf('ld65 BBC C link · %s · %.1f ms · exit %s', $execution['reason'], $execution['durationMs'], $execution['exitCode'] === null ? 'none' : (string) $execution['exitCode']);
                if ($execution['reason'] !== 'succeeded') $terminal = $execution['reason'];
            }

            $this->collectTextDocument($job, '.build/output.map', $documents, $documentBytes, 'linker-map', 'ld65 BBC C linker map', $request->outputName.'.map');
            $this->collectTextDocument($job, '.build/output.lbl', $documents, $documentBytes, 'labels', 'VICE label file', $request->outputName.'.labels.txt');
            $this->collectTextDocument($job, '.build/output.dbg', $documents, $documentBytes, 'debug-info', 'ld65 pinned C debug data', $request->outputName.'.dbg');
            $debug = is_file($job.'/.build/output.dbg') && !is_link($job.'/.build/output.dbg')
                ? $this->parser->debugFile((string) file_get_contents($job.'/.build/output.dbg'), $request->files)
                : ['symbols' => [], 'sourceLocations' => [], 'segments' => []];
            if ($terminal !== null && !$diagnostics) $diagnostics[] = ['severity' => 'error', 'message' => $this->terminalMessage($terminal), 'line' => 1, 'column' => 1, 'stage' => 'adapter'];
            $errors = count(array_filter($diagnostics, static fn (array $item): bool => $item['severity'] === 'error'));
            $warnings = count(array_filter($diagnostics, static fn (array $item): bool => $item['severity'] === 'warning'));
            $artifact = null;
            $artifactRecords = [];
            if ($terminal === null && $errors === 0) {
                $this->requireRegularOutput($job.'/'.$output, 'linked C executable');
                $size = filesize($job.'/'.$output);
                if ($size === false || $size > BuildLimits::ARTIFACT_BYTES) throw new ApiProblem(400, 'BUILD_ARTIFACT_TOO_LARGE', sprintf('Native C executable exceeds the %d-byte artifact limit.', BuildLimits::ARTIFACT_BYTES));
                $outputBytes = (string) file_get_contents($job.'/'.$output);
                $origin = $this->outputOrigin($debug['segments'], $request->origin);
                if ($outputBytes === '') throw new ApiProblem(400, 'BUILD_OUTPUT_EMPTY', 'The C linker produced an empty executable.');
                $artifact = [
                    'kind' => '6502-binary', 'bytesBase64' => base64_encode($outputBytes), 'origin' => $origin, 'entryPoint' => $origin,
                    'processor' => $request->processor === '6502' ? '6502' : '65c02', 'symbols' => $debug['symbols'],
                    'sourceLocations' => $debug['sourceLocations'], 'sourceMap' => array_map(static fn (array $location): int => $location['line'], $debug['sourceLocations']),
                    'entryFileId' => $request->sourceUnitIds[0], 'dependencies' => array_values(array_map(static fn (array $file): string => $file['name'], $request->files)),
                    'listing' => $this->listingRows($outputBytes, $origin, $debug['sourceLocations'], $request->files), 'diagnostics' => $diagnostics,
                ];
                $artifactRecords[] = ['name' => $request->outputName, 'kind' => '6502-binary', 'bytes' => strlen($outputBytes), 'fingerprint' => $this->fingerprint($outputBytes), 'sha256' => hash('sha256', $outputBytes)];
            }

            $inputs = array_map(fn (array $file): array => ['id' => $file['id'], 'name' => $file['name'], 'bytes' => strlen($file['content']), 'fingerprint' => $this->fingerprint($file['content']), 'sha256' => hash('sha256', $file['content'])], $request->files);
            $inputs[] = ['id' => '@linker-config', 'name' => 'generated BBC C linker configuration', 'bytes' => strlen($configuration), 'fingerprint' => $this->fingerprint($configuration), 'sha256' => hash('sha256', $configuration)];
            $duration = max(0.0, (hrtime(true) - $started) / 1_000_000);
            $exitReason = $artifact !== null ? 'succeeded' : match ($terminal) { 'timeout' => 'timeout', 'output-limit' => 'output-limit', default => 'diagnostics' };
            $metadata = [
                'schema' => '8bit-net.build-result', 'version' => 1,
                'invocation' => ['adapterId' => CBuildManifest::ADAPTER_ID, 'adapterVersion' => CBuildManifest::ADAPTER_VERSION, 'toolchainDigest' => $manifest['digest'], 'engine' => 'server-native', 'profile' => $request->profile, 'machineId' => $request->machineId, 'dependencyTargetIds' => []],
                'exit' => ['reason' => $exitReason, 'errors' => $errors, 'warnings' => $warnings], 'timing' => ['durationMs' => $duration],
                'cache' => ['status' => 'bypassed', 'reason' => 'Native C builds use isolated per-request workspaces', 'entries' => 0, 'hits' => 0, 'misses' => 0, 'corruptions' => 0, 'evictions' => 0],
                'inputs' => $inputs, 'artifacts' => $artifactRecords,
                'size' => ['outputBytes' => strlen($outputBytes), 'mappedBytes' => count($debug['sourceLocations']), 'unmappedBytes' => max(0, strlen($outputBytes) - count($debug['sourceLocations'])), ...($artifact === null ? [] : ['origin' => $artifact['origin'], 'end' => $artifact['origin'] + strlen($outputBytes) - 1]), 'symbols' => count($debug['symbols']), 'sourceFiles' => count($request->files)],
                'diagnostics' => $diagnostics, 'logs' => $logs,
            ];
            $provenance = [
                'schema' => '8bit-net.build-provenance', 'version' => 2, 'fingerprintAlgorithm' => 'fnv1a32', 'digestAlgorithm' => 'sha256',
                'fingerprint' => $this->fingerprint(ToolchainManifest::canonicalJson(['targetId' => $request->targetId, 'machineId' => $request->machineId, 'profile' => $request->profile, 'processor' => $request->processor, 'inputs' => $inputs, 'output' => $artifactRecords[0] ?? null])),
                'toolchain' => $manifest, 'toolchainDigest' => $manifest['digest'], 'inputs' => $inputs, 'output' => $artifactRecords[0] ?? null,
            ];
            if ($artifact !== null) $artifact['provenance'] = $provenance;
            $this->logger->info('native-build-completed', ['adapter' => CBuildManifest::ADAPTER_ID, 'outcome' => $exitReason, 'durationMs' => round($duration, 2), 'outputByteCount' => strlen($outputBytes), 'errors' => $errors, 'warnings' => $warnings]);
            $response = ['schema' => '8bit-net.native-build-response', 'version' => 1, 'requestId' => $request->requestId, 'result' => $metadata, 'artifact' => $artifact, 'documents' => $documents, 'invocations' => $invocations, 'provenance' => $provenance];
            $this->cache->write(BuildCache::LOCAL_OWNER, $cacheKey, $request->files, $response);

            return $this->cache->storedEnvelope($response, BuildCache::LOCAL_OWNER, $cacheKey, $request->cacheBypass);
        } finally {
            $this->workspace->remove($job);
        }
    }

    /** @param list<array{id: string, name: string, content: string}> $files */
    private function materialize(string $job, array $files): void
    {
        foreach ($files as $file) {
            $path = $job.'/'.$file['name'];
            if (!is_dir(dirname($path)) && !mkdir(dirname($path), 0700, true)) throw new \RuntimeException('Unable to create project workspace directory.');
            if (file_put_contents($path, $file['content'], LOCK_EX) !== strlen($file['content'])) throw new \RuntimeException('Unable to materialize a declared C input.');
            chmod($path, 0600);
        }
    }

    private function linkerConfiguration(int $origin, int $maximum): string
    {
        $start = sprintf('$%04X', $origin);
        $size = sprintf('$%04X', $maximum - $origin + 1);
        return <<<CFG
SYMBOLS {
    __STACKSIZE__: type = weak, value = \$0800;
    __STACKSTART__: type = weak, value = \$7200;
}
MEMORY {
    ZP: file = "", define = yes, start = \$0070, size = \$0020;
    MAIN: file = %O, define = yes, start = {$start}, size = {$size};
}
SEGMENTS {
    ZEROPAGE: load = ZP, type = zp;
    STARTUP: load = MAIN, type = ro, define = yes;
    LOWCODE: load = MAIN, type = ro, optional = yes;
    ONCE: load = MAIN, type = ro, optional = yes;
    CODE: load = MAIN, type = ro;
    RODATA: load = MAIN, type = ro, optional = yes;
    DATA: load = MAIN, type = rw, optional = yes;
    BSS: load = MAIN, type = bss, optional = yes, define = yes;
    ZPSAVE: load = MAIN, type = bss, optional = yes;
}
FEATURES {
    CONDES: type = constructor, label = __CONSTRUCTOR_TABLE__, count = __CONSTRUCTOR_COUNT__, segment = ONCE;
    CONDES: type = destructor, label = __DESTRUCTOR_TABLE__, count = __DESTRUCTOR_COUNT__, segment = RODATA;
    CONDES: type = interruptor, label = __INTERRUPTOR_TABLE__, count = __INTERRUPTOR_COUNT__, segment = RODATA, import = __CALLIRQ__;
}
CFG;
    }

    /** @return list<string> */
    private function profileArguments(string $profile, string $customGoal): array
    {
        return match ($profile === 'custom' ? $customGoal : $profile) { 'size', 'balanced' => ['-O'], 'speed' => ['-Oi'], default => [] };
    }

    /** @return array<string, int> */
    private function profileDefines(string $profile): array
    {
        return ['BUILD_PROFILE_DEBUG' => $profile === 'debug' ? 1 : 0, 'BUILD_PROFILE_SIZE' => $profile === 'size' ? 1 : 0, 'BUILD_PROFILE_SPEED' => $profile === 'speed' ? 1 : 0, 'BUILD_PROFILE_CUSTOM' => $profile === 'custom' ? 1 : 0];
    }

    /** @param list<array<string, mixed>> $documents */
    private function addDocument(array &$documents, int &$total, string $id, string $label, string $filename, string $content): void
    {
        if (count($documents) >= BuildLimits::DOCUMENTS || strlen($content) > BuildLimits::FILE_BYTES || $total + strlen($content) > BuildLimits::DOCUMENT_BYTES) throw new ApiProblem(400, 'BUILD_DOCUMENT_LIMIT', 'Generated C documents exceeded the collection limit.');
        $documents[] = ['id' => $id, 'label' => $label, 'filename' => $filename, 'content' => $content, 'bytes' => strlen($content), 'sha256' => hash('sha256', $content)];
        $total += strlen($content);
    }

    /** @param list<array<string, mixed>> $documents */
    private function collectTextDocument(string $job, string $relative, array &$documents, int &$total, string $id, string $label, string $filename): void
    {
        $path = $job.'/'.$relative;
        if (!file_exists($path)) return;
        $this->requireRegularOutput($path, $label);
        $size = filesize($path);
        if ($size === false || $size > BuildLimits::FILE_BYTES) throw new ApiProblem(400, 'BUILD_DOCUMENT_LIMIT', "$label exceeded the generated-document limit.");
        $this->addDocument($documents, $total, $id, $label, $filename, str_replace([$job.'/', $job], ['', '<job>'], (string) file_get_contents($path)));
    }

    private function requireRegularOutput(string $path, string $label): void
    {
        if (is_link($path) || !is_file($path) || filetype($path) !== 'file') throw new ApiProblem(400, 'BUILD_OUTPUT_INVALID', "$label was not a regular generated file.");
    }

    /** @param list<array{name: string, start: int, size: int, outputOffset?: int}> $segments */
    private function outputOrigin(array $segments, int $fallback): int
    {
        $starts = array_map(static fn (array $segment): int => $segment['start'], array_filter($segments, static fn (array $segment): bool => $segment['size'] > 0 && isset($segment['outputOffset'])));
        return $starts ? min($starts) : $fallback;
    }

    /**
     * @param array<int, array{fileId: string, fileName: string, line: int}> $locations
     * @param list<array{id: string, name: string, content: string}> $files
     * @return list<string>
     */
    private function listingRows(string $bytes, int $origin, array $locations, array $files): array
    {
        $contents = [];
        foreach ($files as $file) $contents[$file['id']] = preg_split('/\R/u', $file['content']) ?: [];
        $rows = [];
        for ($address = $origin, $end = $origin + strlen($bytes); $address < $end;) {
            $location = $locations[$address] ?? null;
            $length = 1;
            while ($length < 12 && $address + $length < $end && ($locations[$address + $length] ?? null) === $location) ++$length;
            $hex = strtoupper(implode(' ', str_split(bin2hex(substr($bytes, $address - $origin, $length)), 2)));
            $source = $location === null ? '' : trim((string) ($contents[$location['fileId']][$location['line'] - 1] ?? ''));
            $rows[] = sprintf('[%s] &%04X  %-35s %s', $location === null ? 'runtime/unmapped' : $location['fileName'].':'.$location['line'], $address, $hex, $source);
            $address += $length;
        }
        return $rows;
    }

    private function terminalMessage(string $reason): string
    {
        return match ($reason) { 'timeout' => 'Native C toolchain stage exceeded its wall-clock limit.', 'output-limit' => 'Native C toolchain stage exceeded its captured-output limit.', default => 'Native C toolchain exited without a normalized diagnostic.' };
    }

    private function environment(string $name, string $fallback): string
    {
        return ToolLocator::locate($name, basename($fallback), $fallback);
    }

    private function fingerprint(string $bytes): string
    {
        $hash = 0x811c9dc5;
        for ($index = 0; $index < strlen($bytes); ++$index) { $hash ^= ord($bytes[$index]); $hash = ($hash * 0x01000193) & 0xffffffff; }
        return str_pad(dechex($hash), 8, '0', STR_PAD_LEFT);
    }
}
