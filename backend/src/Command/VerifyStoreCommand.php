<?php

declare(strict_types=1);

namespace App\Command;

use App\Storage\StoreIntegrity;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

/**
 * Ask the store whether it still holds what it was given.
 *
 * This exists so the check can be run against a live store and against a
 * restored one, which is the whole of what makes a backup a backup: a copy
 * nobody has verified is a copy nobody knows the state of, and a corrupt blob
 * copies exactly as readily as a sound one.
 *
 * It reads and never repairs, and its exit code is the honest one — a damaged
 * store fails, so this can stand in a restore procedure and stop it rather than
 * printing a warning into a log nobody reads.
 */
#[AsCommand(name: 'store:verify', description: 'Verify every revision and every blob in the project store.')]
final class VerifyStoreCommand extends Command
{
    public function __construct(private readonly StoreIntegrity $integrity)
    {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this->addOption('json', null, InputOption::VALUE_NONE, 'Report as JSON, for a restore procedure to record rather than read.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $started = microtime(true);
        $report = $this->integrity->verify();
        $report['seconds'] = round(microtime(true) - $started, 3);

        if ($input->getOption('json')) {
            $output->writeln((string) json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

            return $report['findings'] === [] ? Command::SUCCESS : Command::FAILURE;
        }

        $output->writeln(sprintf(
            '%d owner(s), %d project(s), %d revision(s), %d file reference(s), %d blob(s) totalling %d bytes, verified in %ss.',
            $report['owners'], $report['projects'], $report['revisions'], $report['files'], $report['blobs'], $report['blobBytes'], $report['seconds'],
        ));
        if ($report['unreferenced'] !== []) {
            /* Said, but not as a fault. Content no revision names is what the
             * collector removes, and a store that has not been collected
             * recently is not a damaged one. */
            $output->writeln(sprintf('%d blob(s) are referenced by no revision. That is what the collector removes, not damage.', count($report['unreferenced'])));
        }
        if ($report['findings'] === []) {
            $output->writeln('Nothing is wrong with this store.');

            return Command::SUCCESS;
        }
        $output->writeln(sprintf('%d finding(s):', count($report['findings'])));
        foreach ($report['findings'] as $finding) $output->writeln('  - '.$finding);

        return Command::FAILURE;
    }
}
