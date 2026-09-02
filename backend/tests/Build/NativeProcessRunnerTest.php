<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\BuildLimits;
use App\Build\NativeProcessRunner;
use PHPUnit\Framework\TestCase;

/**
 * The guard against a runaway tool, and the one knob that can move it.
 *
 * None of this existed before the wall clock became configurable: the limit was
 * a constant nothing asserted, so raising it anywhere would have removed the
 * protection without a single test noticing.
 */
final class NativeProcessRunnerTest extends TestCase
{
    /* The wall clock is read from the process environment as well as from the
     * superglobals, because that is where it arrives under `php -S` and in the
     * gate, which sets NATIVE_STAGE_SECONDS to thirty. A test about what the
     * default is has to start from nothing configured, or it measures the
     * machine it happens to run on. */
    private function forgetTheConfiguredWallClock(): void
    {
        unset($_SERVER[BuildLimits::STAGE_SECONDS_VARIABLE], $_ENV[BuildLimits::STAGE_SECONDS_VARIABLE]);
        putenv(BuildLimits::STAGE_SECONDS_VARIABLE);
    }

    private ?string $inheritedWallClock = null;

    protected function setUp(): void
    {
        $inherited = getenv(BuildLimits::STAGE_SECONDS_VARIABLE);
        $this->inheritedWallClock = $inherited === false ? null : $inherited;
        $this->forgetTheConfiguredWallClock();
    }

    protected function tearDown(): void
    {
        $this->forgetTheConfiguredWallClock();
        if ($this->inheritedWallClock !== null) {
            putenv(BuildLimits::STAGE_SECONDS_VARIABLE.'='.$this->inheritedWallClock);
        }
    }

    public function testStopsAToolThatOverrunsAndReportsItAsATimeout(): void
    {
        /* The adversarial case the limit exists for: a tool that would never
         * finish. It has to be killed and named as a timeout, not left to hang
         * and not reported as an ordinary failure. */
        $_SERVER[BuildLimits::STAGE_SECONDS_VARIABLE] = '1';
        $started = microtime(true);
        $execution = (new NativeProcessRunner())->run(['/bin/sleep', '30'], sys_get_temp_dir());
        $elapsed = microtime(true) - $started;

        self::assertSame('timeout', $execution['reason']);
        self::assertLessThan(10.0, $elapsed, 'A tool past the wall clock must be stopped, not waited for.');
    }

    public function testRunsAToolThatFinishesWithinTheWallClock(): void
    {
        $execution = (new NativeProcessRunner())->run(['/bin/echo', 'hello'], sys_get_temp_dir());
        self::assertSame('succeeded', $execution['reason']);
        self::assertSame(0, $execution['exitCode']);
        self::assertSame("hello\n", $execution['stdout']);
    }

    public function testReportsAToolThatFailedAsAFailureRatherThanATimeout(): void
    {
        $execution = (new NativeProcessRunner())->run(['/bin/false'], sys_get_temp_dir());
        self::assertSame('exit-failure', $execution['reason']);
    }

    public function testWallClockDefaultsToTheDocumentedFiveSeconds(): void
    {
        self::assertSame(5.0, BuildLimits::STAGE_SECONDS);
        self::assertSame(5.0, BuildLimits::stageSeconds());
        self::assertSame(5.0, BuildLimits::manifest()['stageSeconds']);
    }

    public function testADeploymentMayRaiseTheWallClockWithinBounds(): void
    {
        /* Wall clock is a property of the machine: a shared runner can stall a
         * process for seconds because of something else entirely, and the build
         * should not be failed for the neighbour's load. */
        $_SERVER[BuildLimits::STAGE_SECONDS_VARIABLE] = '30';
        self::assertSame(30.0, BuildLimits::stageSeconds());
        self::assertSame(30.0, BuildLimits::manifest()['stageSeconds'], 'The value in force has to be the value published.');
    }

    public function testIgnoresAWallClockOutsideTheBoundsRatherThanClampingIt(): void
    {
        /* Silently adjusting an impossible request would hide what the
         * deployment asked for. A limit below a second would also turn honest
         * work into a fabricated timeout. */
        foreach (['0.1', '600', 'soon', ''] as $refused) {
            $this->forgetTheConfiguredWallClock();
            $_SERVER[BuildLimits::STAGE_SECONDS_VARIABLE] = $refused;
            self::assertSame(5.0, BuildLimits::stageSeconds(), sprintf('%s should have been ignored.', var_export($refused, true)));
        }
    }
}
