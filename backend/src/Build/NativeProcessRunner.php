<?php

declare(strict_types=1);

namespace App\Build;

use Symfony\Component\Process\Exception\ProcessTimedOutException;
use Symfony\Component\Process\Process;

final class NativeProcessRunner
{
    /**
     * @param list<string> $argv
     * @return array{reason: 'succeeded'|'exit-failure'|'timeout'|'output-limit', exitCode: int|null, stdout: string, stderr: string, durationMs: float, argv: list<string>}
     */
    public function run(array $argv, string $directory): array
    {
        $started = hrtime(true);
        $stdout = '';
        $stderr = '';
        $overflow = false;
        $process = new Process($argv, $directory, [
            'HOME' => $directory,
            'LANG' => 'C',
            'LC_ALL' => 'C',
            'PATH' => '/usr/bin:/bin',
            'SOURCE_DATE_EPOCH' => '0',
            'TZ' => 'UTC',
        ]);
        $process->setTimeout(BuildLimits::STAGE_SECONDS);
        try {
            $process->run(function (string $type, string $buffer) use (&$stdout, &$stderr, &$overflow, $process): void {
                $target = $type === Process::ERR ? $stderr : $stdout;
                $remaining = BuildLimits::LOG_BYTES - strlen($target);
                if ($remaining <= 0 || strlen($buffer) > $remaining) {
                    if ($remaining > 0) {
                        $target .= substr($buffer, 0, $remaining);
                    }
                    if ($type === Process::ERR) {
                        $stderr = $target;
                    } else {
                        $stdout = $target;
                    }
                    $overflow = true;
                    $process->stop(0.0);

                    return;
                }
                $target .= $buffer;
                if ($type === Process::ERR) {
                    $stderr = $target;
                } else {
                    $stdout = $target;
                }
            });
            $reason = $overflow ? 'output-limit' : ($process->isSuccessful() ? 'succeeded' : 'exit-failure');
        } catch (ProcessTimedOutException) {
            $process->stop(0.0);
            $reason = 'timeout';
        }

        return [
            'reason' => $reason,
            'exitCode' => $process->getExitCode(),
            'stdout' => $stdout,
            'stderr' => $stderr,
            'durationMs' => max(0.0, (hrtime(true) - $started) / 1_000_000),
            'argv' => $this->redactArgv($argv, $directory),
        ];
    }

    /** @param list<string> $argv @return list<string> */
    private function redactArgv(array $argv, string $directory): array
    {
        return array_map(static fn (string $argument): string => str_replace($directory, '<job>', $argument), $argv);
    }
}
