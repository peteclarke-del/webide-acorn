<?php

declare(strict_types=1);

namespace App\Observability;

/**
 * One JSON object per line, with the correlation identifier on every one.
 *
 * Deliberately not a general-purpose logger. Every field goes through the
 * redactor, and a field it refuses is replaced by the reason it was refused
 * rather than dropped, so a line always says what it could not say. That is the
 * property that makes the log trustworthy for the thing it exists for: showing
 * that a build ran and what it cost, without holding a copy of what was built.
 *
 * The stream is injected rather than opened here so the tests write to memory
 * and read back the exact bytes, which is the only way to prove the redaction
 * rather than assert it.
 */
final class StructuredLogger
{
    /** @var resource */
    private $stream;

    private bool $ownsStream = false;

    public function __construct(
        private readonly RequestContext $context,
        private readonly Redactor $redactor,
        mixed $stream = null,
    ) {
        if (is_resource($stream)) {
            $this->stream = $stream;

            return;
        }
        /* Standard error, because a container's log collector reads it and a
         * file inside a disposable build sandbox would be thrown away with the
         * sandbox. */
        $opened = fopen('php://stderr', 'ab');
        if ($opened === false) {
            throw new \RuntimeException('The log stream could not be opened, and a build service that cannot record what it did should not start.');
        }
        $this->stream = $opened;
        $this->ownsStream = true;
    }

    public function __destruct()
    {
        if ($this->ownsStream && is_resource($this->stream)) {
            fclose($this->stream);
        }
    }

    /** @param array<string, mixed> $fields */
    public function info(string $event, array $fields = []): void
    {
        $this->write('info', $event, $fields);
    }

    /** @param array<string, mixed> $fields */
    public function warning(string $event, array $fields = []): void
    {
        $this->write('warning', $event, $fields);
    }

    /** @param array<string, mixed> $fields */
    public function error(string $event, array $fields = []): void
    {
        $this->write('error', $event, $fields);
    }

    /** @param array<string, mixed> $fields */
    private function write(string $level, string $event, array $fields): void
    {
        $decision = $this->redactor->fields($fields);
        $record = [
            'time' => gmdate('Y-m-d\TH:i:s\Z'),
            'level' => $level,
            'event' => $event,
            'correlationId' => $this->context->correlationId(),
            'service' => 'webide-acorn-native-builder',
        ] + $decision['fields'];
        if ($decision['refused'] !== []) {
            $record['refusedFields'] = $decision['refused'];
        }

        $line = json_encode($record, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        if ($line === false) {
            /* A record that will not encode is still worth recording, and the
             * one thing that cannot have caused it is a field the redactor
             * passed, so the event name alone goes out. */
            $line = json_encode(['time' => gmdate('Y-m-d\TH:i:s\Z'), 'level' => 'error', 'event' => 'log-record-unencodable', 'correlationId' => $this->context->correlationId()], JSON_UNESCAPED_SLASHES);
        }
        fwrite($this->stream, $line."\n");
    }
}
