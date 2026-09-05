<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\BeebAsmBuildService;
use App\Build\BeebAsmManifest;
use App\Build\BeebAsmOutputParser;
use App\Build\BeebAsmSourcePolicy;
use App\Build\BuildCache;
use App\Build\JobWorkspace;
use App\Build\NativeBuildRequest;
use App\Build\NativeProcessRunner;
use App\Tests\LogRecorder;
use App\Tests\ToolchainEnvironment;
use PHPUnit\Framework\TestCase;

final class BeebAsmBuildServiceTest extends TestCase
{
    private LogRecorder $log;

    private BuildCache $cache;

    private string $cacheRoot;

    private BeebAsmBuildService $service;

    protected function setUp(): void
    {
        /* These two tests run the pinned BeebAsm binary for real; there is no
         * mock, because what they assert is the exact bytes it produces. Its
         * version matters: a system BeebAsm 1.10 assembles the same source into
         * different bytes than the pinned 1.11. */
        ToolchainEnvironment::require('BEEBASM_PATH', '/usr/local/bin/beebasm', 'The pinned BeebAsm '.BeebAsmManifest::UPSTREAM_VERSION.' assembler');
        ToolchainEnvironment::require('BEEBASM_SOURCE_PATH', '/usr/share/source/beebasm-source.tar', 'The BeebAsm source archive');
        ToolchainEnvironment::require('BEEBASM_LICENCE_PATH', '/usr/share/licenses/beebasm/COPYING.txt', 'The BeebAsm licence');
        $manifest = new BeebAsmManifest();
        $detected = $manifest->detect();
        self::assertTrue($detected['ready'], sprintf(
            'The BeebAsm adapter reports it is not ready with %s in place. It expects version %s; run `npm run toolchains` from the service root to build the pinned commit.',
            $manifest->executablePath(),
            BeebAsmManifest::UPSTREAM_VERSION,
        ));
        if (!is_dir('/tmp/native-builds')) mkdir('/tmp/native-builds', 0700, true);
        $this->log = new LogRecorder();
        /* Its own root per test, so one test's stored builds cannot answer
         * another's and make a failure look like a pass. */
        $this->cacheRoot = sys_get_temp_dir().'/build-cache-'.bin2hex(random_bytes(8));
        $this->cache = new BuildCache($this->cacheRoot, $this->log->logger);
        $this->service = new BeebAsmBuildService($manifest, new BeebAsmSourcePolicy(), new BeebAsmOutputParser(), new NativeProcessRunner(), $this->log->logger, new JobWorkspace($this->log->logger), $this->cache);
    }

    protected function tearDown(): void
    {
        exec('rm -rf '.escapeshellarg($this->cacheRoot));
    }

    public function testTheRecordOfARealBuildHoldsItsCostAndNotItsSource(): void
    {
        /* The service is handed somebody's source. A log that captured it would
         * be a copy of their work in a file nobody thinks of as storage, and no
         * retention policy would cover it because nobody would know it was
         * there. So this runs a real build and searches the bytes that were
         * actually written. */
        $source = "ORG &1900\n.start\n.secretLabel\nLDA #&41\nJSR &FFEE\nRTS\nSAVE start,P%,start\n";
        $this->service->build(NativeBuildRequest::fromArray($this->payload($source)));

        $written = $this->log->written();
        self::assertStringNotContainsString('secretLabel', $written);
        self::assertStringNotContainsString('JSR', $written);
        self::assertStringNotContainsString('ORG', $written);

        $records = $this->log->records();
        self::assertCount(1, $records);
        self::assertSame('native-build-completed', $records[0]['event']);
        self::assertSame($this->log->context->correlationId(), $records[0]['correlationId']);
        self::assertSame('succeeded', $records[0]['outcome']);
        self::assertGreaterThan(0, $records[0]['outputByteCount']);
        self::assertSame(0, $records[0]['errors']);
    }

    public function testBuildsExactReproducibleBinarySymbolsMapAndDocuments(): void
    {
        $source = "ORG &1900\n.start\nLDA #&41\nJSR &FFEE\n.done\nRTS\nSAVE start,P%,start\n";
        $first = $this->service->build(NativeBuildRequest::fromArray($this->payload($source))); $second = $this->service->build(NativeBuildRequest::fromArray($this->payload($source)));
        self::assertSame('succeeded', $first['result']['exit']['reason']); self::assertSame('qUEg7v9g', $first['artifact']['bytesBase64']); self::assertSame(0x1900, $first['artifact']['symbols']['start']); self::assertSame('main', $first['artifact']['sourceLocations'][0x1900]['fileId']);
        self::assertContains('BeebAsm exported labels', array_column($first['documents'], 'label')); self::assertSame($first['result']['artifacts'], $second['result']['artifacts']); self::assertSame($first['provenance']['fingerprint'], $second['provenance']['fingerprint']); self::assertSame([], glob('/tmp/native-builds/*') ?: []);
    }

    public function testReturnsNoArtifactForNavigableDiagnostic(): void
    {
        $response = $this->service->build(NativeBuildRequest::fromArray($this->payload("ORG &1900\n.start\nBADOP #&41\nSAVE start,P%,start\n")));
        self::assertNull($response['artifact']); self::assertSame('diagnostics', $response['result']['exit']['reason']); self::assertSame('main', $response['result']['diagnostics'][0]['fileId']); self::assertSame(3, $response['result']['diagnostics'][0]['line']); self::assertSame([], glob('/tmp/native-builds/*') ?: []);
    }

    /** @return array<string, mixed> */
    private function payload(string $source): array { $payload = NativeBuildRequestTest::payload($source); $payload['files'][0]['name'] = 'main.asm'; $payload['target']['entry'] = ['mode' => 'symbol', 'value' => 'start']; return $payload; }
}
