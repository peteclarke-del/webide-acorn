<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\ArmOutputParser;
use PHPUnit\Framework\TestCase;

final class ArmOutputParserTest extends TestCase
{
    public function testParsesNavigableDiagnosticsSymbolsEntryAndDecodedLines(): void
    {
        $parser = new ArmOutputParser(); $files = [['id' => 'main', 'name' => 'main.arm', 'content' => "_start:\n bad\n"]];
        $diagnostics = $parser->diagnostics('main.arm:2:3: Error: bad instruction', $files, 'assemble');
        self::assertSame('main', $diagnostics[0]['fileId']); self::assertSame(2, $diagnostics[0]['line']); self::assertSame(3, $diagnostics[0]['column']);
        self::assertSame(['_start' => 0x8000], $parser->symbols("00008000 T _start\n"));
        self::assertSame(0x8000, $parser->entryPoint('Entry point address: 0x8000'));
        $lines = $parser->decodedLines("main.arm  1  0x8000 x\nmain.arm  2  0x8004 x\nmain.arm  -  0x8008\n", $files, 0x8000, 8);
        self::assertSame(1, $lines[0x8000]['line']); self::assertSame(2, $lines[0x8004]['line']); self::assertSame(2, $lines[0x8007]['line']);
    }
}
