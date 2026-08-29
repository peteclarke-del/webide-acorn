<?php

declare(strict_types=1);

namespace App\Observability;

use Symfony\Component\HttpFoundation\Request;

/**
 * The identifier that ties one request's log lines together.
 *
 * A build request crosses several stages — compile, assemble, link — each of
 * which can fail on its own, and without a shared identifier the record of a
 * failed build is a handful of lines nobody can prove belong together.
 *
 * An identifier supplied by the caller is honoured, so a trace that started in
 * front of this service continues through it, but only when it is of a shape
 * that could not carry anything else. A caller-supplied string is caller-
 * controlled input, and this one ends up in a log file: accepting an arbitrary
 * one would let a caller write whatever they liked into the record, including
 * lines that look like other records.
 */
final class RequestContext
{
    /* The header the API already answered on. Keeping it means the identifier
     * a caller quotes from a response is the one the log lines carry, and there
     * is one name for it rather than two. */
    public const HEADER = 'X-Correlation-ID';

    /** Long enough to be unique in practice, short enough to read. */
    private const LENGTH = 32;

    private string $correlationId = '';

    public function correlationId(): string
    {
        if ($this->correlationId === '') {
            $this->correlationId = self::generate();
        }

        return $this->correlationId;
    }

    /** Adopt the caller's identifier when it is one this service can log. */
    public function adopt(Request $request): string
    {
        $supplied = (string) $request->headers->get(self::HEADER, '');
        $this->correlationId = self::acceptable($supplied) ? $supplied : self::generate();

        return $this->correlationId;
    }

    /**
     * Whether a supplied identifier is safe to write into a log line.
     *
     * Letters, digits and a few separators: no spaces, no newlines, no control
     * bytes, nothing that could end a JSON string or start a line that reads
     * like a different record. This is the rule the API already applied to the
     * header, kept as it was and moved here so there is one of it.
     */
    public static function acceptable(string $value): bool
    {
        return preg_match('/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/', $value) === 1;
    }

    private static function generate(): string
    {
        return bin2hex(random_bytes(self::LENGTH / 2));
    }
}
