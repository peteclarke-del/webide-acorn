<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\BuildCache;
use App\Build\CBuildManifest;
use App\Build\CBuildService;
use App\Build\Cc65OutputParser;
use App\Build\CSourcePolicy;
use App\Build\JobWorkspace;
use App\Build\NativeBuildRequest;
use App\Build\NativeProcessRunner;
use App\Tests\LogRecorder;
use App\Tests\ToolchainEnvironment;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Process\Process;

final class CBuildServiceTest extends TestCase
{
    private LogRecorder $log;

    private BuildCache $cache;

    private string $cacheRoot;

    private CBuildService $service;

    protected function setUp(): void
    {
        foreach ([
            '/usr/bin/cc65' => 'The cc65 compiler',
            '/usr/bin/ca65' => 'The ca65 assembler',
            '/usr/bin/ld65' => 'The ld65 linker',
            '/usr/share/cc65/lib/none.lib' => 'The cc65 none.lib runtime library',
        ] as $path => $what) {
            ToolchainEnvironment::requireFile($path, $what);
        }
        $runtime = '/tmp/webide-acorn-c-test-runtime';
        if (!is_dir($runtime)) mkdir($runtime, 0700, true);
        $root = dirname(__DIR__, 2);
        foreach (['crt0', 'platform'] as $unit) {
            $process = new Process(['/usr/bin/ca65', '--target', 'bbc', '--cpu', '6502', '--debug-info', '-o', "$runtime/$unit.o", "$root/resources/cc65-bbc/$unit.s"]);
            $process->mustRun();
        }
        $_SERVER['CC65_PATH'] = '/usr/bin/cc65';
        $_SERVER['CA65_PATH'] = '/usr/bin/ca65';
        $_SERVER['LD65_PATH'] = '/usr/bin/ld65';
        $_SERVER['CC65_BBC_RUNTIME'] = $runtime;
        $_SERVER['CC65_BBC_INCLUDE'] = "$root/resources/cc65-bbc/include";
        $_SERVER['TOOLCHAIN_PACKAGE_VERSION'] = '2.19-1-test';
        if (!is_dir('/tmp/native-builds')) mkdir('/tmp/native-builds', 0700, true);
        $this->log = new LogRecorder();
        /* Its own root per test, so one test's stored builds cannot answer
         * another's and make a failure look like a pass. */
        $this->cacheRoot = sys_get_temp_dir().'/build-cache-'.bin2hex(random_bytes(8));
        $this->cache = new BuildCache($this->cacheRoot, $this->log->logger);
        $this->service = new CBuildService(new CBuildManifest(), new CSourcePolicy(), new NativeProcessRunner(), new Cc65OutputParser(), $this->log->logger, new JobWorkspace($this->log->logger), $this->cache);
    }

    protected function tearDown(): void
    {
        exec('rm -rf '.escapeshellarg($this->cacheRoot));
    }

    public function testCompilesAssemblesAndLinksRunnableCWithSourceMapping(): void
    {
        $first = $this->service->build(NativeBuildRequest::fromArray(NativeBuildRequestTest::cPayload(), 'c'));
        $second = $this->service->build(NativeBuildRequest::fromArray(NativeBuildRequestTest::cPayload(), 'c'));
        self::assertSame('succeeded', $first['result']['exit']['reason']);
        self::assertSame('cc65.c-bbc', $first['result']['invocation']['adapterId']);
        self::assertSame(['compile', 'assemble', 'link'], array_column($first['invocations'], 'stage'));
        self::assertSame(0x1900, $first['artifact']['entryPoint']);
        self::assertSame('main', $first['artifact']['entryFileId']);
        self::assertSame(0x1900, $first['artifact']['symbols']['start']);
        self::assertContains('main', array_column($first['artifact']['sourceLocations'], 'fileId'));
        self::assertContains('cc65 generated assembly · main.c', array_column($first['documents'], 'label'));
        self::assertSame($first['artifact']['bytesBase64'], $second['artifact']['bytesBase64']);
        self::assertSame([], glob('/tmp/native-builds/*') ?: []);
    }

    public function testReturnsCompilerDiagnosticsWithoutAnArtifact(): void
    {
        $payload = NativeBuildRequestTest::cPayload("int main(void) { return DOES_NOT_EXIST; }\n");
        $response = $this->service->build(NativeBuildRequest::fromArray($payload, 'c'));
        self::assertNull($response['artifact']);
        self::assertSame('diagnostics', $response['result']['exit']['reason']);
        self::assertSame('compile', $response['result']['diagnostics'][0]['stage']);
        self::assertSame('main', $response['result']['diagnostics'][0]['fileId']);
    }

    public function testCustomSpeedProfileCanDeliberatelyOmitDebugMetadata(): void
    {
        $payload = NativeBuildRequestTest::cPayload();
        $payload['target']['profile'] = 'custom';
        $payload['target']['profileGoal'] = 'speed';
        $payload['target']['debugMetadata'] = 'none';
        $response = $this->service->build(NativeBuildRequest::fromArray($payload, 'c'));
        self::assertSame('succeeded', $response['result']['exit']['reason']);
        self::assertContains('-Oi', $response['invocations'][0]['argv']);
        self::assertNotContains('--debug-info', $response['invocations'][0]['argv']);
        self::assertSame([], $response['artifact']['sourceLocations']);
        self::assertNotContains('ld65 pinned C debug data', array_column($response['documents'], 'label'));
    }
}
