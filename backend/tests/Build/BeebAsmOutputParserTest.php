<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\BeebAsmOutputParser;
use PHPUnit\Framework\TestCase;

final class BeebAsmOutputParserTest extends TestCase
{
    public function testParsesDiagnosticsSymbolsAndSourceMappings(): void
    {
        $parser = new BeebAsmOutputParser(); $files = [['id' => 'main', 'name' => 'main.asm', 'content' => "LDA #&41\nRTS\n"], ['id' => 'duplicate', 'name' => 'lib.asm', 'content' => "RTS\n"]];
        $diagnostics = $parser->diagnostics("main.asm(1): error: Bad operand.\nLDA #\n    ^\n", $files);
        self::assertSame('main', $diagnostics[0]['fileId']); self::assertSame(1, $diagnostics[0]['line']); self::assertSame(5, $diagnostics[0]['column']);
        self::assertSame(['start' => 0x1900, 'done' => 0x1902], $parser->symbols("[{'.start':6400L,'.done':6402L}]"));
        $listing = $parser->listing(" 1900 A9 41 LDA #&41\n 1902 60 RTS\n", $files);
        self::assertSame(0x1900, $listing['origin']);
        self::assertSame('main', $listing['locations'][0x1900]['fileId']);
        /* RTS is in both files, and used to be left unmapped for that reason.
         * The line before it was placed in main.asm, and main.asm's next line
         * is this one, so following the order gives the true answer rather than
         * a guess. Two files with nothing else to separate them are still
         * refused, which the test below shows. */
        self::assertSame('main', $listing['locations'][0x1902]['fileId']);
        self::assertSame(2, $listing['locations'][0x1902]['line']);
    }

    public function testFollowsTheSourceOrderSoRepeatedInstructionsAreStillPlaced(): void
    {
        /* Most lines in assembly repeat. Placing a listing line by its text
         * alone therefore placed almost none of them: a real game mapped
         * forty-four addresses out of three and a half thousand listing lines,
         * which is not enough to step through. The listing is emitted in source
         * order, so the line after the last one placed in the same file is the
         * answer whenever there is one. */
        $files = [['id' => 'main', 'name' => 'main.asm', 'content' => ".start\nLDA #0\nSTA &70\nLDA #0\nSTA &71\nRTS\n"]];
        $output = <<<'OUT'
             1900   A9 00      LDA #0
             1902   85 70      STA &70
             1904   A9 00      LDA #0
             1906   85 71      STA &71
             1908   60         RTS
            OUT;

        $listing = (new BeebAsmOutputParser())->listing($output, $files);
        $lines = array_map(static fn (array $location): int => $location['line'], $listing['locations']);

        /* The two LDA #0 lines are two and four, in that order, rather than
         * both unplaced for being indistinguishable. */
        self::assertSame(2, $lines[0x1900]);
        self::assertSame(3, $lines[0x1902]);
        self::assertSame(4, $lines[0x1904]);
        self::assertSame(5, $lines[0x1906]);
        self::assertSame(6, $lines[0x1908]);
    }

    public function testStillRefusesToGuessBetweenTwoFiles(): void
    {
        /* Following the order is not guessing: a line that is neither unique
         * nor the next one in the file already being emitted stays unmapped,
         * because attributing it to the wrong file would put a breakpoint
         * somewhere the reader did not ask for. */
        $files = [
            ['id' => 'a', 'name' => 'a.asm', 'content' => "RTS\n"],
            ['id' => 'b', 'name' => 'b.asm', 'content' => "RTS\n"],
        ];
        $listing = (new BeebAsmOutputParser())->listing('     1900   60         RTS', $files);
        self::assertSame([], $listing['locations']);
    }

    public function testNamesTheDirectoriesASourceSavesInto(): void
    {
        $parser = new BeebAsmOutputParser();
        $files = [['id' => 'main', 'name' => 'main.asm', 'content' => "SAVE \"build/game\", start, end\nSAVE \"build/deep/rules\", a, b\nSAVE \"top\", a, b\nSAVE \"/etc/passwd\", a, b\nSAVE \"../out\", a, b\n"]];

        /* A path at the top needs no directory; an absolute one and one that
         * climbs out are left for the policy to refuse rather than created. */
        self::assertSame(['build', 'build/deep'], $parser->saveDirectories($files));
    }

    public function testReadsBackWhatBeebAsmSaidItSaved(): void
    {
        $parser = new BeebAsmOutputParser();
        $output = "Saving file 'build/grave-bbc-tape'\nSaving file 'build/rules-bbc-tape'\nSaving file 'build/grave-bbc-tape'\n";

        /* From what it did rather than what the source asked for: a conditional
         * assembly saves some of what it names and not the rest. */
        self::assertSame(['build/grave-bbc-tape', 'build/rules-bbc-tape'], $parser->savedFiles($output));
        self::assertSame([], $parser->savedFiles('nothing was saved'));
    }

    public function testReadsALoadAddressFromTheDirectiveThatSavedTheFile(): void
    {
        /* The listing's lowest address belongs to the whole assembly. A project
         * that assembles a rules block at &1400 and its game at &1900 had its
         * game reported as loading at &1400, which would have put every
         * breakpoint and every mapped line five hundred bytes out. */
        $parser = new BeebAsmOutputParser();
        $files = [['name' => 'main.asm', 'content' => "SAVE \"build/rules\", rules_start, rules_end\nSAVE \"build/game\", start, end, start\nSAVE \"build/fixed\", &2000, &2100\n"]];
        $symbols = ['rules_start' => 0x1400, 'start' => 0x1900, 'end' => 0x2DA4];

        self::assertSame(0x1900, $parser->saveOrigin($files, 'build/game', $symbols));
        self::assertSame(0x1400, $parser->saveOrigin($files, 'build/rules', $symbols));
        self::assertSame(0x2000, $parser->saveOrigin($files, 'build/fixed', $symbols));
    }

    public function testSaysNothingRatherThanGuessingAnAddressItCannotRead(): void
    {
        $parser = new BeebAsmOutputParser();
        $files = [['name' => 'main.asm', 'content' => "SAVE \"build/game\", start + offset * 2, end\nSAVE \"build/other\", missing_symbol, end\n"]];

        /* An expression, and a symbol nothing defines. Reporting the assembly's
         * lowest address for either would be a wrong answer rather than none. */
        self::assertNull($parser->saveOrigin($files, 'build/game', ['start' => 0x1900]));
        self::assertNull($parser->saveOrigin($files, 'build/other', ['start' => 0x1900]));
        self::assertNull($parser->saveOrigin($files, 'build/never-saved', ['start' => 0x1900]));
    }
}
