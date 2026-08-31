<?php

declare(strict_types=1);

namespace App\Storage;

/**
 * Projects, their revisions, and what an owner is using.
 *
 * A revision is an immutable manifest: filenames against blob digests, a
 * parent, and when it was written. History is therefore a chain of manifests
 * over shared content rather than a pile of copies, and restoring an old
 * revision is reading one rather than reconstructing it.
 *
 * The owner is recorded from the first write even though there is only one and
 * nothing yet proves who they are. A store written without an owner cannot
 * later say whose data it holds, and every isolation test worth having would
 * have nothing to bind to; deferring authentication is not the same as
 * deferring the question of whose something is.
 */
final class ProjectStore
{
    public const LOCAL_OWNER = 'local';

    /** @var callable(): string */
    private $now;

    /**
     * @param (callable(): string)|null $now Injected so a test states the time
     *        rather than racing it, and so a revision's timestamp is the one
     *        thing about it that is not derived from its content.
     */
    public function __construct(
        private readonly string $root,
        private readonly BlobStore $blobs,
        ?callable $now = null,
    ) {
        $this->now = $now ?? static fn (): string => gmdate('c');
    }

    private function clock(): string
    {
        return ($this->now)();
    }

    private function ownerRoot(string $owner): string
    {
        $this->requireIdentifier($owner, 'An owner');

        return $this->root.'/owners/'.$owner;
    }

    private function projectRoot(string $owner, string $projectId): string
    {
        $this->requireIdentifier($projectId, 'A project identifier');

        return $this->ownerRoot($owner).'/projects/'.$projectId;
    }

    private function requireIdentifier(string $value, string $what): void
    {
        if (!preg_match('/^[a-z0-9][a-z0-9-]{0,63}$/', $value)) {
            throw new StorageError('IDENTIFIER_INVALID', sprintf('%s is lower-case letters, digits and hyphens, 1 to 64 characters, and %s is not. Names become directories, so anything else could reach outside the store.', $what, substr($value, 0, 80)));
        }
    }

    /** @return list<string> */
    public function projects(string $owner): array
    {
        $directory = $this->ownerRoot($owner).'/projects';
        if (!is_dir($directory)) return [];
        $found = array_values(array_filter(scandir($directory) ?: [], static fn (string $entry): bool => $entry !== '.' && $entry !== '..'));
        sort($found);

        return $found;
    }

    /** Bytes this owner's blobs occupy, counted from what its revisions name. */
    public function bytesUsed(string $owner): int
    {
        $total = 0;
        foreach ($this->referencedDigests($owner) as $digest) $total += $this->blobs->sizeOf($digest);

        return $total;
    }

    /** @return list<string> every blob digest any revision of this owner names */
    public function referencedDigests(string $owner): array
    {
        $digests = [];
        foreach ($this->projects($owner) as $projectId) {
            foreach ($this->revisions($owner, $projectId) as $revision) {
                foreach ($revision['files'] as $digest) $digests[$digest] = true;
            }
        }
        $found = array_keys($digests);
        sort($found);

        return $found;
    }

