<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\BuildLimits;
use App\Build\NativeProcessRunner;
use PHPUnit\Framework\TestCase;

/**
 * The abuse cases the sandbox exists for.
 *
 * BLD-305 asks for fork and output bombs, cleanup failure and cancellation
 * races. These are the ones a passing build never exercises, which is exactly
 * why they are worth writing: a limit nothing attacks is a limit nobody knows
 * still works.
 */
final class SandboxAbuseTest extends TestCase
{
    private string $scratch;

    protected function setUp(): void
    {
        $this->scratch = sys_get_temp_dir().'/sandbox-abuse-'.bin2hex(random_bytes(8));
        mkdir($this->scratch, 0700, true);
        $_SERVER[BuildLimits::STAGE_SECONDS_VARIABLE] = '2';
    }

    protected function tearDown(): void
    {
        unset($_SERVER[BuildLimits::STAGE_SECONDS_VARIABLE]);
        exec('rm -rf '.escapeshellarg($this->scratch));
    }

    public function testKillsAToolThatWouldNeverFinish(): void
    {
        $started = microtime(true);
        $execution = (new NativeProcessRunner())->run(['/bin/sh', '-c', 'while :; do :; done'], $this->scratch);
        self::assertSame('timeout', $execution['reason']);
        self::assertLessThan(20.0, microtime(true) - $started);
    }

    public function testDoesNotLeaveAChildRunningAfterKillingItsParent(): void
    {
        /*
         * The failure a plain kill has: stopping the tool but not what it
         * spawned. An orphan keeps the CPU, keeps the job directory busy and
         * belongs to nobody.
         *
         * A fork bomb is the case this exists for, so the shape here is the
         * shape of one — many processes wide and several deep — bounded so the
         * test cannot harm the machine running it. Every one of them outlives
         * the tool's deadline and then writes a file; each file that appears is
         * a process that survived the stop.
         */
        $wide = 24;
        $spawn = [];
        for ($index = 0; $index < $wide; ++$index) {
            $spawn[] = sprintf('( sleep 6; touch %s ) &', escapeshellarg($this->scratch."/wide-$index"));
        }
        /* Three deep as well as wide: killing only the immediate children
         * leaves a grandchild running, and a grandchild is what a fork bomb is
         * made of. */
        $spawn[] = sprintf(
            '( ( ( sleep 6; touch %s ) & sleep 6 ) & sleep 6 ) &',
            escapeshellarg($this->scratch.'/deep'),
        );
        (new NativeProcessRunner())->run(
            ['/bin/sh', '-c', implode(' ', $spawn).' while :; do :; done'],
            $this->scratch,
        );
        /* Well past the delay each one waits, so an absent file is a kill and
         * not a race with the assertion. */
        sleep(8);

        $survivors = array_values(array_filter(
            array_map(static fn (string $path): string => basename($path), glob($this->scratch.'/*') ?: []),
            static fn (string $name): bool => str_starts_with($name, 'wide-') || $name === 'deep',
        ));
        self::assertSame([], $survivors, 'Processes the tool spawned outlived the stop that killed the tool.');
    }

    public function testKeepsWhatAStoppedToolPrintedBeforeItWasStopped(): void
    {
        /*
         * Cancelling a tool must not throw away its diagnostics. A tool that
         * says something useful and then hangs is the common shape of a real
         * failure, and the part worth reading is the part it printed first.
         */
        $execution = (new NativeProcessRunner())->run(
            ['/bin/sh', '-c', 'echo "input.s:12: error: unknown opcode"; while :; do :; done'],
            $this->scratch,
        );
        self::assertSame('timeout', $execution['reason']);
        self::assertStringContainsString('input.s:12: error: unknown opcode', $execution['stdout']);
    }

    public function testStopsAToolWritingOutputWithoutEnd(): void
    {
        /* An output bomb fills memory rather than time, so the limit that has
         * to hold is the byte count and not the clock. */
        $execution = (new NativeProcessRunner())->run(['/bin/sh', '-c', 'yes ABCDEFGHIJ'], $this->scratch);
        self::assertSame('output-limit', $execution['reason']);
        self::assertLessThanOrEqual(BuildLimits::LOG_BYTES, strlen($execution['stdout']));
    }

    public function testStopsAToolWritingEndlesslyToItsErrorStream(): void
    {
        /* Both streams are counted, or a tool that shouts on stderr escapes a
         * limit the one on stdout would have caught. */
        $execution = (new NativeProcessRunner())->run(['/bin/sh', '-c', 'yes ABCDEFGHIJ 1>&2'], $this->scratch);
        self::assertSame('output-limit', $execution['reason']);
        self::assertLessThanOrEqual(BuildLimits::LOG_BYTES, strlen($execution['stderr']));
    }

    public function testRefusesToRunSomethingThatIsNotThere(): void
    {
        /* A missing tool has to be a reported failure rather than an exception
         * that escapes as a five hundred. */
        $execution = (new NativeProcessRunner())->run([$this->scratch.'/no-such-tool'], $this->scratch);
        self::assertContains($execution['reason'], ['exit-failure', 'timeout']);
        self::assertNotSame('succeeded', $execution['reason']);
    }

    public function testReportsWhatItRanWithTheJobDirectoryRedacted(): void
    {
        /* The job path is a temporary name that means nothing to a reader and
         * discloses the layout of the machine; the argv is still reported so a
         * failure can be understood. */
        $execution = (new NativeProcessRunner())->run(['/bin/echo', $this->scratch.'/input.s'], $this->scratch);
        self::assertSame('succeeded', $execution['reason']);
        self::assertContains('<job>/input.s', $execution['argv']);
        self::assertStringNotContainsString($this->scratch, implode(' ', $execution['argv']));
    }
}
