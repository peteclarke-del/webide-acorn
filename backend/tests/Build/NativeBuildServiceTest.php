<?php

declare(strict_types=1);

namespace App\Tests\Build;

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
        $this->service = new NativeBuildService(new ToolchainManifest(), new SourcePolicy(), new NativeProcessRunner(), new Cc65OutputParser(), $this->log->logger, new JobWorkspace($this->log->logger));
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
}
