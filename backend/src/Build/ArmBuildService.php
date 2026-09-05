<?php

declare(strict_types=1);

namespace App\Build;

use App\Http\ApiProblem;

use App\Observability\StructuredLogger;

final class ArmBuildService
{
    public function __construct(
        private readonly ArmBuildManifest $toolchain,
        private readonly ArmSourcePolicy $sourcePolicy,
        private readonly NativeProcessRunner $runner,
        private readonly ArmOutputParser $parser,
        private readonly StructuredLogger $logger,
        private readonly JobWorkspace $workspace,
        private readonly BuildCache $cache,
    ) {
    }

    /** @return array<string, mixed> */
    public function build(NativeBuildRequest $request): array
    {
        $started = hrtime(true); $manifest = $this->toolchain->detect();
        if (!$manifest['ready']) throw new ApiProblem(503, 'TOOLCHAIN_UNAVAILABLE', 'The pinned GNU ARM2 assembler/linker toolchain is not ready.', true);
        $this->sourcePolicy->validate($request);
        /*
         * Answered from the cache when the same inputs, toolchain and target
         * have been built before. The key is checked against the entry's own
         * record of those inputs on the way out, so a hit is a hit because the
         * build matches and not because a hash did.
         */
        $cacheKey = BuildCache::key(BuildCache::LOCAL_OWNER, ArmBuildManifest::ADAPTER_ID, ArmBuildManifest::ADAPTER_VERSION, (string) $manifest['digest'], $request);
        if (!$request->cacheBypass) {
            $cached = $this->cache->read(BuildCache::LOCAL_OWNER, $cacheKey, $request->files);
            if ($cached !== null) {
                return $this->cache->hitEnvelope($cached, BuildCache::LOCAL_OWNER, $cacheKey, max(0.0, (hrtime(true) - $started) / 1_000_000.0));
            }
        }
        $job = $this->workspace->allocate();
        $documents = []; $documentBytes = 0; $invocations = []; $diagnostics = []; $logs = []; $terminal = null; $outputBytes = '';
        try {
            $this->materialize($job, $request->files);
            if (!mkdir($job.'/.build', 0700)) throw new \RuntimeException('Unable to create ARM generated-output workspace.');
            $linkerScript = $this->linkerScript($request);
            file_put_contents($job.'/.build/linker.ld', $linkerScript, LOCK_EX);
            $this->addDocument($documents, $documentBytes, 'linker-script', 'Effective ARM2 linker script', $request->outputName.'.linker.ld', $linkerScript);
            $byId = [];
            foreach ($request->files as $file) $byId[$file['id']] = $file;
            $objects = [];
            foreach ($request->sourceUnitIds as $index => $sourceId) {
                $source = $byId[$sourceId]; $object = ".build/unit-$index.o";
                $argv = [$this->toolchain->path('as'), '-EL', '-mcpu=arm2', '-I', $job, ...($request->debugMetadata === 'full' ? ['-g'] : [])];
                foreach ($this->profileDefines($request->profile) + $request->defines as $name => $value) array_push($argv, '--defsym', $name.'='.$value);
                array_push($argv, '-o', $object, $source['name']);
                $execution = $this->runner->run($argv, $job); $invocations[] = ['stage' => 'assemble', 'unitId' => $sourceId, ...$execution];
                $diagnostics = [...$diagnostics, ...$this->parser->diagnostics($execution['stdout']."\n".$execution['stderr'], $request->files, 'assemble')];
                $logs[] = sprintf('GNU as ARM2 unit %d/%d · %s · %.1f ms · exit %s', $index + 1, count($request->sourceUnitIds), $execution['reason'], $execution['durationMs'], $execution['exitCode'] === null ? 'none' : (string) $execution['exitCode']);
                if ($execution['reason'] !== 'succeeded') { $terminal = $execution['reason']; break; }
                $this->requireRegularOutput($job.'/'.$object, 'ARM object'); $objects[] = $object;
            }

            if ($terminal === null) {
                $argv = [$this->toolchain->path('ld'), '-EL', '--build-id=none', '-T', '.build/linker.ld', '-Map', '.build/output.map', '-o', '.build/output.elf', ...$objects];
                $execution = $this->runner->run($argv, $job); $invocations[] = ['stage' => 'link', ...$execution];
                $diagnostics = [...$diagnostics, ...$this->parser->diagnostics($execution['stdout']."\n".$execution['stderr'], $request->files, 'link')];
                $logs[] = sprintf('GNU ld ARM2 link · %s · %.1f ms · exit %s', $execution['reason'], $execution['durationMs'], $execution['exitCode'] === null ? 'none' : (string) $execution['exitCode']);
                if ($execution['reason'] !== 'succeeded') $terminal = $execution['reason'];
            }
            if ($terminal === null) {
                $this->requireRegularOutput($job.'/.build/output.elf', 'linked ARM ELF');
                foreach ([
                    ['objcopy', [$this->toolchain->path('objcopy'), '-O', 'binary', '.build/output.elf', '.build/output.bin']],
                    ['disassemble', [$this->toolchain->path('objdump'), '-d', '-S', '-l', '--prefix-addresses', '.build/output.elf']],
                    ['debug-lines', [$this->toolchain->path('objdump'), '--dwarf=decodedline', '.build/output.elf']],
                    ['symbols', [$this->toolchain->path('nm'), '-n', '--defined-only', '.build/output.elf']],
                    ['elf-header', [$this->toolchain->path('readelf'), '-h', '-A', '.build/output.elf']],
                ] as [$stage, $argv]) {
                    $execution = $this->runner->run($argv, $job); $invocations[] = ['stage' => $stage, ...$execution];
                    $logs[] = sprintf('GNU ARM %s · %s · %.1f ms · exit %s', $stage, $execution['reason'], $execution['durationMs'], $execution['exitCode'] === null ? 'none' : (string) $execution['exitCode']);
                    if ($execution['reason'] !== 'succeeded') { $terminal = $execution['reason']; $diagnostics = [...$diagnostics, ...$this->parser->diagnostics($execution['stdout']."\n".$execution['stderr'], $request->files, $stage)]; break; }
                    if ($stage !== 'objcopy') file_put_contents($job.'/.build/'.$stage.'.txt', $execution['stdout'].$execution['stderr'], LOCK_EX);
                }
            }

            foreach ([
                ['output.map', 'linker-map', 'GNU ARM linker map', $request->outputName.'.map'],
                ['disassemble.txt', 'disassembly', 'GNU ARM2 linked disassembly', $request->outputName.'.disassembly.txt'],
                ['debug-lines.txt', 'debug-lines', 'DWARF decoded source lines', $request->outputName.'.dwarf-lines.txt'],
                ['symbols.txt', 'symbols', 'GNU ARM linked symbols', $request->outputName.'.symbols.txt'],
                ['elf-header.txt', 'elf-header', 'ELF and ARM attributes', $request->outputName.'.elf-info.txt'],
            ] as [$relative, $id, $label, $filename]) $this->collectDocument($job, '.build/'.$relative, $documents, $documentBytes, $id, $label, $filename);

            if ($terminal !== null && !$diagnostics) $diagnostics[] = ['severity' => 'error', 'message' => $this->terminalMessage($terminal), 'line' => 1, 'column' => 1, 'stage' => 'adapter'];
            $errors = count(array_filter($diagnostics, static fn (array $item): bool => $item['severity'] === 'error'));
            $warnings = count(array_filter($diagnostics, static fn (array $item): bool => $item['severity'] === 'warning'));
            $artifact = null; $artifactRecords = []; $locations = []; $symbols = [];
            if ($terminal === null && $errors === 0) {
                $this->requireRegularOutput($job.'/.build/output.bin', 'ARM raw executable');
                $size = filesize($job.'/.build/output.bin');
                if ($size === false || $size < 1 || $size > BuildLimits::ARTIFACT_BYTES) throw new ApiProblem(400, 'BUILD_ARTIFACT_TOO_LARGE', sprintf('ARM executable must contain 1–%d bytes.', BuildLimits::ARTIFACT_BYTES));
                $outputBytes = (string) file_get_contents($job.'/.build/output.bin');
                $dwarf = $request->debugMetadata === 'full' ? $this->read($job.'/.build/debug-lines.txt') : '';
                $locations = $this->parser->decodedLines($dwarf, $request->files, $request->origin, strlen($outputBytes));
                $symbols = $this->parser->symbols($this->read($job.'/.build/symbols.txt'));
                $entry = $this->parser->entryPoint($this->read($job.'/.build/elf-header.txt'));
                if ($entry === null || $entry < $request->origin || $entry >= $request->origin + strlen($outputBytes) || ($entry & 3) !== 0) throw new ApiProblem(400, 'BUILD_ENTRY_RANGE', 'The ARM ELF entry point is outside the linked raw executable or is not word-aligned.');
                $artifact = [
                    'kind' => 'arm-binary', 'bytesBase64' => base64_encode($outputBytes), 'origin' => $request->origin, 'entryPoint' => $entry,
                    'processor' => 'arm2', 'endianness' => 'little', 'containerFormat' => 'raw', 'riscOsFiletype' => null,
                    'symbols' => $symbols, 'sourceLocations' => $locations, 'sourceMap' => array_map(static fn (array $location): int => $location['line'], $locations),
                    'entryFileId' => $request->sourceUnitIds[0], 'dependencies' => array_values(array_map(static fn (array $file): string => $file['name'], $request->files)),
                    'listing' => $this->listingRows($outputBytes, $request->origin, $locations, $this->read($job.'/.build/disassemble.txt')), 'diagnostics' => $diagnostics,
                ];
                $artifactRecords[] = ['name' => $request->outputName, 'kind' => 'arm-binary', 'bytes' => strlen($outputBytes), 'fingerprint' => $this->fingerprint($outputBytes), 'sha256' => hash('sha256', $outputBytes)];
            }
            $inputs = array_map(fn (array $file): array => ['id' => $file['id'], 'name' => $file['name'], 'bytes' => strlen($file['content']), 'fingerprint' => $this->fingerprint($file['content']), 'sha256' => hash('sha256', $file['content'])], $request->files);
            $inputs[] = ['id' => '@linker-script', 'name' => 'generated ARM2 linker script', 'bytes' => strlen($linkerScript), 'fingerprint' => $this->fingerprint($linkerScript), 'sha256' => hash('sha256', $linkerScript)];
            $duration = max(0.0, (hrtime(true) - $started) / 1_000_000); $exitReason = $artifact !== null ? 'succeeded' : match ($terminal) { 'timeout' => 'timeout', 'output-limit' => 'output-limit', default => 'diagnostics' };
            $metadata = [
                'schema' => '8bit-net.build-result', 'version' => 1,
                'invocation' => ['adapterId' => ArmBuildManifest::ADAPTER_ID, 'adapterVersion' => ArmBuildManifest::ADAPTER_VERSION, 'toolchainDigest' => $manifest['digest'], 'engine' => 'server-native', 'profile' => $request->profile, 'machineId' => $request->machineId, 'dependencyTargetIds' => []],
                'exit' => ['reason' => $exitReason, 'errors' => $errors, 'warnings' => $warnings], 'timing' => ['durationMs' => $duration],
                'cache' => ['status' => 'bypassed', 'reason' => 'ARM builds use isolated per-request workspaces', 'entries' => 0, 'hits' => 0, 'misses' => 0, 'corruptions' => 0, 'evictions' => 0],
                'inputs' => $inputs, 'artifacts' => $artifactRecords,
                'size' => ['outputBytes' => strlen($outputBytes), 'mappedBytes' => count($locations), 'unmappedBytes' => max(0, strlen($outputBytes) - count($locations)), ...($artifact === null ? [] : ['origin' => $request->origin, 'end' => $request->origin + strlen($outputBytes) - 1]), 'symbols' => count($symbols), 'sourceFiles' => count($request->files)],
                'diagnostics' => $diagnostics, 'logs' => $logs,
            ];
            $provenance = [
                'schema' => '8bit-net.build-provenance', 'version' => 2, 'fingerprintAlgorithm' => 'fnv1a32', 'digestAlgorithm' => 'sha256',
                'fingerprint' => $this->fingerprint(ToolchainManifest::canonicalJson(['targetId' => $request->targetId, 'machineId' => $request->machineId, 'profile' => $request->profile, 'processor' => 'arm2', 'inputs' => $inputs, 'output' => $artifactRecords[0] ?? null])),
                'toolchain' => $manifest, 'toolchainDigest' => $manifest['digest'], 'inputs' => $inputs, 'output' => $artifactRecords[0] ?? null,
            ];
            if ($artifact !== null) $artifact['provenance'] = $provenance;
            $this->logger->info('native-build-completed', ['adapter' => ArmBuildManifest::ADAPTER_ID, 'outcome' => $exitReason, 'durationMs' => round($duration, 2), 'outputByteCount' => strlen($outputBytes), 'errors' => $errors, 'warnings' => $warnings]);
            $response = ['schema' => '8bit-net.native-build-response', 'version' => 1, 'requestId' => $request->requestId, 'result' => $metadata, 'artifact' => $artifact, 'documents' => $documents, 'invocations' => $invocations, 'provenance' => $provenance];
            $this->cache->write(BuildCache::LOCAL_OWNER, $cacheKey, $request->files, $response);

            return $this->cache->storedEnvelope($response, BuildCache::LOCAL_OWNER, $cacheKey, $request->cacheBypass);
        } finally { $this->workspace->remove($job); }
    }

