<?php

declare(strict_types=1);

namespace App\Build;

use App\Http\ApiProblem;

final class CSourcePolicy
{
    public function validate(NativeBuildRequest $request): void
    {
        if ($request->dialect !== 'c') throw new \InvalidArgumentException('C policy requires a C build request.');
        if (!in_array($request->machineId, ['bbc-b', 'bbc-b-plus', 'master'], true)) {
            throw new ApiProblem(400, 'BUILD_C_MACHINE', 'The current cc65 BBC runtime is validated only for BBC B, B+ and Master targets.', false, ['target.machineId' => 'Unsupported C runtime machine']);
        }
        if ($request->origin < 0x0e00 || $request->maximumAddress >= 0x7200 || $request->origin > $request->maximumAddress) {
            throw new ApiProblem(400, 'BUILD_C_MEMORY', 'BBC C code must load at or above &0E00 and finish below the runtime stack at &7200.', false, ['target.maximumAddress' => 'Use an address below &7200']);
        }
        if ($request->entryMode !== 'source') {
            throw new ApiProblem(400, 'BUILD_C_ENTRY', 'Runnable C builds enter through the generated startup routine; function and address overrides bypass runtime initialization.', false, ['target.entry.mode' => 'Use source entry']);
        }

        $names = array_fill_keys(array_map(static fn (array $file): string => strtolower($file['name']), $request->files), true);
        foreach ($request->files as $file) {
            if (!preg_match('/\.(?:c|h)$/i', $file['name'])) continue;
            foreach ($this->directives($file['content']) as [$line, $directive]) {
                if (preg_match('/^\s*#\s*(?:line)\b/i', $directive)) {
                    throw new ApiProblem(400, 'BUILD_C_LINE_DIRECTIVE', 'C #line directives are disabled because linked debug paths must identify declared project sources.', false, [$file['name'].':'.$line => 'Debug-source spoofing rejected']);
                }
                if (!preg_match('/^\s*#\s*include\b(.*)$/i', $directive, $match)) continue;
                $operand = trim($match[1]);
                if (preg_match('/^"([^"\x00-\x1f]+)"$/', $operand, $quoted)) {
                    $include = $quoted[1];
                    if (!$this->safePath($include)) $this->rejectPath($file['name'], $line);
                    $root = strtolower($include);
                    $relative = strtolower(ltrim(dirname($file['name']).'/'.$include, './'));
                    if (!isset($names[$root]) && !isset($names[$relative])) {
                        throw new ApiProblem(400, 'BUILD_C_INCLUDE_MISSING', "Included project header $include was not supplied.", false, [$file['name'].':'.$line => 'Missing declared input']);
                    }
                    continue;
                }
                if (preg_match('/^<([^>\x00-\x1f]+)>$/', $operand, $system)) {
                    if (!$this->safePath($system[1]) || !$this->systemHeaderExists($system[1])) {
                        throw new ApiProblem(400, 'BUILD_C_SYSTEM_INCLUDE', 'Angle-bracket includes must name a header from the immutable cc65 or WebIDE BBC SDK.', false, [$file['name'].':'.$line => 'Unknown system header']);
                    }
                    continue;
                }
                throw new ApiProblem(400, 'BUILD_C_INCLUDE_DYNAMIC', 'C include operands must be one static quoted project path or immutable SDK header.', false, [$file['name'].':'.$line => 'Computed include rejected']);
            }
        }
    }

    /** @return list<array{int, string}> */
    private function directives(string $content): array
    {
        $clean = $this->stripComments($content);
        $physical = preg_split('/\R/u', $clean) ?: [];
        $result = [];
        for ($index = 0; $index < count($physical); ++$index) {
            $line = $physical[$index];
            $start = $index + 1;
            while (preg_match('/\\\s*$/', $line) && isset($physical[$index + 1])) {
                $line = preg_replace('/\\\s*$/', '', $line).$physical[++$index];
            }
            if (preg_match('/^\s*#/', $line)) $result[] = [$start, $line];
        }
        return $result;
    }

    private function stripComments(string $content): string
    {
        $result = '';
        $length = strlen($content);
        $block = false;
        $line = false;
        $quote = null;
        for ($index = 0; $index < $length; ++$index) {
            $character = $content[$index];
            $next = $index + 1 < $length ? $content[$index + 1] : '';
            if ($line) {
                if ($character === "\n" || $character === "\r") { $line = false; $result .= $character; }
                else $result .= ' ';
                continue;
            }
            if ($block) {
                if ($character === '*' && $next === '/') { $result .= '  '; ++$index; $block = false; }
                else $result .= ($character === "\n" || $character === "\r") ? $character : ' ';
                continue;
            }
            if ($quote !== null) {
                $result .= $character;
                if ($character === '\\' && $next !== '') { $result .= $next; ++$index; continue; }
                if ($character === $quote) $quote = null;
                continue;
            }
            if (($character === '"' || $character === "'")) { $quote = $character; $result .= $character; continue; }
            if ($character === '/' && $next === '*') { $result .= '  '; ++$index; $block = true; continue; }
            if ($character === '/' && $next === '/') { $result .= '  '; ++$index; $line = true; continue; }
            $result .= $character;
        }
        return $result;
    }

    private function systemHeaderExists(string $include): bool
    {
        $sdk = (string) (ToolLocator::configured('CC65_BBC_INCLUDE') ?? '/usr/local/share/8bit-net/cc65-bbc/include');
        foreach ([$sdk, '/usr/share/cc65/include'] as $root) {
            $rootPath = realpath($root);
            $candidate = realpath($root.'/'.$include);
            if ($rootPath !== false && $candidate !== false && ($candidate === $rootPath || str_starts_with($candidate, $rootPath.'/')) && is_file($candidate)) return true;
        }
        return false;
    }

    private function safePath(string $path): bool
    {
        if ($path === '' || strlen($path) > BuildLimits::PATH_BYTES || str_starts_with($path, '/') || str_contains($path, '\\')) return false;
        $segments = explode('/', $path);
        return count($segments) <= BuildLimits::PATH_SEGMENTS && !array_filter($segments, static fn (string $segment): bool => $segment === '' || $segment === '.' || $segment === '..');
    }

    private function rejectPath(string $file, int $line): never
    {
        throw new ApiProblem(400, 'BUILD_C_INCLUDE_PATH', 'C includes cannot use absolute paths or traversal.', false, [$file.':'.$line => 'Unsafe include path']);
    }
}
