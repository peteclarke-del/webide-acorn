<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\NativeBuildRequest;
use App\Build\SourcePolicy;
use App\Http\ApiProblem;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class SourcePolicyTest extends TestCase
{
    public function testAllowsStaticDeclaredProjectInclude(): void
    {
        $payload = NativeBuildRequestTest::payload(".include \"lib/constants.inc\"\n.segment \"CODE\"\n.byte VALUE\n");
        $payload['files'][] = ['id' => 'constants', 'name' => 'lib/constants.inc', 'content' => 'VALUE = $41'];
        (new SourcePolicy())->validate(NativeBuildRequest::fromArray($payload));
        self::addToAssertionCount(1);
    }

    /** @return iterable<string, array{string, string}> */
    public static function rejectedSources(): iterable
    {
        yield 'absolute include' => ['.include "/etc/passwd"', 'BUILD_INCLUDE_PATH'];
        yield 'traversal include' => ['.include "../../etc/passwd"', 'BUILD_INCLUDE_PATH'];
        yield 'dynamic include' => ['.include .concat("/etc/", "passwd")', 'BUILD_INCLUDE_DYNAMIC'];
        yield 'binary include' => ['.incbin "/etc/passwd"', 'BUILD_INCBIN_UNAVAILABLE'];
        yield 'missing include' => ['.include "missing.inc"', 'BUILD_INCLUDE_MISSING'];
    }

    #[DataProvider('rejectedSources')]
    public function testRejectsFilesystemEscapeSurfaces(string $source, string $code): void
    {
        $request = NativeBuildRequest::fromArray(NativeBuildRequestTest::payload($source));
        try {
            (new SourcePolicy())->validate($request);
            self::fail('Expected source policy rejection.');
        } catch (ApiProblem $problem) {
            self::assertSame($code, $problem->errorCode);
        }
    }
}
