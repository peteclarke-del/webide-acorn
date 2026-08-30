<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\ArmSourcePolicy;
use App\Build\NativeBuildRequest;
use App\Http\ApiProblem;
use PHPUnit\Framework\TestCase;

final class ArmSourcePolicyTest extends TestCase
{
    public function testAcceptsStaticProjectInclude(): void
    {
        $payload = NativeBuildRequestTest::armPayload(".include \"constants.sarm\"\n.global _start\n_start:\n mov r0, #VALUE\n");
        $payload['files'][] = ['id' => 'constants', 'name' => 'constants.sarm', 'content' => '.equ VALUE, 1'];
        (new ArmSourcePolicy())->validate(NativeBuildRequest::fromArray($payload, 'arm'));
        self::addToAssertionCount(1);
    }

    public function testRejectsIncbin(): void
    {
        $request = NativeBuildRequest::fromArray(NativeBuildRequestTest::armPayload(".incbin \"secret\"\n"), 'arm');
        try { (new ArmSourcePolicy())->validate($request); self::fail('Expected policy rejection.'); }
        catch (ApiProblem $problem) { self::assertSame('BUILD_INCBIN_UNAVAILABLE', $problem->errorCode); }
    }
}
