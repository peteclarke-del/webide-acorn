<?php

declare(strict_types=1);

namespace App\Build;

final class Cc65OutputParser
{
    /**
     * @param list<array{id: string, name: string, content: string}> $files
     * @return list<array{severity: 'error'|'warning', message: string, line: int, column: int, fileId?: string, fileName?: string, stage: string}>
     */
    public function diagnostics(string $output, array $files, string $stage): array
    {
        $byName = [];
        foreach ($files as $file) {
            $byName[strtolower($file['name'])] = $file;
            $byName[strtolower(basename($file['name']))] ??= $file;
        }
        $diagnostics = [];
        foreach (preg_split('/\R/', $output) ?: [] as $line) {
            if (trim($line) === '') {
                continue;
            }
            if (preg_match('/^(.+?)\((\d+)\):\s*(Error|Warning):\s*(.+)$/i', $line, $match)) {
                $path = str_replace('\\', '/', trim($match[1]));
                $file = $byName[strtolower($path)] ?? $byName[strtolower(basename($path))] ?? null;
                $diagnostic = [
                    'severity' => strtolower($match[3]) === 'warning' ? 'warning' : 'error',
                    'message' => trim($match[4]),
                    'line' => max(1, (int) $match[2]),
                    'column' => 1,
                    'stage' => $stage,
                ];
                if ($file !== null) {
                    $diagnostic['fileId'] = $file['id'];
                    $diagnostic['fileName'] = $file['name'];
                }
                $diagnostics[] = $diagnostic;
                continue;
            }
            if (preg_match('/^(?:ca65|ld65):\s*(Error|Warning):\s*(.+)$/i', $line, $match)) {
                $diagnostics[] = ['severity' => strtolower($match[1]) === 'warning' ? 'warning' : 'error', 'message' => trim($match[2]), 'line' => 1, 'column' => 1, 'stage' => $stage];
            }
        }

        return $diagnostics;
    }

    /**
     * @param list<array{id: string, name: string, content: string}> $files
     * @return array{symbols: array<string, int>, sourceLocations: array<int, array{fileId: string, fileName: string, line: int}>, segments: list<array{name: string, start: int, size: int, outputOffset?: int}>}
     */
    public function debugFile(string $content, array $files): array
    {
        $projectFiles = [];
        foreach ($files as $file) {
            $projectFiles[strtolower($file['name'])] = $file;
            $projectFiles[strtolower(basename($file['name']))] ??= $file;
        }
        $debugFiles = [];
        $lines = [];
        $segments = [];
        $spans = [];
        $symbols = [];
        foreach (preg_split('/\R/', $content) ?: [] as $row) {
            if (!str_contains($row, "\t")) {
                continue;
            }
            [$kind, $raw] = explode("\t", $row, 2);
            $fields = $this->fields($raw);
            if ($kind === 'file' && isset($fields['id'], $fields['name'])) {
                $name = str_replace('\\', '/', $fields['name']);
                $debugFiles[(int) $fields['id']] = $projectFiles[strtolower($name)] ?? $projectFiles[strtolower(basename($name))] ?? null;
            } elseif ($kind === 'line' && isset($fields['id'], $fields['file'], $fields['line'])) {
                $lines[(int) $fields['id']] = ['file' => (int) $fields['file'], 'line' => max(1, (int) $fields['line']), 'spans' => isset($fields['span']) ? array_map('intval', preg_split('/\+/', $fields['span']) ?: []) : []];
            } elseif ($kind === 'seg' && isset($fields['id'], $fields['name'], $fields['start'], $fields['size'])) {
                $segment = ['name' => $fields['name'], 'start' => $this->number($fields['start']), 'size' => $this->number($fields['size'])];
                if (isset($fields['ooffs'])) {
                    $segment['outputOffset'] = $this->number($fields['ooffs']);
                }
                $segments[(int) $fields['id']] = $segment;
            } elseif ($kind === 'span' && isset($fields['id'], $fields['seg'], $fields['start'], $fields['size'])) {
                $spans[(int) $fields['id']] = ['seg' => (int) $fields['seg'], 'start' => $this->number($fields['start']), 'size' => $this->number($fields['size'])];
            } elseif ($kind === 'sym' && isset($fields['name'], $fields['val']) && ($fields['type'] ?? '') === 'lab') {
                $symbols[$fields['name']] = $this->number($fields['val']);
            }
        }

        $sourceLocations = [];
        foreach ($lines as $line) {
            $file = $debugFiles[$line['file']] ?? null;
            if ($file === null) {
                continue;
            }
            foreach ($line['spans'] as $spanId) {
                $span = $spans[$spanId] ?? null;
                $segment = $span === null ? null : ($segments[$span['seg']] ?? null);
                if ($span === null || $segment === null) {
                    continue;
                }
                $start = $segment['start'] + $span['start'];
                for ($offset = 0; $offset < $span['size']; ++$offset) {
                    $sourceLocations[$start + $offset] ??= ['fileId' => $file['id'], 'fileName' => $file['name'], 'line' => $line['line']];
                }
            }
        }
        ksort($symbols, SORT_STRING);
        ksort($sourceLocations, SORT_NUMERIC);

        return ['symbols' => $symbols, 'sourceLocations' => $sourceLocations, 'segments' => array_values($segments)];
    }

    /** @return array<string, string> */
    private function fields(string $raw): array
    {
        $fields = [];
        foreach (str_getcsv($raw, ',', '"', '\\') as $field) {
            if (!str_contains($field, '=')) {
                continue;
            }
            [$key, $value] = explode('=', $field, 2);
            if (strlen($value) >= 2 && $value[0] === '"' && $value[strlen($value) - 1] === '"') {
                $value = stripcslashes(substr($value, 1, -1));
            }
            $fields[$key] = $value;
        }

        return $fields;
    }

    private function number(string $value): int
    {
        return str_starts_with(strtolower($value), '0x') ? intval(substr($value, 2), 16) : (int) $value;
    }
}
