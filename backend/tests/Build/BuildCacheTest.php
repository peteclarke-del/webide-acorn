<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\BuildCache;
use App\Build\NativeBuildRequest;
use App\Tests\LogRecorder;
use PHPUnit\Framework\TestCase;

/**
 * What the build cache may and may not do.
 *
 * A cache is the one component whose failures all look like successes: it
 * returns something, quickly, with the confidence of a build that never
 * happened. So most of these are about the ways it must refuse.
 */
final class BuildCacheTest extends TestCase
{
    private string $root;

    private LogRecorder $log;

    private BuildCache $cache;

    protected function setUp(): void
    {
        $this->root = sys_get_temp_dir().'/build-cache-test-'.bin2hex(random_bytes(8));
        $this->log = new LogRecorder();
        $this->cache = new BuildCache($this->root, $this->log->logger);
    }

    protected function tearDown(): void
    {
        exec('rm -rf '.escapeshellarg($this->root));
    }

    /** @param array<string, mixed> $overrides */
    private function request(string $source = 'LDA #0', array $overrides = []): NativeBuildRequest
    {
        $payload = NativeBuildRequestTest::payload($source);
        foreach ($overrides as $path => $value) {
            $keys = explode('.', $path);
            $cursor = &$payload;
            foreach ($keys as $key) {
                if (!isset($cursor[$key]) || !is_array($cursor[$key])) {
                    $cursor[$key] = [];
                }
                $cursor = &$cursor[$key];
            }
            $cursor = $value;
            unset($cursor);
        }

        return NativeBuildRequest::fromArray($payload);
    }

    /** @return list<array{id: string, name: string, content: string}> */
    private function files(NativeBuildRequest $request): array
    {
        return $request->files;
    }

    private function key(NativeBuildRequest $request, string $owner = BuildCache::LOCAL_OWNER, string $digest = 'toolchain-1'): string
    {
        return BuildCache::key($owner, 'test.adapter', '1.0.0', $digest, $request);
    }

    /** @return array<string, mixed> */
    private function response(string $marker = 'built'): array
    {
        return ['schema' => '8bit-net.native-build-response', 'version' => 1, 'result' => ['logs' => [$marker], 'timing' => ['durationMs' => 1234.5]], 'artifact' => ['bytesBase64' => 'AAEC']];
    }

    public function testReturnsWhatItStoredForTheSameBuild(): void
    {
        $request = $this->request();
        $key = $this->key($request);
        $this->cache->write(BuildCache::LOCAL_OWNER, $key, $this->files($request), $this->response());

        $hit = $this->cache->read(BuildCache::LOCAL_OWNER, $key, $this->files($request));
        self::assertNotNull($hit);
        self::assertSame('AAEC', $hit['artifact']['bytesBase64']);
    }

    public function testEveryValueThatReachesTheToolchainChangesTheKey(): void
    {
        /*
         * A key that missed any of these would hand somebody the output of a
         * build they did not ask for, and the output would look right.
         */
        $base = $this->key($this->request());
        $different = [
            'the source' => $this->key($this->request('LDA #1')),
            'the toolchain' => $this->key($this->request(), BuildCache::LOCAL_OWNER, 'toolchain-2'),
            'the owner' => $this->key($this->request(), 'somebody-else'),
            'the machine' => $this->key($this->request('LDA #0', ['target.machineId' => 'master'])),
            'the profile' => $this->key($this->request('LDA #0', ['target.profile' => 'size'])),
            'the origin' => $this->key($this->request('LDA #0', ['target.origin' => 0x2000])),
            'the output name' => $this->key($this->request('LDA #0', ['target.outputName' => 'other.bin'])),
        ];
        foreach ($different as $what => $key) {
            self::assertNotSame($base, $key, "Changing $what did not change the cache key.");
        }
        /* And the same build twice is the same key, or nothing is ever a hit. */
        self::assertSame($base, $this->key($this->request()));
    }

