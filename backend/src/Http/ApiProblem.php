<?php

declare(strict_types=1);

namespace App\Http;

final class ApiProblem extends \RuntimeException
{
    /** @param array<string, scalar|list<scalar>|null> $fields */
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly bool $retryable = false,
        public readonly array $fields = [],
    ) {
        parent::__construct($message);
    }
}
