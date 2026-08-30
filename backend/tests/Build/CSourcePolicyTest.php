<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\CSourcePolicy;
use App\Build\NativeBuildRequest;
use App\Http\ApiProblem;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class CSourcePolicyTest extends TestCase
{
    public function testAllowsDeclaredProjectAndImmutableSdkHeaders(): void
    {
        $_SERVER['CC65_BBC_INCLUDE'] = dirname(__DIR__, 2).'/resources/cc65-bbc/include';
        $payload = NativeBuildRequestTest::cPayload("#include \"game.h\"\n#include <acorn.h>\nint main(void) { return GAME_VALUE; }\n");
        (new CSourcePolicy())->validate(NativeBuildRequest::fromArray($payload, 'c'));
        self::addToAssertionCount(1);
    }

    /** @return iterable<string, array{string, string}> */
    public static function rejectedSources(): iterable
    {
        yield 'absolute include' => ['#include "/etc/passwd"', 'BUILD_C_INCLUDE_PATH'];
        yield 'comment-separated absolute include' => ['#include/**/"/etc/passwd"', 'BUILD_C_INCLUDE_PATH'];
        yield 'traversal include' => ['#include "../../etc/passwd"', 'BUILD_C_INCLUDE_PATH'];
        yield 'computed include' => ["#define HEADER \"game.h\"\n#include HEADER", 'BUILD_C_INCLUDE_DYNAMIC'];
        yield 'unknown SDK header' => ['#include <not-a-real-sdk-header.h>', 'BUILD_C_SYSTEM_INCLUDE'];
        yield 'debug path spoof' => ["#line 1 \"/etc/passwd\"", 'BUILD_C_LINE_DIRECTIVE'];
    }

    #[DataProvider('rejectedSources')]
    public function testRejectsFilesystemAndDebugMappingEscapeSurfaces(string $source, string $code): void
    {
        $request = NativeBuildRequest::fromArray(NativeBuildRequestTest::cPayload($source."\nint main(void) { return 0; }\n"), 'c');
        try {
            (new CSourcePolicy())->validate($request);
            self::fail('Expected C source policy rejection.');
        } catch (ApiProblem $problem) {
            self::assertSame($code, $problem->errorCode);
        }
    }
}
