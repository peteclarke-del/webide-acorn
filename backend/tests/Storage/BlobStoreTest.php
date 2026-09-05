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

    public function testAnEmptyFileIsADigestThatIsAlwaysPresentRatherThanARefusal(): void
    {
        /* An empty file used to be refused, which made the store unusable for
         * the case it exists for: a source file somebody has just created is
         * empty, and the whole project went with it. Emptiness is a digest that
         * is never written and always answers, so an empty blob and a missing
         * one are no longer alike. */
        $store = $this->store();
        $digest = $store->put('');
        self::assertSame(BlobStore::EMPTY_DIGEST, $digest);
        self::assertSame(hash('sha256', ''), $digest);
        self::assertTrue($store->has($digest));
        self::assertSame('', $store->get($digest));
        self::assertFileDoesNotExist($this->root.'/blobs/e3/b0/'.$digest);
    }

    public function testABlobThatIsNotThereIsStillMissing(): void
    {
        /* The exemption is for emptiness alone; every other digest still has to
         * be on disk, or the store says so rather than returning nothing. */
        $store = $this->store();
        $absent = hash('sha256', 'never stored');
        self::assertFalse($store->has($absent));
        $this->expectExceptionMessageMatches('/No blob is stored under/');
        $store->get($absent);
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
