<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\ArmBuildManifest;
use App\Build\ArmBuildService;
use App\Build\ArmOutputParser;
use App\Build\ArmSourcePolicy;
use App\Build\BuildCache;
use App\Build\JobWorkspace;
use App\Build\NativeBuildRequest;
use App\Build\NativeProcessRunner;
use App\Tests\LogRecorder;
use App\Tests\ToolchainEnvironment;
use PHPUnit\Framework\TestCase;

final class ArmBuildServiceTest extends TestCase
{
    private LogRecorder $log;

    private BuildCache $cache;

    private string $cacheRoot;

    private ArmBuildService $service;

    protected function setUp(): void
    {
        /* Each tool's path comes from the environment the toolchain script
         * publishes, falling back to the container's own location. A missing
         * tool fails with the remedy rather than skipping the test. */
        foreach (['as', 'ld', 'objcopy', 'objdump', 'nm', 'readelf'] as $tool) {
            $variable = 'ARM_'.strtoupper($tool).'_PATH';
            $default = '/usr/bin/arm-none-eabi-'.$tool;
            $configured = ToolchainEnvironment::path($variable, $default);
            /* The script publishes as, ld and objcopy; the rest sit beside them. */
            if (!is_file($configured) && isset($_SERVER['ARM_AS_PATH'])) {
                $configured = dirname((string) $_SERVER['ARM_AS_PATH']).'/arm-none-eabi-'.$tool;
            }
            $_SERVER[$variable] = $configured;
            ToolchainEnvironment::require($variable, $default, 'GNU ARM binutils arm-none-eabi-'.$tool);
        }
        $_SERVER['ARM_BINUTILS_PACKAGE_VERSION'] = 'test-toolchain';
        if (!is_dir('/tmp/native-builds')) mkdir('/tmp/native-builds', 0700, true);
        $this->log = new LogRecorder();
        /* Its own root per test, so one test's stored builds cannot answer
         * another's and make a failure look like a pass. */
        $this->cacheRoot = sys_get_temp_dir().'/build-cache-'.bin2hex(random_bytes(8));
        $this->cache = new BuildCache($this->cacheRoot, $this->log->logger);
        $this->service = new ArmBuildService(new ArmBuildManifest(), new ArmSourcePolicy(), new NativeProcessRunner(), new ArmOutputParser(), $this->log->logger, new JobWorkspace($this->log->logger), $this->cache);
    }

    /**
     * Every stage and how long it took, for a failure message.
     *
     * This test failed three times on a shared runner reporting only
     * 'timeout', which named neither the tool nor the duration and left
     * nothing to work from. A wall-clock failure has to say what overran.
     *
     * @param array<string, mixed> $result
     */
    private static function stageTiming(array $result): string
    {
        $invocations = is_array($result['invocations'] ?? null) ? $result['invocations'] : [];
        if ($invocations === []) return 'no stage ran at all';

        return implode(', ', array_map(
            static fn (array $invocation): string => sprintf(
                '%s %s in %.0fms',
                (string) ($invocation['stage'] ?? 'unnamed'),
                (string) ($invocation['reason'] ?? 'no reason'),
                (float) ($invocation['durationMs'] ?? 0.0),
            ),
            $invocations,
        ));
    }

    protected function tearDown(): void
    {
        exec('rm -rf '.escapeshellarg($this->cacheRoot));
    }

    public function testBuildsReproducibleArm2RawBinaryWithRealSourceEvidence(): void
    {
        $first = $this->service->build(NativeBuildRequest::fromArray(NativeBuildRequestTest::armPayload(), 'arm'));
        $second = $this->service->build(NativeBuildRequest::fromArray(NativeBuildRequestTest::armPayload(), 'arm'));
        self::assertSame('succeeded', $first['result']['exit']['reason'], sprintf(
            'ARM build did not succeed. Wall clock in force: %.1fs. Stages: %s',
            \App\Build\BuildLimits::stageSeconds(),
            self::stageTiming($first),
        ));
        self::assertSame('gnu.arm-none-eabi-binutils', $first['result']['invocation']['adapterId']);
        self::assertSame('arm-binary', $first['artifact']['kind']); self::assertSame('arm2', $first['artifact']['processor']);
        self::assertSame(0x8000, $first['artifact']['entryPoint']); self::assertSame('main', $first['artifact']['sourceLocations'][0x8000]['fileId']);
        $decoded = base64_decode($first['artifact']['bytesBase64'], true);
        /* Asserted rather than assumed: strict base64_decode returns false on
         * anything that is not base64, and a length taken from false would be
         * a length taken from nothing. */
        self::assertIsString($decoded, 'The artifact bytes were not valid base64.');
        self::assertSame(12, strlen($decoded));
        self::assertSame($first['artifact']['bytesBase64'], $second['artifact']['bytesBase64']);
        self::assertContains('ELF and ARM attributes', array_column($first['documents'], 'label'));
        self::assertFalse($first['provenance']['toolchain']['output']['riscOsApplication']);
        self::assertSame([], glob('/tmp/native-builds/*') ?: []);
    }

    public function testReturnsAssemblerDiagnosticWithoutArtifact(): void
    {
        $response = $this->service->build(NativeBuildRequest::fromArray(NativeBuildRequestTest::armPayload(".cpu arm2\n.global _start\n_start:\n definitely_not_an_instruction r0\n"), 'arm'));
        self::assertNull($response['artifact']); self::assertSame('diagnostics', $response['result']['exit']['reason']);
        self::assertSame('main', $response['result']['diagnostics'][0]['fileId']);
    }

    public function testCustomNoMetadataOmitsDwarfSourceMap(): void
    {
        $payload = NativeBuildRequestTest::armPayload(); $payload['target']['profile'] = 'custom'; $payload['target']['debugMetadata'] = 'none';
        $response = $this->service->build(NativeBuildRequest::fromArray($payload, 'arm'));
        self::assertSame([], $response['artifact']['sourceLocations']); self::assertNotContains('-g', $response['invocations'][0]['argv']);
    }
}
