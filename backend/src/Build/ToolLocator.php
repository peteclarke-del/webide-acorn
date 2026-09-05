<?php

declare(strict_types=1);

namespace App\Build;

/**
 * Where a native toolchain's executable actually is.
 *
 * Each manifest used to name one absolute path and report the toolchain
 * missing when nothing was there. That is right inside the container the build
 * service ships in, where the path is known, and wrong everywhere else: a
 * developer running the workbench against a local backend has beebasm from a
 * distribution package, a snap or Homebrew, and was told the toolchain was
 * unavailable while the binary sat on their PATH.
 *
 * An explicitly configured path is never second-guessed — somebody who sets
 * BEEBASM_PATH means that binary, and reporting a different one they did not
 * choose would be worse than reporting the one they did and saying it is not
 * there. Only when nothing is configured is the executable searched for.
 */
final class ToolLocator
{
    /**
     * Directories searched after PATH, covering the ways these tools are
     * installed on the systems this product is developed and run on.
     */
    public const WELL_KNOWN = ['/usr/local/bin', '/usr/bin', '/bin', '/snap/bin', '/opt/homebrew/bin', '/opt/local/bin'];

    /**
     * The path to use for $name, honouring $envKey when it is set.
     *
     * Falls back to $conventional when the executable cannot be found, so that
     * the readiness check reports a concrete path somebody can act on rather
     * than an empty string.
     *
     * $searchDirectories replaces both PATH and the well-known list. It exists
     * so the search can be tested against a directory the test made, rather
     * than against whatever happens to be installed on the machine running the
     * suite, which would make the result differ from one machine to the next.
     *
     * @param list<string>|null $searchDirectories
     */
    public static function locate(string $envKey, string $name, string $conventional, ?array $searchDirectories = null): string
    {
        $configured = self::configured($envKey);
        if ($configured !== null) {
            return $configured;
        }

        foreach ($searchDirectories ?? self::searchDirectories() as $directory) {
            $candidate = rtrim($directory, '/').'/'.$name;
            if (is_file($candidate) && is_executable($candidate)) {
                return $candidate;
            }
        }

        return $conventional;
    }

    /**
     * A configured value for $key, or null when nothing configures it.
     *
     * All three sources are consulted because which one carries an environment
     * variable depends on how PHP is being served. Under nginx and PHP-FPM the
     * container passes them as FastCGI parameters and they arrive in $_SERVER;
     * a developer running `php -S` exports them into the process environment,
     * where PHP's default `variables_order` of GPCS puts them in neither
     * $_SERVER nor $_ENV, and only getenv() can see them. Reading just the two
     * superglobals meant a documented setting silently did nothing outside the
     * container.
     */
    public static function configured(string $key): ?string
    {
        foreach ([$_SERVER[$key] ?? null, $_ENV[$key] ?? null, getenv($key)] as $value) {
            if (is_string($value) && $value !== '') {
                return $value;
            }
        }

        return null;
    }

    /** @return list<string> */
    private static function searchDirectories(): array
    {
        $path = self::configured('PATH') ?? '';
        $fromPath = $path !== '' ? explode(PATH_SEPARATOR, $path) : [];

        $directories = [];
        foreach ([...$fromPath, ...self::WELL_KNOWN] as $directory) {
            if ($directory === '' || isset($directories[$directory])) {
                continue;
            }
            $directories[$directory] = true;
        }

        return array_keys($directories);
    }
}
