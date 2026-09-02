<?php

declare(strict_types=1);

namespace App\Build;

final class BuildLimits
{
    public const REQUEST_BYTES = 2 * 1024 * 1024;
    public const FILES = 128;
    public const FILE_BYTES = 512 * 1024;
    public const TOTAL_INPUT_BYTES = 2 * 1024 * 1024;
    public const SOURCE_UNITS = 32;
    public const DEFINES = 64;
    public const PATH_BYTES = 160;
    public const PATH_SEGMENTS = 16;
    /**
     * The wall clock a single native tool may take, by default.
     *
     * Five seconds is a thousand times what any of these tools needs for the
     * work, so it is a guard against a runaway tool rather than a budget. It is
     * still wall clock, and wall clock is a property of the machine: on a
     * shared runner a process can be stalled for seconds by something else
     * entirely, and the build is then failed for the neighbour's load.
     *
     * So a deployment that cannot promise wall clock may raise it, within
     * bounds, and the value it is actually running with is published in the
     * manifest. The default is unchanged and lowering it below a second is
     * refused, because a limit short enough to cut off honest work would turn
     * every slow build into a fabricated timeout.
     */
    /** Most files one build may name in SAVE directives. */
    public const SAVE_DIRECTIVES = 64;

    public const STAGE_SECONDS = 5.0;
    public const STAGE_SECONDS_MINIMUM = 1.0;
    public const STAGE_SECONDS_MAXIMUM = 60.0;
    public const STAGE_SECONDS_VARIABLE = 'NATIVE_STAGE_SECONDS';
    public const LOG_BYTES = 256 * 1024;
    public const DOCUMENTS = 32;
    public const DOCUMENT_BYTES = 2 * 1024 * 1024;
    public const ARTIFACT_BYTES = 1024 * 1024;

    /**
     * The wall clock this deployment is actually running with.
     *
     * A value outside the bounds, or one that is not a number, is ignored in
     * favour of the default rather than clamped: a deployment that asked for
     * something impossible has said something about its intent that a silently
     * adjusted number would hide.
     */
    public static function stageSeconds(): float
    {
        $raw = ToolLocator::configured(self::STAGE_SECONDS_VARIABLE);
        if ($raw === null || !is_numeric($raw)) return self::STAGE_SECONDS;
        $seconds = (float) $raw;
        if ($seconds < self::STAGE_SECONDS_MINIMUM || $seconds > self::STAGE_SECONDS_MAXIMUM) return self::STAGE_SECONDS;

        return $seconds;
    }

    /** @return array<string, int|float> */
    public static function manifest(): array
    {
        return [
            'requestBytes' => self::REQUEST_BYTES,
            'files' => self::FILES,
            'fileBytes' => self::FILE_BYTES,
            'totalInputBytes' => self::TOTAL_INPUT_BYTES,
            'sourceUnits' => self::SOURCE_UNITS,
            'defines' => self::DEFINES,
            'pathBytes' => self::PATH_BYTES,
            'pathSegments' => self::PATH_SEGMENTS,
            'stageSeconds' => self::stageSeconds(),
            'logBytes' => self::LOG_BYTES,
            'documents' => self::DOCUMENTS,
            'documentBytes' => self::DOCUMENT_BYTES,
            'artifactBytes' => self::ARTIFACT_BYTES,
        ];
    }
}
