<?php

declare(strict_types=1);

namespace App\Tests\Api;

use App\Api\SchemaValidator;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\HttpFoundation\Response;

/**
 * That the server and the accepted API description are the same API.
 *
 * The description in api/openapi.json is the contract the TypeScript clients
 * are generated from. Generating them proves the clients agree with the
 * document; it proves nothing about whether the document agrees with the
 * server. This is that half: real requests through the real kernel, and every
 * answer checked against the schema the document declares for the status it
 * came back with.
 *
 * Nothing here is conditional on the environment. A build route answers 200
 * where the toolchains are installed and 503 where they are not, and both are
 * responses the description declares, so both are checked. A status the
 * description does not declare at all is a failure wherever it happens — which
 * is the point, because an undeclared status is a shape no client was written
 * for.
 */
final class DescriptionConformanceTest extends WebTestCase
{
    /** @var array<string, mixed> */
    private static array $description;

    private string $storeRoot;

    public static function setUpBeforeClass(): void
    {
        $path = __DIR__.'/../../../api/openapi.json';
        self::assertFileExists($path, 'The accepted API description is what this test checks against.');
        /** @var array<string, mixed> $decoded */
        $decoded = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        self::$description = $decoded;
    }

    protected function setUp(): void
    {
        /* Each test boots its own kernel, so each gets the store root set
         * below rather than the one the previous test was using. */
        self::ensureKernelShutdown();

        /* Its own store, so the test writes real revisions and reads real
         * answers without touching anything a person put there. */
        $this->storeRoot = sys_get_temp_dir().'/api-conformance-'.bin2hex(random_bytes(6));
        $_ENV['PROJECT_STORE_ROOT'] = $this->storeRoot;
        $_SERVER['PROJECT_STORE_ROOT'] = $this->storeRoot;
    }

    protected function tearDown(): void
    {
        $this->removeTree($this->storeRoot);
        unset($_ENV['PROJECT_STORE_ROOT'], $_SERVER['PROJECT_STORE_ROOT']);
    }

    private function removeTree(string $path): void
    {
        if (!is_dir($path)) {
            return;
        }
        foreach (scandir($path) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $child = $path.'/'.$entry;
            is_dir($child) && !is_link($child) ? $this->removeTree($child) : @unlink($child);
        }
        @rmdir($path);
    }

    /** @return array<string, mixed> */
    private function schemas(): array
    {
        /** @var array<string, mixed> $schemas */
        $schemas = self::$description['components']['schemas'] ?? [];

        return $schemas;
    }

    /**
     * Every operation the description declares.
     *
     * @return list<array{path: string, method: string, operation: array<string, mixed>}>
     */
    private function declaredOperations(): array
    {
        $found = [];
        /** @var array<string, array<string, mixed>> $paths */
        $paths = self::$description['paths'] ?? [];
        foreach ($paths as $path => $item) {
            foreach (['get', 'post', 'put', 'patch', 'delete'] as $method) {
                if (isset($item[$method]) && is_array($item[$method])) {
                    $found[] = ['path' => $path, 'method' => strtoupper($method), 'operation' => $item[$method]];
                }
            }
        }

        return $found;
    }

    /**
     * Every API route the application actually has.
     *
     * @return list<string> "METHOD /path"
     */
    private function routedOperations(KernelBrowser $client): array
    {
        $router = $client->getContainer()->get('router');
        self::assertInstanceOf(\Symfony\Component\Routing\RouterInterface::class, $router);
        $found = [];
        foreach ($router->getRouteCollection() as $route) {
            if (!str_starts_with($route->getPath(), '/api/')) {
                continue;
            }
            foreach ($route->getMethods() ?: ['GET'] as $method) {
                $found[] = $method.' '.$route->getPath();
            }
        }
        sort($found);

        return $found;
    }

    public function testTheDescriptionAndTheRouterDeclareTheSameApi(): void
    {
        /* Both directions. A route the description does not mention is one no
         * client was generated for and nothing checks; a route the description
         * mentions and the application does not have is a client that will 404
         * at somebody. */
        $client = static::createClient();
        $described = array_map(static fn (array $entry): string => $entry['method'].' '.$entry['path'], $this->declaredOperations());
        sort($described);

        self::assertSame($this->routedOperations($client), $described, 'The accepted API description and the application router disagree about what this API is.');
    }

