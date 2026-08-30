<?php

declare(strict_types=1);

namespace App\Build;

use App\Http\ApiProblem;

final class SourcePolicy
{
    public function validate(NativeBuildRequest $request): void
    {
        $names = array_fill_keys(array_map(static fn (array $file): string => strtolower($file['name']), $request->files), true);
        foreach ($request->files as $file) {
            $lines = preg_split('/\R/u', $file['content']) ?: [];
            foreach ($lines as $index => $line) {
                $code = $this->stripComment($line);
                if (preg_match('/^\s*\.?incbin\b/i', $code)) {
                    throw new ApiProblem(400, 'BUILD_INCBIN_UNAVAILABLE', 'INCBIN is disabled until binary project inputs have a separately validated transport.', false, [$file['name'].':'.($index + 1) => 'INCBIN is unavailable']);
                }
                if (!preg_match('/^\s*\.?include\s+(.+?)\s*$/i', $code, $match)) {
                    continue;
                }
                if (!preg_match('/^"([^"\x00-\x1f]+)"$/', $match[1], $pathMatch)) {
                    throw new ApiProblem(400, 'BUILD_INCLUDE_DYNAMIC', 'INCLUDE paths must be static quoted project paths.', false, [$file['name'].':'.($index + 1) => 'Dynamic include path rejected']);
                }
                $include = $pathMatch[1];
                if (!$this->isSafeRelativePath($include)) {
                    throw new ApiProblem(400, 'BUILD_INCLUDE_PATH', 'INCLUDE cannot use absolute paths or traversal.', false, [$file['name'].':'.($index + 1) => 'Unsafe include path']);
                }
                $fromRoot = strtolower($include);
                $fromDirectory = strtolower(ltrim(dirname($file['name']).'/'.$include, './'));
                if (!isset($names[$fromRoot]) && !isset($names[$fromDirectory])) {
                    throw new ApiProblem(400, 'BUILD_INCLUDE_MISSING', "Included project file $include was not supplied.", false, [$file['name'].':'.($index + 1) => 'Missing declared input']);
                }
            }
        }
    }

    private function isSafeRelativePath(string $path): bool
    {
        if ($path === '' || strlen($path) > BuildLimits::PATH_BYTES || str_starts_with($path, '/') || str_contains($path, '\\')) {
            return false;
        }
        $segments = explode('/', $path);

        return count($segments) <= BuildLimits::PATH_SEGMENTS && !array_filter($segments, static fn (string $segment): bool => $segment === '' || $segment === '.' || $segment === '..');
    }

    private function stripComment(string $line): string
    {
        $quoted = false;
        $escaped = false;
        $result = '';
        foreach (str_split($line) as $character) {
            if ($escaped) {
                $result .= $character;
                $escaped = false;
                continue;
            }
            if ($quoted && $character === '\\') {
                $escaped = true;
                $result .= $character;
                continue;
            }
            if ($character === '"') {
                $quoted = !$quoted;
            }
            if ($character === ';' && !$quoted) {
                break;
            }
            $result .= $character;
        }

        return $result;
    }
}
