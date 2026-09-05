<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\BuildCache;
use App\Build\Cc65OutputParser;
use App\Build\JobWorkspace;
use App\Build\NativeBuildRequest;
use App\Build\NativeBuildService;
use App\Build\NativeProcessRunner;
use App\Build\SourcePolicy;
use App\Build\ToolchainManifest;
use App\Tests\LogRecorder;
use PHPUnit\Framework\TestCase;

final class NativeBuildServiceTest extends TestCase
{
    private LogRecorder $log;

    private BuildCache $cache;

    private string $cacheRoot;

    private NativeBuildService $service;

    protected function setUp(): void
    {
        $_SERVER['CA65_PATH'] = '/usr/bin/ca65';
        $_SERVER['LD65_PATH'] = '/usr/bin/ld65';
        $_SERVER['TOOLCHAIN_PACKAGE_VERSION'] = '2.19-1-test';
        if (!is_dir('/tmp/native-builds')) {
            mkdir('/tmp/native-builds', 0700, true);
        }
        $this->log = new LogRecorder();
        /* Its own root per test, so one test's stored builds cannot answer
         * another's and make a failure look like a pass. */
        $this->cacheRoot = sys_get_temp_dir().'/build-cache-'.bin2hex(random_bytes(8));
        $this->cache = new BuildCache($this->cacheRoot, $this->log->logger);
        $this->service = new NativeBuildService(new ToolchainManifest(), new SourcePolicy(), new NativeProcessRunner(), new Cc65OutputParser(), $this->log->logger, new JobWorkspace($this->log->logger), $this->cache);
    }

    protected function tearDown(): void
    {
        exec('rm -rf '.escapeshellarg($this->cacheRoot));
    }

    public function testBuildsRealBinarySymbolsSourceMapAndDocumentsReproducibly(): void
    {
        $first = $this->service->build(NativeBuildRequest::fromArray(NativeBuildRequestTest::payload()));
        $second = $this->service->build(NativeBuildRequest::fromArray(NativeBuildRequestTest::payload()));
        self::assertSame('succeeded', $first['result']['exit']['reason']);
        self::assertSame('server-native', $first['result']['invocation']['engine']);
        self::assertSame('qUEg7v9g', $first['artifact']['bytesBase64']);
        self::assertSame(0x1900, $first['artifact']['symbols']['_start']);
        self::assertSame('main', $first['artifact']['sourceLocations'][0x1900]['fileId']);
        self::assertNotEmpty($first['artifact']['listing']);
        self::assertContains('ld65 linker map', array_column($first['documents'], 'label'));
        self::assertContains('ld65 pinned debug data', array_column($first['documents'], 'label'));
        self::assertSame($first['artifact']['bytesBase64'], $second['artifact']['bytesBase64']);
        self::assertSame($first['result']['artifacts'], $second['result']['artifacts']);
        self::assertSame($first['provenance']['fingerprint'], $second['provenance']['fingerprint']);
        self::assertSame([], glob('/tmp/native-builds/*') ?: [], 'Every job directory must be removed.');
    }

    public function testReturnsNormalizedNoArtifactDiagnostics(): void
    {
        $payload = NativeBuildRequestTest::payload(".setcpu \"6502\"\n.segment \"CODE\"\n lda #\$100\n");
        $response = $this->service->build(NativeBuildRequest::fromArray($payload));
        self::assertNull($response['artifact']);
        self::assertSame([], $response['result']['artifacts']);
        self::assertSame('diagnostics', $response['result']['exit']['reason']);
        self::assertSame('error', $response['result']['diagnostics'][0]['severity']);
        self::assertSame('main', $response['result']['diagnostics'][0]['fileId']);
        self::assertSame([], glob('/tmp/native-builds/*') ?: [], 'Failed job directories must be removed.');
    }

