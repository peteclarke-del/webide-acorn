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

        /* Every emitted line, with the source lines whose text it could have
         * come from. BeebAsm's verbose listing does not name the file, and in
         * assembly most lines repeat, so placing a line by its text alone
         * placed almost none of them: a real game mapped forty-four addresses
         * out of three and a half thousand listing lines, which is not enough
         * to step through. The listing is emitted in source order, so it is
         * read twice — forwards from the last line placed, then backwards from
         * the next one — and a line that is neither unique nor adjacent to
         * something already placed stays unmapped rather than being guessed. */
        $rows = [];
        $origin = null;
        foreach (preg_split('/\R/u', $output) ?: [] as $line) {
            if (!preg_match('/^\s*([0-9A-F]{4})\s+((?:[0-9A-F]{2}(?:\s+|$))+)(.*)$/i', $line, $match)) continue;
            $address = (int) hexdec($match[1]); /* four hex digits, so never the float hexdec returns for a wider value */
            $origin = $origin === null ? $address : min($origin, $address);
            $source = trim($match[3]);
            $rows[] = [
                'address' => $address,
                'bytes' => preg_split('/\s+/', trim($match[2])) ?: [],
                'source' => $source,
                'candidates' => $sources[$this->normalize($source)] ?? [],
                'location' => null,
            ];
        }

        $cursor = null;
        foreach ($rows as $index => $row) {
            $placed = $this->place($row['candidates'], $cursor, 1);
            if ($placed !== null) { $rows[$index]['location'] = $placed; $cursor = $placed; }
        }
        $cursor = null;
        foreach (array_reverse(array_keys($rows)) as $index) {
            if ($rows[$index]['location'] !== null) { $cursor = $rows[$index]['location']; continue; }
            $placed = $this->place($rows[$index]['candidates'], $cursor, -1);
            if ($placed !== null) { $rows[$index]['location'] = $placed; $cursor = $placed; }
        }

        $locations = []; $listing = [];
        foreach ($rows as $row) {
            $location = $row['location'];
            foreach ($row['bytes'] as $offset => $_byte) if ($location !== null) $locations[$row['address'] + $offset] = $location;
            $listing[] = sprintf('[%s] &%04X  %-35s %s', $location ? $location['fileName'].':'.$location['line'] : 'unmapped', $row['address'], strtoupper(implode(' ', $row['bytes'])), $row['source']);
        }

        return ['origin' => $origin, 'locations' => $locations, 'listing' => $listing];
    }

    /**
     * Which source line a listing line came from, or null when it cannot be
     * told without guessing.
     *
     * @param list<array{fileId: string, fileName: string, line: int}> $candidates
     * @param array{fileId: string, fileName: string, line: int}|null  $cursor
     * @param int                                                       $direction 1 reading forwards, -1 backwards
     *
     * @return array{fileId: string, fileName: string, line: int}|null
     */
    private function place(array $candidates, ?array $cursor, int $direction): ?array
    {
        if ($candidates === []) {
            return null;
        }
        if (count($candidates) === 1) {
            return $candidates[0];
        }
        if ($cursor === null) {
            return null;
        }
        /* The nearest line beyond the one the cursor holds, in the same file
         * and in the direction being read. An INCLUDE moves the listing into
         * the included file and back out again, and each move is made by a line
         * that was placed on its own. */
        $best = null;
        foreach ($candidates as $candidate) {
            if ($candidate['fileId'] !== $cursor['fileId']) {
                continue;
            }
            if ($direction > 0 ? $candidate['line'] <= $cursor['line'] : $candidate['line'] >= $cursor['line']) {
                continue;
            }
            if ($best === null || ($direction > 0 ? $candidate['line'] < $best['line'] : $candidate['line'] > $best['line'])) {
                $best = $candidate;
            }
        }

        return $best;
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

    /**
     * Where a named SAVE's output starts, or null when it cannot be told.
     *
     * The listing's lowest address is the lowest address the whole assembly
     * emitted, which is the right origin for the one binary a filename-free
     * SAVE writes and the wrong one for a project that emits several. Graveyard
     * Shift assembles a rules block at &1400 and the game at &1900, and its
     * game binary was being reported as loading at &1400 — five hundred bytes
     * out, which would put every breakpoint and every mapped line in the wrong
     * place.
     *
     * The start is read from the directive that wrote the file, resolved
     * against the symbols BeebAsm emitted. A start that is neither a symbol nor
     * a literal is not guessed at.
     *
     * @param list<array{name: string, content: string}> $files
     * @param array<string, int>                         $symbols
     */
    public function saveOrigin(array $files, string $saved, array $symbols): ?int
    {
        $wanted = str_replace('\\', '/', $saved);
        foreach ($files as $file) {
            foreach (preg_split('/\R/u', $file['content']) ?: [] as $line) {
                if (!preg_match('/^\s*SAVE\s+"([^"]+)"\s*,\s*([^,]+)/i', $this->stripListingComment($line), $match)) {
                    continue;
                }
                if (str_replace('\\', '/', trim($match[1])) !== $wanted) {
                    continue;
                }

                return $this->address(trim($match[2]), $symbols);
            }
        }

        return null;
    }

    /** @param array<string, int> $symbols */
    private function address(string $expression, array $symbols): ?int
    {
        $token = ltrim(trim($expression), '.');
        if ($token === '') {
            return null;
        }
        if (preg_match('/^&([0-9A-F]+)$/i', $token, $hex) || preg_match('/^\$([0-9A-F]+)$/i', $token, $hex)) {
            return (int) hexdec($hex[1]);
        }
        if (preg_match('/^[0-9]+$/', $token)) {
            return (int) $token;
        }
        if (preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $token) && isset($symbols[$token])) {
            return $symbols[$token];
        }

        return null;
    }

    private function stripListingComment(string $line): string
    {
        $quoted = false; $code = '';
        foreach (str_split($line) as $character) {
            if ($character === '"') $quoted = !$quoted;
            if ($character === ';' && !$quoted) break;
            $code .= $character;
        }

        return $code;
    }
}
