<?php

declare(strict_types=1);

namespace App\Tests\Storage;

use App\Storage\BlobStore;
use App\Storage\ProjectStore;
use App\Storage\StoreIntegrity;
use PHPUnit\Framework\TestCase;

/**
 * The disaster-recovery exercise, run rather than described.
 *
 * A restore procedure written down and never performed is a belief. This
 * performs it: a store is built, copied, destroyed, restored from the copy, and
 * then read back and compared byte for byte against what was written — because
 * a restore that produces a store which merely opens is not a restore, and the
 * question is whether the content came back.
 *
 * The integrity pass is the other half. The store addresses content by its
 * SHA-256, so damage is detectable rather than only suspectable, and a corrupt
 * blob copies into a backup exactly as readily as a sound one and looks
 * identical until something reads it. So the exercise also damages a store on
 * purpose and requires the verifier to name what it damaged.
 */
final class StoreRecoveryTest extends TestCase
{
    private string $root;
    private string $backup;
    private ProjectStore $store;
    private int $tick = 0;

    protected function setUp(): void
    {
        $this->root = sys_get_temp_dir().'/store-recovery-'.bin2hex(random_bytes(8));
        $this->backup = $this->root.'-backup';
        mkdir($this->root, 0700, true);
        $this->tick = 0;
        $this->store = new ProjectStore($this->root, new BlobStore($this->root), function (): string {
            return sprintf('2026-09-01T00:00:%02dZ', $this->tick++);
        });
    }

    protected function tearDown(): void
    {
        foreach ([$this->root, $this->backup] as $path) $this->removeTree($path);
    }

    /** @return array<string, array<string, string>> project to files, as written */
    private function seed(): array
    {
        $written = [];
        foreach (['first-project', 'second-project'] as $projectId) {
            $files = [
                'main.asm' => "\\ $projectId entry\norg &1900\nlda #&42\nrts\n",
                'notes/readme.txt' => "Notes for $projectId.\n",
            ];
            $first = $this->store->commit(ProjectStore::LOCAL_OWNER, $projectId, $files, null, 'first');
            /* A second revision over shared content, so the exercise covers the
             * thing that makes history cheap: one changed file, one new blob,
             * and the rest of the manifest pointing at what was already there. */
            $files['main.asm'] .= "; revised\n";
            $this->store->commit(ProjectStore::LOCAL_OWNER, $projectId, $files, (string) $first['id'], 'second');
            $written[$projectId] = $files;
        }

        return $written;
    }

    private function copyTree(string $from, string $to): void
    {
        mkdir($to, 0700, true);
        foreach (scandir($from) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') continue;
            $source = $from.'/'.$entry;
            if (is_dir($source)) $this->copyTree($source, $to.'/'.$entry);
            else copy($source, $to.'/'.$entry);
        }
    }

    private function removeTree(string $path): void
    {
        if (!is_dir($path)) return;
        foreach (scandir($path) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') continue;
            $child = $path.'/'.$entry;
            is_dir($child) ? $this->removeTree($child) : unlink($child);
        }
        rmdir($path);
    }

