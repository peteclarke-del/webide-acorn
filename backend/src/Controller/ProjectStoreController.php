<?php

declare(strict_types=1);

namespace App\Controller;

use App\Http\ApiProblem;
use App\Http\ApiProblemResponse;
use App\Observability\RequestContext;
use App\Storage\ProjectStore;
use App\Storage\StorageError;
use App\Storage\StorageLimits;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Projects kept on the server, and their history.
 *
 * There is one identity, `local`, and nothing proves it: this is storage on a
 * machine somebody already controls, not an account. The owner is carried
 * through every route anyway, so the authorisation that CLD-800 will bring has
 * something to attach to rather than a schema to migrate.
 *
 * Every refusal the store makes is reported with its reason and its remedy
 * rather than flattened into one status, because "invalid request" teaches a
 * client to send the same thing again.
 */
final class ProjectStoreController
{
    private const OWNER = ProjectStore::LOCAL_OWNER;

    /** How a storage refusal maps onto HTTP, and whether trying again could help. */
    private const REFUSALS = [
        'IDENTIFIER_INVALID' => [400, false],
        'FILENAME_INVALID' => [400, false],
        'REVISION_EMPTY' => [400, false],
        'REVISION_TOO_MANY_FILES' => [400, false],
        'BLOB_EMPTY' => [400, false],
        'BLOB_TOO_LARGE' => [413, false],
        'BLOB_DIGEST_INVALID' => [400, false],
        'OWNER_BYTE_QUOTA' => [409, false],
        'OWNER_PROJECT_QUOTA' => [409, false],
        /* Somebody else committed in between. Retrying the same write would
         * fail again; reading the head and merging would not. */
        'REVISION_STALE_PARENT' => [409, false],
        'REVISION_NOT_FOUND' => [404, false],
        'PROJECT_NOT_FOUND' => [404, false],
        'BLOB_NOT_FOUND' => [404, false],
        /* The store is damaged. Not the caller's doing and not retryable. */
        'BLOB_CORRUPT' => [500, false],
        'PROJECT_UNWRITABLE' => [503, true],
        'BLOB_UNWRITABLE' => [503, true],
    ];

    public function __construct(
        private readonly ProjectStore $store,
        private readonly RequestContext $context,
    ) {
    }

    #[Route('/api/v1/store', name: 'api_store_usage', methods: ['GET'])]
    public function usage(): JsonResponse
    {
        return $this->answer(function (): JsonResponse {
            return $this->json([
                'schema' => '8bit-net.project-store',
                'version' => 1,
                /* Said in the response rather than left to be inferred: a client
                 * that thought this was an account would be wrong about who can
                 * read it. */
                'identity' => ['owner' => self::OWNER, 'authenticated' => false, 'detail' => 'One local identity. Nothing proves who you are, so this store is exactly as private as the machine it runs on.'],
                'usage' => $this->guard(fn (): array => $this->store->usage(self::OWNER)),
                'limits' => StorageLimits::manifest(),
            ]);
    
        });
    }

    #[Route('/api/v1/store/projects', name: 'api_store_projects', methods: ['GET'])]
    public function projects(): JsonResponse
    {
        return $this->answer(function (): JsonResponse {
            $projects = $this->guard(fn (): array => $this->store->projects(self::OWNER));

            return $this->json([
                'schema' => '8bit-net.project-store-projects',
                'version' => 1,
                'projects' => array_map(fn (string $id): array => [
                    'id' => $id,
                    'revisions' => count($this->store->revisions(self::OWNER, $id)),
                ], $projects),
            ]);
    
        });
    }

    #[Route('/api/v1/store/projects/{projectId}/revisions', name: 'api_store_revisions', methods: ['GET'])]
    public function revisions(string $projectId): JsonResponse
    {
        return $this->answer(function () use ($projectId): JsonResponse {
            $revisions = $this->guard(fn (): array => $this->store->revisions(self::OWNER, $projectId));

            return $this->json([
                'schema' => '8bit-net.project-store-revisions',
                'version' => 1,
                'projectId' => $projectId,
                /* The manifest without the content: a timeline is read far more
                 * often than a revision is restored. */
                'revisions' => array_map(static fn (array $revision): array => [
                    'id' => $revision['id'],
                    'parent' => $revision['parent'],
                    'writtenAt' => $revision['writtenAt'],
                    'note' => $revision['note'],
                    'files' => count($revision['files']),
                ], $revisions),
            ]);
    
        });
    }

    #[Route('/api/v1/store/projects/{projectId}/revisions', name: 'api_store_commit', methods: ['POST'])]
    public function commit(string $projectId, Request $request): JsonResponse
    {
        return $this->answer(function () use ($projectId, $request): JsonResponse {
            $payload = $this->payload($request);
            $files = $payload['files'] ?? null;
            if (!is_array($files) || $files === []) {
                throw new ApiProblem(400, 'STORE_FILES_REQUIRED', 'Send files as an object of filename to base64 content. A revision names what a project contains at that moment.');
            }
            $decoded = [];
            foreach ($files as $name => $encoded) {
                if (!is_string($encoded)) {
                    throw new ApiProblem(400, 'STORE_FILE_NOT_TEXT', sprintf('The content of %s is not a base64 string.', (string) $name));
                }
                $bytes = base64_decode($encoded, true);
                if ($bytes === false) {
                    throw new ApiProblem(400, 'STORE_FILE_NOT_BASE64', sprintf('The content of %s is not valid base64. Content is sent encoded so that a binary asset survives the journey.', (string) $name));
                }
                $decoded[(string) $name] = $bytes;
            }
            $parent = $payload['parent'] ?? null;
            if ($parent !== null && !is_string($parent)) {
                throw new ApiProblem(400, 'STORE_PARENT_INVALID', 'A parent is the identifier of the revision this one was written against, or null for the first.');
            }
            $note = is_string($payload['note'] ?? null) ? $payload['note'] : '';

            $revision = $this->guard(fn (): array => $this->store->commit(self::OWNER, $projectId, $decoded, $parent, $note));

            return $this->json(['schema' => '8bit-net.project-revision', 'version' => 1, 'revision' => $revision], 201);
    
        });
    }

