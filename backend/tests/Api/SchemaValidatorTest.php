<?php

declare(strict_types=1);

namespace App\Tests\Api;

use App\Api\SchemaValidator;
use PHPUnit\Framework\TestCase;

/**
 * The validator, and every way it must refuse.
 *
 * A validator that passes things it should not is worse than no validator,
 * because the conformance tests that depend on it would be green for a server
 * that had drifted. So each rule it implements is proved to fail on a value
 * that breaks it, and the keywords it does not implement are proved to fail
 * rather than to pass quietly.
 */
final class SchemaValidatorTest extends TestCase
{
    /** @param array<string, mixed> $schemas */
    private function validator(array $schemas = []): SchemaValidator
    {
        return new SchemaValidator($schemas);
    }

    private function decode(string $json): mixed
    {
        return json_decode($json, false, 512, JSON_THROW_ON_ERROR);
    }

    public function testAcceptsAValueThatMatches(): void
    {
        $schema = ['type' => 'object', 'properties' => ['id' => ['type' => 'string'], 'n' => ['type' => 'integer']]];
        self::assertSame([], $this->validator()->validate($schema, $this->decode('{"id":"a","n":2}')));
    }

    public function testReportsAMissingDeclaredField(): void
    {
        $schema = ['type' => 'object', 'properties' => ['id' => ['type' => 'string']], 'required' => ['id']];
        $failures = $this->validator()->validate($schema, $this->decode('{}'));
        self::assertCount(1, $failures);
        self::assertStringContainsString('is missing id', $failures[0]);
        self::assertStringContainsString('A client may rely on it being there', $failures[0]);
    }

    public function testReportsEveryFailureRatherThanTheFirst(): void
    {
        /* One failure at a time turns fixing a drifted response into a
         * conversation with the test suite. */
        $schema = ['type' => 'object', 'properties' => ['a' => ['type' => 'string'], 'b' => ['type' => 'integer']], 'required' => ['a', 'b', 'c']];
        $failures = $this->validator()->validate($schema, $this->decode('{"a":1,"b":"x"}'));
        self::assertCount(3, $failures);
    }

    public function testTellsAnEmptyObjectFromAnEmptyList(): void
    {
        /* This is why values are decoded as objects. In PHP's associative
         * decoding both are `[]`, and `files` coming back as a list instead of
         * an object is exactly the drift this is meant to catch. */
        $object = ['type' => 'object'];
        self::assertSame([], $this->validator()->validate($object, $this->decode('{}')));
        self::assertNotSame([], $this->validator()->validate($object, $this->decode('[]')));
        $list = ['type' => 'array', 'items' => ['type' => 'string']];
        self::assertSame([], $this->validator()->validate($list, $this->decode('[]')));
        self::assertNotSame([], $this->validator()->validate($list, $this->decode('{}')));
    }

    public function testRefusesNullWhereAValueIsDeclared(): void
    {
        /* A null read through a client's `?? ''` becomes an empty string and
         * looks like data. */
        self::assertNotSame([], $this->validator()->validate(['type' => 'string'], null));
        self::assertNotSame([], $this->validator()->validate(['type' => 'integer'], null));
    }

    public function testAcceptsNullOnlyWhereTheDescriptionAllowsIt(): void
    {
        $nullable = ['oneOf' => [['type' => 'string'], ['type' => 'null']]];
        self::assertSame([], $this->validator()->validate($nullable, null));
        self::assertSame([], $this->validator()->validate($nullable, 'r1'));
        self::assertNotSame([], $this->validator()->validate($nullable, 7));
    }

    public function testChecksConstAndEnum(): void
    {
        self::assertSame([], $this->validator()->validate(['const' => 1], 1));
        self::assertNotSame([], $this->validator()->validate(['const' => 1], '1'));
        self::assertNotSame([], $this->validator()->validate(['const' => 1], true));
        self::assertSame([], $this->validator()->validate(['enum' => ['a', 'b']], 'b'));
        self::assertNotSame([], $this->validator()->validate(['enum' => ['a', 'b']], 'c'));
    }

    public function testChecksPatternAndBounds(): void
    {
        $digest = ['type' => 'string', 'pattern' => '^[0-9a-f]{64}$'];
        self::assertSame([], $this->validator()->validate($digest, str_repeat('a', 64)));
        self::assertNotSame([], $this->validator()->validate($digest, str_repeat('a', 63)));
        self::assertNotSame([], $this->validator()->validate($digest, str_repeat('A', 64)));
        $bounded = ['type' => 'integer', 'minimum' => 0, 'maximum' => 10];
        self::assertSame([], $this->validator()->validate($bounded, 10));
        self::assertNotSame([], $this->validator()->validate($bounded, 11));
        self::assertNotSame([], $this->validator()->validate($bounded, -1));
    }

    public function testFollowsAReferenceAndReportsOneItCannot(): void
    {
        $validator = $this->validator(['Named' => ['type' => 'string']]);
        self::assertSame([], $validator->validate(['$ref' => '#/components/schemas/Named'], 'text'));
        $failures = $validator->validate(['$ref' => '#/components/schemas/Absent'], 'text');
        self::assertStringContainsString('the description does not define', $failures[0]);
    }

    public function testValidatesEveryEntryOfAList(): void
    {
        $schema = ['type' => 'array', 'items' => ['type' => 'object', 'properties' => ['id' => ['type' => 'string']], 'required' => ['id']]];
        $failures = $this->validator()->validate($schema, $this->decode('[{"id":"a"},{},{"id":3}]'));
        self::assertCount(2, $failures);
        self::assertStringContainsString('[1]', $failures[0]);
        self::assertStringContainsString('[2]', $failures[1]);
    }

    public function testChecksTheValuesOfAnOpenObject(): void
    {
        $schema = ['type' => 'object', 'additionalProperties' => ['type' => 'string']];
        self::assertSame([], $this->validator()->validate($schema, $this->decode('{"a":"x","b":"y"}')));
        self::assertNotSame([], $this->validator()->validate($schema, $this->decode('{"a":1}')));
    }

    public function testRefusesAFieldWhereTheDescriptionForbidsExtras(): void
    {
        $schema = ['type' => 'object', 'properties' => ['a' => ['type' => 'string']], 'additionalProperties' => false];
        self::assertNotSame([], $this->validator()->validate($schema, $this->decode('{"a":"x","b":"y"}')));
    }

    public function testFailsOnAKeywordItDoesNotImplement(): void
    {
        /* Silently passing a rule it did not understand is how a validator
         * comes to be trusted for something it never checked. */
        $failures = $this->validator()->validate(['allOf' => []], 'anything');
        self::assertCount(1, $failures);
        self::assertStringContainsString('does not implement', $failures[0]);
        self::assertStringContainsString('worse than failing', $failures[0]);
    }

    public function testFailsOnATypeItDoesNotImplement(): void
    {
        $failures = $this->validator()->validate(['type' => 'tuple'], []);
        self::assertStringContainsString('does not implement', $failures[0]);
    }

    public function testNamesWhereTheFailureIs(): void
    {
        /* "must be a string" without a path is a message somebody has to search
         * a response for. */
        $schema = ['type' => 'object', 'properties' => ['usage' => ['type' => 'object', 'properties' => ['bytes' => ['type' => 'integer']]]]];
        $failures = $this->validator()->validate($schema, $this->decode('{"usage":{"bytes":"lots"}}'), 'the store');
        self::assertStringContainsString('the store.usage.bytes', $failures[0]);
    }
}
