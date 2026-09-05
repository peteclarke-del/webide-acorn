<?php

declare(strict_types=1);

namespace App\Storage;

/**
 * A refusal the caller can act on.
 *
 * Every one names what was refused, why, and what would make it succeed. A
 * store that answers "invalid request" teaches somebody to retry the same
 * thing. The reason is carried as `reason` rather than as the exception's own
 * `code`, which is an integer and already means something else.
 */
final class StorageError extends \RuntimeException
{
    public function __construct(public readonly string $reason, string $message)
    {
        parent::__construct($message);
    }
}
