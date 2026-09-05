<?php

declare(strict_types=1);

namespace App\Build;

use App\Http\ApiProblem;

final class NativeBuildRequest
{
    /**
     * @param list<array{id: string, name: string, content: string}> $files
     * @param list<string> $sourceUnitIds
     * @param array<string, int> $defines
     */
    private function __construct(
        public readonly string $requestId,
        public readonly string $targetId,
        public readonly string $machineId,
        public readonly string $profile,
        public readonly string $processor,
        public readonly string $outputName,
        public readonly int $origin,
        public readonly int $maximumAddress,
        public readonly array $files,
        public readonly array $sourceUnitIds,
        public readonly array $defines,
        public readonly string $entryMode,
        public readonly string $entryValue,
        public readonly string $dialect,
        public readonly string $profileGoal,
        public readonly string $debugMetadata,
        /**
         * Rebuild rather than answer from the cache, and store what comes back.
         *
         * Explicit rather than inferred, so that Rebuild means rebuild: a
         * person who asks again after a toolchain change they suspect has not
         * been noticed needs a way to find out, and a cache with no way past it
         * is a cache nobody can trust.
         */
        public readonly bool $cacheBypass,
    ) {
    }

    /** @param array<string, mixed> $payload */
    public static function fromArray(array $payload, string $dialect = 'assembly'): self
    {
        if (!in_array($dialect, ['assembly', 'c', 'arm'], true)) {
            throw new \InvalidArgumentException('Unsupported native request dialect.');
        }
        if (($payload['schema'] ?? null) !== '8bit-net.native-build-request' || ($payload['version'] ?? null) !== 1) {
            throw new ApiProblem(400, 'BUILD_REQUEST_SCHEMA', 'Unsupported native build request schema.', false, ['schema' => 'Expected 8bit-net.native-build-request version 1']);
        }

        $requestId = self::identifier($payload['requestId'] ?? null, 'requestId', 80);
        $target = self::record($payload['target'] ?? null, 'target');
        $targetId = self::identifier($target['id'] ?? null, 'target.id', 80);
        $machineId = self::identifier($target['machineId'] ?? null, 'target.machineId', 80);
        $profile = $target['profile'] ?? null;
        if (!is_string($profile) || !in_array($profile, ['debug', 'size', 'speed', 'custom'], true)) {
            throw new ApiProblem(400, 'BUILD_PROFILE_INVALID', 'Build profile must be debug, size, speed or custom.', false, ['target.profile' => 'Invalid build profile']);
        }
        $profileGoal = $target['profileGoal'] ?? 'balanced';
        $debugMetadata = $target['debugMetadata'] ?? 'full';
        if (!is_string($profileGoal) || !in_array($profileGoal, ['balanced', 'size', 'speed'], true) || !is_string($debugMetadata) || !in_array($debugMetadata, ['full', 'none'], true)) {
            throw new ApiProblem(400, 'BUILD_PROFILE_OPTIONS', 'Profile goal must be balanced, size or speed and debug metadata must be full or none.', false, ['target.profileGoal' => 'Invalid profile option']);
        }
        $processor = strtolower((string) ($target['processor'] ?? ''));
        $processors = $dialect === 'arm' ? ['arm2'] : ['6502', '65sc02', '65c02', 'w65c02'];
        if (!in_array($processor, $processors, true)) {
            $message = $dialect === 'arm' ? 'The first GNU ARM adapter supports ARM2 only.' : 'The ca65 adapter supports 6502, 65SC02, 65C02 or W65C02.';
            throw new ApiProblem(400, 'BUILD_CPU_INVALID', $message, false, ['target.processor' => 'Unsupported processor']);
        }
        $outputName = $target['outputName'] ?? null;
        if (!is_string($outputName) || strlen($outputName) < 1 || strlen($outputName) > 128 || strpbrk($outputName, '/\\') !== false || preg_match('/[\x00-\x1f]/', $outputName)) {
            throw new ApiProblem(400, 'BUILD_OUTPUT_INVALID', 'Output name must be 1–128 characters without paths or control characters.', false, ['target.outputName' => 'Unsafe output name']);
        }
        $addressMaximum = $dialect === 'arm' ? 0x03ffffff : 0xffff;
        $origin = self::address($target['origin'] ?? null, 'target.origin', $addressMaximum);
        $maximumAddress = self::address($target['maximumAddress'] ?? null, 'target.maximumAddress', $addressMaximum);
        $minimumOrigin = $dialect === 'arm' ? 0x8000 : 0x0200;
        if ($origin < $minimumOrigin || $maximumAddress < $origin || ($dialect === 'arm' && (($origin | ($maximumAddress + 1)) & 3) !== 0)) {
            $message = $dialect === 'arm' ? 'ARM2 output must use a word-aligned range from &00008000 through the 26-bit address space.' : 'The native output range must start at or above &0200 and end at or after its origin.';
            throw new ApiProblem(400, 'BUILD_MEMORY_INVALID', $message, false, ['target.origin' => 'Invalid native output range']);
        }

        $rawFiles = $payload['files'] ?? null;
        if (!is_array($rawFiles) || !$rawFiles || count($rawFiles) > BuildLimits::FILES) {
            throw new ApiProblem(400, 'BUILD_FILES_INVALID', sprintf('Supply between 1 and %d project files.', BuildLimits::FILES), false, ['files' => 'Invalid file count']);
        }
        $files = [];
        $ids = [];
        $names = [];
        $totalBytes = 0;
        foreach (array_values($rawFiles) as $index => $raw) {
            if (!is_array($raw)) {
                throw new ApiProblem(400, 'BUILD_FILE_INVALID', 'Every project file must be an object.', false, ["files.$index" => 'Expected an object']);
            }
            $id = self::identifier($raw['id'] ?? null, "files.$index.id", 80);
            $name = self::safePath($raw['name'] ?? null, "files.$index.name");
            $content = $raw['content'] ?? null;
            if (!is_string($content) || strlen($content) > BuildLimits::FILE_BYTES) {
                throw new ApiProblem(400, 'BUILD_FILE_TOO_LARGE', sprintf('Each project file is limited to %d bytes.', BuildLimits::FILE_BYTES), false, ["files.$index.content" => 'Invalid or oversized UTF-8 content']);
            }
            if (!mb_check_encoding($content, 'UTF-8')) {
                throw new ApiProblem(400, 'BUILD_FILE_ENCODING', 'Native source files must be valid UTF-8.', false, ["files.$index.content" => 'Invalid UTF-8']);
            }
            if (isset($ids[$id]) || isset($names[strtolower($name)])) {
                throw new ApiProblem(400, 'BUILD_FILE_DUPLICATE', 'Project file IDs and names must be unique.', false, ["files.$index" => 'Duplicate file']);
            }
            $ids[$id] = $name;
            $names[strtolower($name)] = true;
            $totalBytes += strlen($content);
            if ($totalBytes > BuildLimits::TOTAL_INPUT_BYTES) {
                throw new ApiProblem(413, 'BUILD_INPUT_TOO_LARGE', sprintf('Decoded project input is limited to %d bytes.', BuildLimits::TOTAL_INPUT_BYTES));
            }
            $files[] = ['id' => $id, 'name' => $name, 'content' => $content];
        }

        $rawUnits = $payload['sourceUnitIds'] ?? null;
        if (!is_array($rawUnits) || !$rawUnits || count($rawUnits) > BuildLimits::SOURCE_UNITS) {
            throw new ApiProblem(400, 'BUILD_UNITS_INVALID', sprintf('Supply between 1 and %d source units.', BuildLimits::SOURCE_UNITS), false, ['sourceUnitIds' => 'Invalid source-unit count']);
        }
        $sourceUnitIds = [];
        foreach (array_values($rawUnits) as $index => $id) {
            if (!is_string($id) || !isset($ids[$id]) || isset($sourceUnitIds[$id])) {
                throw new ApiProblem(400, 'BUILD_UNIT_INVALID', 'Every source unit must identify one unique supplied file.', false, ["sourceUnitIds.$index" => 'Missing or duplicate file ID']);
            }
            $extensionPattern = $dialect === 'c' ? '/\.c$/i' : ($dialect === 'arm' ? '/\.(?:arm|sarm)$/i' : '/\.(?:s|asm|a65|6502)$/i');
            if (!preg_match($extensionPattern, $ids[$id])) {
                $message = $dialect === 'c' ? 'Native C source units must use .c filenames; headers are declared inputs, not translation units.' : ($dialect === 'arm' ? 'ARM source units must use .arm or .sarm filenames so they cannot be mistaken for 6502 source.' : 'Native assembly source units must use .s, .asm, .a65 or .6502 filenames.');
                throw new ApiProblem(400, 'BUILD_UNIT_EXTENSION', $message, false, ["sourceUnitIds.$index" => 'Unsupported source-unit extension']);
            }
            $sourceUnitIds[$id] = true;
        }

        $defines = [];
        $rawDefines = $payload['defines'] ?? [];
        if (!is_array($rawDefines) || count($rawDefines) > BuildLimits::DEFINES) {
            throw new ApiProblem(400, 'BUILD_DEFINES_INVALID', sprintf('At most %d numeric defines are supported.', BuildLimits::DEFINES), false, ['defines' => 'Invalid define collection']);
        }
        foreach ($rawDefines as $name => $value) {
            if (!is_string($name) || !preg_match('/^[A-Za-z_][A-Za-z0-9_]{0,63}$/', $name) || (!is_int($value) && !(is_string($value) && preg_match('/^(?:\d+|0x[0-9a-f]+|\$[0-9a-f]+)$/i', $value)))) {
                throw new ApiProblem(400, 'BUILD_DEFINE_INVALID', 'Defines must use identifier names and integer values.', false, ['defines' => 'Invalid define']);
            }
            $integer = is_int($value) ? $value : (str_starts_with(strtolower($value), '0x') ? intval(substr($value, 2), 16) : (str_starts_with($value, '$') ? intval(substr($value, 1), 16) : intval($value, 10)));
            if ($integer < -2147483648 || $integer > 4294967295) {
                throw new ApiProblem(400, 'BUILD_DEFINE_RANGE', 'Define values must fit the ca65 32-bit expression range.', false, ["defines.$name" => 'Out of range']);
            }
            $defines[$name] = $integer;
        }

        $entry = isset($target['entry']) ? self::record($target['entry'], 'target.entry') : ['mode' => 'source', 'value' => ''];
        $entryMode = $entry['mode'] ?? 'source';
        $entryValue = $entry['value'] ?? '';
        if (!is_string($entryMode) || !in_array($entryMode, ['source', 'symbol', 'address'], true) || !is_string($entryValue) || strlen($entryValue) > 128) {
            throw new ApiProblem(400, 'BUILD_ENTRY_INVALID', 'Entry point must be source, symbol or address with a bounded value.', false, ['target.entry' => 'Invalid entry declaration']);
        }
        if ($entryMode === 'symbol' && !preg_match('/^[A-Za-z_][A-Za-z0-9_.]{0,127}$/', $entryValue)) {
            throw new ApiProblem(400, 'BUILD_ENTRY_SYMBOL', 'Entry symbol is not a valid ca65 identifier.', false, ['target.entry.value' => 'Invalid symbol']);
        }
        if ($entryMode === 'address') {
            self::address($entryValue, 'target.entry.value', $addressMaximum);
        }

        /* An omitted `cache` is a request that has no opinion, which is the
         * ordinary case and must not read as a malformed one. An empty JSON
         * object decodes to the same empty array as no object at all, so the
         * two cannot be told apart here and neither is an error. */
        $cache = $payload['cache'] ?? ['bypass' => false];
        if (!is_array($cache) || (array_is_list($cache) && $cache !== [])) {
            throw new ApiProblem(400, 'BUILD_FIELD_INVALID', 'cache must be an object.', false, ['cache' => 'Expected an object']);
        }
        $bypass = $cache['bypass'] ?? false;
        if (!is_bool($bypass)) {
            throw new ApiProblem(400, 'BUILD_CACHE_BYPASS_INVALID', 'cache.bypass must be true or false.', false, ['cache.bypass' => 'Expected a boolean']);
        }

        return new self($requestId, $targetId, $machineId, $profile, $processor, $outputName, $origin, $maximumAddress, $files, array_keys($sourceUnitIds), $defines, $entryMode, $entryValue, $dialect, $profileGoal, $debugMetadata, $bypass);
    }

