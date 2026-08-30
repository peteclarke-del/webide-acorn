<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\BeebAsmOutputParser;
use PHPUnit\Framework\TestCase;

final class BeebAsmOutputParserTest extends TestCase
{
    public function testParsesDiagnosticsSymbolsAndOnlyUniqueSourceMappings(): void
    {
        $parser = new BeebAsmOutputParser(); $files = [['id' => 'main', 'name' => 'main.asm', 'content' => "LDA #&41\nRTS\n"], ['id' => 'duplicate', 'name' => 'lib.asm', 'content' => "RTS\n"]];
        $diagnostics = $parser->diagnostics("main.asm(1): error: Bad operand.\nLDA #\n    ^\n", $files);
        self::assertSame('main', $diagnostics[0]['fileId']); self::assertSame(1, $diagnostics[0]['line']); self::assertSame(5, $diagnostics[0]['column']);
        self::assertSame(['start' => 0x1900, 'done' => 0x1902], $parser->symbols("[{'.start':6400L,'.done':6402L}]"));
        $listing = $parser->listing(" 1900 A9 41 LDA #&41\n 1902 60 RTS\n", $files);
        self::assertSame(0x1900, $listing['origin']); self::assertSame('main', $listing['locations'][0x1900]['fileId']); self::assertArrayNotHasKey(0x1902, $listing['locations']);
    }
}
