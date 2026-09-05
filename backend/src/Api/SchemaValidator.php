<?php

declare(strict_types=1);

namespace App\Api;

/**
 * Checking a real response against the accepted API description.
 *
 * The description in api/openapi.json is the contract, and a contract nothing
 * checks is a wish. This validates an answer the server actually produced
 * against the schema the description declares for it, so a field that changed
 * shape, went missing or came back null fails a test rather than reaching a
 * client that will read it as an empty string.
 *
 * It understands the subset the description uses, and nothing more. An
 * unrecognised keyword is reported as a failure rather than ignored: silently
 * passing a rule it did not understand is how a validator comes to be trusted
 * for something it never checked. The list of what it does understand is in
 * `KNOWN` and the test asserts the description uses nothing outside it.
 *
 * Values are decoded as objects rather than as associative arrays, because
 * `[]` and `{}` are the same PHP array and telling an empty object from an
 * empty list matters here: `files` being `[]` instead of `{}` is exactly the
 * kind of drift this exists to catch.
 */
final class SchemaValidator
{
    /** Keywords this validator acts on. Anything else in a schema is a failure. */
    public const KNOWN = [
        '$ref', 'const', 'enum', 'oneOf', 'type', 'properties', 'required',
        'additionalProperties', 'items', 'pattern', 'minimum', 'maximum',
        'description', 'summary', 'title', 'examples', 'default',
    ];

    /** @param array<string, mixed> $schemas the description's components.schemas */
    public function __construct(private readonly array $schemas)
    {
    }

    /**
     * @param array<string, mixed> $schema
     *
     * @return list<string> every way the value failed, not the first
     */
    public function validate(array $schema, mixed $value, string $where = 'the response'): array
    {
        foreach (array_keys($schema) as $keyword) {
            if (!in_array((string) $keyword, self::KNOWN, true)) {
                return [sprintf('%s is checked against a schema using %s, which this validator does not implement. Passing a rule it did not understand would be worse than failing.', $where, (string) $keyword)];
            }
        }

        if (isset($schema['$ref'])) {
            $name = str_replace('#/components/schemas/', '', (string) $schema['$ref']);
            if (!isset($this->schemas[$name]) || !is_array($this->schemas[$name])) {
                return [sprintf('%s refers to schema %s, which the description does not define.', $where, $name)];
            }

            return $this->validate($this->schemas[$name], $value, $where);
        }

        if (array_key_exists('const', $schema)) {
            return $value === $schema['const']
                ? []
                : [sprintf('%s must be %s and was %s.', $where, $this->show($schema['const']), $this->show($value))];
        }

        if (isset($schema['enum']) && is_array($schema['enum'])) {
            return in_array($value, $schema['enum'], true)
                ? []
                : [sprintf('%s must be one of %s and was %s.', $where, implode(', ', array_map($this->show(...), $schema['enum'])), $this->show($value))];
        }

        if (isset($schema['oneOf']) && is_array($schema['oneOf'])) {
            foreach ($schema['oneOf'] as $option) {
                if (is_array($option) && $this->validate($option, $value, $where) === []) {
                    return [];
                }
            }

            return [sprintf('%s matched none of the %d shapes the description allows, and was %s.', $where, count($schema['oneOf']), $this->show($value))];
        }

        return $this->validateTyped($schema, $value, $where);
    }