    public function testWillNotHandOneOwnerAnothersBuild(): void
    {
        /*
         * A build's documents carry the source itself, so a cache that crossed
         * owners would be a way to read somebody else's program. Two things
         * stop it: the entry is stored under the owner, and the owner is in
         * the key. Both are checked here, the second by asking for the first
         * owner's key while claiming to be the second.
         */
        $request = $this->request();
        $mine = $this->key($request, 'me');
        $this->cache->write('me', $mine, $this->files($request), $this->response('mine'));

        self::assertNull($this->cache->read('you', $mine, $this->files($request)), 'A cache entry was readable by another owner.');
        self::assertNull($this->cache->read('you', $this->key($request, 'you'), $this->files($request)));
        self::assertNotNull($this->cache->read('me', $mine, $this->files($request)));
    }

    public function testRefusesAnEntryWhoseInputsAreNotTheOnesBeingBuilt(): void
    {
        /*
         * The key matching is not the claim; the inputs matching is. This is
         * what a key with a gap in it would look like from the inside, and the
         * entry has to be refused rather than returned because a hash agreed.
         */
        $request = $this->request();
        $key = $this->key($request);
        $this->cache->write(BuildCache::LOCAL_OWNER, $key, $this->files($request), $this->response());

        $other = $this->files($this->request('LDA #9'));
        self::assertNull($this->cache->read(BuildCache::LOCAL_OWNER, $key, $other));
    }

    public function testRejectsAnEntryWhoseBytesAreNotWhatItSaysTheyAre(): void
    {
        /* Corruption is worse than absence, because it is returned with the
         * confidence of a build that did not happen. */
        $request = $this->request();
        $key = $this->key($request);
        $this->cache->write(BuildCache::LOCAL_OWNER, $key, $this->files($request), $this->response());

        $path = $this->entryPath($key);
        $entry = json_decode((string) file_get_contents($path), true);
        $entry['response']['artifact']['bytesBase64'] = 'Zm9yZ2Vk';
        file_put_contents($path, (string) json_encode($entry));

        self::assertNull($this->cache->read(BuildCache::LOCAL_OWNER, $key, $this->files($request)));
        self::assertFileDoesNotExist($path, 'A corrupt entry was left where it could be found again.');
        $rejections = array_values(array_filter($this->log->records(), static fn (array $record): bool => ($record['event'] ?? '') === 'build-cache-entry-rejected'));
        self::assertCount(1, $rejections);
        self::assertSame(1, $this->cache->manifest(BuildCache::LOCAL_OWNER, 'miss', 'x', $key)['corruptions']);
    }

    public function testCountsWhatItDidAcrossRequests(): void
    {
        /*
         * On disk rather than in the process. Each request gets its own memory,
         * so an in-process counter would report 0 or 1 forever and say nothing
         * about whether the cache was working at all.
         */
        $request = $this->request();
        $key = $this->key($request);
        $this->cache->read(BuildCache::LOCAL_OWNER, $key, $this->files($request));
        $this->cache->write(BuildCache::LOCAL_OWNER, $key, $this->files($request), $this->response());
        $this->cache->read(BuildCache::LOCAL_OWNER, $key, $this->files($request));
        $this->cache->read(BuildCache::LOCAL_OWNER, $key, $this->files($request));

        $fresh = new BuildCache($this->root, $this->log->logger);
        $manifest = $fresh->manifest(BuildCache::LOCAL_OWNER, 'hit', 'reason', $key);
        self::assertSame(['hits' => 2, 'misses' => 1, 'corruptions' => 0, 'evictions' => 0], array_intersect_key($manifest, array_flip(['hits', 'misses', 'corruptions', 'evictions'])));
        self::assertSame(1, $manifest['entries']);
        self::assertGreaterThan(0, $manifest['bytes']);
        self::assertSame($key, $manifest['key']);
    }

    public function testTellsAHitFromABuildInWhatItReports(): void
    {
        /*
         * The stored envelope carries the timing of the build that made it.
         * Returning that unchanged would report a duration this request did not
         * take, and a cached result nobody can tell from a real one is one
         * nobody can debug.
         */
        $told = $this->cache->hitEnvelope($this->response('the original build'), BuildCache::LOCAL_OWNER, str_repeat('a', 64), 0.25);
        self::assertSame('hit', $told['result']['cache']['status']);
        self::assertSame(0.25, $told['result']['timing']['durationMs']);
        self::assertStringContainsString('no toolchain was run for this request', $told['result']['logs'][0]);
        self::assertContains('the original build', $told['result']['logs']);

        $built = $this->cache->storedEnvelope($this->response(), BuildCache::LOCAL_OWNER, str_repeat('a', 64), false);
        self::assertSame('miss', $built['result']['cache']['status']);
        self::assertSame(1234.5, $built['result']['timing']['durationMs']);

        $forced = $this->cache->storedEnvelope($this->response(), BuildCache::LOCAL_OWNER, str_repeat('a', 64), true);
        self::assertSame('bypassed', $forced['result']['cache']['status']);
        self::assertStringContainsString('asked for a rebuild', $forced['result']['cache']['reason']);
    }

