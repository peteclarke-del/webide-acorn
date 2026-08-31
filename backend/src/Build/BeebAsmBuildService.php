<?php

declare(strict_types=1);

namespace App\Build;

use App\Observability\StructuredLogger;

use App\Http\ApiProblem;

final class BeebAsmBuildService
{
    public function __construct(
        private readonly BeebAsmManifest $manifest,
        private readonly BeebAsmSourcePolicy $policy,
        private readonly BeebAsmOutputParser $parser,
        private readonly NativeProcessRunner $runner,
        private readonly StructuredLogger $logger,
        private readonly JobWorkspace $workspace,
    ) {}

    /** @return array<string, mixed> */
    public function build(NativeBuildRequest $request): array
    {
        $started = hrtime(true); $this->policy->validate($request);
        $toolchain = $this->manifest->detect();
        if (!$toolchain['ready']) throw new ApiProblem(503, 'BEEBASM_UNAVAILABLE', 'The pinned BeebAsm adapter is not ready.', true);
        $job = $this->workspace->allocate('beebasm-');
        if (!mkdir($job.'/.build', 0700)) throw new ApiProblem(500, 'BUILD_JOB_CREATE', 'Could not create the isolated build job.', true);
        try {
            foreach ($request->files as $file) {
                $path = $job.'/'.$file['name']; $directory = dirname($path);
                if (!is_dir($directory) && !mkdir($directory, 0700, true)) throw new ApiProblem(500, 'BUILD_JOB_CREATE', 'Could not create a project directory.', true);
                if (file_put_contents($path, $file['content'], LOCK_EX) !== strlen($file['content'])) throw new ApiProblem(500, 'BUILD_JOB_WRITE', 'Could not stage a project source file.', true);
            }
            $root = $this->fileById($request, $request->sourceUnitIds[0]);
            $wrapper = sprintf("CPU %d\nINCLUDE \"%s\"\n", $request->processor === '6502' ? 0 : 1, $root['name']);
            file_put_contents($job.'/.build/entry.asm', $wrapper, LOCK_EX);
            $argv = [$this->manifest->executablePath(), '-i', '.build/entry.asm', '-o', '.build/output.bin', '-labels', '.build/labels.txt', '-dd', '-v', '-w', '-vc'];
            foreach ([...$request->defines, ...$this->profileDefines($request->profile)] as $name => $value) { $argv[] = '-D'; $argv[] = $name.'='.$value; }
            $process = $this->runner->run($argv, $job);
            $combined = trim($process['stdout']."\n".$process['stderr']);
            $diagnostics = $this->parser->diagnostics($combined, $request->files);
            if ($process['reason'] !== 'succeeded' && !$diagnostics) $diagnostics[] = ['severity' => 'error', 'message' => $this->terminalMessage($process['reason']), 'line' => 1, 'column' => 1, 'stage' => 'adapter', 'fileId' => $root['id'], 'fileName' => $root['name']];
            $listing = $this->parser->listing($combined, $request->files);
            $labels = $this->safeText($job.'/.build/labels.txt');
            $symbols = $this->parser->symbols($labels);
            $errors = count(array_filter($diagnostics, static fn (array $item): bool => $item['severity'] === 'error'));
            $warnings = count(array_filter($diagnostics, static fn (array $item): bool => $item['severity'] === 'warning'));
            $artifact = null; $artifactRecord = []; $bytes = '';
            if ($process['reason'] === 'succeeded' && $errors === 0) {
                $path = $job.'/.build/output.bin';
                if (!file_exists($path)) {
                    $diagnostics[] = ['severity' => 'error', 'message' => 'BeebAsm completed without the required filename-free SAVE output.', 'line' => 1, 'column' => 1, 'stage' => 'collect', 'fileId' => $root['id'], 'fileName' => $root['name']]; ++$errors;
                } else {
                    $this->regular($path, 'BeebAsm binary'); $size = filesize($path);
                    if ($size === false || $size > BuildLimits::ARTIFACT_BYTES) throw new ApiProblem(400, 'BUILD_ARTIFACT_TOO_LARGE', 'BeebAsm binary exceeded the artifact limit.');
                    $bytes = (string) file_get_contents($path); $origin = $listing['origin'] ?? $request->origin;
                    if ($origin !== $request->origin) throw new ApiProblem(400, 'BEEBASM_ORIGIN_MISMATCH', sprintf('First emitted address &%04X does not match target origin &%04X.', $origin, $request->origin), false, ['target.origin' => 'Must match the first emitted address']);
                    if (strlen($bytes) === 0 || $origin + strlen($bytes) - 1 > $request->maximumAddress) throw new ApiProblem(400, 'BUILD_MEMORY_OVERFLOW', 'BeebAsm output is empty or exceeds the target memory range.');
                    $entry = $this->entryPoint($request, $symbols, $origin, strlen($bytes));
                    $artifact = ['kind' => '6502-binary', 'bytesBase64' => base64_encode($bytes), 'origin' => $origin, 'entryPoint' => $entry, 'processor' => $request->processor === '6502' ? '6502' : '65c02', 'symbols' => $symbols, 'sourceLocations' => $listing['locations'], 'sourceMap' => array_map(static fn (array $location): int => $location['line'], $listing['locations']), 'entryFileId' => $root['id'], 'dependencies' => array_values(array_map(static fn (array $file): string => $file['name'], $request->files)), 'listing' => $listing['listing'], 'diagnostics' => $diagnostics];
                    $artifactRecord[] = ['name' => $request->outputName, 'kind' => '6502-binary', 'bytes' => strlen($bytes), 'fingerprint' => $this->fingerprint($bytes), 'sha256' => hash('sha256', $bytes)];
                }
            }
            $inputs = array_map(fn (array $file): array => ['id' => $file['id'], 'name' => $file['name'], 'bytes' => strlen($file['content']), 'fingerprint' => $this->fingerprint($file['content']), 'sha256' => hash('sha256', $file['content'])], $request->files);
            $inputs[] = ['id' => '@beebasm-wrapper', 'name' => 'target-controlled BeebAsm wrapper', 'bytes' => strlen($wrapper), 'fingerprint' => $this->fingerprint($wrapper), 'sha256' => hash('sha256', $wrapper)];
            $duration = max(0.0, (hrtime(true) - $started) / 1_000_000); $mapped = $artifact ? count($listing['locations']) : 0;
            $reason = $artifact ? 'succeeded' : ($process['reason'] === 'timeout' ? 'timeout' : ($process['reason'] === 'output-limit' ? 'output-limit' : 'diagnostics'));
            $metadata = ['schema' => '8bit-net.build-result', 'version' => 1, 'invocation' => ['adapterId' => BeebAsmManifest::ADAPTER_ID, 'adapterVersion' => BeebAsmManifest::ADAPTER_VERSION, 'toolchainDigest' => $toolchain['digest'], 'engine' => 'server-native', 'profile' => $request->profile, 'machineId' => $request->machineId, 'dependencyTargetIds' => []], 'exit' => ['reason' => $reason, 'errors' => $errors, 'warnings' => $warnings], 'timing' => ['durationMs' => $duration], 'cache' => ['status' => 'bypassed', 'reason' => 'Native BeebAsm cache is not yet enabled', 'entries' => 0, 'hits' => 0, 'misses' => 0, 'corruptions' => 0, 'evictions' => 0], 'inputs' => $inputs, 'artifacts' => $artifactRecord, 'size' => ['outputBytes' => strlen($bytes), 'mappedBytes' => $mapped, 'unmappedBytes' => max(0, strlen($bytes) - $mapped), ...($artifact ? ['origin' => $artifact['origin'], 'end' => $artifact['origin'] + strlen($bytes) - 1] : []), 'symbols' => count($symbols), 'sourceFiles' => count($request->files)], 'diagnostics' => $diagnostics, 'logs' => ['BeebAsm '.$toolchain['upstream']['version'].' · fixed argv · '.$process['reason'], sprintf('Read %d declared input%s', count($request->files), count($request->files) === 1 ? '' : 's'), $artifact ? 'Produced '.$request->outputName.' · '.strlen($bytes).' bytes' : 'No executable artifact produced']];
            $documents = [['id' => 'beebasm-output', 'label' => 'BeebAsm verbose assembly output', 'filename' => $request->outputName.'.beebasm.txt', 'content' => $combined, 'bytes' => strlen($combined), 'sha256' => hash('sha256', $combined)], ['id' => 'beebasm-labels', 'label' => 'BeebAsm exported labels', 'filename' => $request->outputName.'.labels.txt', 'content' => $labels, 'bytes' => strlen($labels), 'sha256' => hash('sha256', $labels)]];
            $provenance = ['schema' => '8bit-net.build-provenance', 'version' => 2, 'fingerprintAlgorithm' => 'fnv1a32', 'digestAlgorithm' => 'sha256', 'fingerprint' => $this->fingerprint(ToolchainManifest::canonicalJson(['targetId' => $request->targetId, 'machineId' => $request->machineId, 'processor' => $request->processor, 'inputs' => $inputs, 'output' => $artifactRecord[0] ?? null])), 'toolchain' => $toolchain, 'toolchainDigest' => $toolchain['digest'], 'inputs' => $inputs, 'output' => $artifactRecord[0] ?? null];
            if ($artifact) $artifact['provenance'] = $provenance;
            $this->logger->info('native-build-completed', ['adapter' => BeebAsmManifest::ADAPTER_ID, 'outcome' => $reason, 'durationMs' => round($duration, 2), 'outputByteCount' => strlen($bytes), 'errors' => $errors, 'warnings' => $warnings]);
            return ['schema' => '8bit-net.native-build-response', 'version' => 1, 'requestId' => $request->requestId, 'result' => $metadata, 'artifact' => $artifact, 'documents' => $documents, 'invocations' => [$process], 'provenance' => $provenance];
        } finally { $this->workspace->remove($job); }
    }

