<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\Readiness;
use PHPUnit\Framework\TestCase;

/**
 * A `ready: false` that says nothing is a report nobody can act on, so what
 * these contracts check is that every failure names what was examined and what
 * to do, and that the summary is derived from the detail rather than computed
 * beside it.
 */
final class ReadinessTest extends TestCase
{
    public function testAPassingSetIsReadyAndCarriesNoDetail(): void
    {
        $readiness = (new Readiness())->check('one', true, 'unused')->check('two', true, 'unused');

        self::assertTrue($readiness->ready());
        self::assertSame([], $readiness->unmet());
        self::assertSame([['check' => 'one', 'ok' => true, 'detail' => ''], ['check' => 'two', 'ok' => true, 'detail' => '']], $readiness->checks());
    }

    public function testOneFailingCheckMakesTheWholeThingNotReadyAndSaysWhich(): void
    {
        $readiness = (new Readiness())->check('one', true, '')->check('two', false, 'two was missing')->check('three', true, '');

        self::assertFalse($readiness->ready());
        self::assertSame(['two was missing'], $readiness->unmet());
    }

    public function testAMissingExecutableNamesThePathAndTheRemedy(): void
    {
        $readiness = (new Readiness())->executable('beebasm', '/nowhere/beebasm');

        self::assertFalse($readiness->ready());
        self::assertStringContainsString('/nowhere/beebasm', $readiness->unmet()[0]);
        self::assertStringContainsString('npm run toolchains', $readiness->unmet()[0]);
    }

    public function testAnUnreadableFileIsDistinguishedFromAMissingProgram(): void
    {
        $readiness = (new Readiness())->file('BeebAsm licence', '/nowhere/COPYING.txt');

        self::assertStringContainsString('was not readable at /nowhere/COPYING.txt', $readiness->unmet()[0]);
    }

    public function testAPinnedVersionMismatchReportsBothNumbers(): void
    {
        $wrong = (new Readiness())->version('beebasm', '1.10', '1.11');
        self::assertStringContainsString('reported version 1.10', $wrong->unmet()[0]);
        self::assertStringContainsString('pinned to 1.11', $wrong->unmet()[0]);

        $missing = (new Readiness())->version('beebasm', null, '1.11');
        self::assertStringContainsString('did not report a version', $missing->unmet()[0]);

        self::assertTrue((new Readiness())->version('beebasm', '1.11', '1.11')->ready());
        /* No pin means any detected version is accepted, and that is a
         * different statement from having no version at all. */
        self::assertTrue((new Readiness())->version('ca65', '2.19')->ready());
    }

    public function testAnExecutableThatExistsPasses(): void
    {
        /* Checked against something that is certainly present and runnable in
         * any environment this suite can run in at all. */
        $readiness = (new Readiness())->executable('php', PHP_BINARY);

        self::assertTrue($readiness->ready());
    }
}