    public function testEvictsTheLeastRecentlyUsedWhenItIsFull(): void
    {
        /*
         * Least recently *used*, not oldest written. A cache that evicted by
         * age alone would throw away the entry it was about to be asked for
         * again, which is the one thing a cache exists to avoid.
         *
         * The times are set rather than waited for. A file's modification time
         * has one-second resolution, so entries written in the same second are
         * indistinguishable by age and a test that relied on the order they
         * were written in would be asserting nothing.
         */
        $requests = [];
        for ($index = 0; $index < BuildCache::ENTRIES; ++$index) {
            $request = $this->request("LDA #$index");
            $key = $this->key($request);
            $requests[$index] = [$request, $key];
            $this->cache->write(BuildCache::LOCAL_OWNER, $key, $this->files($request), $this->response());
        }
        self::assertSame(BuildCache::ENTRIES, $this->cache->manifest(BuildCache::LOCAL_OWNER, 'miss', 'x', 'k')['entries']);

        /* Entry 0 used most recently, entry 1 least. */
        $now = time();
        foreach ($requests as $index => [, $key]) {
            touch($this->entryPath($key), $index === 0 ? $now : $now - (BuildCache::ENTRIES - $index));
        }

        $overflow = $this->request('LDA #999');
        $overflowKey = $this->key($overflow);
        $this->cache->write(BuildCache::LOCAL_OWNER, $overflowKey, $this->files($overflow), $this->response());

        $manifest = $this->cache->manifest(BuildCache::LOCAL_OWNER, 'miss', 'x', 'k');
        self::assertSame(BuildCache::ENTRIES, $manifest['entries']);
        self::assertSame(1, $manifest['evictions']);

        [$kept, $keptKey] = $requests[0];
        self::assertNotNull($this->cache->read(BuildCache::LOCAL_OWNER, $keptKey, $this->files($kept)), 'The most recently used entry was evicted.');
        [$dropped, $droppedKey] = $requests[1];
        self::assertNull($this->cache->read(BuildCache::LOCAL_OWNER, $droppedKey, $this->files($dropped)), 'The least recently used entry survived.');
        self::assertNotNull($this->cache->read(BuildCache::LOCAL_OWNER, $overflowKey, $this->files($overflow)));
    }

    public function testKeepsNothingItCannotHoldWhole(): void
    {
        /* A build whose documents exceed an entry is simply one this cache does
         * not keep. Storing a truncated one would be a corruption it created
         * itself. */
        $request = $this->request();
        $key = $this->key($request);
        $enormous = $this->response();
        $enormous['artifact']['bytesBase64'] = str_repeat('A', BuildCache::ENTRY_BYTES + 1);
        $this->cache->write(BuildCache::LOCAL_OWNER, $key, $this->files($request), $enormous);

        self::assertNull($this->cache->read(BuildCache::LOCAL_OWNER, $key, $this->files($request)));
        self::assertNotSame([], array_values(array_filter($this->log->records(), static fn (array $record): bool => ($record['event'] ?? '') === 'build-cache-entry-too-large')));
    }

    public function testAnOwnerNameCannotBecomeAPath(): void
    {
        /* An owner is a caller-supplied name, and a name used as a path
         * component is a traversal waiting to be found. */
        $request = $this->request();
        $key = $this->key($request, '../../escape');
        $this->cache->write('../../escape', $key, $this->files($request), $this->response());

        self::assertNotNull($this->cache->read('../../escape', $key, $this->files($request)));
        self::assertSame([], glob($this->root.'/../../escape') ?: []);
        self::assertDirectoryExists($this->root.'/build-cache/'.hash('sha256', '../../escape'));
    }

    private function entryPath(string $key): string
    {
        return sprintf('%s/build-cache/%s/%s/%s.json', $this->root, hash('sha256', BuildCache::LOCAL_OWNER), substr($key, 0, 2), $key);
    }
}