    /**
     * Write a revision.
     *
     * @param array<string, string> $files filename to bytes
     * @return array<string, mixed> the revision written
     */
    public function commit(string $owner, string $projectId, array $files, ?string $parent = null, string $note = ''): array
    {
        $this->requireIdentifier($owner, 'An owner');
        $this->requireIdentifier($projectId, 'A project identifier');
        if ($files === []) {
            throw new StorageError('REVISION_EMPTY', 'A revision with no files would record that a project became empty, which is not what an empty request means. Send the files the revision should contain.');
        }
        if (count($files) > StorageLimits::REVISION_FILES) {
            throw new StorageError('REVISION_TOO_MANY_FILES', sprintf('A revision names at most %d files and this names %d.', StorageLimits::REVISION_FILES, count($files)));
        }
        $existing = $this->projects($owner);
        if (!in_array($projectId, $existing, true) && count($existing) >= StorageLimits::OWNER_PROJECTS) {
            throw new StorageError('OWNER_PROJECT_QUOTA', sprintf('This owner already has the %d projects it may keep. Remove one before adding another.', StorageLimits::OWNER_PROJECTS));
        }

        $history = $this->revisions($owner, $projectId);
        $head = $history === [] ? null : $history[count($history) - 1]['id'];
        if ($parent !== $head) {
            /* The caller wrote against a revision that is no longer the head,
             * so somebody else has committed in between. Refusing names both,
             * which is what a client needs to merge or fork. */
            throw new StorageError('REVISION_STALE_PARENT', sprintf('This revision was written against %s but the project is now at %s. Read the head and merge, or fork from the parent.', $parent ?? 'nothing', $head ?? 'nothing'));
        }

        /* Quota is measured against what this write would add, not what it
         * sends: content already stored costs nothing to name again. */
        $manifest = [];
        $wouldAdd = 0;
        foreach ($files as $name => $bytes) {
            $this->requireFilename((string) $name);
            $digest = BlobStore::digestOf($bytes);
            if (!$this->blobs->has($digest)) $wouldAdd += strlen($bytes);
            $manifest[(string) $name] = $digest;
        }
        $used = $this->bytesUsed($owner);
        if ($used + $wouldAdd > StorageLimits::OWNER_BYTES) {
            throw new StorageError('OWNER_BYTE_QUOTA', sprintf('This owner may store %d bytes, is using %d, and this revision would add %d. Remove a project or a revision first.', StorageLimits::OWNER_BYTES, $used, $wouldAdd));
        }

        foreach ($files as $name => $bytes) $this->blobs->put($bytes);

        $directory = $this->projectRoot($owner, $projectId).'/revisions';
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new StorageError('PROJECT_UNWRITABLE', 'The project store could not be written to.');
        }
        $sequence = count($history) + 1;
        $revision = [
            'schema' => '8bit-net.project-revision',
            'version' => 1,
            'id' => sprintf('%06d-%s', $sequence, substr(hash('sha256', $projectId.$sequence.implode('', $manifest)), 0, 16)),
            'owner' => $owner,
            'projectId' => $projectId,
            'parent' => $parent,
            'writtenAt' => $this->clock(),
            'note' => mb_substr($note, 0, 200),
            'files' => $manifest,
        ];
        $path = sprintf('%s/%s.json', $directory, $revision['id']);
        if (file_put_contents($path, json_encode($revision, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), LOCK_EX) === false) {
            throw new StorageError('PROJECT_UNWRITABLE', 'The project store could not be written to.');
        }