    public function testEveryDescribedOperationHasAnIdentifierAndASuccessfulResponse(): void
    {
        foreach ($this->declaredOperations() as $entry) {
            $where = $entry['method'].' '.$entry['path'];
            self::assertArrayHasKey('operationId', $entry['operation'], $where.' has no operationId, so no client can be generated for it.');
            /** @var array<string, mixed> $responses */
            $responses = $entry['operation']['responses'] ?? [];
            $successes = array_filter(array_keys($responses), static fn (string|int $code): bool => str_starts_with((string) $code, '2'));
            self::assertNotEmpty($successes, $where.' declares no successful response.');
        }
    }

    public function testTheDescriptionUsesNothingTheValidatorCannotCheck(): void
    {
        /* A description that used a keyword the validator ignores would be
         * checked less thoroughly than it looks. */
        $unknown = [];
        $walk = static function (mixed $node, string $where) use (&$walk, &$unknown): void {
            if (!is_array($node)) {
                return;
            }
            if (isset($node['type']) || isset($node['$ref']) || isset($node['oneOf']) || array_key_exists('const', $node) || isset($node['enum'])) {
                foreach (array_keys($node) as $keyword) {
                    if (!in_array((string) $keyword, SchemaValidator::KNOWN, true)) {
                        $unknown[] = $where.': '.(string) $keyword;
                    }
                }
            }
            foreach ($node as $key => $child) {
                $walk($child, $where.'.'.(string) $key);
            }
        };
        $walk($this->schemas(), 'schemas');
        self::assertSame([], $unknown, 'The description uses schema keywords the validator does not implement, so those rules are not being checked.');
    }

    /**
     * Check one real answer against the description.
     *
     * @param array<string, mixed> $operation
     */
    private function assertConforms(array $operation, Response $response, string $where): void
    {
        /** @var array<string|int, mixed> $responses */
        $responses = $operation['responses'] ?? [];
        $status = $response->getStatusCode();
        self::assertArrayHasKey(
            (string) $status,
            $responses,
            sprintf('%s answered %d, which the description does not declare. An undeclared status is a shape no client was written for. It declared: %s.', $where, $status, implode(', ', array_map('strval', array_keys($responses)))),
        );

        /** @var array<string, mixed> $declared */
        $declared = $responses[(string) $status];
        /** @var array<string, mixed>|null $schema */
        $schema = $declared['content']['application/json']['schema'] ?? null;
        if ($schema === null) {
            return;
        }

        $body = (string) $response->getContent();
        $decoded = json_decode($body, false, 512, JSON_THROW_ON_ERROR);
        $failures = (new SchemaValidator($this->schemas()))->validate($schema, $decoded, $where.' → '.$status);
        self::assertSame([], $failures, sprintf("%s answered %d with a body the description does not describe:\n- %s", $where, $status, implode("\n- ", $failures)));
    }

    /** @return array<string, mixed> */
    private function operationFor(string $method, string $path): array
    {
        foreach ($this->declaredOperations() as $entry) {
            if ($entry['method'] === $method && $entry['path'] === $path) {
                return $entry['operation'];
            }
        }
        self::fail(sprintf('The description declares no %s %s.', $method, $path));
    }

    /** @param array<string, mixed>|null $body */
    private function callRoute(KernelBrowser $client, string $method, string $concrete, string $declared, ?array $body = null): Response
    {
        $client->request(
            $method,
            $concrete,
            [],
            [],
            $body === null ? [] : ['CONTENT_TYPE' => 'application/json', 'HTTP_X_8BIT_NET_REQUEST' => 'native-build'],
            $body === null ? null : (string) json_encode($body, JSON_THROW_ON_ERROR),
        );
        $response = $client->getResponse();
        $this->assertConforms($this->operationFor($method, $declared), $response, $method.' '.$declared);

        return $response;
    }

    public function testHealthAndToolchainRoutesAnswerWhatTheDescriptionSays(): void
    {
        $client = static::createClient();
        $this->callRoute($client, 'GET', '/api/health/live', '/api/health/live');
        $this->callRoute($client, 'GET', '/api/health/ready', '/api/health/ready');
        foreach (['ca65', 'beebasm', 'cc65-c', 'arm-binutils'] as $slug) {
            /* 200 where the toolchain is installed and 503 where it is not.
             * Both are declared, both are checked, and neither is skipped. */
            $this->callRoute($client, 'GET', '/api/v1/toolchains/'.$slug, '/api/v1/toolchains/'.$slug);
        }
    }

