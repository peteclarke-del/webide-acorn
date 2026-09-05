<?php

declare(strict_types=1);

namespace App\Controller;

use App\Build\ArmBuildManifest;
use App\Build\ArmBuildService;
use App\Build\BeebAsmBuildService;
use App\Build\BeebAsmManifest;
use App\Build\BuildLimits;
use App\Build\CBuildManifest;
use App\Build\CBuildService;
use App\Build\CSDKDocumentService;
use App\Build\NativeBuildRequest;
use App\Build\NativeBuildService;
use App\Build\ToolchainManifest;
use App\Http\ApiProblem;
use App\Http\ApiProblemResponse;
use App\Observability\RequestContext;
use App\Observability\StructuredLogger;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

final class NativeBuildController
{
    public function __construct(
        private readonly ToolchainManifest $toolchain,
        private readonly NativeBuildService $builds,
        private readonly BeebAsmManifest $beebAsm,
        private readonly BeebAsmBuildService $beebAsmBuilds,
        private readonly CBuildManifest $cToolchain,
        private readonly CBuildService $cBuilds,
        private readonly CSDKDocumentService $cSdkDocuments,
        private readonly ArmBuildManifest $armToolchain,
        private readonly ArmBuildService $armBuilds,
        private readonly RequestContext $context,
        private readonly StructuredLogger $logger,
    ) {
    }

    #[Route('/api/health/live', name: 'api_health_live', methods: ['GET'])]
    public function live(): JsonResponse
    {
        return $this->json(['status' => 'live', 'service' => 'webide-acorn-native-builder', 'apiVersion' => 1]);
    }

    #[Route('/api/health/ready', name: 'api_health_ready', methods: ['GET'])]
    public function ready(): JsonResponse
    {
        $manifest = $this->toolchain->detect();
        $beebAsm = $this->beebAsm->detect();
        $cToolchain = $this->cToolchain->detect();
        $armToolchain = $this->armToolchain->detect();
        $toolchains = [$manifest, $beebAsm, $cToolchain, $armToolchain];
        $ready = true;
        /* Every unmet check, named with its toolchain, so whoever is looking at
         * a not-ready service is told what to fix rather than only that
         * something is wrong somewhere. */
        $unmet = [];
        foreach ($toolchains as $toolchain) {
            $ready = $ready && $toolchain['ready'] === true;
            foreach (is_array($toolchain['readiness'] ?? null) ? $toolchain['readiness'] : [] as $check) {
                if ($check['ok'] !== true) {
                    $unmet[] = ['toolchain' => $toolchain['id'], 'check' => $check['check'], 'detail' => $check['detail']];
                }
            }
        }

        return $this->json(['status' => $ready ? 'ready' : 'not-ready', 'service' => 'webide-acorn-native-builder', 'unmet' => $unmet, 'toolchain' => $manifest, 'toolchains' => $toolchains], $ready ? 200 : 503);
    }

    #[Route('/api/v1/toolchains/ca65', name: 'api_toolchain_ca65', methods: ['GET'])]
    public function manifest(): JsonResponse
    {
        $manifest = $this->toolchain->detect();

        return $this->json($manifest, $manifest['ready'] ? 200 : 503);
    }

    #[Route('/api/v1/toolchains/beebasm', name: 'api_toolchain_beebasm', methods: ['GET'])]
    public function beebAsmManifest(): JsonResponse
    {
        $manifest = $this->beebAsm->detect();
        return $this->json($manifest, $manifest['ready'] ? 200 : 503);
    }

    #[Route('/api/v1/toolchains/cc65-c', name: 'api_toolchain_cc65_c', methods: ['GET'])]
    public function cManifest(): JsonResponse
    {
        $manifest = $this->cToolchain->detect();
        return $this->json($manifest, $manifest['ready'] ? 200 : 503);
    }

    #[Route('/api/v1/toolchains/cc65-c/sdk', name: 'api_toolchain_cc65_c_sdk', methods: ['GET'])]
    public function cSdkDocument(Request $request): JsonResponse
    {
        $correlationId = $this->correlationId($request);
        try {
            $this->authorizeLocalRead($request);
            $path = $request->query->get('path');
            if (!is_string($path)) throw new ApiProblem(400, 'SDK_PATH_REQUIRED', 'SDK document path is required.', false, ['path' => 'Required']);
            return $this->json($this->cSdkDocuments->read($path), 200, $correlationId);
        } catch (ApiProblem $problem) {
            return $this->problem($problem, $correlationId);
        } catch (\Throwable $error) {
            $this->logger->error('sdk-document-internal-error', ['exceptionClass' => $error::class]);
            return $this->problem(new ApiProblem(500, 'SDK_DOCUMENT_INTERNAL_ERROR', 'The SDK document service encountered an internal error.', true), $correlationId);
        }
    }

    #[Route('/api/v1/toolchains/arm-binutils', name: 'api_toolchain_arm_binutils', methods: ['GET'])]
    public function armManifest(): JsonResponse
    {
        $manifest = $this->armToolchain->detect();
        return $this->json($manifest, $manifest['ready'] ? 200 : 503);
    }

