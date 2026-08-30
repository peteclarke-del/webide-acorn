<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\BeebAsmSourcePolicy;
use App\Build\NativeBuildRequest;
use App\Http\ApiProblem;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class BeebAsmSourcePolicyTest extends TestCase
{
    public function testAllowsOneRootLiteralIncludeAndFilenameFreeSave(): void
    {
        $payload = $this->payload("ORG &1900\n.start\nINCLUDE \"lib.asm\"\nSAVE start,P%,start\n");
        $payload['files'][] = ['id' => 'lib', 'name' => 'lib.asm', 'content' => "LDA #&41\nRTS\n"];
        (new BeebAsmSourcePolicy())->validate(NativeBuildRequest::fromArray($payload)); self::addToAssertionCount(1);
    }

    /** @return iterable<string, array{string, string}> */
    public static function rejected(): iterable
    {
        yield 'absolute include' => ["INCLUDE \"/etc/passwd\"\nSAVE &1900,&1901", 'BEEBASM_INCLUDE_MISSING'];
        yield 'dynamic include' => ["INCLUDE name$\nSAVE &1900,&1901", 'BEEBASM_INCLUDE_DYNAMIC'];
        yield 'incbin' => ["INCBIN \"/etc/passwd\"\nSAVE &1900,&1901", 'BEEBASM_FILESYSTEM_DIRECTIVE'];
        yield 'colon directive bypass' => ["ORG &1900:INCBIN \"/etc/passwd\"\nSAVE &1900,&1901", 'BEEBASM_FILESYSTEM_DIRECTIVE'];
        yield 'putfile' => ["PUTFILE \"/etc/passwd\",\"X\",0\nSAVE &1900,&1901", 'BEEBASM_FILESYSTEM_DIRECTIVE'];
        yield 'dynamic assembly' => ["ASM \"INCBIN \\\"/etc/passwd\\\"\"\nSAVE &1900,&1901", 'BEEBASM_FILESYSTEM_DIRECTIVE'];
        yield 'filename save' => ["ORG &1900\nRTS\nSAVE \"/tmp/out\",&1900,P%", 'BEEBASM_SAVE_FILENAME'];
        yield 'source cpu' => ["CPU 1\nORG &1900\nRTS\nSAVE &1900,P%", 'BEEBASM_CPU_OWNED'];
        yield 'time dependent expression' => ["ORG &1900\nEQUS TIME$\nSAVE &1900,P%", 'BEEBASM_NONDETERMINISTIC'];
        yield 'two saves' => ["ORG &1900\nRTS\nSAVE &1900,P%\nSAVE &1900,P%", 'BEEBASM_SAVE_COUNT'];
    }

    #[DataProvider('rejected')]
    public function testRejectsEscapeAndUnsupportedSurfaces(string $source, string $code): void
    {
        try { (new BeebAsmSourcePolicy())->validate(NativeBuildRequest::fromArray($this->payload($source))); self::fail('Expected rejection'); }
        catch (ApiProblem $problem) { self::assertSame($code, $problem->errorCode); }
    }

    /** @return array<string, mixed> */
    private function payload(string $source): array
    {
        $payload = NativeBuildRequestTest::payload($source); $payload['files'][0]['name'] = 'main.asm'; return $payload;
    }
}
