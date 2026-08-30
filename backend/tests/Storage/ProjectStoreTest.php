<?php

declare(strict_types=1);

namespace App\Tests\Storage;

use App\Storage\BlobStore;
use App\Storage\ProjectStore;
use App\Storage\StorageError;
use App\Storage\StorageLimits;
use PHPUnit\Framework\TestCase;

final class ProjectStoreTest extends TestCase
{
    private string $root;
    private ProjectStore $store;
    private int $tick = 0;

    protected function setUp(): void
    {
        $this->root = sys_get_temp_dir().'/project-store-'.bin2hex(random_bytes(8));
        mkdir($this->root, 0700, true);
        $this->tick = 0;
        $this->store = new ProjectStore($this->root, new BlobStore($this->root), function (): string {
            return sprintf('2026-08-30T00:00:%02dZ', $this->tick++);
        });
    }

    protected function tearDown(): void
    {
        exec('rm -rf '.escapeshellarg($this->root));
    }

    public function testRecordsTheOwnerFromTheFirstWriteEvenThoughThereIsOnlyOne(): void
    {
        /* Authentication is deferred; whose data this is, is not. A store
         * written without an owner could not later say. */
        $revision = $this->store->commit(ProjectStore::LOCAL_OWNER, 'demo', ['main.asm' => 'RTS']);
        self::assertSame('local', $revision['owner']);
        self::assertSame('demo', $revision['projectId']);
        self::assertNull($revision['parent']);
    }

    public function testKeepsHistoryAsAChainAndRestoresARevisionByReadingIt(): void
    {
        $first = $this->store->commit('local', 'demo', ['main.asm' => 'first version']);
        $second = $this->store->commit('local', 'demo', ['main.asm' => 'second version'], $first['id']);

        self::assertSame($first['id'], $second['parent']);
        self::assertSame(['main.asm' => 'first version'], $this->store->read('local', 'demo', $first['id']));
        self::assertSame(['main.asm' => 'second version'], $this->store->read('local', 'demo', $second['id']));
    }

    public function testStoresUnchangedFilesOnceAcrossRevisions(): void
    {
        /* History over a project that barely changes should cost almost
         * nothing, which is the point of sharing content between revisions. */
        $blobs = new BlobStore($this->root);
        $first = $this->store->commit('local', 'demo', ['a.asm' => 'unchanged', 'b.asm' => 'one']);
        $this->store->commit('local', 'demo', ['a.asm' => 'unchanged', 'b.asm' => 'two'], $first['id']);
        self::assertCount(3, $blobs->digests());
    }

    public function testRefusesARevisionWrittenAgainstSomethingThatIsNoLongerTheHead(): void
    {
        /* The refusal names both, because that is what a client needs to merge
         * or fork rather than to retry blindly. */
        $first = $this->store->commit('local', 'demo', ['main.asm' => 'one']);
        $this->store->commit('local', 'demo', ['main.asm' => 'two'], $first['id']);

        $error = null;
        try { $this->store->commit('local', 'demo', ['main.asm' => 'three'], $first['id']); }
        catch (StorageError $caught) { $error = $caught; }

        self::assertNotNull($error);
        self::assertSame('REVISION_STALE_PARENT', $error->reason);
        self::assertStringContainsString($first['id'], $error->getMessage());
        self::assertStringContainsString('Read the head and merge, or fork from the parent', $error->getMessage());
    }

    public function testRefusesAFirstRevisionClaimingAParent(): void
    {
        $error = null;
        try { $this->store->commit('local', 'demo', ['main.asm' => 'one'], 'invented'); }
        catch (StorageError $caught) { $error = $caught; }
        self::assertNotNull($error);
        self::assertSame('REVISION_STALE_PARENT', $error->reason);
    }

    public function testRefusesAnEmptyRevisionRatherThanRecordingAnEmptyProject(): void
    {
        $this->expectExceptionMessageMatches('/would record that a project became empty/');
        $this->store->commit('local', 'demo', []);
    }

