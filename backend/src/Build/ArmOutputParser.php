<?php

declare(strict_types=1);

namespace App\Build;

final class ArmOutputParser
{
    /** @param list<array{id: string, name: string, content: string}> $files @return list<array<string, mixed>> */
    public function diagnostics(string $output, array $files, string $stage): array
    {
        $byName = $this->filesByName($files); $result = [];
        foreach (preg_split('/\R/', $output) ?: [] as $line) {
            if (!preg_match('/^(.*?):(\d+)(?::(\d+))?:\s*(?:(fatal error|error|warning):\s*)?(.+)$/i', trim($line), $match)) continue;
            $path = str_replace('\\', '/', $match[1]);
            $file = $byName[strtolower($path)] ?? $byName[strtolower(basename($path))] ?? null;
            $kind = strtolower($match[4] ?? '');
            $message = trim($match[5]);
            if ($kind === '' && !preg_match('/\b(?:error|warning|undefined reference|cannot find)\b/i', $message)) continue;
            $diagnostic = ['severity' => str_contains($kind, 'warning') ? 'warning' : 'error', 'message' => $message, 'line' => max(1, (int) $match[2]), 'column' => max(1, (int) ($match[3] ?: 1)), 'stage' => $stage];
            if ($file !== null) { $diagnostic['fileId'] = $file['id']; $diagnostic['fileName'] = $file['name']; }
            $result[] = $diagnostic;
        }
        if (!$result && preg_match('/(?:arm-none-eabi-(?:ld|as)|ld):\s*(.+)/i', $output, $match)) $result[] = ['severity' => 'error', 'message' => trim($match[1]), 'line' => 1, 'column' => 1, 'stage' => $stage];
        return $result;
    }

    /** @param list<array{id: string, name: string, content: string}> $files @return array<int, array{fileId: string, fileName: string, line: int}> */
    public function decodedLines(string $content, array $files, int $origin, int $size): array
    {
        $byName = $this->filesByName($files); $points = [];
        foreach (preg_split('/\R/', $content) ?: [] as $row) {
            if (!preg_match('/^\s*(\S.*?)\s+(\d+)\s+0x([0-9a-f]+)(?:\s|$)/i', $row, $match)) continue;
            $file = $byName[strtolower(trim($match[1]))] ?? $byName[strtolower(basename(trim($match[1])))] ?? null;
            $address = intval($match[3], 16);
            if ($file === null || $address < $origin || $address >= $origin + $size) continue;
            $points[$address] = ['fileId' => $file['id'], 'fileName' => $file['name'], 'line' => max(1, (int) $match[2])];
        }
        ksort($points, SORT_NUMERIC); $mapped = []; $addresses = array_keys($points);
        foreach ($addresses as $index => $address) {
            $next = min($origin + $size, $addresses[$index + 1] ?? ($address + 4));
            for ($cursor = $address; $cursor < $next; ++$cursor) $mapped[$cursor] = $points[$address];
        }
        return $mapped;
    }

    /** @return array<string, int> */
    public function symbols(string $content): array
    {
        $symbols = [];
        foreach (preg_split('/\R/', $content) ?: [] as $row) if (preg_match('/^([0-9a-f]{8})\s+[A-Za-z]\s+(\S+)$/i', trim($row), $match)) $symbols[$match[2]] = intval($match[1], 16);
        return $symbols;
    }

    public function entryPoint(string $content): ?int
    {
        return preg_match('/Entry point address:\s*0x([0-9a-f]+)/i', $content, $match) ? intval($match[1], 16) : null;
    }

    /** @param list<array{id: string, name: string, content: string}> $files @return array<string, array{id: string, name: string, content: string}> */
    private function filesByName(array $files): array
    {
        $result = [];
        foreach ($files as $file) { $result[strtolower($file['name'])] = $file; $result[strtolower(basename($file['name']))] ??= $file; }
        return $result;
    }
}