    #[Route('/api/v1/builds/ca65', name: 'api_build_ca65', methods: ['POST'])]
    public function build(Request $request): JsonResponse
    {
        $correlationId = $this->correlationId($request);
        try {
            $this->authorizeLocalRequest($request);
            $declaredLength = $request->headers->get('Content-Length');
            if ($declaredLength !== null && ctype_digit($declaredLength) && (int) $declaredLength > BuildLimits::REQUEST_BYTES) {
                throw new ApiProblem(413, 'BUILD_REQUEST_TOO_LARGE', sprintf('Native build requests are limited to %d bytes.', BuildLimits::REQUEST_BYTES));
            }
            $content = $request->getContent();
            if (strlen($content) > BuildLimits::REQUEST_BYTES) {
                throw new ApiProblem(413, 'BUILD_REQUEST_TOO_LARGE', sprintf('Native build requests are limited to %d bytes.', BuildLimits::REQUEST_BYTES));
            }
            try {
                $payload = json_decode($content, true, 64, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                throw new ApiProblem(400, 'BUILD_JSON_INVALID', 'Request body must be valid JSON.');
            }
            if (!is_array($payload) || array_is_list($payload)) {
                throw new ApiProblem(400, 'BUILD_JSON_INVALID', 'Request body must be a JSON object.');
            }
            $payload['requestId'] = $correlationId;
            $result = $this->builds->build(NativeBuildRequest::fromArray($payload));

            return $this->json($result, 200, $correlationId);
        } catch (ApiProblem $problem) {
            return $this->problem($problem, $correlationId);
        } catch (\Throwable $error) {
            $this->logger->error('native-build-internal-error', ['exceptionClass' => $error::class]);

            return $this->problem(new ApiProblem(500, 'BUILD_INTERNAL_ERROR', 'The native build service encountered an internal error.', true), $correlationId);
        }
    }

    #[Route('/api/v1/builds/beebasm', name: 'api_build_beebasm', methods: ['POST'])]
    public function beebAsmBuild(Request $request): JsonResponse
    {
        $correlationId = $this->correlationId($request);
        try {
            $this->authorizeLocalRequest($request);
            $declaredLength = $request->headers->get('Content-Length');
            if ($declaredLength !== null && ctype_digit($declaredLength) && (int) $declaredLength > BuildLimits::REQUEST_BYTES) throw new ApiProblem(413, 'BUILD_REQUEST_TOO_LARGE', sprintf('Native build requests are limited to %d bytes.', BuildLimits::REQUEST_BYTES));
            $content = $request->getContent();
            if (strlen($content) > BuildLimits::REQUEST_BYTES) throw new ApiProblem(413, 'BUILD_REQUEST_TOO_LARGE', sprintf('Native build requests are limited to %d bytes.', BuildLimits::REQUEST_BYTES));
            try { $payload = json_decode($content, true, 64, JSON_THROW_ON_ERROR); } catch (\JsonException) { throw new ApiProblem(400, 'BUILD_JSON_INVALID', 'Request body must be valid JSON.'); }
            if (!is_array($payload) || array_is_list($payload)) throw new ApiProblem(400, 'BUILD_JSON_INVALID', 'Request body must be a JSON object.');
            $payload['requestId'] = $correlationId;
            return $this->json($this->beebAsmBuilds->build(NativeBuildRequest::fromArray($payload)), 200, $correlationId);
        } catch (ApiProblem $problem) { return $this->problem($problem, $correlationId); }
        catch (\Throwable $error) {
            $this->logger->error('native-build-internal-error', ['adapter' => BeebAsmManifest::ADAPTER_ID, 'exceptionClass' => $error::class]);
            return $this->problem(new ApiProblem(500, 'BUILD_INTERNAL_ERROR', 'The native build service encountered an internal error.', true), $correlationId);
        }
    }

    #[Route('/api/v1/builds/cc65-c', name: 'api_build_cc65_c', methods: ['POST'])]
    public function cBuild(Request $request): JsonResponse
    {
        $correlationId = $this->correlationId($request);
        try {
            $this->authorizeLocalRequest($request);
            $declaredLength = $request->headers->get('Content-Length');
            if ($declaredLength !== null && ctype_digit($declaredLength) && (int) $declaredLength > BuildLimits::REQUEST_BYTES) throw new ApiProblem(413, 'BUILD_REQUEST_TOO_LARGE', sprintf('Native build requests are limited to %d bytes.', BuildLimits::REQUEST_BYTES));
            $content = $request->getContent();
            if (strlen($content) > BuildLimits::REQUEST_BYTES) throw new ApiProblem(413, 'BUILD_REQUEST_TOO_LARGE', sprintf('Native build requests are limited to %d bytes.', BuildLimits::REQUEST_BYTES));
            try { $payload = json_decode($content, true, 64, JSON_THROW_ON_ERROR); } catch (\JsonException) { throw new ApiProblem(400, 'BUILD_JSON_INVALID', 'Request body must be valid JSON.'); }
            if (!is_array($payload) || array_is_list($payload)) throw new ApiProblem(400, 'BUILD_JSON_INVALID', 'Request body must be a JSON object.');
            $payload['requestId'] = $correlationId;
            return $this->json($this->cBuilds->build(NativeBuildRequest::fromArray($payload, 'c')), 200, $correlationId);
        } catch (ApiProblem $problem) { return $this->problem($problem, $correlationId); }
        catch (\Throwable $error) {
            $this->logger->error('native-build-internal-error', ['adapter' => CBuildManifest::ADAPTER_ID, 'exceptionClass' => $error::class]);
            return $this->problem(new ApiProblem(500, 'BUILD_INTERNAL_ERROR', 'The native C build service encountered an internal error.', true), $correlationId);
        }
    }

    #[Route('/api/v1/builds/arm-binutils', name: 'api_build_arm_binutils', methods: ['POST'])]
    public function armBuild(Request $request): JsonResponse
    {
        $correlationId = $this->correlationId($request);
        try {
            $this->authorizeLocalRequest($request);
            $declaredLength = $request->headers->get('Content-Length');
            if ($declaredLength !== null && ctype_digit($declaredLength) && (int) $declaredLength > BuildLimits::REQUEST_BYTES) throw new ApiProblem(413, 'BUILD_REQUEST_TOO_LARGE', sprintf('Native build requests are limited to %d bytes.', BuildLimits::REQUEST_BYTES));
            $content = $request->getContent();
            if (strlen($content) > BuildLimits::REQUEST_BYTES) throw new ApiProblem(413, 'BUILD_REQUEST_TOO_LARGE', sprintf('Native build requests are limited to %d bytes.', BuildLimits::REQUEST_BYTES));
            try { $payload = json_decode($content, true, 64, JSON_THROW_ON_ERROR); } catch (\JsonException) { throw new ApiProblem(400, 'BUILD_JSON_INVALID', 'Request body must be valid JSON.'); }
            if (!is_array($payload) || array_is_list($payload)) throw new ApiProblem(400, 'BUILD_JSON_INVALID', 'Request body must be a JSON object.');
            $payload['requestId'] = $correlationId;
            return $this->json($this->armBuilds->build(NativeBuildRequest::fromArray($payload, 'arm')), 200, $correlationId);
        } catch (ApiProblem $problem) { return $this->problem($problem, $correlationId); }
        catch (\Throwable $error) {
            $this->logger->error('native-build-internal-error', ['adapter' => ArmBuildManifest::ADAPTER_ID, 'exceptionClass' => $error::class]);
            return $this->problem(new ApiProblem(500, 'BUILD_INTERNAL_ERROR', 'The native ARM build service encountered an internal error.', true), $correlationId);
        }
    }

    private function authorizeLocalRequest(Request $request): void
    {
        if (!str_starts_with(strtolower((string) $request->headers->get('Content-Type')), 'application/json')) {
            throw new ApiProblem(415, 'BUILD_CONTENT_TYPE', 'Native build requests require application/json.');
        }
        if ($request->headers->get('X-8bit-Net-Request') !== 'native-build') {
            throw new ApiProblem(403, 'BUILD_REQUEST_HEADER', 'Native build request header is missing.');
        }
        $fetchSite = $request->headers->get('Sec-Fetch-Site');
        if ($fetchSite !== null && !in_array($fetchSite, ['same-origin', 'none'], true)) {
            throw new ApiProblem(403, 'BUILD_ORIGIN_FORBIDDEN', 'Cross-site native build requests are forbidden.');
        }
        $origin = $request->headers->get('Origin');
        if ($origin !== null && rtrim($origin, '/') !== rtrim($request->getSchemeAndHttpHost(), '/')) {
            throw new ApiProblem(403, 'BUILD_ORIGIN_FORBIDDEN', 'Cross-origin native build requests are forbidden.');
        }
    }

    private function authorizeLocalRead(Request $request): void
    {
        $fetchSite = $request->headers->get('Sec-Fetch-Site');
        if ($fetchSite !== null && !in_array($fetchSite, ['same-origin', 'none'], true)) throw new ApiProblem(403, 'SDK_ORIGIN_FORBIDDEN', 'Cross-site SDK document requests are forbidden.');
        $origin = $request->headers->get('Origin');
        if ($origin !== null && rtrim($origin, '/') !== rtrim($request->getSchemeAndHttpHost(), '/')) throw new ApiProblem(403, 'SDK_ORIGIN_FORBIDDEN', 'Cross-origin SDK document requests are forbidden.');
    }

    /*
     * The identifier belongs to the request context, which the log subscriber
     * has already taken from the header. Deriving it a second time here would
     * be a second answer to the same question, and the two would eventually be
     * different in the one situation where it mattered.
     */
    private function correlationId(Request $request): string
    {
        return $this->context->adopt($request);
    }

    private function problem(ApiProblem $problem, string $correlationId): JsonResponse
    {
        return ApiProblemResponse::from($problem, $correlationId);
    }

    /** @param array<string, mixed> $payload */
    private function json(array $payload, int $status = 200, ?string $correlationId = null): JsonResponse
    {
        return ApiProblemResponse::json($payload, $status, $correlationId);
    }
}
