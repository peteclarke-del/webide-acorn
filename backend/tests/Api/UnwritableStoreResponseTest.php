<?php

declare(strict_types=1);

namespace App\Tests\Api;

use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/**
 * What somebody is actually told when the store cannot be written to.
 *
 * This is the case that turns up the moment the backend runs outside its
 * container: PROJECT_STORE_ROOT is unset, the default path belongs to the
 * container's volume, and nothing may create it. The store always meant to
 * answer PROJECT_UNWRITABLE, which the workbench can show and act on. It did
 * not: PHP raised a warning before returning false, the development
 * environment promoted the warning to an exception, and what came back was an
 * HTML page of PHP internals with no machine-readable reason in it at all.
 *
 * The test asks over HTTP rather than of the store directly, because the shape
 * of the answer is what a client depends on and a unit test of the store could
 * not have shown it. It runs in the test environment, which does not promote
 * warnings, so what it pins is the contract: the code, a message naming the
 * path, that it is worth retrying, and a correlation id. That the development
 * environment no longer answers with a page of PHP internals was proved
 * against a running server, and is recorded in the commit that fixed it.
 */
final class UnwritableStoreResponseTest extends WebTestCase
{
    private string $blocked = '';

    protected function setUp(): void
    {
        self::ensureKernelShutdown();
        /* A path that cannot be created because a file stands where its parent
         * directory would have to be. This holds however the suite is run,
         * including as root, where a permission bit would not. */
        $file = sys_get_temp_dir().'/unwritable-store-'.bin2hex(random_bytes(6));
        file_put_contents($file, "not a directory\n");
        $this->blocked = $file.'/store';
        $_ENV['PROJECT_STORE_ROOT'] = $this->blocked;
        $_SERVER['PROJECT_STORE_ROOT'] = $this->blocked;
    }

    protected function tearDown(): void
    {
        @unlink(substr($this->blocked, 0, -6));
        unset($_ENV['PROJECT_STORE_ROOT'], $_SERVER['PROJECT_STORE_ROOT']);
    }

    public function testACommitAnswersTheStoresOwnRefusalRatherThanAPageOfPhpInternals(): void
    {
        $client = static::createClient();
        $client->catchExceptions(false);
        $client->request(
            'POST',
            '/api/v1/store/projects/demo/revisions',
            [],
            [],
            ['CONTENT_TYPE' => 'application/json'],
            (string) json_encode(['files' => ['main.asm' => base64_encode('RTS')]], JSON_THROW_ON_ERROR),
        );
        $response = $client->getResponse();

        /* 503 rather than 500: the store is not broken, it has nowhere to
         * write, and that is something whoever runs it can put right. */
        self::assertSame(503, $response->getStatusCode());
        self::assertStringContainsString('json', (string) $response->headers->get('Content-Type'));

        /** @var array{error?: array<string, mixed>} $body */
        $body = json_decode((string) $response->getContent(), true, 512, JSON_THROW_ON_ERROR);
        $problem = $body['error'] ?? [];
        self::assertContains($problem['code'] ?? '', ['PROJECT_UNWRITABLE', 'BLOB_UNWRITABLE']);
        /* Naming the path is the difference between something to act on and a
         * sentence saying that something went wrong. */
        self::assertStringContainsString($this->blocked, (string) ($problem['message'] ?? ''));
        /* An unwritable store is the one refusal worth trying again, once
         * whoever runs it has given it somewhere to write. */
        self::assertTrue($problem['retryable'] ?? false);
        self::assertNotSame('', (string) ($problem['correlationId'] ?? ''));
    }
}
