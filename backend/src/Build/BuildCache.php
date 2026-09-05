<?php

declare(strict_types=1);

namespace App\Build;

use App\Observability\StructuredLogger;

/**
 * Build results kept between requests, addressed by what produced them.
 *
 * A native build runs a real assembler in a real workspace, and the same
 * inputs through the same pinned toolchain give the same bytes every time —
 * that is a property this build already proves, and it is what makes a cache
 * possible at all. What makes one dangerous is everything around that:
 *
 *   - **A key that does not cover everything** returns somebody the output of a
 *     build they did not ask for. So the key is built from every value that
 *     reaches the toolchain — the adapter and its version, the pinned toolchain
 *     digest, the machine, the profile and its options, the processor, the
 *     origin and address ceiling, the entry point, the output name, the
 *     defines, and the name and SHA-256 of every declared input — and the entry
 *     records those inputs so a hit can be checked against the request rather
 *     than trusted because the key matched.
 *
 *   - **A shared cache is a way to read somebody else's source.** A build's
 *     output is not only bytes: the listing and dependency documents carry the
 *     source itself. Identical inputs would give identical outputs, so sharing
 *     would in principle be safe, but "in principle" is doing far too much work
 *     there — it holds only while the key covers everything, and a key is
 *     exactly the kind of thing that grows a gap. Entries are therefore
 *     partitioned by owner, and the owner is mixed into the key as well, so
 *     that two independent things have to be wrong before one tenant can be
 *     handed another's build.
 *
 *   - **A corrupt entry is worse than no entry**, because it is returned with
 *     the confidence of a build that did not happen. Every read re-hashes what
 *     it found and discards it if the bytes do not match what the entry says
 *     they are.
 *
 * The counters are kept on disk rather than in the process, because PHP-FPM
 * hands each request its own memory: an in-process hit count would report 0 or
 * 1 forever and say nothing about whether the cache was working.
 */
final class BuildCache
{
    /** Entries one owner may hold. */
    public const ENTRIES = 256;
    /** Bytes one owner's entries may occupy. */
    public const BYTES = 64 * 1024 * 1024;
    /** A single entry. Larger than an artifact, because documents are stored too. */
    public const ENTRY_BYTES = 4 * 1024 * 1024;

    /**
     * The one identity this build has.
     *
     * Nothing proves it: this is a builder on a machine somebody already
     * controls. It is carried through the cache anyway so that the partition
     * exists now and the authorisation CLD-800 will bring has something to
     * attach to, rather than a cache to migrate.
     */
    public const LOCAL_OWNER = 'local';

    public function __construct(
        private readonly string $root,
        private readonly StructuredLogger $logger,
    ) {
    }

    /**
     * A response answered from the cache, told truthfully.
     *
     * The stored envelope carries the timing of the build that produced it, and
     * returning that unchanged would report a duration this request did not
     * take. It is replaced with what the lookup actually cost, and the logs say
     * where the answer came from — a result that cannot be told from a real
     * build is one nobody can debug.
     *
     * @param array<string, mixed> $response
     *
     * @return array<string, mixed>
     */
    public function hitEnvelope(array $response, string $owner, string $key, float $durationMs): array
    {
        $result = is_array($response['result'] ?? null) ? $response['result'] : [];
        $result['cache'] = $this->manifest($owner, 'hit', 'Answered from a stored result with the same inputs, toolchain and target', $key);
        $result['timing'] = ['durationMs' => $durationMs];
        $logs = is_array($result['logs'] ?? null) ? array_values(array_filter($result['logs'], 'is_string')) : [];
        $result['logs'] = [sprintf('Cache hit · %s · no toolchain was run for this request', substr($key, 0, 16)), ...$logs];
        $response['result'] = $result;

        return $response;
    }

    /**
     * A response that was built, with what the cache did to it recorded.
     *
     * @param array<string, mixed> $response
     *
     * @return array<string, mixed>
     */
    public function storedEnvelope(array $response, string $owner, string $key, bool $bypassed): array
    {
        $result = is_array($response['result'] ?? null) ? $response['result'] : [];
        $result['cache'] = $bypassed
            ? $this->manifest($owner, 'bypassed', 'The request asked for a rebuild, so the stored result was neither read nor trusted', $key)
            : $this->manifest($owner, 'miss', 'No stored result had these inputs, toolchain and target', $key);
        $response['result'] = $result;

        return $response;
    }

