<?php

declare(strict_types=1);

namespace App\Tests\Storage;

use App\Storage\BlobStore;
use App\Storage\ProjectStore;
use App\Storage\StorageError;
use PHPUnit\Framework\TestCase;

/**
 * What the store says when it cannot write.
 *
 * The code always meant to answer PROJECT_UNWRITABLE or BLOB_UNWRITABLE, which
 * the controller renders as a refusal somebody can act on. It did not, because
 * PHP's mkdir and file_put_contents raise a warning before returning false, and
 * a warning is promoted to an exception in the development environment. So a
 * store pointed at a directory it could not write — which is what happens when
 * the backend runs outside its container and nothing sets PROJECT_STORE_ROOT —
 * answered a five-hundred page of PHP internals instead of saying that the
 * store could not be written to, and where.
 */
final class UnwritableStoreTest extends TestCase
{
    private string $root;

    protected function setUp(): void
    {
        $this->root = sys_get_temp_dir().'/unwritable-store-'.bin2hex(random_bytes(8));
        mkdir($this->root, 0500, true);
        if (is_writable($this->root)) {
            /* Running as root defeats a permission bit, so the unwritable place
             * is one that cannot exist instead: a directory under a file. */
            exec('rm -rf '.escapeshellarg($this->root));
            $blocker = $this->root;
            file_put_contents($blocker, "not a directory\n");
            $this->root = $blocker.'/inside';
        }
    }

    protected function tearDown(): void
    {
        $base = str_ends_with($this->root, '/inside') ? substr($this->root, 0, -7) : $this->root;
        @chmod($base, 0700);
        exec('rm -rf '.escapeshellarg($base));
    }

    private function store(): ProjectStore
    {
        return new ProjectStore($this->root, new BlobStore($this->root), static fn (): string => '2026-09-02T00:00:00Z');
    }

    public function testACommitSaysTheStoreCouldNotBeWrittenToRatherThanRaisingAWarning(): void
    {
        $this->expectException(StorageError::class);
        try {
            $this->store()->commit(ProjectStore::LOCAL_OWNER, 'demo', ['main.asm' => 'RTS']);
        } catch (StorageError $error) {
            self::assertContains($error->reason, ['PROJECT_UNWRITABLE', 'BLOB_UNWRITABLE']);
            self::assertStringContainsString('could not be written to at ', $error->getMessage());
            /* The path is named, because "could not be written to" without
             * saying where is not something anybody can act on. */
            self::assertStringContainsString($this->root, $error->getMessage());
            throw $error;
        }
    }

    public function testTheRefusalIsTheOnlyThingRaised(): void
    {
        /* Every diagnostic PHP raises while the store refuses is collected. An
         * unsuppressed warning here is exactly what Symfony promoted into the
         * five-hundred page of PHP internals that hid the store's own answer,
         * so the list has to come back empty. The handler respects suppression
         * because a warning the code has already dealt with is not a defect. */
        $raised = [];
        set_error_handler(static function (int $severity, string $message) use (&$raised): bool {
            if (error_reporting() & $severity) $raised[] = $message;
            return true;
        });
        try {
            $this->store()->commit(ProjectStore::LOCAL_OWNER, 'demo', ['main.asm' => 'RTS']);
            self::fail('The store accepted a commit it could not have written');
        } catch (StorageError $error) {
            self::assertNotSame('', $error->reason);
        } finally {
            restore_error_handler();
        }

        self::assertSame([], $raised, 'the store raised a diagnostic instead of answering for itself');
    }
}
