<?php

declare(strict_types=1);

namespace App\Storage;

/**
 * What one owner may keep.
 *
 * Quotas exist so that a store on somebody's own machine cannot be filled by a
 * runaway loop or a project that grew without anybody noticing. They are
 * enforced when something is written, because a quota checked only when
 * somebody asks is a report rather than a limit.
 */
final class StorageLimits
{
    /** A single stored file. Larger than a build input, because assets are stored too. */
    public const BLOB_BYTES = 8 * 1024 * 1024;
    /** Everything one owner holds, across every project and revision. */
    public const OWNER_BYTES = 512 * 1024 * 1024;
    /** Files named by one revision. */
    public const REVISION_FILES = 512;
    /** Revisions kept for one project before the oldest are eligible for retention. */
    public const PROJECT_REVISIONS = 256;
    /** Projects one owner may have. */
    public const OWNER_PROJECTS = 64;

    /** @return array<string, int> */
    public static function manifest(): array
    {
        return [
            'blobBytes' => self::BLOB_BYTES,
            'ownerBytes' => self::OWNER_BYTES,
            'revisionFiles' => self::REVISION_FILES,
            'projectRevisions' => self::PROJECT_REVISIONS,
            'ownerProjects' => self::OWNER_PROJECTS,
        ];
    }
}
