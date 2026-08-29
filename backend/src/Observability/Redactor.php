<?php

declare(strict_types=1);

namespace App\Observability;

/**
 * What may appear in a log line.
 *
 * The build service is handed people's source code and, on the emulator paths,
 * ROM images. A log that captured either would be a copy of somebody's work and
 * somebody's licensed firmware sitting in a file nobody thinks of as storage,
 * and no retention policy would cover it because nobody would know it was
 * there.
 *
 * So this does not try to strip content out of a message. It decides whether a
 * value is of a shape that could not be content in the first place, and refuses
 * anything else. A refused field is still reported — by name, with the reason —
 * because a log that silently dropped a field would be a log that lies about
 * what happened.
 *
 * The judgement is deliberately one-sided: a value that cannot be proved safe is
 * refused. That over-refuses, which costs a diagnostic message. The other
 * direction costs somebody their source.
 */
final class Redactor
{
    /**
     * Names that carry content, when what is under them is text.
     *
     * Matched against the words of a field name rather than against the name as
     * a whole, so `sourceFiles` and `romBytes` are caught along with `source`
     * and `bytes`, while `keyboard` is not — a word that merely contains a
     * reserved word is a different word.
     *
     * The check applies only to strings. A number cannot be somebody's source,
     * so `documentCount` and `romCount` are the measurements this log exists to
     * carry and refusing them on their names would remove the useful half of
     * every record while protecting nothing.
     */
    private const CONTENT_NAMES = [
        'source', 'sources', 'sourcefile', 'sourcefiles', 'content', 'contents', 'body', 'text',
        'bytes', 'bytesbase64', 'data', 'payload', 'image', 'rom', 'roms', 'romset', 'firmware',
        'listing', 'document', 'documents', 'password', 'secret', 'token', 'authorization', 'cookie', 'key',
    ];

    /** A field long enough to be a fragment of a file is treated as one. */
    public const MAX_STRING = 120;

    /**
     * Decide one field.
     *
     * @return array{value: scalar|null, refused: string|null}
     */
    public function field(string $name, mixed $value): array
    {
        if ($value === null || is_bool($value) || is_int($value)) {
            return ['value' => $value, 'refused' => null];
        }
        if (is_float($value)) {
            return is_finite($value)
                ? ['value' => round($value, 3), 'refused' => null]
                : ['value' => null, 'refused' => sprintf('%s was not a finite number', $name)];
        }
        if (!is_string($value)) {
            return ['value' => null, 'refused' => sprintf('%s was a %s, and only scalars are logged', $name, get_debug_type($value))];
        }
        foreach (self::words($name) as $word) {
            if (in_array($word, self::CONTENT_NAMES, true)) {
                return ['value' => null, 'refused' => sprintf('%s is a name this service uses for content, so no text under it is logged', $name)];
            }
        }
        if ($value === '') {
            return ['value' => '', 'refused' => null];
        }
        if (strlen($value) > self::MAX_STRING) {
            return ['value' => null, 'refused' => sprintf('%s was %d bytes, and anything over %d is treated as content', $name, strlen($value), self::MAX_STRING)];
        }
        /* Printable ASCII on one line. This covers newlines and tabs as well
         * as binary, which is why there is no separate check for them: a
         * second check that could never fire would read like protection that
         * was not there. */
        if (preg_match('/[^\x20-\x7e]/', $value) === 1) {
            return ['value' => null, 'refused' => sprintf('%s held a byte that is not printable ASCII on one line, so it is treated as content', $name)];
        }

        return ['value' => $value, 'refused' => null];
    }

    /**
     * The words of a field name, however it was spelled.
     *
     * @return list<string>
     */
    private static function words(string $name): array
    {
        $spaced = (string) preg_replace('/(?<=[a-z0-9])(?=[A-Z])/', ' ', $name);
        $parts = preg_split('/[^A-Za-z0-9]+/', $spaced) ?: [];

        return array_values(array_filter(array_map(static fn (string $part): string => strtolower($part), $parts), static fn (string $part): bool => $part !== ''));
    }

    /**
     * Decide a whole set of fields.
     *
     * @param array<string, mixed> $fields
     * @return array{fields: array<string, scalar|null>, refused: list<string>}
     */
    public function fields(array $fields): array
    {
        $kept = [];
        $refused = [];
        foreach ($fields as $name => $value) {
            $decision = $this->field((string) $name, $value);
            if ($decision['refused'] !== null) {
                $refused[] = $decision['refused'];
                continue;
            }
            $kept[(string) $name] = $decision['value'];
        }

        return ['fields' => $kept, 'refused' => $refused];
    }
}