    public function testTheSdkRouteAnswersWhatTheDescriptionSays(): void
    {
        $client = static::createClient();
        $this->callRoute($client, 'GET', '/api/v1/toolchains/cc65-c/sdk?path=stdio.h', '/api/v1/toolchains/cc65-c/sdk');
        /* A refusal is part of the contract too, and it is the part a client
         * most needs to be able to parse. */
        $refusal = $this->callRoute($client, 'GET', '/api/v1/toolchains/cc65-c/sdk?path=../../etc/passwd', '/api/v1/toolchains/cc65-c/sdk');
        self::assertGreaterThanOrEqual(400, $refusal->getStatusCode(), 'A path that leaves the SDK root must be refused.');
    }

    public function testBuildRoutesAnswerWhatTheDescriptionSays(): void
    {
        $client = static::createClient();
        $request = [
            'schema' => '8bit-net.native-build-request',
            'version' => 1,
            'requestId' => 'conformance-1',
            'targetId' => 'conformance',
            'machineId' => 'bbc-b',
            'processor' => '6502',
            'profile' => 'debug',
            'origin' => 0x2000,
            'outputName' => 'conformance.bin',
            'files' => [['id' => 'main', 'name' => 'main.s', 'content' => "  .org $2000\n  rts\n"]],
        ];
        foreach (['ca65', 'beebasm', 'cc65-c', 'arm-binutils'] as $slug) {
            $this->callRoute($client, 'POST', '/api/v1/builds/'.$slug, '/api/v1/builds/'.$slug, $request);
        }
    }

    public function testABuildWithoutTheRequestHeaderIsRefusedInTheShapeTheDescriptionDeclares(): void
    {
        /* A form or an image tag cannot set a header, so requiring one is what
         * stops a cross-site request from starting a build in somebody's
         * browser. The refusal was enforced and undeclared until the
         * conformance test asked for a status the description did not have. */
        $client = static::createClient();
        $client->request('POST', '/api/v1/builds/ca65', [], [], ['CONTENT_TYPE' => 'application/json'], '{}');
        $response = $client->getResponse();
        self::assertSame(403, $response->getStatusCode());
        $this->assertConforms($this->operationFor('POST', '/api/v1/builds/ca65'), $response, 'POST /api/v1/builds/ca65 without its header');
    }

    public function testTheStoreAnswersWhatTheDescriptionSaysThroughAWholeLifecycle(): void
    {
        /* One project written, listed, read back and deleted, with every answer
         * checked. Reading the routes one at a time against an empty store
         * would check the shape of "nothing", which is the shape least likely
         * to have drifted. */
        $client = static::createClient();
        $this->callRoute($client, 'GET', '/api/v1/store', '/api/v1/store');
        $this->callRoute($client, 'GET', '/api/v1/store/projects', '/api/v1/store/projects');

        $written = $this->callRoute(
            $client,
            'POST',
            '/api/v1/store/projects/conformance/revisions',
            '/api/v1/store/projects/{projectId}/revisions',
            ['files' => ['main.s' => base64_encode("  rts\n")], 'parent' => null, 'note' => 'written by the conformance test'],
        );
        self::assertSame(201, $written->getStatusCode(), 'A written revision is a creation.');
        $revision = json_decode((string) $written->getContent(), true, 512, JSON_THROW_ON_ERROR);
        self::assertIsArray($revision);
        $revisionId = $revision['revision']['id'] ?? null;
        self::assertIsString($revisionId);

        $this->callRoute($client, 'GET', '/api/v1/store/projects/conformance/revisions', '/api/v1/store/projects/{projectId}/revisions');
        $this->callRoute($client, 'GET', '/api/v1/store/projects/conformance/revisions/'.$revisionId, '/api/v1/store/projects/{projectId}/revisions/{revisionId}');
        $this->callRoute($client, 'GET', '/api/v1/store/export', '/api/v1/store/export');

        /* The refusal a client is most likely to meet, and the one it must be
         * able to act on: a write against a parent that is no longer the head. */
        $stale = $this->callRoute(
            $client,
            'POST',
            '/api/v1/store/projects/conformance/revisions',
            '/api/v1/store/projects/{projectId}/revisions',
            ['files' => ['main.s' => base64_encode("  nop\n")], 'parent' => null, 'note' => 'written against a parent that has moved'],
        );
        self::assertSame(409, $stale->getStatusCode(), 'A write against a stale parent must collide rather than overwrite.');

        $this->callRoute($client, 'POST', '/api/v1/store/collect', '/api/v1/store/collect');
        $this->callRoute($client, 'DELETE', '/api/v1/store/projects/conformance', '/api/v1/store/projects/{projectId}', ['confirmProjectId' => 'conformance', 'reason' => 'the conformance test is finished with it']);
        $this->callRoute($client, 'GET', '/api/v1/store/tombstones', '/api/v1/store/tombstones');
    }
}
