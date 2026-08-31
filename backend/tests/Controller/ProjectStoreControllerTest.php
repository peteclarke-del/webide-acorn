<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Controller\ProjectStoreController;
use PHPUnit\Framework\TestCase;

/**
 * That every refusal the store can make has an answer.
 *
 * A refusal with no mapping becomes a 500 with the store's own wording, which
 * reads to a client as "the server broke" when it usually means "you asked for
 * something you cannot have". The store's reasons are read out of its source
 * rather than listed here, so adding one and forgetting to map it fails.
 */
final class ProjectStoreControllerTest extends TestCase
{
    /** @return list<string> every reason the storage layer constructs */
    private function reasonsTheStoreCanRaise(): array
    {
        $reasons = [];
        foreach (glob(__DIR__.'/../../src/Storage/*.php') ?: [] as $path) {
            preg_match_all("/new StorageError\('([A-Z_]+)'/", (string) file_get_contents($path), $matches);
            foreach ($matches[1] as $reason) $reasons[$reason] = true;
        }
        $found = array_keys($reasons);
        sort($found);

        return $found;
    }

    /** @return array<string, array{int, bool}> */
    private function mapping(): array
    {
        $reflection = new \ReflectionClass(ProjectStoreController::class);

        return $reflection->getConstant('REFUSALS');
    }

    public function testTheStoreHasRefusalsToMapAtAll(): void
    {
        /* If the extraction stopped matching, every other assertion here would
         * pass on an empty list. */
        self::assertGreaterThan(8, count($this->reasonsTheStoreCanRaise()));
    }

    public function testEveryRefusalTheStoreCanMakeHasAnAnswer(): void
    {
        $unmapped = array_values(array_diff($this->reasonsTheStoreCanRaise(), array_keys($this->mapping())));
        self::assertSame([], $unmapped, 'These storage refusals would become a 500 with no meaning: '.implode(', ', $unmapped));
    }

    public function testNothingIsMappedThatTheStoreCannotRaise(): void
    {
        /* A mapping for a reason nothing produces is a claim about behaviour
         * that does not exist. */
        $stale = array_values(array_diff(array_keys($this->mapping()), $this->reasonsTheStoreCanRaise()));
        self::assertSame([], $stale, 'These are mapped but nothing raises them: '.implode(', ', $stale));
    }

    public function testQuotaAndConflictAreNotReportedAsServerFaults(): void
    {
        /* The distinction a client acts on: what it asked for cannot be had,
         * against the server having failed. */
        foreach (['OWNER_BYTE_QUOTA', 'OWNER_PROJECT_QUOTA', 'REVISION_STALE_PARENT'] as $reason) {
            self::assertSame(409, $this->mapping()[$reason][0], $reason);
            self::assertFalse($this->mapping()[$reason][1], $reason.' cannot be fixed by sending it again');
        }
    }

    public function testOnlyAnUnwritableStoreIsWorthRetrying(): void
    {
        /* Retryable has to mean it: a client that retries a quota failure loops
         * forever, and one that gives up on a full disk gives up too early. */
        $retryable = array_keys(array_filter($this->mapping(), static fn (array $answer): bool => $answer[1]));
        sort($retryable);
        self::assertSame(['BLOB_UNWRITABLE', 'PROJECT_UNWRITABLE'], $retryable);
    }

    public function testDamagedContentIsAServerFaultAndNotANotFound(): void
    {
        /* Reporting corruption as absence would send somebody looking for the
         * wrong problem, and hide that the store needs attention. */
        self::assertSame(500, $this->mapping()['BLOB_CORRUPT'][0]);
        self::assertSame(404, $this->mapping()['BLOB_NOT_FOUND'][0]);
    }
}
