<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\NativeBuildRequest;
use App\Http\ApiProblem;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class NativeBuildRequestTest extends TestCase
{
    public function testAcceptsBoundedCa65Project(): void
    {
        $request = NativeBuildRequest::fromArray(self::payload());
        self::assertSame('6502', $request->processor);
        self::assertSame(0x1900, $request->origin);
        self::assertSame(['main'], $request->sourceUnitIds);
        self::assertSame(['FEATURE' => 1], $request->defines);
    }

    public function testAcceptsCTranslationUnitsButNotHeadersAsUnits(): void
    {
        $payload = self::cPayload();
        $request = NativeBuildRequest::fromArray($payload, 'c');
        self::assertSame('c', $request->dialect);
        self::assertSame(['main'], $request->sourceUnitIds);
        $payload['sourceUnitIds'] = ['header'];
        $this->expectException(ApiProblem::class);
        NativeBuildRequest::fromArray($payload, 'c');
    }

    public function testAcceptsWordAlignedArm2RequestAndRejects6502Extensions(): void
    {
        $request = NativeBuildRequest::fromArray(self::armPayload(), 'arm');
        self::assertSame('arm', $request->dialect);
        self::assertSame('arm2', $request->processor);
        self::assertSame(0x8000, $request->origin);
        $payload = self::armPayload(); $payload['files'][0]['name'] = 'main.s';
        $this->expectException(ApiProblem::class);
        NativeBuildRequest::fromArray($payload, 'arm');
    }

    /** @return iterable<string, array{callable(array<string, mixed>): void, string}> */
    public static function invalidPayloads(): iterable
    {
        yield 'path traversal' => [static function (array &$payload): void { $payload['files'][0]['name'] = '../main.s'; }, 'BUILD_PATH_INVALID'];
        yield 'absolute path' => [static function (array &$payload): void { $payload['files'][0]['name'] = '/tmp/main.s'; }, 'BUILD_PATH_INVALID'];
        yield 'unsafe output' => [static function (array &$payload): void { $payload['target']['outputName'] = '../escape.bin'; }, 'BUILD_OUTPUT_INVALID'];
        yield 'unknown source unit' => [static function (array &$payload): void { $payload['sourceUnitIds'] = ['missing']; }, 'BUILD_UNIT_INVALID'];
        yield 'unsupported CPU' => [static function (array &$payload): void { $payload['target']['processor'] = '65816'; }, 'BUILD_CPU_INVALID'];
        yield 'oversized file' => [static function (array &$payload): void { $payload['files'][0]['content'] = str_repeat('x', 512 * 1024 + 1); }, 'BUILD_FILE_TOO_LARGE'];
    }

    /** @param callable(array<string, mixed>): void $mutate */
    #[DataProvider('invalidPayloads')]
    public function testRejectsUnsafePayload(callable $mutate, string $code): void
    {
        $payload = self::payload();
        $mutate($payload);
        try {
            NativeBuildRequest::fromArray($payload);
            self::fail('Expected an API validation problem.');
        } catch (ApiProblem $problem) {
            self::assertSame($code, $problem->errorCode);
        }
    }

    /** @return array<string, mixed> */
    public static function payload(string $content = ".setcpu \"6502\"\n.export _start\n.segment \"CODE\"\n_start:\n lda #\$41\n jsr \$ffee\n rts\n"): array
    {
        return [
            'schema' => '8bit-net.native-build-request', 'version' => 1, 'requestId' => 'test-request',
            'target' => ['id' => 'target', 'machineId' => 'bbc-b', 'profile' => 'debug', 'processor' => '6502', 'outputName' => 'program.bin', 'origin' => 0x1900, 'maximumAddress' => 0x7fff, 'entry' => ['mode' => 'source', 'value' => '']],
            'files' => [['id' => 'main', 'name' => 'main.s', 'content' => $content]],
            'sourceUnitIds' => ['main'], 'defines' => ['FEATURE' => 1],
        ];
    }

    /** @return array<string, mixed> */
    public static function cPayload(string $content = "#include \"game.h\"\nint main(void) { return GAME_VALUE; }\n"): array
    {
        return [
            'schema' => '8bit-net.native-build-request', 'version' => 1, 'requestId' => 'test-c-request',
            'target' => ['id' => 'c-target', 'machineId' => 'bbc-b', 'profile' => 'debug', 'processor' => '6502', 'outputName' => 'program.bin', 'origin' => 0x1900, 'maximumAddress' => 0x69ff, 'entry' => ['mode' => 'source', 'value' => '']],
            'files' => [
                ['id' => 'main', 'name' => 'main.c', 'content' => $content],
                ['id' => 'header', 'name' => 'game.h', 'content' => "#define GAME_VALUE 7\n"],
            ],
            'sourceUnitIds' => ['main'], 'defines' => ['FEATURE' => 1],
        ];
    }

    /** @return array<string, mixed> */
    public static function armPayload(string $content = ".syntax unified\n.cpu arm2\n.arm\n.global _start\n.type _start, %function\n_start:\n mov r0, #1\nloop:\n add r0, r0, #1\n b loop\n"): array
    {
        return [
            'schema' => '8bit-net.native-build-request', 'version' => 1, 'requestId' => 'test-arm-request',
            'target' => ['id' => 'arm-target', 'machineId' => 'archimedes-a300', 'profile' => 'debug', 'processor' => 'arm2', 'outputName' => 'program.arm.bin', 'origin' => 0x8000, 'maximumAddress' => 0x0fffff, 'entry' => ['mode' => 'source', 'value' => '']],
            'files' => [['id' => 'main', 'name' => 'main.arm', 'content' => $content]],
            'sourceUnitIds' => ['main'], 'defines' => ['FEATURE' => 1],
        ];
    }
}
