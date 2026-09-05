<?php

declare(strict_types=1);

namespace App\Storage;

/**
 * Content addressed by SHA-256.
 *
 * Two properties matter and both are enforced rather than assumed. The same
 * bytes are stored once however many revisions name them, so history over a
 * project that barely changes costs almost nothing. And bytes that do not hash
 * to the digest they were filed under are refused: a store that accepted them
 * would hold something other than what it was given and would say otherwise
 * every time it was asked.
 */
final class BlobStore
{
    public function __construct(private readonly string $root)
    {
    }

    /** Where a digest lives. Sharded, because a directory of a million entries is slow to read. */
    private function path(string $digest): string
    {
        return sprintf('%s/blobs/%s/%s/%s', $this->root, substr($digest, 0, 2), substr($digest, 2, 2), $digest);
    }

    public static function digestOf(string $bytes): string
    {
        return hash('sha256', $bytes);
    }

    private function requireDigest(string $digest): void
    {
        if (!preg_match('/^[0-9a-f]{64}$/', $digest)) {
            throw new StorageError('BLOB_DIGEST_INVALID', sprintf('A blob is addressed by its lower-case SHA-256, and %s is not one.', substr($digest, 0, 80)));
        }
    }

    /**
     * Store bytes and return their digest.
     *
     * Writing the same content twice is not an error and not a second copy: it
     * is the point of addressing content by what it is.
     */
    /**
     * The digest of no bytes at all.
     *
     * An empty file used to be refused, on the grounds that an empty blob and a
     * missing one would look alike. That was true of blobs on disk and false of
     * projects: a source file somebody has just created is empty, and refusing
     * to store the project holding it made the store unusable for the case it
     * exists for. Emptiness is a digest instead, one that is always present by
     * definition and is never written, so nothing is missing and nothing is
     * ambiguous. Every other digest still has to be on disk.
     */
    public const EMPTY_DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    public function put(string $bytes): string
    {
        if ($bytes === '') {
            return self::EMPTY_DIGEST;
        }
        if (strlen($bytes) > StorageLimits::BLOB_BYTES) {
            throw new StorageError('BLOB_TOO_LARGE', sprintf('A stored file is limited to %d bytes and this is %d.', StorageLimits::BLOB_BYTES, strlen($bytes)));
        }
        $digest = self::digestOf($bytes);
        $path = $this->path($digest);
        if (is_file($path)) return $digest;

        $directory = dirname($path);
        if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new StorageError('BLOB_UNWRITABLE', sprintf('The blob store could not be written to at %s.', $directory));
        }
        /* Written beside and renamed, so a reader never sees a partial blob and
         * an interrupted write leaves nothing addressable behind. */
        $temporary = $directory.'/.'.$digest.'.'.bin2hex(random_bytes(8));
        if (@file_put_contents($temporary, $bytes, LOCK_EX) !== strlen($bytes) || !@rename($temporary, $path)) {
            @unlink($temporary);
            throw new StorageError('BLOB_UNWRITABLE', 'The blob store could not be written to.');
        }

        return $digest;
    }

    /** The bytes filed under a digest, checked against it before they are returned. */
    public function get(string $digest): string
    {
        $this->requireDigest($digest);
        if ($digest === self::EMPTY_DIGEST) return '';
        $path = $this->path($digest);
        $bytes = is_file($path) ? file_get_contents($path) : false;
        if ($bytes === false) {
            throw new StorageError('BLOB_NOT_FOUND', sprintf('No blob is stored under %s.', $digest));
        }
        if (self::digestOf($bytes) !== $digest) {
            /* Corruption on disk, not a caller's mistake. Saying so is the only
             * useful thing to do: silently returning it would spread it. */
            throw new StorageError('BLOB_CORRUPT', sprintf('The blob stored under %s no longer hashes to it, so the store has been damaged and this content cannot be trusted.', $digest));
        }

        return $bytes;
    }

    public function has(string $digest): bool
    {
        $this->requireDigest($digest);

        return $digest === self::EMPTY_DIGEST || is_file($this->path($digest));
    }

    public function sizeOf(string $digest): int
    {
        $this->requireDigest($digest);
        $size = is_file($this->path($digest)) ? filesize($this->path($digest)) : false;

        return $size === false ? 0 : $size;
    }

    /**
     * Every digest held, for collection and for accounting.
     *
     * @return list<string>
     */
    public function digests(): array
    {
        $found = [];
        $blobs = $this->root.'/blobs';
        if (!is_dir($blobs)) return $found;
        foreach (glob($blobs.'/*/*/*') ?: [] as $path) {
            $name = basename($path);
            if (preg_match('/^[0-9a-f]{64}$/', $name)) $found[] = $name;
        }
        sort($found);

        return $found;
    }

    /** Remove one blob. Only the collector calls this, and only for unreferenced content. */
    public function forget(string $digest): bool
    {
        $this->requireDigest($digest);
        $path = $this->path($digest);

        return is_file($path) && unlink($path);
    }
}
