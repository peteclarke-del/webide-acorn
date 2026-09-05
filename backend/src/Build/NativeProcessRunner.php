<?php

declare(strict_types=1);

namespace App\Build;

use Symfony\Component\Process\Process;

final class NativeProcessRunner
{
    /**
     * Stop the tool and everything it started.
     *
     * Killing the process alone leaves whatever it spawned behind: an
     * adversarial test caught a child outliving the stop that killed its
     * parent, holding CPU and the job directory and belonging to nobody.
     *
     * The descendants are found rather than signalled by group. A process
     * group would be tidier, but `setsid` forks — the identifier this runner
     * holds is not the leader of the group the tool ends up in, so a group
     * kill would signal something already gone. Walking the parent links in
     * `/proc` asks the kernel what actually descends from this process, which
     * is the question that needs answering.
     */
    private function stopEverything(Process $process): void
    {
        $pid = $process->getPid();
        if ($pid !== null && function_exists('posix_kill')) {
            $descendants = $this->descendantsOf($pid);
            /*
             * Stopped before any of them is killed, and stopped shallowest
             * first.
             *
             * Killing them one at a time in any order is not enough, and the
             * fork-bomb test proved it on a loaded machine: kill a child and
             * its parent sees the child exit and runs whatever came next in
             * the shell line, which is how three of twenty-four survived a
             * sweep that had already enumerated them. A stopped process makes
             * no progress and starts nothing, so the whole tree is frozen
             * before any of it is taken apart, and a parent is frozen before
             * its children so that nothing new is spawned behind the sweep.
             */
            foreach ($descendants as $descendant) {
                @posix_kill($descendant, SIGSTOP);
            }
            foreach (array_reverse($descendants) as $descendant) {
                @posix_kill($descendant, SIGKILL);
                /* A stopped process does not act on SIGKILL until it is
                 * allowed to run again. */
                @posix_kill($descendant, SIGCONT);
            }
        }
        $process->stop(0.0);
    }

    /**
     * Every process descending from one, deepest last.
     *
     * @return list<int>
     */
    private function descendantsOf(int $pid): array
    {
        $children = [];
        foreach (glob('/proc/[0-9]*/stat') ?: [] as $path) {
            $stat = @file_get_contents($path);
            if ($stat === false) continue;
            /* The command name can contain spaces and brackets, so the fields
             * after it are read from the last closing bracket rather than by
             * splitting the whole line. */
            $tail = strrchr($stat, ')');
            if ($tail === false) continue;
            $fields = preg_split('/\s+/', trim(substr($tail, 1)));
            $parent = isset($fields[1]) ? (int) $fields[1] : 0;
            $self = (int) basename(dirname($path));
            if ($parent > 0 && $self > 0) $children[$parent][] = $self;
        }
        $found = [];
        $queue = [$pid];
        while ($queue !== []) {
            $next = array_shift($queue);
            foreach ($children[$next] ?? [] as $child) {
                if (in_array($child, $found, true)) continue;
                $found[] = $child;
                $queue[] = $child;
            }
        }

        return $found;
    }

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
        /*
         * The deadline is enforced here rather than by the process helper.
         *
         * The helper kills the tool before it reports a timeout, and once the
         * parent is gone the kernel reparents whatever it spawned — so by the
         * time a timeout could be caught, the parent links that identify the
         * tool's descendants have already been rewritten. Owning the deadline
         * means the tree can be swept while it is still a tree.
         */
        $process->setTimeout(null);
        $deadline = microtime(true) + BuildLimits::stageSeconds();
        $timedOut = false;
        $process->start(function (string $type, string $buffer) use (&$stdout, &$stderr, &$overflow): void {
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

                return;
            }
            $target .= $buffer;
            if ($type === Process::ERR) {
                $stderr = $target;
            } else {
                $stdout = $target;
            }
        });
        while ($process->isRunning()) {
            if ($overflow) break;
            if (microtime(true) >= $deadline) { $timedOut = true; break; }
            /* Short enough that a tool is stopped promptly, long enough that
             * waiting for one costs no measurable processor time. */
            usleep(5000);
        }
        $this->stopEverything($process);
        $reason = $timedOut ? 'timeout' : ($overflow ? 'output-limit' : ($process->isSuccessful() ? 'succeeded' : 'exit-failure'));

        return [
            'reason' => $reason,
            'exitCode' => $process->getExitCode(),
            'stdout' => $stdout,
            'stderr' => $stderr,
            'durationMs' => max(0.0, (hrtime(true) - $started) / 1_000_000.0),
            'argv' => $this->redactArgv($argv, $directory),
        ];
    }

    /**
     * @param list<string> $argv
     * @return list<string>
     */
    private function redactArgv(array $argv, string $directory): array
    {
        return array_values(array_map(static fn (string $argument): string => str_replace($directory, '<job>', $argument), $argv));
    }
}
