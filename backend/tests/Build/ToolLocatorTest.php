<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\ToolLocator;
use PHPUnit\Framework\TestCase;

final class ToolLocatorTest extends TestCase
{
    private string $root;

    /** @var array<string, mixed> */
    private array $server = [];

    protected function setUp(): void
    {
        $this->root = sys_get_temp_dir().'/tool-locator-'.bin2hex(random_bytes(6));
        mkdir($this->root.'/somewhere/bin', 0o755, true);
        $this->server = $_SERVER;
    }

    protected function tearDown(): void
    {
        $_SERVER = $this->server;
        foreach (['/somewhere/bin/beebasm', '/somewhere/bin'] as $path) {
            if (is_file($this->root.$path)) unlink($this->root.$path);
            elseif (is_dir($this->root.$path)) rmdir($this->root.$path);
        }
        if (is_dir($this->root.'/somewhere')) rmdir($this->root.'/somewhere');
        if (is_dir($this->root)) rmdir($this->root);
    }

    private function installExecutable(string $name): string
    {
        $path = $this->root.'/somewhere/bin/'.$name;
        file_put_contents($path, "#!/bin/sh\nexit 0\n");
        chmod($path, 0o755);

        return $path;
    }

    public function testAnExplicitlyConfiguredPathIsUsedExactlyAsGiven(): void
    {
        /* Somebody who names a binary means that binary. Silently substituting
         * another one found on PATH would build with a toolchain they did not
         * choose and say nothing about it. */
        $_SERVER['BEEBASM_PATH'] = '/opt/my-own/beebasm';
        $this->installExecutable('beebasm');

        self::assertSame('/opt/my-own/beebasm', ToolLocator::locate('BEEBASM_PATH', 'beebasm', '/usr/local/bin/beebasm'));
    }

    public function testAnExecutableOnThePathIsFoundWhenNothingIsConfigured(): void
    {
        unset($_SERVER['BEEBASM_PATH']);
        $installed = $this->installExecutable('beebasm');

        self::assertSame($installed, ToolLocator::locate('BEEBASM_PATH', 'beebasm', '/usr/local/bin/beebasm', [$this->root.'/somewhere/bin']));
    }

    public function testAFileThatIsNotExecutableIsNotMistakenForTheTool(): void
    {
        unset($_SERVER['BEEBASM_PATH']);
        $path = $this->root.'/somewhere/bin/beebasm';
        file_put_contents($path, "not a program\n");
        chmod($path, 0o644);

        self::assertSame('/usr/local/bin/beebasm', ToolLocator::locate('BEEBASM_PATH', 'beebasm', '/usr/local/bin/beebasm', [$this->root.'/somewhere/bin']));
    }

    public function testTheConventionalPathIsReportedWhenNothingIsInstalled(): void
    {
        /* The readiness check has to name a concrete path for somebody to act
         * on, so a failed search reports where the tool is expected to be. */
        unset($_SERVER['BEEBASM_PATH']);

        self::assertSame('/usr/local/bin/beebasm', ToolLocator::locate('BEEBASM_PATH', 'beebasm', '/usr/local/bin/beebasm', [$this->root.'/somewhere/bin']));
    }

    public function testAnEmptyConfiguredValueDoesNotSuppressTheSearch(): void
    {
        $installed = $this->installExecutable('beebasm');
        $_SERVER['BEEBASM_PATH'] = '';

        self::assertSame($installed, ToolLocator::locate('BEEBASM_PATH', 'beebasm', '/usr/local/bin/beebasm', [$this->root.'/somewhere/bin']));
    }

    public function testTheSearchLooksWhereThesToolsAreActuallyInstalled(): void
    {
        /* The places these toolchains arrive from on the machines this product
         * is developed and run on. /snap/bin in particular is where beebasm
         * lands on Ubuntu and is not always on a web server's PATH, which is
         * what made an installed assembler report as unavailable. */
        self::assertSame(
            ['/usr/local/bin', '/usr/bin', '/bin', '/snap/bin', '/opt/homebrew/bin', '/opt/local/bin'],
            ToolLocator::WELL_KNOWN,
        );
    }

    public function testAnEnvironmentVariableIsSeenHoweverPhpIsBeingServed(): void
    {
        /* Under `php -S` an exported variable reaches neither $_SERVER nor
         * $_ENV, because PHP's default variables_order is GPCS. Reading only
         * those two made BEEBASM_PATH silently do nothing outside the
         * container, which is where it is most needed. */
        unset($_SERVER['TOOL_LOCATOR_PROBE'], $_ENV['TOOL_LOCATOR_PROBE']);
        putenv('TOOL_LOCATOR_PROBE=/from/the/process/environment');
        try {
            self::assertSame('/from/the/process/environment', ToolLocator::configured('TOOL_LOCATOR_PROBE'));
            self::assertSame('/from/the/process/environment', ToolLocator::locate('TOOL_LOCATOR_PROBE', 'beebasm', '/usr/local/bin/beebasm'));
        } finally {
            putenv('TOOL_LOCATOR_PROBE');
        }
    }

    public function testNothingConfiguredReadsAsNothing(): void
    {
        unset($_SERVER['TOOL_LOCATOR_ABSENT'], $_ENV['TOOL_LOCATOR_ABSENT']);
        putenv('TOOL_LOCATOR_ABSENT');
        self::assertNull(ToolLocator::configured('TOOL_LOCATOR_ABSENT'));
    }

    public function testPathIsSearchedBeforeTheWellKnownDirectories(): void
    {
        unset($_SERVER['BEEBASM_PATH']);
        $installed = $this->installExecutable('beebasm');
        $_SERVER['PATH'] = $this->root.'/somewhere/bin';

        /* No injected list here: this is the real search, and it has to reach
         * an executable that is only on PATH. */
        self::assertSame($installed, ToolLocator::locate('BEEBASM_PATH', 'beebasm', '/usr/local/bin/beebasm'));
    }
}