    #[Route('/api/v1/store/projects/{projectId}/revisions/{revisionId}', name: 'api_store_read', methods: ['GET'])]
    public function read(string $projectId, string $revisionId): JsonResponse
    {
        return $this->answer(function () use ($projectId, $revisionId): JsonResponse {
            $files = $this->guard(fn (): array => $this->store->read(self::OWNER, $projectId, $revisionId));

            return $this->json([
                'schema' => '8bit-net.project-store-revision-content',
                'version' => 1,
                'projectId' => $projectId,
                'revisionId' => $revisionId,
                'files' => array_map(static fn (string $bytes): string => base64_encode($bytes), $files),
            ]);
    
        });
    }

    #[Route('/api/v1/store/export', name: 'api_store_export', methods: ['GET'])]
    public function export(): JsonResponse
    {
        return $this->answer(function (): JsonResponse {
            /* Everything, including history. Work somebody cannot get out is
             * work the store has taken. */
            return $this->json($this->guard(fn (): array => $this->store->export(self::OWNER)));
        });
    }

    #[Route('/api/v1/store/projects/{projectId}', name: 'api_store_delete', methods: ['DELETE'])]
    public function delete(string $projectId, Request $request): JsonResponse
    {
        return $this->answer(function () use ($projectId, $request): JsonResponse {
            /*
             * Deleting a project removes every revision of it. That cannot be
             * undone here, so it is not something a stray request should do:
             * the caller has to name the project it means, in the body, and a
             * mismatch is refused rather than resolved in favour of the URL.
             */
            $payload = $request->getContent() === '' ? [] : $this->payload($request);
            $confirmed = $payload['confirmProjectId'] ?? null;
            if ($confirmed !== $projectId) {
                throw new ApiProblem(400, 'STORE_DELETE_UNCONFIRMED', sprintf('Deleting removes every revision of %s and cannot be undone here. Send {"confirmProjectId":"%s"} to confirm that is the project you mean.', $projectId, $projectId));
            }
            $reason = is_string($payload['reason'] ?? null) ? $payload['reason'] : '';
            $tombstone = $this->guard(fn (): array => $this->store->deleteProject(self::OWNER, $projectId, $reason));

            return $this->json(['schema' => '8bit-net.project-tombstone', 'version' => 1, 'tombstone' => $tombstone]);
        });
    }

    #[Route('/api/v1/store/tombstones', name: 'api_store_tombstones', methods: ['GET'])]
    public function tombstones(): JsonResponse
    {
        return $this->answer(function (): JsonResponse {
            return $this->json([
                'schema' => '8bit-net.project-store-tombstones',
                'version' => 1,
                'tombstones' => $this->guard(fn (): array => $this->store->tombstones(self::OWNER)),
                'detail' => 'What has been deleted, and when. Deleting without a trace is indistinguishable from a project that was never there.',
            ]);
        });
    }

    #[Route('/api/v1/store/collect', name: 'api_store_collect', methods: ['POST'])]
    public function collect(): JsonResponse
    {
        return $this->answer(function (): JsonResponse {
            $collected = $this->guard(fn (): array => $this->store->collect(self::OWNER));

            return $this->json([
                'schema' => '8bit-net.project-store-collection',
                'version' => 1,
                'collected' => $collected,
                'detail' => 'Only content no revision names was removed. A blob any revision names is never collected, and no revision is ever removed to make one collectable.',
            ]);
    
        });
    }

    /** @param array<string, mixed> $body */
    private function payload(Request $request): array
    {
        $raw = $request->getContent();
        /* Matched by `client_max_body_size` on the store's own nginx location.
         * If the proxy refused first the caller would get a bare 413 with none
         * of this wording, so the two numbers are kept deliberately equal. */
        if (strlen($raw) > StorageLimits::BLOB_BYTES * 2) {
            throw new ApiProblem(413, 'STORE_REQUEST_TOO_LARGE', 'The request is larger than this store accepts in one revision.');
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new ApiProblem(400, 'STORE_BODY_INVALID', 'The request body is not a JSON object.');
        }

        return $decoded;
    }

    /**
     * Run a store operation, turning its refusal into the answer it deserves.
     *
     * @template T
     * @param callable(): T $operation
     * @return T
     */
    private function guard(callable $operation): mixed
    {
        try {
            return $operation();
        } catch (StorageError $error) {
            [$status, $retryable] = self::REFUSALS[$error->reason] ?? [500, false];
            throw new ApiProblem($status, $error->reason, $error->getMessage(), $retryable);
        }
    }

    /**
     * Run a route, rendering a refusal rather than letting it escape.
     *
     * An ApiProblem thrown out of a controller becomes Symfony's HTML error
     * page: a 500 with no code, no correlation identifier and no indication
     * whether retrying helps. That happened here and was found by calling the
     * running container rather than by reading the code.
     *
     * @param callable(): JsonResponse $route
     */
    private function answer(callable $route): JsonResponse
    {
        $correlationId = $this->context->correlationId();
        try {
            return $route();
        } catch (ApiProblem $problem) {
            return ApiProblemResponse::from($problem, $correlationId);
        }
    }

    /** @param array<string, mixed> $body */
    private function json(array $body, int $status = 200): JsonResponse
    {
        return ApiProblemResponse::json($body + ['requestId' => $this->context->correlationId()], $status, $this->context->correlationId());
    }
}
