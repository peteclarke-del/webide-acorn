<?php

declare(strict_types=1);

namespace App\Tests;

use App\Observability\Redactor;
use App\Observability\RequestContext;
use App\Observability\StructuredLogger;

/**
 * A logger the tests can read back.
 *
 * The build services write a record for every build, and the only way to prove
 * that record cannot contain the source it was given is to run a real build and
 * search the bytes that were written. That needs the log to go somewhere a test
 * can look, so it goes to memory here rather than to standard error.
 */
final class LogRecorder
{
    /** @var resource */
    private $stream;

    public readonly StructuredLogger $logger;

    public readonly RequestContext $context;

    public function __construct()
    {
        $stream = fopen('php://memory', 'w+b');
        if ($stream === false) {
            throw new \RuntimeException('The in-memory log stream could not be opened.');
        }
        $this->stream = $stream;
        $this->context = new RequestContext();
        $this->logger = new StructuredLogger($this->context, new Redactor(), $stream);
    }

    public function written(): string
    {
        rewind($this->stream);

        return (string) stream_get_contents($this->stream);
    }

    /** @return list<array<string, mixed>> */
    public function records(): array
    {
        $records = [];
        foreach (explode("\n", $this->written()) as $line) {
            if (trim($line) === '') {
                continue;
            }
            $decoded = json_decode($line, true);
            if (is_array($decoded)) {
                $records[] = $decoded;
            }
        }

        return $records;
    }
}