    /** The address of one build's result. */
    public static function key(string $owner, string $adapterId, string $adapterVersion, string $toolchainDigest, NativeBuildRequest $request): string
    {
        $inputs = array_map(
            static fn (array $file): array => ['name' => $file['name'], 'sha256' => hash('sha256', $file['content'])],
            $request->files,
        );
        /* Sorted by name, so the same project sent in a different order is the
         * same build rather than a second entry that happens to agree. */
        usort($inputs, static fn (array $left, array $right): int => strcmp($left['name'], $right['name']));

        return hash('sha256', ToolchainManifest::canonicalJson([
            'schema' => '8bit-net.build-cache-key',
            'version' => 1,
            'owner' => $owner,
            'adapterId' => $adapterId,
            'adapterVersion' => $adapterVersion,
            'toolchainDigest' => $toolchainDigest,
            'machineId' => $request->machineId,
            'profile' => $request->profile,
            'profileGoal' => $request->profileGoal,
            'debugMetadata' => $request->debugMetadata,
            'processor' => $request->processor,
            'origin' => $request->origin,
            'maximumAddress' => $request->maximumAddress,
            'entryMode' => $request->entryMode,
            'entryValue' => $request->entryValue,
            'outputName' => $request->outputName,
            'defines' => $request->defines,
            'sourceUnitIds' => $request->sourceUnitIds,
            'inputs' => $inputs,
        ]));
    }

    /**
     * A stored result, or null when there is none to be had.
     *
     * A hit is only a hit when the entry belongs to this owner, hashes to what
     * it says it does, and names the same inputs the request carries. Anything
     * else is discarded and counted, because an entry that fails one of those
     * is not a miss — it is a fault worth being able to see.
     *
     * @param list<array{id: string, name: string, content: string}> $files
     *
     * @return array<string, mixed>|null
     */
    public function read(string $owner, string $key, array $files): ?array
    {
        $path = $this->pathFor($owner, $key);
        $raw = is_file($path) ? @file_get_contents($path) : false;
        if ($raw === false) {
            $this->count($owner, 'misses');

            return null;
        }
        $entry = json_decode($raw, true);
        if (!is_array($entry) || !$this->intact($entry, $owner, $key, $files)) {
            @unlink($path);
            $this->count($owner, 'corruptions');
            $this->logger->warning('build-cache-entry-rejected', ['keyPrefix' => substr($key, 0, 16), 'bytes' => strlen($raw)]);

            return null;
        }
        /* Touched on every hit, because eviction is by least recently used and
         * a cache that evicted by age alone would throw away the entry it was
         * about to be asked for again. */
        @touch($path);
        $this->count($owner, 'hits');
        $response = $entry['response'];

        return is_array($response) ? $response : null;
    }

