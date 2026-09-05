<?php

declare(strict_types=1);

namespace App\Tests\Observability;

use App\Observability\Redactor;
use App\Observability\RequestContext;
use App\Observability\StructuredLogger;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\Request;

/**
 * The claim these contracts have to earn is that a log line cannot contain
 * somebody's source or somebody's ROM. Asserting the redactor was called would
 * not earn it, so the logger is given a real source file and a real binary and
 * the bytes it wrote are read back and searched.
 */
final class ObservabilityTest extends TestCase
{
    private const SOURCE = "ORG &1900\n.start\n LDA #65\n JSR &FFEE\n RTS\n";

    /** @return array{0: StructuredLogger, 1: resource, 2: RequestContext} */
    private function logger(): array
    {
        $stream = fopen('php://memory', 'w+b');
        self::assertIsResource($stream);
        $context = new RequestContext();

        return [new StructuredLogger($context, new Redactor(), $stream), $stream, $context];
    }

    private function written(mixed $stream): string
    {
        rewind($stream);

        return (string) stream_get_contents($stream);
    }

    public function testSourceCannotReachTheLogWhateverItIsCalled(): void
    {
        [$logger, $stream] = $this->logger();
        $logger->info('build', [
            'source' => self::SOURCE,
            'mainAsmContents' => self::SOURCE,
            'somethingElseEntirely' => self::SOURCE,
            'outputBytes' => "\x00\x01\x02\xff",
        ]);
        $written = $this->written($stream);

        self::assertStringNotContainsString('LDA #65', $written);
        self::assertStringNotContainsString('ORG', $written);
        self::assertStringNotContainsString('FFEE', $written);
        /* Refused rather than dropped: the line says what it could not say. */
        self::assertStringContainsString('refusedFields', $written);
        self::assertStringContainsString('source is a name this service uses for content', $written);
        self::assertStringContainsString('somethingElseEntirely held a byte that is not printable ASCII', $written);
    }

    public function testAReservedWordIsMatchedAsAWordAndNotAsASubstring(): void
    {
        $redactor = new Redactor();
        self::assertNotNull($redactor->field('romSet', 'bbcb')['refused']);
        self::assertNotNull($redactor->field('api_key', 'abc')['refused']);
        self::assertNotNull($redactor->field('sourceFiles', 'main.asm')['refused']);
        /* A word that merely contains a reserved word is a different word. */
        self::assertNull($redactor->field('keyboard', 'uk')['refused']);
        /* A number cannot be anybody's source, and these counts are what the
         * log exists to carry. */
        self::assertNull($redactor->field('documentCount', 4)['refused']);
        self::assertNull($redactor->field('romCount', 4)['refused']);
        self::assertNull($redactor->field('sourceFiles', 3)['refused']);
    }

    public function testAValueThatCouldBeAFragmentOfAFileIsRefused(): void
    {
        $redactor = new Redactor();
        self::assertNull($redactor->field('tool', 'ca65')['refused']);
        self::assertNotNull($redactor->field('tool', str_repeat('a', Redactor::MAX_STRING + 1))['refused']);
        self::assertNotNull($redactor->field('tool', "ca\x0065")['refused']);
        self::assertNotNull($redactor->field('tool', ['ca65'])['refused']);
        self::assertNotNull($redactor->field('tool', NAN)['refused']);
    }

    public function testEveryLineCarriesTheSameCorrelationIdentifier(): void
    {
        [$logger, $stream, $context] = $this->logger();
        $logger->info('one');
        $logger->warning('two');
        $logger->error('three');
        $lines = array_values(array_filter(explode("\n", $this->written($stream))));

        self::assertCount(3, $lines);
        foreach ($lines as $line) {
            $record = json_decode($line, true);
            self::assertIsArray($record);
            self::assertSame($context->correlationId(), $record['correlationId']);
            self::assertSame('webide-acorn-native-builder', $record['service']);
        }
        self::assertSame(['info', 'warning', 'error'], array_map(static fn (string $line): string => (string) json_decode($line, true)['level'], $lines));
    }

    public function testACallerSuppliedIdentifierIsAdoptedOnlyWhenItCouldNotCarryAnythingElse(): void
    {
        $context = new RequestContext();
        self::assertSame('trace-abc.123:4', $context->adopt(Request::create('/api/health/live', 'GET', [], [], [], ['HTTP_X_CORRELATION_ID' => 'trace-abc.123:4'])));

        /* A caller-controlled string ends up in a log file, so one that could
         * end a JSON string or start a line that reads like another record is
         * replaced rather than escaped. */
        $injected = new RequestContext();
        $adopted = $injected->adopt(Request::create('/api/health/live', 'GET', [], [], [], ['HTTP_X_CORRELATION_ID' => 'abc","event":"forged']));
        self::assertNotSame('abc","event":"forged', $adopted);
        self::assertMatchesRegularExpression('/^[0-9a-f]{32}$/', $adopted);

        $empty = new RequestContext();
        self::assertMatchesRegularExpression('/^[0-9a-f]{32}$/', $empty->adopt(Request::create('/api/health/live')));
    }

    public function testAnIdentifierIsStableWithinOneRequest(): void
    {
        $context = new RequestContext();
        self::assertSame($context->correlationId(), $context->correlationId());
        self::assertNotSame($context->correlationId(), (new RequestContext())->correlationId());
    }

    public function testAcceptableRejectsWhatCannotSafelyBeLogged(): void
    {
        self::assertTrue(RequestContext::acceptable('abc-123.DEF:9'));
        self::assertFalse(RequestContext::acceptable(''));
        self::assertFalse(RequestContext::acceptable('has space'));
        self::assertFalse(RequestContext::acceptable("has\nnewline"));
        self::assertFalse(RequestContext::acceptable('-leading-separator'));
        self::assertFalse(RequestContext::acceptable(str_repeat('a', 81)));
    }
}
