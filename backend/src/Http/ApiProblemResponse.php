<?php

declare(strict_types=1);

namespace App\Http;

use App\Observability\RequestContext;
use Symfony\Component\HttpFoundation\JsonResponse;

/**
 * The one shape an API refusal takes.
 *
 * It was written inside the build controller, which was fine while there was
 * one controller. A second one that threw without catching produced Symfony's
 * HTML error page instead — a 500 with no code, no correlation identifier and
 * no indication whether trying again could help. Every route now renders a
 * refusal the same way, because a client cannot parse two error formats and
 * should not have to discover which it got.
 */
final class ApiProblemResponse
{
    public static function from(ApiProblem $problem, string $correlationId): JsonResponse
    {
        return self::json([
            'error' => [
                'code' => $problem->errorCode,
                'correlationId' => $correlationId,
                'message' => $problem->getMessage(),
                'retryable' => $problem->retryable,
                'fields' => $problem->fields,
            ],
        ], $problem->status, $correlationId);
    }

    /** @param array<string, mixed> $payload */
    public static function json(array $payload, int $status = 200, ?string $correlationId = null): JsonResponse
    {
        $response = new JsonResponse($payload, $status, ['Cache-Control' => 'no-store', 'X-Content-Type-Options' => 'nosniff']);
        if ($correlationId !== null) {
            $response->headers->set(RequestContext::HEADER, $correlationId);
        }

        return $response;
    }
}
