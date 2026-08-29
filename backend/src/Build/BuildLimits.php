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
    public const STAGE_SECONDS = 5.0;
    public const LOG_BYTES = 256 * 1024;
    public const DOCUMENTS = 32;
    public const DOCUMENT_BYTES = 2 * 1024 * 1024;
    public const ARTIFACT_BYTES = 1024 * 1024;

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
            'stageSeconds' => self::STAGE_SECONDS,
            'logBytes' => self::LOG_BYTES,
            'documents' => self::DOCUMENTS,
            'documentBytes' => self::DOCUMENT_BYTES,
            'artifactBytes' => self::ARTIFACT_BYTES,
        ];
    }
}
