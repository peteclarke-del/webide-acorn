<?php

declare(strict_types=1);

namespace App\Storage;

/**
 * Whether what the store holds is still what it was given.
 *
 * The store addresses content by its SHA-256, which means damage is detectable
 * rather than merely possible to suspect: a blob that no longer hashes to its
 * own name is corrupt, and nothing else needs to be known to say so. Until now
 * that was only checked one blob at a time, when something happened to read it.
 * A file nobody has opened since the disk went bad is exactly the file a restore
 * is for, and it would have been copied into the backup unremarked.
 *
 * So this walks the whole store and reports every way it is inconsistent, as
 * sentences rather than as an exception, because the first fault is rarely the
 * only one and stopping at it would turn a full picture into a guess.
 *
 * It reads and never repairs. A store that quietly fixed itself would destroy
 * the evidence of what went wrong, and deciding what to do about damage is the
 * operator's, not this class's.
 */
final class StoreIntegrity
{
    public function __construct(
        private readonly string $root,
        private readonly BlobStore $blobs,
    ) {
    }

    /**
     * Everything wrong with the store, and what it holds.
     *
     * @return array{
     *     owners: int, projects: int, revisions: int, files: int,
     *     blobs: int, blobBytes: int, referenced: int, unreferenced: list<string>,
     *     findings: list<string>, checkedAt: string
     * }
     */
    public function verify(): array
    {
        $findings = [];
        $referenced = [];
        $owners = 0;
        $projects = 0;
        $revisions = 0;
        $files = 0;

        foreach ($this->directoriesIn($this->root.'/owners') as $owner) {
            ++$owners;
            foreach ($this->directoriesIn($this->root.'/owners/'.$owner.'/projects') as $projectId) {
                ++$projects;
                $seen = [];
                foreach (glob($this->root.'/owners/'.$owner.'/projects/'.$projectId.'/revisions/*.json') ?: [] as $path) {
                    $revision = $this->readRevision($path, $owner, $projectId, $findings);
                    if ($revision === null) continue;
                    ++$revisions;
                    $seen[(string) $revision['id']] = $revision;
                    foreach ($revision['files'] as $name => $digest) {
                        ++$files;
                        $digest = (string) $digest;
                        if (!preg_match('/^[0-9a-f]{64}$/', $digest)) {
                            $findings[] = sprintf('%s/%s revision %s names %s under a digest that is not a SHA-256, so nothing could ever be found for it.', $owner, $projectId, $revision['id'], $name);
                            continue;
                        }
                        $referenced[$digest] = true;
                        if (!$this->blobs->has($digest)) {
                            $findings[] = sprintf('%s/%s revision %s names %s at %s, and no blob is stored under it, so that revision can no longer be read.', $owner, $projectId, $revision['id'], $name, $digest);
                        }
                    }
                }
                /* A parent that is not in the same project is a broken chain:
                 * the revision still reads, but its history no longer leads
                 * anywhere, and a restore that reported success would be
                 * reporting on a project that had lost where it came from. */
                foreach ($seen as $revision) {
                    $parent = $revision['parent'] ?? null;
                    if ($parent !== null && !isset($seen[(string) $parent])) {
                        $findings[] = sprintf('%s/%s revision %s was written against parent %s, which is not in this project, so its history is broken.', $owner, $projectId, $revision['id'], (string) $parent);
                    }
                }
            }
            foreach (glob($this->root.'/owners/'.$owner.'/tombstones/*.json') ?: [] as $path) {
                $decoded = json_decode((string) file_get_contents($path), true);
                if (!is_array($decoded) || ($decoded['schema'] ?? null) !== '8bit-net.project-tombstone') {
                    $findings[] = sprintf('%s has a tombstone at %s that is not a readable tombstone, so what was deleted can no longer be accounted for.', $owner, basename($path));
                }
            }
        }

        /* The check that only a whole-store pass can make: every blob re-hashed
         * against the name it is filed under. This is what a backup is verified
         * by, because a corrupt blob copies into the backup as readily as a
         * sound one and looks identical until something reads it. */
        $blobBytes = 0;
        $digests = $this->blobs->digests();
        foreach ($digests as $digest) {
            try {
                $blobBytes += strlen($this->blobs->get($digest));
            } catch (StorageError $error) {
                $findings[] = sprintf('The blob filed under %s could not be verified: %s', $digest, $error->getMessage());
            }
        }

        $unreferenced = array_values(array_filter($digests, static fn (string $digest): bool => !isset($referenced[$digest])));

        return [
            'owners' => $owners,
            'projects' => $projects,
            'revisions' => $revisions,
            'files' => $files,
            'blobs' => count($digests),
            'blobBytes' => $blobBytes,
            'referenced' => count($referenced),
            /* Reported and not counted as a fault. Content no revision names is
             * what the collector removes, and a store that has simply not been
             * collected recently is not a damaged one. */
            'unreferenced' => $unreferenced,
            'findings' => $findings,
            'checkedAt' => gmdate('c'),
        ];
    }

    /**
     * @param list<string> $findings
     *
     * @param-out list<string> $findings
     *
     * @return array<string, mixed>|null
     */
    private function readRevision(string $path, string $owner, string $projectId, array &$findings): ?array
    {
        $decoded = json_decode((string) file_get_contents($path), true);
        if (!is_array($decoded) || ($decoded['schema'] ?? null) !== '8bit-net.project-revision') {
            $findings[] = sprintf('%s/%s has a revision file at %s that is not a readable revision, so whatever it recorded is lost.', $owner, $projectId, basename($path));

            return null;
        }
        if (!isset($decoded['id']) || !is_array($decoded['files'] ?? null)) {
            $findings[] = sprintf('%s/%s revision file %s has no identifier or no file list, so it names nothing that could be restored.', $owner, $projectId, basename($path));

            return null;
        }

        return $decoded;
    }

    /** @return list<string> */
    private function directoriesIn(string $path): array
    {
        if (!is_dir($path)) return [];
        $found = [];
        foreach (scandir($path) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') continue;
            if (is_dir($path.'/'.$entry)) $found[] = $entry;
        }
        sort($found);

        return $found;
    }
}
