<?php

declare(strict_types=1);

namespace App\Tests;

use PHPUnit\Framework\Assert;

/**
 * Locating the pinned native toolchains for the tests that exercise them.
 *
 * These tests run the real assemblers, because what they assert is what those
 * assemblers actually produce. They used to skip themselves where a toolchain
 * was absent, and two of them pointed at a hard-coded temporary directory that
 * existed on exactly one machine. A test that only runs somewhere is worse than
 * no test: the suite reports green while checking less than it claims.
 *
 * So nothing here skips. A toolchain that cannot be found fails the test with
 * the two ways to make it present: `npm run toolchains` from the service root,
 * which builds BeebAsm at the pinned commit and locates the rest, or the
 * native-builder container, where every version is pinned by the image.
 */
final class ToolchainEnvironment
{
    private const REMEDY = 'Run `npm run toolchains` from the service root to obtain it, or run this suite in the native-builder container where every version is pinned.';

    /** Reads a path from the environment, falling back to the container's location. */
    public static function path(string $variable, string $containerDefault): string
    {
        $value = $_SERVER[$variable] ?? $_ENV[$variable] ?? $containerDefault;

        return (string) $value;
    }

    /**
     * Publish a tool's path for the build service to read, failing with the
     * remedy when it is not there.
     */
    public static function require(string $variable, string $containerDefault, string $what): string
    {
        $path = self::path($variable, $containerDefault);
        if (!is_file($path)) {
            Assert::fail(sprintf('%s was not found at %s. %s', $what, $path, self::REMEDY));
        }
        $_SERVER[$variable] = $path;

        return $path;
    }

    /** Fail unless a file the toolchain needs is present. */
    public static function requireFile(string $path, string $what): void
    {
        if (!is_file($path)) {
            Assert::fail(sprintf('%s was not found at %s. %s', $what, $path, self::REMEDY));
        }
    }
}