    /** @return array<string, mixed> */
    private static function record(mixed $value, string $field): array
    {
        if (!is_array($value) || array_is_list($value)) {
            throw new ApiProblem(400, 'BUILD_FIELD_INVALID', "$field must be an object.", false, [$field => 'Expected an object']);
        }

        return $value;
    }

    private static function identifier(mixed $value, string $field, int $maximum): string
    {
        if (!is_string($value) || strlen($value) < 1 || strlen($value) > $maximum || !preg_match('/^[A-Za-z0-9][A-Za-z0-9._:-]*$/', $value)) {
            throw new ApiProblem(400, 'BUILD_IDENTIFIER_INVALID', "$field is invalid.", false, [$field => 'Expected a bounded identifier']);
        }

        return $value;
    }

    private static function safePath(mixed $value, string $field): string
    {
        if (!is_string($value) || strlen($value) < 1 || strlen($value) > BuildLimits::PATH_BYTES || str_starts_with($value, '/') || str_contains($value, '\\') || preg_match('/[\x00-\x1f\x7f]/', $value)) {
            throw new ApiProblem(400, 'BUILD_PATH_INVALID', 'Project paths must be bounded, relative POSIX paths.', false, [$field => 'Unsafe path']);
        }
        $segments = explode('/', $value);
        if (count($segments) > BuildLimits::PATH_SEGMENTS || array_filter($segments, static fn (string $segment): bool => $segment === '' || $segment === '.' || $segment === '..' || !preg_match('/^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}$/', $segment))) {
            throw new ApiProblem(400, 'BUILD_PATH_INVALID', 'Project paths cannot contain traversal, empty or unsafe segments.', false, [$field => 'Unsafe path segment']);
        }

        return implode('/', $segments);
    }

    private static function address(mixed $value, string $field, int $maximum = 0xffff): int
    {
        if (is_int($value)) {
            $address = $value;
        } elseif (is_string($value) && preg_match('/^(?:\d+|0x[0-9a-f]+|\$[0-9a-f]+|&[0-9a-f]+)$/i', $value)) {
            $address = str_starts_with(strtolower($value), '0x') ? intval(substr($value, 2), 16) : ((str_starts_with($value, '$') || str_starts_with($value, '&')) ? intval(substr($value, 1), 16) : intval($value, 10));
        } else {
            throw new ApiProblem(400, 'BUILD_ADDRESS_INVALID', "$field must be a bounded address.", false, [$field => 'Invalid address']);
        }
        if ($address < 0 || $address > $maximum) {
            throw new ApiProblem(400, 'BUILD_ADDRESS_INVALID', "$field is outside the selected processor address range.", false, [$field => 'Address outside selected range']);
        }

        return $address;
    }
}