    /**
     * Keep one result.
     *
     * @param list<array{id: string, name: string, content: string}> $files
     * @param array<string, mixed>                                   $response
     */
    public function write(string $owner, string $key, array $files, array $response): void
    {
        $entry = [
            'schema' => '8bit-net.build-cache-entry',
            'version' => 1,
            'owner' => $owner,
            'key' => $key,
            'inputs' => $this->inputDigests($files),
            'response' => $response,
        ];
        $entry['payloadSha256'] = hash('sha256', ToolchainManifest::canonicalJson($entry['response']));
        $encoded = json_encode($entry, JSON_UNESCAPED_SLASHES);
        if ($encoded === false || strlen($encoded) > self::ENTRY_BYTES) {
            /* Not an error. A build whose documents are larger than an entry may
             * be is simply one this cache does not keep, and saying so is more
             * useful than storing a truncated one. */
            $this->logger->info('build-cache-entry-too-large', ['keyPrefix' => substr($key, 0, 16), 'limitBytes' => self::ENTRY_BYTES]);

            return;
        }
        $path = $this->pathFor($owner, $key);
        $directory = dirname($path);
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            $this->logger->warning('build-cache-directory-unavailable', ['keyPrefix' => substr($key, 0, 16)]);

            return;
        }
        /* Written beside and renamed, so a reader never meets a half-written
         * entry and a crash leaves the previous one intact. */
        $temporary = $path.'.'.bin2hex(random_bytes(8));
        if (file_put_contents($temporary, $encoded, LOCK_EX) !== strlen($encoded) || !rename($temporary, $path)) {
            @unlink($temporary);
            $this->logger->warning('build-cache-write-failed', ['keyPrefix' => substr($key, 0, 16)]);

            return;
        }
        $this->evict($owner);
    }

    /**
     * What this owner's cache holds and has done, for the build result envelope.
     *
     * @return array{status: string, reason: string, key: string, entries: int, bytes: int, hits: int, misses: int, corruptions: int, evictions: int}
     */
    public function manifest(string $owner, string $status, string $reason, string $key): array
    {
        $entries = $this->entries($owner);

        return [
            'status' => $status,
            'reason' => $reason,
            'key' => $key,
            'entries' => count($entries),
            'bytes' => array_sum(array_column($entries, 'bytes')),
            ...$this->counters($owner),
        ];
    }

    /** Everything this owner holds, removed. */
    public function clear(string $owner): int
    {
        $removed = 0;
        foreach ($this->entries($owner) as $entry) {
            if (@unlink($entry['path'])) {
                ++$removed;
            }
        }
        @unlink($this->countersPath($owner));

        return $removed;
    }

    /**
     * @param array<string, mixed>                                   $entry
     * @param list<array{id: string, name: string, content: string}> $files
     */
    private function intact(array $entry, string $owner, string $key, array $files): bool
    {
        if (($entry['schema'] ?? null) !== '8bit-net.build-cache-entry' || ($entry['version'] ?? null) !== 1) {
            return false;
        }
        /* The owner is in the path and in the key already. Checked a third time
         * here because the cost is one comparison and the failure it guards
         * against is handing one tenant another's source. */
        if (($entry['owner'] ?? null) !== $owner || ($entry['key'] ?? null) !== $key) {
            return false;
        }
        $response = $entry['response'] ?? null;
        if (!is_array($response) || !is_string($entry['payloadSha256'] ?? null)) {
            return false;
        }
        if (!hash_equals($entry['payloadSha256'], hash('sha256', ToolchainManifest::canonicalJson($response)))) {
            return false;
        }
        /* The inputs are checked against the request rather than assumed from
         * the key matching, so a key that failed to cover something cannot
         * quietly return the wrong build. */
        $recorded = $entry['inputs'] ?? null;

        return is_array($recorded) && $recorded === $this->inputDigests($files);
    }

    /**
     * @param list<array{id: string, name: string, content: string}> $files
     *
     * @return list<array{name: string, sha256: string}>
     */
    private function inputDigests(array $files): array
    {
        $digests = array_map(
            static fn (array $file): array => ['name' => $file['name'], 'sha256' => hash('sha256', $file['content'])],
            $files,
        );
        usort($digests, static fn (array $left, array $right): int => strcmp($left['name'], $right['name']));

        return $digests;
    }

    /** @return list<array{path: string, bytes: int, usedAt: int}> */
    private function entries(string $owner): array
    {
        $found = [];
        foreach (glob($this->ownerRoot($owner).'/*/*.json') ?: [] as $path) {
            $size = @filesize($path);
            $used = @filemtime($path);
            if ($size === false || $used === false) {
                continue;
            }
            $found[] = ['path' => $path, 'bytes' => $size, 'usedAt' => $used];
        }

        return $found;
    }

    private function evict(string $owner): void
    {
        $entries = $this->entries($owner);
        $bytes = array_sum(array_column($entries, 'bytes'));
        if (count($entries) <= self::ENTRIES && $bytes <= self::BYTES) {
            return;
        }
        usort($entries, static fn (array $left, array $right): int => $left['usedAt'] <=> $right['usedAt']);
        $evicted = 0;
        while ($entries !== [] && (count($entries) > self::ENTRIES || $bytes > self::BYTES)) {
            $oldest = array_shift($entries);
            if (@unlink($oldest['path'])) {
                $bytes -= $oldest['bytes'];
                ++$evicted;
            }
        }
        if ($evicted > 0) {
            $this->count($owner, 'evictions', $evicted);
        }
    }

    private function ownerRoot(string $owner): string
    {
        /* Hashed rather than used as a path component: an owner is a caller-
         * supplied name, and a name that is a path is a traversal waiting to
         * be found. */
        return $this->root.'/build-cache/'.hash('sha256', $owner);
    }

    private function pathFor(string $owner, string $key): string
    {
        return sprintf('%s/%s/%s.json', $this->ownerRoot($owner), substr($key, 0, 2), $key);
    }

    private function countersPath(string $owner): string
    {
        return $this->ownerRoot($owner).'/counters.json';
    }

    /** @return array{hits: int, misses: int, corruptions: int, evictions: int} */
    private function counters(string $owner): array
    {
        $raw = @file_get_contents($this->countersPath($owner));
        $decoded = $raw === false ? null : json_decode($raw, true);
        $stored = is_array($decoded) ? $decoded : [];

        return [
            'hits' => (int) ($stored['hits'] ?? 0),
            'misses' => (int) ($stored['misses'] ?? 0),
            'corruptions' => (int) ($stored['corruptions'] ?? 0),
            'evictions' => (int) ($stored['evictions'] ?? 0),
        ];
    }

    private function count(string $owner, string $counter, int $by = 1): void
    {
        $directory = $this->ownerRoot($owner);
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            return;
        }
        $path = $this->countersPath($owner);
        $handle = @fopen($path, 'c+');
        if ($handle === false) {
            return;
        }
        try {
            if (!flock($handle, LOCK_EX)) {
                return;
            }
            $raw = stream_get_contents($handle);
            $decoded = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
            $counters = is_array($decoded) ? $decoded : [];
            $counters[$counter] = (int) ($counters[$counter] ?? 0) + $by;
            $encoded = json_encode($counters);
            if ($encoded !== false) {
                rewind($handle);
                ftruncate($handle, 0);
                fwrite($handle, $encoded);
                fflush($handle);
            }
            flock($handle, LOCK_UN);
        } finally {
            fclose($handle);
        }
    }
}