    /** @return array{id: string, name: string, content: string} */
    private function fileById(NativeBuildRequest $request, string $id): array { foreach ($request->files as $file) if ($file['id'] === $id) return $file; throw new ApiProblem(400, 'BEEBASM_ROOT_MISSING', 'Root source missing.'); }
    /** @return array<string, int> */
    private function profileDefines(string $profile): array { return ['BUILD_PROFILE_DEBUG' => $profile === 'debug' ? 1 : 0, 'BUILD_PROFILE_SIZE' => $profile === 'size' ? 1 : 0, 'BUILD_PROFILE_SPEED' => $profile === 'speed' ? 1 : 0, 'BUILD_PROFILE_CUSTOM' => $profile === 'custom' ? 1 : 0]; }
    /** @param array<string, int> $symbols */
    private function entryPoint(NativeBuildRequest $request, array $symbols, int $origin, int $size): int { $entry = $origin; if ($request->entryMode === 'address') $entry = $this->address($request->entryValue); elseif ($request->entryMode === 'symbol') { $wanted = strtolower(ltrim($request->entryValue, '.')); foreach ($symbols as $name => $value) if (strtolower($name) === $wanted) $entry = $value; if ($entry === $origin && !array_key_exists($wanted, array_change_key_case($symbols, CASE_LOWER))) throw new ApiProblem(400, 'BUILD_ENTRY_MISSING', 'The selected entry symbol was not exported by BeebAsm.'); } if ($entry < $origin || $entry >= $origin + $size) throw new ApiProblem(400, 'BUILD_ENTRY_RANGE', 'The selected entry point is outside the saved binary.'); return $entry; }
    private function address(string $value): int { return str_starts_with(strtolower($value), '0x') ? intval(substr($value, 2), 16) : ((str_starts_with($value, '$') || str_starts_with($value, '&')) ? intval(substr($value, 1), 16) : intval($value)); }
    private function safeText(string $path): string { if (!file_exists($path)) return ''; $this->regular($path, 'generated document'); $size = filesize($path); if ($size === false || $size > BuildLimits::FILE_BYTES) throw new ApiProblem(400, 'BUILD_DOCUMENT_LIMIT', 'Generated document exceeded its limit.'); return (string) file_get_contents($path); }
    private function regular(string $path, string $label): void { if (is_link($path) || !is_file($path) || filetype($path) !== 'file') throw new ApiProblem(400, 'BUILD_OUTPUT_INVALID', $label.' was not a regular file.'); }
    private function terminalMessage(string $reason): string { return $reason === 'timeout' ? 'BeebAsm exceeded its wall-clock limit.' : ($reason === 'output-limit' ? 'BeebAsm exceeded its output limit.' : 'BeebAsm stopped without a parsed diagnostic.'); }
    private function fingerprint(string $bytes): string { $hash = 0x811c9dc5; for ($i = 0; $i < strlen($bytes); ++$i) { $hash ^= ord($bytes[$i]); $hash = ($hash * 0x01000193) & 0xffffffff; } return str_pad(dechex($hash), 8, '0', STR_PAD_LEFT); }
}