    public function testASecondIdenticalBuildIsAnsweredWithoutRunningTheToolchain(): void
    {
        /*
         * The whole point of the cache is that a hit runs no process at all.
         *
         * A hit still answers with the invocation records of the build that
         * produced the artifact, because those are its provenance — so their
         * presence proves nothing. What proves it is that they are *identical*,
         * down to the sub-millisecond durations the first run measured. A
         * second run of the same assembler would not reproduce those to six
         * decimal places; a replay does, exactly.
         *
         * This used to assert that the second build was faster than the first,
         * which sounds like the same claim and is not. Elapsed time measures the
         * machine as much as the code, and on a loaded one a cache hit that ran
         * nothing took 59.9ms against a first build's 51.4ms — so the gate
         * failed over a cache that had worked perfectly. A test that can fail
         * while the code is right is not evidence about the code.
         */
        $first = $this->service->build(NativeBuildRequest::fromArray(NativeBuildRequestTest::payload()));
        self::assertSame('miss', $first['result']['cache']['status']);
        self::assertNotSame([], $first['invocations']);

        $second = $this->service->build(NativeBuildRequest::fromArray(NativeBuildRequestTest::payload()));
        self::assertSame('hit', $second['result']['cache']['status']);
        self::assertSame(1, $second['result']['cache']['hits']);
        self::assertSame($first['artifact']['bytesBase64'], $second['artifact']['bytesBase64']);
        self::assertSame($first['provenance']['fingerprint'], $second['provenance']['fingerprint']);
        self::assertSame($first['invocations'], $second['invocations'], 'A cache hit replays the first build\'s record rather than running the toolchain again.');
        self::assertStringContainsString('no toolchain was run', $second['result']['logs'][0]);
    }

    public function testAChangedSourceIsADifferentBuildRatherThanTheSameOne(): void
    {
        /* The failure a cache makes possible: returning the previous program
         * for a source somebody has just edited. */
        $this->service->build(NativeBuildRequest::fromArray(NativeBuildRequestTest::payload()));
        $edited = NativeBuildRequestTest::payload(".setcpu \"6502\"\n.export _start\n.segment \"CODE\"\n_start:\n lda #\$42\n rts\n");
        $changed = $this->service->build(NativeBuildRequest::fromArray($edited));

        self::assertSame('miss', $changed['result']['cache']['status']);
        self::assertSame('hit', $this->service->build(NativeBuildRequest::fromArray($edited))['result']['cache']['status']);
    }

    public function testRebuildIsAnExplicitWayPastTheCache(): void
    {
        /*
         * A cache with no way past it is a cache nobody can trust: somebody who
         * suspects a stored result is wrong needs to be able to find out. The
         * rebuild runs the toolchain and replaces what was stored.
         */
        $this->service->build(NativeBuildRequest::fromArray(NativeBuildRequestTest::payload()));
        $payload = NativeBuildRequestTest::payload();
        $payload['cache'] = ['bypass' => true];
        $forced = $this->service->build(NativeBuildRequest::fromArray($payload));

        self::assertSame('bypassed', $forced['result']['cache']['status']);
        self::assertNotSame([], $forced['invocations'], 'A bypassed build did not run the toolchain.');
        self::assertSame('hit', $this->service->build(NativeBuildRequest::fromArray(NativeBuildRequestTest::payload()))['result']['cache']['status']);
    }

    public function testTheStoredResultCarriesNoWorkspacePath(): void
    {
        /* An entry outlives the request that made it, so anything disclosed in
         * one is disclosed for as long as it is kept. */
        $this->service->build(NativeBuildRequest::fromArray(NativeBuildRequestTest::payload()));
        $entries = glob($this->cacheRoot.'/build-cache/*/*/*.json') ?: [];
        self::assertCount(1, $entries);
        $stored = (string) file_get_contents($entries[0]);
        self::assertStringNotContainsString('/tmp/native-builds', $stored);
        self::assertStringContainsString('<job>', $stored);
    }
}