    public function testRefusesFilenamesThatCouldReachOutsideTheStore(): void
    {
        foreach (['../escape.asm', '/etc/passwd', 'a/../../b', '', str_repeat('x', 161)] as $name) {
            try {
                $this->store->commit('local', 'demo', [$name => 'x']);
                self::fail(sprintf('%s should have been refused.', $name));
            } catch (StorageError $error) {
                self::assertSame('FILENAME_INVALID', $error->reason, $name);
            }
        }
    }

    public function testRefusesIdentifiersThatCouldReachOutsideTheStore(): void
    {
        foreach ([['local', '../other'], ['../other', 'demo'], ['local', 'Demo'], ['local', '']] as [$owner, $project]) {
            try {
                $this->store->commit($owner, $project, ['a.asm' => 'x']);
                self::fail(sprintf('%s/%s should have been refused.', $owner, $project));
            } catch (StorageError $error) {
                self::assertSame('IDENTIFIER_INVALID', $error->reason);
            }
        }
    }

    public function testCountsWhatAnOwnerIsUsingAgainstWhatItMayUse(): void
    {
        $this->store->commit('local', 'demo', ['main.asm' => str_repeat('x', 100)]);
        $usage = $this->store->usage('local');
        self::assertSame(1, $usage['projects']);
        self::assertSame(1, $usage['revisions']);
        self::assertSame(100, $usage['bytes']);
        self::assertSame(StorageLimits::OWNER_BYTES, $usage['limits']['ownerBytes']);
    }

    public function testChargesOnlyContentTheStoreDoesNotAlreadyHold(): void
    {
        /* Naming content that is already stored costs nothing, so a quota that
         * charged for the whole request would refuse a revision that adds a
         * byte to a large project. */
        $first = $this->store->commit('local', 'demo', ['big.bin' => str_repeat('x', 1000)]);
        $before = $this->store->usage('local')['bytes'];
        $this->store->commit('local', 'demo', ['big.bin' => str_repeat('x', 1000), 'note.txt' => 'hi'], $first['id']);
        self::assertSame($before + 2, $this->store->usage('local')['bytes']);
    }

    public function testCollectsOnlyContentNoRevisionNames(): void
    {
        /* Collection that could lose history would be a worse problem than the
         * space it recovers. */
        $blobs = new BlobStore($this->root);
        $first = $this->store->commit('local', 'demo', ['main.asm' => 'kept']);
        $blobs->put('nothing names this');
        self::assertCount(2, $blobs->digests());

        $collected = $this->store->collect('local');
        self::assertSame(1, $collected['removed']);
        self::assertSame(['main.asm' => 'kept'], $this->store->read('local', 'demo', $first['id']));
    }

    public function testKeepsContentAnOlderRevisionStillNames(): void
    {
        /* The failure this guards against: collecting a blob because the head
         * no longer names it, and losing the ability to read the past. */
        $first = $this->store->commit('local', 'demo', ['main.asm' => 'original']);
        $this->store->commit('local', 'demo', ['main.asm' => 'replaced'], $first['id']);
        $this->store->collect('local');
        self::assertSame(['main.asm' => 'original'], $this->store->read('local', 'demo', $first['id']));
    }

    public function testSaysWhenARevisionIsNotThere(): void
    {
        $this->store->commit('local', 'demo', ['main.asm' => 'x']);
        $error = null;
        try { $this->store->read('local', 'demo', 'no-such-revision'); }
        catch (StorageError $caught) { $error = $caught; }
        self::assertNotNull($error);
        self::assertSame('REVISION_NOT_FOUND', $error->reason);
    }

    public function testTimestampsARevisionFromTheClockItWasGiven(): void
    {
        self::assertSame('2026-08-30T00:00:00Z', $this->store->commit('local', 'demo', ['a' => 'x'])['writtenAt']);
    }
}