    /**
     * @param array<string, mixed> $schema
     *
     * @return list<string>
     */
    private function validateTyped(array $schema, mixed $value, string $where): array
    {
        $type = isset($schema['type']) ? (string) $schema['type'] : null;
        if ($type === null) {
            return [];
        }

        $failures = match ($type) {
            'string' => is_string($value) ? [] : [$this->wrongType($where, 'a string', $value)],
            'integer' => is_int($value) ? [] : [$this->wrongType($where, 'a whole number', $value)],
            'number' => is_int($value) || is_float($value) ? [] : [$this->wrongType($where, 'a number', $value)],
            'boolean' => is_bool($value) ? [] : [$this->wrongType($where, 'true or false', $value)],
            'null' => $value === null ? [] : [$this->wrongType($where, 'null', $value)],
            'array' => is_array($value) ? [] : [$this->wrongType($where, 'a list', $value)],
            'object' => $value instanceof \stdClass ? [] : [$this->wrongType($where, 'an object', $value)],
            default => [sprintf('%s is declared as type %s, which this validator does not implement.', $where, $type)],
        };
        if ($failures !== []) {
            return $failures;
        }

        if ($type === 'string') {
            /** @var string $value */
            if (isset($schema['pattern']) && preg_match('/'.str_replace('/', '\/', (string) $schema['pattern']).'/', $value) !== 1) {
                $failures[] = sprintf('%s must match %s and was %s.', $where, (string) $schema['pattern'], $this->show($value));
            }
        }

        if ($type === 'integer' || $type === 'number') {
            /** @var int|float $value */
            if (isset($schema['minimum']) && $value < $schema['minimum']) {
                $failures[] = sprintf('%s must be at least %s and was %s.', $where, $this->show($schema['minimum']), $this->show($value));
            }
            if (isset($schema['maximum']) && $value > $schema['maximum']) {
                $failures[] = sprintf('%s must be at most %s and was %s.', $where, $this->show($schema['maximum']), $this->show($value));
            }
        }

        if ($type === 'array' && isset($schema['items']) && is_array($schema['items'])) {
            /** @var array<int, mixed> $value */
            foreach ($value as $index => $entry) {
                array_push($failures, ...$this->validate($schema['items'], $entry, sprintf('%s[%s]', $where, (string) $index)));
            }
        }

        if ($type === 'object') {
            /** @var \stdClass $value */
            array_push($failures, ...$this->validateObject($schema, $value, $where));
        }

        return $failures;
    }

    /**
     * @param array<string, mixed> $schema
     *
     * @return list<string>
     */
    private function validateObject(array $schema, \stdClass $value, string $where): array
    {
        $failures = [];
        $properties = isset($schema['properties']) && is_array($schema['properties']) ? $schema['properties'] : [];
        $required = isset($schema['required']) && is_array($schema['required']) ? $schema['required'] : array_keys($properties);

        foreach ($required as $name) {
            if (!property_exists($value, (string) $name)) {
                $failures[] = sprintf('%s is missing %s, which the description declares. A client may rely on it being there.', $where, (string) $name);
            }
        }

        foreach ($properties as $name => $property) {
            if (!is_array($property) || !property_exists($value, (string) $name)) {
                continue;
            }
            array_push($failures, ...$this->validate($property, $value->{(string) $name}, sprintf('%s.%s', $where, (string) $name)));
        }

        $extra = $schema['additionalProperties'] ?? true;
        foreach (get_object_vars($value) as $name => $entry) {
            if (isset($properties[$name])) {
                continue;
            }
            if ($extra === false) {
                $failures[] = sprintf('%s carries %s, which the description does not allow here.', $where, $name);
                continue;
            }
            if (is_array($extra)) {
                array_push($failures, ...$this->validate($extra, $entry, sprintf('%s.%s', $where, $name)));
            }
        }

        return $failures;
    }

    private function wrongType(string $where, string $expected, mixed $value): string
    {
        return sprintf('%s must be %s and was %s.', $where, $expected, $this->show($value));
    }

    private function show(mixed $value): string
    {
        if (is_string($value)) {
            return '"'.(strlen($value) > 40 ? substr($value, 0, 37).'...' : $value).'"';
        }
        if ($value === null) {
            return 'null';
        }
        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }
        if (is_array($value)) {
            return sprintf('a list of %d', count($value));
        }
        if ($value instanceof \stdClass) {
            return sprintf('an object with %s', implode(', ', array_keys(get_object_vars($value))) ?: 'nothing in it');
        }

        return (string) json_encode($value);
    }
}
