<?php

declare(strict_types=1);

namespace App\Build;

use App\Http\ApiProblem;

final class ArmSourcePolicy
{
    public function validate(NativeBuildRequest $request): void
    {
        $names = array_fill_keys(array_map(static fn (array $file): string => strtolower($file['name']), $request->files), true);
        foreach ($request->files as $file) {
            foreach (preg_split('/\R/u', $file['content']) ?: [] as $index => $line) {
                $code = preg_replace('/(?:\/\/|@|;).*/', '', $line) ?? $line;
                if (preg_match('/^\s*\.incbin\b/i', $code)) {
                    throw new ApiProblem(400, 'BUILD_INCBIN_UNAVAILABLE', 'ARM .incbin is disabled until bounded binary project inputs have a validated transport.', false, [$file['name'].':'.($index + 1) => '.incbin is unavailable']);
                }
                if (!preg_match('/^\s*\.include\s+(.+?)\s*$/i', $code, $match)) continue;
                if (!preg_match('/^"([^"\x00-\x1f]+)"$/', $match[1], $pathMatch)) {
                    throw new ApiProblem(400, 'BUILD_INCLUDE_DYNAMIC', 'ARM .include paths must be static quoted project paths.', false, [$file['name'].':'.($index + 1) => 'Dynamic include rejected']);
                }
                $include = $pathMatch[1];
                $segments = explode('/', $include);
                /* Not tested for emptiness: the pattern above matches one or
                 * more characters, so an empty include cannot reach here and a
                 * test for it would be a check that can never fire. */
                if (str_starts_with($include, '/') || str_contains($include, '\\') || array_filter($segments, static fn (string $part): bool => $part === '' || $part === '.' || $part === '..')) {
                    throw new ApiProblem(400, 'BUILD_INCLUDE_PATH', 'ARM .include cannot use absolute paths or traversal.', false, [$file['name'].':'.($index + 1) => 'Unsafe include path']);
                }
                $relative = strtolower(ltrim(dirname($file['name']).'/'.$include, './'));
                if (!isset($names[strtolower($include)]) && !isset($names[$relative])) {
                    throw new ApiProblem(400, 'BUILD_INCLUDE_MISSING', "Included project file $include was not supplied.", false, [$file['name'].':'.($index + 1) => 'Missing declared input']);
                }
            }
        }
    }
}
