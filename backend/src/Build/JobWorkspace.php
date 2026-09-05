<?php

declare(strict_types=1);

namespace App\Build;

use App\Observability\StructuredLogger;

/**
 * The directory one build runs in, and its removal.
 *
 * Four adapters allocated and removed a workspace with four copies of the same
 * recursion, and every copy ignored every failure it met. A removal that
 * quietly does nothing is the worst of both outcomes: somebody's source stays
 * on disk, and nothing says so until the disk is full. Removal happens here
 * instead, once — repairing what it can and reporting what it cannot.
 */
final class JobWorkspace
{
    /** Every build workspace lives under one root, so there is one place to look. */
    public const ROOT = '/tmp/native-builds';

    public function __construct(private readonly StructuredLogger $logger)
    {
    }

    /**
     * @param string $prefix tells one adapter's jobs from another's in a listing
     *
     * @throws \RuntimeException when no workspace could be allocated
     */
    public function allocate(string $prefix = ''): string
    {
        $job = self::ROOT.'/'.$prefix.bin2hex(random_bytes(16));
        if (!mkdir($job, 0700, true) || !is_dir($job)) {
            throw new \RuntimeException('Unable to allocate a native build workspace.');
        }

        return $job;
    }

    /**
     * Remove a workspace and say what survived it.
     *
     * @return list<string> whatever is still on disk, named relative to the job
     *                      so that no temporary path is disclosed
     */
    public function remove(string $job): array
    {
        $unremoved = [];
        $this->removeTree($job, $job, $unremoved);
        sort($unremoved);
        if ($unremoved !== []) {
            $this->logger->warning('native-build-workspace-not-removed', [
                'jobIdHash' => substr(hash('sha256', $job), 0, 16),
                'remaining' => count($unremoved),
                'examples' => array_slice($unremoved, 0, 5),
            ]);
        }

        return $unremoved;
    }

    /** @param list<string> $unremoved */
    private function removeTree(string $path, string $job, array &$unremoved): void
    {
        /* A symbolic link is removed as a link and never followed: a tool is
         * free to point one outside the workspace, and following it would have
         * this delete whatever it names. */
        if (is_link($path)) {
            if (!@unlink($path)) {
                $unremoved[] = $this->name($path, $job);
            }

            return;
        }
        if (!file_exists($path)) {
            return;
        }
        if (!is_dir($path)) {
            /* The permission that stops a file being removed is on the
             * directory holding it, and this service owns the whole workspace,
             * so it is a permission it may put back. */
            if (!@unlink($path) && (!@chmod(dirname($path), 0700) || !@unlink($path))) {
                $unremoved[] = $this->name($path, $job);
            }

            return;
        }
        /* A tool may leave a directory that cannot be read or traversed. Same
         * reasoning: it is this service's directory to repair. */
        @chmod($path, 0700);
        $entries = @scandir($path);
        if ($entries === false) {
            $unremoved[] = $this->name($path, $job);

            return;
        }
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $this->removeTree($path.'/'.$entry, $job, $unremoved);
        }
        if (!@rmdir($path)) {
            $unremoved[] = $this->name($path, $job);
        }
    }

    private function name(string $path, string $job): string
    {
        return $path === $job ? '<job>' : ltrim(substr($path, strlen($job)), '/');
    }
}