    public function testAStoreIsBackedUpDestroyedAndRestoredWithEveryByteIntact(): void
    {
        $written = $this->seed();
        $before = (new StoreIntegrity($this->root, new BlobStore($this->root)))->verify();
        self::assertSame([], $before['findings'], 'the store was already damaged before the exercise began');
        self::assertSame(2, $before['projects']);
        self::assertSame(4, $before['revisions']);

        /* The backup. A file-level copy is the procedure, and it is honest here
         * because a blob is written beside its name and renamed into place, so
         * a copy never catches a partial one. */
        $backupStarted = microtime(true);
        $this->copyTree($this->root, $this->backup);
        $backupSeconds = microtime(true) - $backupStarted;

        /* The disaster. Not a deletion of one file: the whole store. */
        $this->removeTree($this->root);
        self::assertDirectoryDoesNotExist($this->root);

        $restoreStarted = microtime(true);
        $this->copyTree($this->backup, $this->root);
        $restored = new ProjectStore($this->root, new BlobStore($this->root));
        $after = (new StoreIntegrity($this->root, new BlobStore($this->root)))->verify();
        $restoreSeconds = microtime(true) - $restoreStarted;

        self::assertSame([], $after['findings'], 'the restored store did not verify');
        self::assertSame($before['projects'], $after['projects']);
        self::assertSame($before['revisions'], $after['revisions']);
        self::assertSame($before['blobs'], $after['blobs']);
        self::assertSame($before['blobBytes'], $after['blobBytes']);

        /* What was actually asked: not that it opens, but that the content came
         * back. Every project, every revision, every file, compared against
         * what was written. */
        self::assertSame(['first-project', 'second-project'], $restored->projects(ProjectStore::LOCAL_OWNER));
        foreach ($written as $projectId => $files) {
            $revisions = $restored->revisions(ProjectStore::LOCAL_OWNER, $projectId);
            self::assertCount(2, $revisions);
            $latest = $restored->read(ProjectStore::LOCAL_OWNER, $projectId, (string) $revisions[1]['id']);
            self::assertSame($files, $latest, "$projectId did not come back as it was written");
        }

        /* Recorded rather than asserted against a threshold: what a recovery
         * objective needs is a measurement from a real run, and a threshold
         * fixed here would only be measuring this machine. */
        self::assertGreaterThan(0, $backupSeconds);
        self::assertGreaterThan(0, $restoreSeconds);
    }

    public function testTheVerifierNamesCorruptionRatherThanPassingItOn(): void
    {
        $this->seed();
        $blobs = new BlobStore($this->root);
        $digests = $blobs->digests();
        self::assertNotEmpty($digests);

        /* Damage that a copy would carry into a backup unremarked: the file is
         * still there and still the right length, and only re-hashing finds it. */
        $victim = $digests[0];
        $path = sprintf('%s/blobs/%s/%s/%s', $this->root, substr($victim, 0, 2), substr($victim, 2, 2), $victim);
        $bytes = (string) file_get_contents($path);
        file_put_contents($path, str_repeat('X', strlen($bytes)));

        $report = (new StoreIntegrity($this->root, $blobs))->verify();
        self::assertNotSame([], $report['findings']);
        self::assertStringContainsString($victim, implode("\n", $report['findings']));
        self::assertStringContainsString('no longer hashes to it', implode("\n", $report['findings']));
    }

    public function testTheVerifierNamesARevisionWhoseContentIsMissing(): void
    {
        $this->seed();
        $blobs = new BlobStore($this->root);
        $digests = $blobs->digests();
        $blobs->forget($digests[0]);

        $report = (new StoreIntegrity($this->root, $blobs))->verify();
        self::assertNotSame([], $report['findings']);
        self::assertStringContainsString('can no longer be read', implode("\n", $report['findings']));
    }

    public function testTheVerifierNamesARevisionFileThatIsNoLongerReadable(): void
    {
        $this->seed();
        $revisions = glob($this->root.'/owners/local/projects/first-project/revisions/*.json') ?: [];
        self::assertNotEmpty($revisions);
        /* Truncated rather than deleted, which is what an interrupted write or
         * a full disk leaves behind. The store's own reader skips a file it
         * cannot decode, so without this pass the revision would simply cease
         * to exist with nothing said. */
        file_put_contents($revisions[0], '{"schema":"8bit-net.project-revision"');

        $report = (new StoreIntegrity($this->root, new BlobStore($this->root)))->verify();
        self::assertNotSame([], $report['findings']);
        self::assertStringContainsString('is not a readable revision', implode("\n", $report['findings']));
    }

    public function testAnIntactStoreReportsNothingWrongAndCountsWhatItHolds(): void
    {
        $this->seed();
        $report = (new StoreIntegrity($this->root, new BlobStore($this->root)))->verify();
        self::assertSame([], $report['findings']);
        self::assertSame(1, $report['owners']);
        self::assertSame(8, $report['files'], 'two projects, two revisions each, two files each');
        self::assertSame($report['blobs'], $report['referenced'], 'nothing unreferenced in a store nothing has deleted from');
        self::assertSame([], $report['unreferenced']);
        self::assertGreaterThan(0, $report['blobBytes']);
    }
}
