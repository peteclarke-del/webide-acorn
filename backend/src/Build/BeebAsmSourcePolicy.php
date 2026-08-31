<?php

declare(strict_types=1);

namespace App\Build;

use App\Http\ApiProblem;

final class BeebAsmSourcePolicy
{
    public function validate(NativeBuildRequest $request): void
    {
        if (count($request->sourceUnitIds) !== 1) {
            throw new ApiProblem(400, 'BEEBASM_ROOT_COUNT', 'BeebAsm requires exactly one root source unit; use INCLUDE for subordinate source files.');
        }
        $files = [];
        foreach ($request->files as $file) $files[strtolower($file['name'])] = $file;
        $root = $this->fileById($request, $request->sourceUnitIds[0]);
        if (!preg_match('/\.(?:asm|6502|a65)$/i', $root['name'])) {
            throw new ApiProblem(400, 'BEEBASM_ROOT_EXTENSION', 'BeebAsm root source must use .asm, .6502 or .a65.');
        }

        $edges = []; $saveCount = 0;
        foreach ($request->files as $file) {
            foreach (preg_split('/\R/u', $file['content']) ?: [] as $lineIndex => $line) {
                foreach ($this->statements($this->stripComment($line)) as $code) {
                if (preg_match('/^(?:INCBIN|PUTFILE|PUTTEXT|PUTBASIC|ASM|SOURCELINE)\b/i', $code, $match)) {
                    throw new ApiProblem(400, 'BEEBASM_FILESYSTEM_DIRECTIVE', strtoupper($match[0]).' is unavailable in the bounded binary-output adapter.', false, [$file['name'].':'.($lineIndex + 1) => 'Unsafe or unsupported directive']);
                }
                if (preg_match('/^CPU\b/i', $code)) {
                    throw new ApiProblem(400, 'BEEBASM_CPU_OWNED', 'CPU is owned by the selected machine profile; remove the source CPU directive.', false, [$file['name'].':'.($lineIndex + 1) => 'CPU is target-controlled']);
                }
                if (preg_match('/\bTIME\$(?![A-Za-z0-9_$%])/i', $this->withoutQuotedText($code))) {
                    throw new ApiProblem(400, 'BEEBASM_NONDETERMINISTIC', 'TIME$ is unavailable because native builds must be reproducible.', false, [$file['name'].':'.($lineIndex + 1) => 'Time-dependent expression rejected']);
                }
                if (preg_match('/^INCLUDE\s+(.+?)\s*$/i', $code, $match)) {
                    if (!preg_match('/^"([^"\x00-\x1f]+)"$/', $match[1], $path)) {
                        throw new ApiProblem(400, 'BEEBASM_INCLUDE_DYNAMIC', 'BeebAsm INCLUDE requires one literal quoted project path.', false, [$file['name'].':'.($lineIndex + 1) => 'Dynamic include rejected']);
                    }
                    $resolved = $this->resolve($file['name'], $path[1]);
                    if ($resolved === null || !isset($files[strtolower($resolved)])) {
                        throw new ApiProblem(400, 'BEEBASM_INCLUDE_MISSING', 'Included file '.$path[1].' is missing or unsafe.', false, [$file['name'].':'.($lineIndex + 1) => 'Missing declared input']);
                    }
                    $edges[strtolower($file['name'])][] = strtolower($resolved);
                }
                if (preg_match('/^SAVE\s+(.+)$/i', $code, $match)) {
                    ++$saveCount;
                    if (preg_match('/^\s*"/', $match[1])) {
                        throw new ApiProblem(400, 'BEEBASM_SAVE_FILENAME', 'SAVE filenames are controlled by the build target; use SAVE start,end[,exec[,reload]].', false, [$file['name'].':'.($lineIndex + 1) => 'Source-controlled output path rejected']);
                    }
                }
                }
            }
        }
        if ($saveCount !== 1) throw new ApiProblem(400, 'BEEBASM_SAVE_COUNT', 'The binary-output adapter requires exactly one filename-free SAVE directive.');
        $this->assertAcyclic(strtolower($root['name']), $edges, []);
    }

    /** @return array{id: string, name: string, content: string} */
    private function fileById(NativeBuildRequest $request, string $id): array
    {
        foreach ($request->files as $file) if ($file['id'] === $id) return $file;
        throw new ApiProblem(400, 'BEEBASM_ROOT_MISSING', 'BeebAsm root source is missing.');
    }

    /**
     * @param array<string, list<string>> $edges
     * @param array<string, true> $path
     */
    private function assertAcyclic(string $file, array $edges, array $path): void
    {
        if (isset($path[$file])) throw new ApiProblem(400, 'BEEBASM_INCLUDE_CYCLE', 'BeebAsm INCLUDE graph contains a cycle at '.$file.'.');
        $path[$file] = true;
        foreach ($edges[$file] ?? [] as $next) $this->assertAcyclic($next, $edges, $path);
    }

    private function resolve(string $from, string $include): ?string
    {
        if ($include === '' || str_starts_with($include, '/') || str_contains($include, '\\')) return null;
        $parts = explode('/', ($directory = dirname($from)) === '.' ? $include : $directory.'/'.$include);
        if (count($parts) > BuildLimits::PATH_SEGMENTS || array_filter($parts, static fn (string $part): bool => $part === '' || $part === '.' || $part === '..')) return null;
        return implode('/', $parts);
    }

    private function stripComment(string $line): string
    {
        $quoted = false; $result = '';
        foreach (str_split($line) as $character) {
            if ($character === '"') $quoted = !$quoted;
            if ($character === ';' && !$quoted) break;
            $result .= $character;
        }
        return $result;
    }

    /** @return list<string> */
    private function statements(string $line): array
    {
        $quoted = false; $statement = ''; $statements = [];
        foreach (str_split($line) as $character) {
            if ($character === '"') $quoted = !$quoted;
            if ($character === ':' && !$quoted) {
                if (($trimmed = trim($statement)) !== '') $statements[] = $trimmed;
                $statement = '';
                continue;
            }
            $statement .= $character;
        }
        if (($trimmed = trim($statement)) !== '') $statements[] = $trimmed;
        return $statements;
    }

    private function withoutQuotedText(string $code): string
    {
        $quoted = false; $result = '';
        foreach (str_split($code) as $character) {
            if ($character === '"') { $quoted = !$quoted; $result .= ' '; continue; }
            $result .= $quoted ? ' ' : $character;
        }
        return $result;
    }
}
