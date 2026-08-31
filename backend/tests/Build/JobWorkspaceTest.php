<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\JobWorkspace;
use App\Tests\LogRecorder;
use PHPUnit\Framework\TestCase;

/**
 * What happens to a build's directory when the build is over.
 *
 * BLD-305 asks for cleanup failure to be exercised. It is worth exercising
 * because the cost of getting it wrong is invisible: a workspace that survives
 * its build keeps somebody's source on a shared disk, and the removal that
 * failed to take it away said nothing.
 */
final class JobWorkspaceTest extends TestCase
{
    private LogRecorder $log;

    private JobWorkspace $workspace;

    protected function setUp(): void
    {
        $this->log = new LogRecorder();
        $this->workspace = new JobWorkspace($this->log->logger);
        if (!is_dir(JobWorkspace::ROOT)) {
            mkdir(JobWorkspace::ROOT, 0700, true);
        }
    }

    public function testAllocatesAPrivateDirectoryNobodyElseCanRead(): void
    {
        $job = $this->workspace->allocate();
        $second = $this->workspace->allocate();
        try {
            self::assertDirectoryExists($job);
            self::assertSame('0700', substr(sprintf('%o', fileperms($job)), -4));
            /* Two builds must never share a directory, or one can read and
             * overwrite the other's source. */
            self::assertNotSame($job, $second);
        } finally {
            $this->workspace->remove($job);
            $this->workspace->remove($second);
        }
    }

    public function testRemovesEverythingABuildLeftBehind(): void
    {
        $job = $this->workspace->allocate();
        mkdir($job.'/.build/nested', 0700, true);
        file_put_contents($job.'/.build/nested/output.bin', 'bytes');
        file_put_contents($job.'/main.s', 'lda #0');

        self::assertSame([], $this->workspace->remove($job));
        self::assertDirectoryDoesNotExist($job);
    }

    public function testRemovesADirectoryATooLeftUnreadable(): void
    {
        /*
         * A tool is free to leave a directory nobody can look inside. The
         * recursion that met one used to walk away from it, leaving the whole
         * subtree on disk. The workspace belongs to this service, so the
         * permission stopping the removal is one it may put back.
         */
        $job = $this->workspace->allocate();
        mkdir($job.'/sealed', 0700);
        file_put_contents($job.'/sealed/inside.o', 'object');
        chmod($job.'/sealed', 0000);

        self::assertSame([], $this->workspace->remove($job));
        self::assertDirectoryDoesNotExist($job);
    }

    public function testRemovesALinkWithoutFollowingItToWhatItNames(): void
    {
        /* Following a link a tool planted would have the removal delete
         * something outside the workspace entirely. */
        $outside = sys_get_temp_dir().'/workspace-must-not-delete-'.bin2hex(random_bytes(6));
        file_put_contents($outside, 'not the build');
        $job = $this->workspace->allocate();
        symlink($outside, $job.'/escape');

        try {
            self::assertSame([], $this->workspace->remove($job));
            self::assertDirectoryDoesNotExist($job);
            self::assertFileExists($outside, 'The removal followed a link out of the workspace.');
        } finally {
            @unlink($outside);
        }
    }

    public function testWhatSurvivesRemovalIsExactlyWhatRemovalReports(): void
    {
        /*
         * Cleanup can genuinely fail — a directory refilled by something still
         * running, an entry on a mount this process may not touch — and the
         * only thing that must never happen is failing quietly. So rather than
         * manufacturing one particular failure, this runs cleanup against a
         * workspace something is actively writing into and holds the report to
         * the disk: the workspace is gone if and only if the removal said so.
         *
         * A removal that swallowed its failures passes the first half of that
         * and fails the second, which is the bug this guards.
         */
        $job = $this->workspace->allocate();
        mkdir($job.'/busy', 0700);
        $writer = proc_open(
            ['/bin/sh', '-c', 'i=0; while [ $i -lt 200000 ]; do : > busy/f$i; i=$((i+1)); done'],
            [['pipe', 'r'], ['file', '/dev/null', 'w'], ['file', '/dev/null', 'w']],
            $pipes,
            $job,
        );
        self::assertIsResource($writer, 'The writer this test races against did not start.');
        /* Long enough that it is certainly producing files by the time cleanup
         * begins; short enough that the test costs nothing. */
        usleep(200_000);

        $unremoved = $this->workspace->remove($job);

        foreach ($pipes as $pipe) {
            fclose($pipe);
        }
        $status = proc_get_status($writer);
        if ($status['running'] ?? false) {
            proc_terminate($writer, SIGKILL);
        }
        proc_close($writer);

        $survived = is_dir($job);
        try {
            self::assertSame(
                $survived,
                $unremoved !== [],
                $survived
                    ? 'The workspace is still on disk and the removal reported success.'
                    : 'The removal reported leftovers that are not on disk.',
            );
            $warnings = array_values(array_filter(
                $this->log->records(),
                static fn (array $record): bool => ($record['event'] ?? '') === 'native-build-workspace-not-removed',
            ));
            self::assertCount($survived ? 1 : 0, $warnings, 'A failed removal must be reported, and a clean one must not be.');
            if ($survived) {
                self::assertSame('warning', $warnings[0]['level']);
                /* Named relative to the job: the absolute path is a random
                 * temporary name that discloses the layout of the machine and
                 * tells a reader nothing. */
                self::assertContains('busy', $unremoved);
                self::assertStringNotContainsString($job, $this->log->written());
            }
        } finally {
            exec('rm -rf '.escapeshellarg($job));
        }
    }
}
