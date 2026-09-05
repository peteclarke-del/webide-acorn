<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\Cc65OutputParser;
use PHPUnit\Framework\TestCase;

final class Cc65OutputParserTest extends TestCase
{
    public function testNormalizesDiagnosticsAndPinnedDebugRecords(): void
    {
        $files = [['id' => 'main', 'name' => 'src/main.s', 'content' => '']];
        $parser = new Cc65OutputParser();
        $diagnostics = $parser->diagnostics("src/main.s(4): Error: Range error\nld65: Warning: test warning\n", $files, 'assemble');
        self::assertSame(['error', 'warning'], array_column($diagnostics, 'severity'));
        /* The identifier is optional in the shape, because a diagnostic that
         * names no project file has none, so it is asserted present before it
         * is read rather than assumed. */
        self::assertSame(['fileId' => 'main', 'fileName' => 'src/main.s'], array_intersect_key($diagnostics[0], ['fileId' => null, 'fileName' => null]));
        self::assertSame(4, $diagnostics[0]['line']);

        $debug = implode("\n", [
            'file'."\t".'id=0,name="src/main.s",size=10,mtime=0x0,mod=0',
            'line'."\t".'id=0,file=0,line=4,span=0',
            'seg'."\t".'id=0,name="CODE",start=0x001900,size=0x0002,addrsize=absolute,type=ro,oname="output.bin",ooffs=0',
            'span'."\t".'id=0,seg=0,start=0,size=2',
            'sym'."\t".'id=0,name="_start",addrsize=absolute,scope=0,def=0,val=0x1900,seg=0,type=lab',
        ]);
        $parsed = $parser->debugFile($debug, $files);
        self::assertSame(0x1900, $parsed['symbols']['_start']);
        self::assertSame(['fileId' => 'main', 'fileName' => 'src/main.s', 'line' => 4], $parsed['sourceLocations'][0x1901]);
        /* Optional for the same reason: a segment that never reaches the
         * output has no offset in it. */
        self::assertSame(['outputOffset' => 0], array_intersect_key($parsed['segments'][0], ['outputOffset' => null]));
    }
}
