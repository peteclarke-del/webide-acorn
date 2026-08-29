<?php

declare(strict_types=1);

namespace App\Build;

/**
 * Why a toolchain is not ready, rather than only that it is not.
 *
 * Every manifest already reported a single `ready` boolean computed from a
 * chain of conditions. When it came back false there was nothing to act on: a
 * missing binary, a wrong version and an unreadable licence file all looked
 * identical from outside, so the only way to find out which was to read the
 * source of the manifest.
 *
 * Each check records what was examined, whether it passed, and — when it did
 * not — what to do about it. Readiness is then derived from the checks rather
 * than computed separately, so the summary cannot disagree with the detail.
 */
final class Readiness
{
    /** @var list<array{check: string, ok: bool, detail: string}> */
    private array $checks = [];

    /** The remedy repeated on every environment failure, because it is the same one. */
    public const REMEDY = 'Run `npm run toolchains` from the service root, or run this service in the native-builder container where every version is pinned.';

    public function check(string $check, bool $ok, string $detail): self
    {
        $this->checks[] = ['check' => $check, 'ok' => $ok, 'detail' => $ok ? '' : $detail];

        return $this;
    }

    /** A program that has to exist and be runnable. */
    public function executable(string $name, string $path): self
    {
        return $this->check(
            $name,
            is_file($path) && is_executable($path),
            sprintf('%s was not found as an executable at %s. %s', $name, $path, self::REMEDY),
        );
    }

    /** A file that has to be present and readable — a runtime object, a licence. */
    public function file(string $name, string $path): self
    {
        return $this->check(
            $name,
            is_file($path) && is_readable($path),
            sprintf('%s was not readable at %s. %s', $name, $path, self::REMEDY),
        );
    }

    /**
     * A version that had to be detected, and optionally had to be a given one.
     *
     * A pinned version that does not match is reported with both numbers,
     * because "wrong version" without saying which is not something anyone can
     * act on.
     */
    public function version(string $name, ?string $found, ?string $expected = null): self
    {
        if ($found === null) {
            return $this->check($name.' version', false, sprintf('%s did not report a version, so it could not be identified. %s', $name, self::REMEDY));
        }
        if ($expected !== null && $found !== $expected) {
            return $this->check($name.' version', false, sprintf('%s reported version %s and this service is pinned to %s. %s', $name, $found, $expected, self::REMEDY));
        }

        return $this->check($name.' version', true, '');
    }

    public function ready(): bool
    {
        foreach ($this->checks as $check) {
            if (!$check['ok']) {
                return false;
            }
        }

        return true;
    }

    /** @return list<array{check: string, ok: bool, detail: string}> */
    public function checks(): array
    {
        return $this->checks;
    }

    /**
     * Only the failures, in the order they were checked.
     *
     * @return list<string>
     */
    public function unmet(): array
    {
        $unmet = [];
        foreach ($this->checks as $check) {
            if (!$check['ok']) {
                $unmet[] = $check['detail'];
            }
        }

        return $unmet;
    }
}