        return $revision;
    }

    private function requireFilename(string $name): void
    {
        if ($name === '' || strlen($name) > 160 || str_contains($name, '..') || str_starts_with($name, '/') || !preg_match('#^[A-Za-z0-9._/-]+$#', $name)) {
            throw new StorageError('FILENAME_INVALID', sprintf('A stored filename is 1 to 160 characters of letters, digits, dot, underscore, hyphen and slash, and cannot be absolute or contain "..". %s is not one.', substr($name, 0, 80)));
        }
    }

    /** @return list<array<string, mixed>> oldest first */
    public function revisions(string $owner, string $projectId): array
    {
        $directory = $this->projectRoot($owner, $projectId).'/revisions';
        if (!is_dir($directory)) return [];
        $found = [];
        foreach (glob($directory.'/*.json') ?: [] as $path) {
            $decoded = json_decode((string) file_get_contents($path), true);
            if (is_array($decoded) && ($decoded['schema'] ?? null) === '8bit-net.project-revision') $found[] = $decoded;
        }
        usort($found, static fn (array $left, array $right): int => strcmp((string) $left['id'], (string) $right['id']));

        return $found;
    }

    /** The files of one revision, by name, with their bytes read back and checked. */
    public function read(string $owner, string $projectId, string $revisionId): array
    {
        foreach ($this->revisions($owner, $projectId) as $revision) {
            if ($revision['id'] !== $revisionId) continue;
            $files = [];
            foreach ($revision['files'] as $name => $digest) $files[$name] = $this->blobs->get((string) $digest);

            return $files;
        }

        throw new StorageError('REVISION_NOT_FOUND', sprintf('%s has no revision %s.', $projectId, $revisionId));
    }

    /**
     * Remove blobs no revision names.
     *
     * Only ever in that direction: a blob any revision names is never removed,
     * and no revision is removed to make a blob collectable. Collection that
     * could lose history would be a worse problem than the space it recovers.
     *
     * @return array{examined: int, removed: int, keptBytes: int}
     */
    public function collect(string $owner): array
    {
        $referenced = array_flip($this->referencedDigests($owner));
        $examined = 0;
        $removed = 0;
        foreach ($this->blobs->digests() as $digest) {
            $examined++;
            if (isset($referenced[$digest])) continue;
            if ($this->blobs->forget($digest)) $removed++;
        }

        return ['examined' => $examined, 'removed' => $removed, 'keptBytes' => $this->bytesUsed($owner)];
    }

    /**
     * Everything an owner holds, in one document.
     *
     * Work somebody cannot get out of a store is work the store has taken. The
     * export is the whole history rather than the newest revision, because a
     * history that only leaves as its last state is not a history, and it is
     * the same shape the store writes so it can be read back without a
     * converter nobody maintains.
     *
     * @return array<string, mixed>
     */
    public function export(string $owner): array
    {
        $projects = [];
        foreach ($this->projects($owner) as $projectId) {
            $revisions = [];
            foreach ($this->revisions($owner, $projectId) as $revision) {
                $files = [];
                foreach ($revision['files'] as $name => $digest) $files[$name] = base64_encode($this->blobs->get((string) $digest));
                $revisions[] = ['revision' => $revision, 'files' => $files];
            }
            $projects[] = ['projectId' => $projectId, 'revisions' => $revisions];
        }

        return [
            'schema' => '8bit-net.project-store-export',
            'version' => 1,
            'owner' => $owner,
            'exportedAt' => $this->clock(),
            'projects' => $projects,
        ];
    }

    /**
     * Delete a project and everything only it referenced.
     *
     * A tombstone is left: what was removed, when, and how many revisions went
     * with it. Deleting without a trace is indistinguishable from a project
     * that was never there, and somebody who finds their work gone deserves to
     * know whether it was deleted or lost.
     *
     * Content another project still names is kept — deletion frees what only
     * this project held, and nothing else.
     *
     * @return array<string, mixed> the tombstone
     */
    public function deleteProject(string $owner, string $projectId, string $reason = ''): array
    {
        $this->requireIdentifier($owner, 'An owner');
        $this->requireIdentifier($projectId, 'A project identifier');
        $revisions = $this->revisions($owner, $projectId);
        if ($revisions === []) {
            throw new StorageError('PROJECT_NOT_FOUND', sprintf('There is no project %s to delete.', $projectId));
        }
        $root = $this->projectRoot($owner, $projectId);
        foreach (glob($root.'/revisions/*.json') ?: [] as $path) unlink($path);
        @rmdir($root.'/revisions');
        @rmdir($root);

        $tombstone = [
            'schema' => '8bit-net.project-tombstone',
            'version' => 1,
            'owner' => $owner,
            'projectId' => $projectId,
            'deletedAt' => $this->clock(),
            'revisions' => count($revisions),
            'reason' => mb_substr($reason, 0, 200),
        ];
        $graves = $this->ownerRoot($owner).'/tombstones';
        if (!is_dir($graves) && !mkdir($graves, 0700, true) && !is_dir($graves)) {
            throw new StorageError('PROJECT_UNWRITABLE', 'The project store could not be written to.');
        }
        file_put_contents(sprintf('%s/%s.json', $graves, $projectId), json_encode($tombstone, JSON_PRETTY_PRINT), LOCK_EX);

        /* Content no surviving revision names is now collectable. Content
         * another project still names is not, and is left alone. */
        $this->collect($owner);

        return $tombstone;
    }

    /** @return list<array<string, mixed>> what has been deleted, and when */
    public function tombstones(string $owner): array
    {
        $graves = $this->ownerRoot($owner).'/tombstones';
        if (!is_dir($graves)) return [];
        $found = [];
        foreach (glob($graves.'/*.json') ?: [] as $path) {
            $decoded = json_decode((string) file_get_contents($path), true);
            if (is_array($decoded) && ($decoded['schema'] ?? null) === '8bit-net.project-tombstone') $found[] = $decoded;
        }
        usort($found, static fn (array $left, array $right): int => strcmp((string) $left['deletedAt'], (string) $right['deletedAt']));

        return $found;
    }

    /** What this owner is using, against what it may use. */
    public function usage(string $owner): array
    {
        $projects = $this->projects($owner);
        $revisions = 0;
        foreach ($projects as $projectId) $revisions += count($this->revisions($owner, $projectId));

        return [
            'owner' => $owner,
            'projects' => count($projects),
            'revisions' => $revisions,
            'bytes' => $this->bytesUsed($owner),
            'limits' => StorageLimits::manifest(),
        ];
    }
}
