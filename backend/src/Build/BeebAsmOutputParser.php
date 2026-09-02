<?php

declare(strict_types=1);

namespace App\Build;

final class BeebAsmOutputParser
{
    /**
     * @param list<array{id: string, name: string, content: string}> $files
     * @return list<array<string, mixed>>
     */
    public function diagnostics(string $output, array $files): array
    {
        $byName = array_combine(array_map(static fn (array $file): string => strtolower($file['name']), $files), $files);
        $lines = preg_split('/\R/u', $output) ?: []; $result = [];
        foreach ($lines as $index => $line) {
            if (!preg_match('/^(.+?)\((\d+)\):\s+(error|warning):\s+(.+)$/i', trim($line), $match)) continue;
            $name = ltrim(str_replace('\\', '/', $match[1]), './'); $file = $byName[strtolower($name)] ?? null;
            $column = 1;
            if (isset($lines[$index + 2]) && preg_match('/^(\s*)\^/', $lines[$index + 2], $caret)) $column = strlen($caret[1]) + 1;
            $result[] = ['severity' => strtolower($match[3]), 'message' => trim($match[4]), 'line' => (int) $match[2], 'column' => $column, 'stage' => 'assemble', ...($file ? ['fileId' => $file['id'], 'fileName' => $file['name']] : ['fileName' => $name])];
        }
        return $result;
    }

    /** @return array<string, int> */
    public function symbols(string $labels): array
    {
        $symbols = [];
        if (preg_match_all("/'([^']+)'\s*:\s*(-?\d+)L?/", $labels, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $name = ltrim($match[1], '.'); $value = (int) $match[2];
                if ($name !== '' && $value >= 0 && $value <= 0xffff && !isset($symbols[$name])) $symbols[$name] = $value;
            }
        }
        return $symbols;
    }

    /**
     * @param list<array{id: string, name: string, content: string}> $files
     * @return array{origin: int|null, locations: array<int, array{fileId: string, fileName: string, line: int}>, listing: list<string>}
     */
    public function listing(string $output, array $files): array
    {
        $sources = [];
        foreach ($files as $file) foreach (preg_split('/\R/u', $file['content']) ?: [] as $index => $line) {
            $key = $this->normalize($line); if ($key !== '') $sources[$key][] = ['fileId' => $file['id'], 'fileName' => $file['name'], 'line' => $index + 1];
        }
        $origin = null; $locations = []; $listing = [];
        foreach (preg_split('/\R/u', $output) ?: [] as $line) {
            if (!preg_match('/^\s*([0-9A-F]{4})\s+((?:[0-9A-F]{2}(?:\s+|$))+)(.*)$/i', $line, $match)) continue;
            $address = (int) hexdec($match[1]); /* four hex digits, so never the float hexdec returns for a wider value */ $origin = $origin === null ? $address : min($origin, $address);
            $bytes = preg_split('/\s+/', trim($match[2])) ?: []; $source = trim($match[3]); $candidates = $sources[$this->normalize($source)] ?? [];
            $location = count($candidates) === 1 ? $candidates[0] : null;
            foreach ($bytes as $offset => $_byte) if ($location !== null) $locations[$address + $offset] = $location;
            $listing[] = sprintf('[%s] &%04X  %-35s %s', $location ? $location['fileName'].':'.$location['line'] : 'unmapped', $address, strtoupper(implode(' ', $bytes)), $source);
        }
        return ['origin' => $origin, 'locations' => $locations, 'listing' => $listing];
    }

    private function normalize(string $line): string
    {
        $quoted = false; $code = '';
        foreach (str_split($line) as $character) { if ($character === '"') $quoted = !$quoted; if ($character === ';' && !$quoted) break; $code .= $character; }
        return strtolower((string) preg_replace('/\s+/', ' ', trim($code)));
    }

    /**
     * Directories a source asks BeebAsm to save into.
     *
     * A named SAVE writes where the source says, and BeebAsm does not create
     * the directory: a project whose Makefile writes into build/ assembles all
     * the way to the end and then reports that it could not open the object
     * file for writing. The job is isolated and starts empty, so the
     * directories a build needs have to be made before it runs.
     *
     * Only a relative path inside the job is answered. An absolute path, or one
     * that climbs out of it, is not something an isolated build may write to
     * and is left for BeebAsm to refuse.
     *
     * @param list<array{name: string, content: string}> $files
     *
     * @return list<string> relative directories, without duplicates
     */
    public function saveDirectories(array $files): array
    {
        $directories = [];
        foreach ($files as $file) {
            if (!preg_match_all('/^\s*SAVE\s+"([^"]+)"/mi', $file['content'], $matches)) {
                continue;
            }
            foreach ($matches[1] as $target) {
                $path = str_replace('\\', '/', $target);
                if ($path === '' || $path[0] === '/' || preg_match('#(^|/)\.\.(/|$)#', $path)) {
                    continue;
                }
                $directory = trim(dirname($path), '.');
                if ($directory === '' || $directory === '/') {
                    continue;
                }
                $directories[trim($directory, '/')] = true;
            }
        }

        return array_keys($directories);
    }

    /**
     * The files BeebAsm reported saving, in the order it saved them.
     *
     * Read from what it said it did rather than from what the source asked for,
     * because a conditional assembly saves some of what it names and not the
     * rest, and only the run knows which.
     *
     * @return list<string>
     */
    public function savedFiles(string $output): array
    {
        if (!preg_match_all("/^Saving file '([^']+)'/mi", $output, $matches)) {
            return [];
        }

        return array_values(array_unique($matches[1]));
    }
}