    private function linkerScript(NativeBuildRequest $request): string
    {
        $entry = match ($request->entryMode) { 'symbol' => $request->entryValue, 'address' => sprintf('0x%08X', $this->address($request->entryValue)), default => '_start' };
        return sprintf("ENTRY(%s)\nSECTIONS\n{\n  . = 0x%08X;\n  .text : { *(.text .text.*) }\n  .rodata : { *(.rodata .rodata.*) }\n  .data : { *(.data .data.*) }\n  .bss (NOLOAD) : { *(.bss .bss.*) *(COMMON) }\n  /DISCARD/ : { *(.note.GNU-stack) *(.comment) }\n  ASSERT(. <= 0x%08X, \"ARM output exceeds configured address range\")\n}\n", $entry, $request->origin, $request->maximumAddress + 1);
    }

    /** @return array<string, int> */ private function profileDefines(string $profile): array { return ['BUILD_PROFILE_DEBUG' => $profile === 'debug' ? 1 : 0, 'BUILD_PROFILE_SIZE' => $profile === 'size' ? 1 : 0, 'BUILD_PROFILE_SPEED' => $profile === 'speed' ? 1 : 0, 'BUILD_PROFILE_CUSTOM' => $profile === 'custom' ? 1 : 0]; }
    /** @param list<array{id: string, name: string, content: string}> $files */ private function materialize(string $job, array $files): void { foreach ($files as $file) { $path = $job.'/'.$file['name']; if (!is_dir(dirname($path)) && !mkdir(dirname($path), 0700, true)) throw new \RuntimeException('Unable to create ARM source directory.'); if (file_put_contents($path, $file['content'], LOCK_EX) !== strlen($file['content'])) throw new \RuntimeException('Unable to materialize ARM input.'); chmod($path, 0600); } }
    /** @param list<array<string, mixed>> $documents */ private function addDocument(array &$documents, int &$total, string $id, string $label, string $filename, string $content): void { if (count($documents) >= BuildLimits::DOCUMENTS || strlen($content) > BuildLimits::FILE_BYTES || $total + strlen($content) > BuildLimits::DOCUMENT_BYTES) throw new ApiProblem(400, 'BUILD_DOCUMENT_LIMIT', 'Generated ARM documents exceeded the collection limit.'); $documents[] = ['id' => $id, 'label' => $label, 'filename' => $filename, 'content' => $content, 'bytes' => strlen($content), 'sha256' => hash('sha256', $content)]; $total += strlen($content); }
    /** @param list<array<string, mixed>> $documents */ private function collectDocument(string $job, string $relative, array &$documents, int &$total, string $id, string $label, string $filename): void { if (!file_exists($job.'/'.$relative)) return; $this->requireRegularOutput($job.'/'.$relative, $label); $content = str_replace([$job.'/', $job], ['', '<job>'], $this->read($job.'/'.$relative)); $this->addDocument($documents, $total, $id, $label, $filename, $content); }
    private function requireRegularOutput(string $path, string $label): void { if (is_link($path) || !is_file($path) || filetype($path) !== 'file') throw new ApiProblem(400, 'BUILD_OUTPUT_INVALID', "$label was not a regular generated file."); $size = filesize($path); if ($size === false || $size > BuildLimits::FILE_BYTES) throw new ApiProblem(400, 'BUILD_OUTPUT_INVALID', "$label exceeded the generated-file limit."); }
    private function read(string $path): string { return is_file($path) && !is_link($path) ? (string) file_get_contents($path) : ''; }
    /**
     * @param array<int, array{fileId: string, fileName: string, line: int}> $locations
     * @return list<string>
     */ private function listingRows(string $bytes, int $origin, array $locations, string $disassembly): array { $instructions = []; foreach (preg_split('/\R/', $disassembly) ?: [] as $row) if (preg_match('/^([0-9a-f]{8})\s+<[^>]+>\s+(.+)$/i', trim($row), $match)) $instructions[intval($match[1], 16)] = trim($match[2]); $rows = []; for ($offset = 0; $offset < strlen($bytes); $offset += 4) { $address = $origin + $offset; $hex = strtoupper(implode(' ', str_split(bin2hex(substr($bytes, $offset, 4)), 2))); $location = $locations[$address] ?? null; $rows[] = sprintf('[%s] &%08X  %-11s %s', $location === null ? 'unmapped' : $location['fileName'].':'.$location['line'], $address, $hex, $instructions[$address] ?? ''); } return $rows; }
    private function address(string $value): int { return str_starts_with(strtolower($value), '0x') ? intval(substr($value, 2), 16) : ((str_starts_with($value, '$') || str_starts_with($value, '&')) ? intval(substr($value, 1), 16) : intval($value, 10)); }
    private function terminalMessage(string $reason): string { return match ($reason) { 'timeout' => 'GNU ARM toolchain stage exceeded its wall-clock limit.', 'output-limit' => 'GNU ARM toolchain stage exceeded its captured-output limit.', default => 'GNU ARM toolchain exited without a normalized diagnostic.' }; }
    private function fingerprint(string $bytes): string { $hash = 0x811c9dc5; for ($index = 0; $index < strlen($bytes); ++$index) { $hash ^= ord($bytes[$index]); $hash = ($hash * 0x01000193) & 0xffffffff; } return str_pad(dechex($hash), 8, '0', STR_PAD_LEFT); }
}
