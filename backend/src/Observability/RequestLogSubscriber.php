<?php

declare(strict_types=1);

namespace App\Observability;

use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * One record per request, and the correlation identifier back on the response.
 *
 * The identifier is returned in a header so that whoever made the request can
 * quote it when something went wrong; without that, a user reporting a failed
 * build and the line describing it cannot be connected by anyone.
 *
 * What is recorded is the shape of the request, never its contents: method,
 * route, status, how long it took and how large the bodies were. Those are the
 * measurements the service-level objectives are written against, and none of
 * them is a copy of anybody's source.
 */
final class RequestLogSubscriber implements EventSubscriberInterface
{
    private float $startedAt = 0.0;

    public function __construct(
        private readonly RequestContext $context,
        private readonly StructuredLogger $logger,
    ) {
    }

    /** @return array<string, array{0: string, 1: int}> */
    public static function getSubscribedEvents(): array
    {
        return [
            /* Before anything else, so every later line carries the identifier. */
            KernelEvents::REQUEST => ['onRequest', 4096],
            KernelEvents::RESPONSE => ['onResponse', -4096],
            KernelEvents::EXCEPTION => ['onException', 0],
        ];
    }

    public function onRequest(RequestEvent $event): void
    {
        if (!$event->isMainRequest()) {
            return;
        }
        $this->startedAt = microtime(true);
        $this->context->adopt($event->getRequest());
    }

    public function onResponse(ResponseEvent $event): void
    {
        if (!$event->isMainRequest()) {
            return;
        }
        $request = $event->getRequest();
        $response = $event->getResponse();
        $response->headers->set(RequestContext::HEADER, $this->context->correlationId());

        $status = $response->getStatusCode();
        $fields = [
            'method' => $request->getMethod(),
            /* The route name, not the path: a path can carry a caller's own
             * strings and a route name cannot. */
            'route' => (string) $request->attributes->get('_route', 'unrouted'),
            'status' => $status,
            'durationMs' => $this->elapsedMs(),
            'requestBytes' => (int) $request->headers->get('Content-Length', '0'),
            'responseBytes' => strlen((string) $response->getContent()),
        ];
        if ($status >= 500) {
            $this->logger->error('request', $fields);

            return;
        }
        if ($status >= 400) {
            $this->logger->warning('request', $fields);

            return;
        }
        $this->logger->info('request', $fields);
    }

    public function onException(ExceptionEvent $event): void
    {
        if (!$event->isMainRequest()) {
            return;
        }
        $throwable = $event->getThrowable();
        $this->logger->error('unhandled-exception', [
            /* The class and where it was raised, not the message: an exception
             * message can quote the input that caused it, and the input here is
             * somebody's source. */
            'exceptionClass' => $throwable::class,
            'file' => basename($throwable->getFile()),
            'line' => $throwable->getLine(),
            'route' => (string) $event->getRequest()->attributes->get('_route', 'unrouted'),
            'durationMs' => $this->elapsedMs(),
        ]);
    }

    private function elapsedMs(): float
    {
        return $this->startedAt > 0.0 ? round((microtime(true) - $this->startedAt) * 1000, 3) : 0.0;
    }
}
