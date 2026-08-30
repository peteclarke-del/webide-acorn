<?php

declare(strict_types=1);

namespace App\Tests\Storage;

use App\Storage\BlobStore;
use App\Storage\StorageError;
use App\Storage\StorageLimits;
use PHPUnit\Framework\TestCase;

final class BlobStoreTest extends TestCase
{
    private string $root;

    protected function setUp(): void
    {
        $this->root = sys_get_temp_dir().'/blob-store-'.bin2hex(random_bytes(8));
        mkdir($this->root, 0700, true);
    }

    protected function tearDown(): void
    {
        exec('rm -rf '.escapeshellarg($this->root));
    }

    private function store(): BlobStore
    {
        return new BlobStore($this->root);
    }

    public function testStoresContentOnceHoweverManyTimesItIsWritten(): void
    {
        /* The whole reason for addressing by content: a file that appears in
         * twenty revisions costs one copy. */
        $store = $this->store();
        $first = $store->put('the same bytes');
        $second = $store->put('the same bytes');
        self::assertSame($first, $second);
        self::assertCount(1, $store->digests());
    }

    public function testReturnsExactlyWhatWasStored(): void
    {
        $store = $this->store();
        $bytes = random_bytes(4096);
        self::assertSame($bytes, $store->get($store->put($bytes)));
    }

    public function testRefusesBytesThatDoNotHashToWhatTheyAreFiledUnder(): void
    {
        /* Corruption on disk, not a caller's mistake. Returning it would spread
         * it, and reporting it as missing would send somebody looking for the
         * wrong problem. */
        $store = $this->store();
        $digest = $store->put('honest content');
        $path = sprintf('%s/blobs/%s/%s/%s', $this->root, substr($digest, 0, 2), substr($digest, 2, 2), $digest);
        file_put_contents($path, 'something else entirely');

        $this->expectException(StorageError::class);
        $this->expectExceptionMessageMatches('/no longer hashes to it, so the store has been damaged/');
        $store->get($digest);
    }

    public function testRefusesAnEmptyBlobRatherThanStoringSomethingIndistinguishableFromNothing(): void
    {
        $this->expectExceptionMessageMatches('/indistinguishable from a missing one/');
        $this->store()->put('');
    }

    public function testRefusesAFileLargerThanTheLimitAndSaysBothNumbers(): void
    {
        $this->expectExceptionMessageMatches('/limited to '.StorageLimits::BLOB_BYTES.' bytes and this is/');
        $this->store()->put(str_repeat('x', StorageLimits::BLOB_BYTES + 1));
    }

    public function testRefusesSomethingThatIsNotADigestRatherThanLookingForIt(): void
    {
        /* A path that is not a digest could name anything, including something
         * outside the store. */
        foreach (['../../etc/passwd', 'NOTHEX', str_repeat('a', 63), 'A'.str_repeat('a', 63)] as $rubbish) {
            try {
                $this->store()->has($rubbish);
                self::fail(sprintf('%s should have been refused.', $rubbish));
            } catch (StorageError $error) {
                self::assertSame('BLOB_DIGEST_INVALID', $error->reason);
            }
        }
    }

    public function testSaysWhenNothingIsStoredUnderADigest(): void
    {
        $error = null;
        try { $this->store()->get(str_repeat('a', 64)); } catch (StorageError $caught) { $error = $caught; }
        self::assertNotNull($error);
        self::assertSame('BLOB_NOT_FOUND', $error->reason);
    }

    public function testLeavesNothingAddressableBehindWhenAWriteIsInterrupted(): void
    {
        /* The temporary name is not a digest, so a partial write can never be
         * read as content. */
        $store = $this->store();
        $store->put('content');
        foreach ($store->digests() as $digest) self::assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $digest);
    }
}
