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
                    $resolved = $this->resolveInclude($file['name'], $path[1], $files);
                    if ($resolved === null) {
                        throw new ApiProblem(400, 'BEEBASM_INCLUDE_MISSING', 'Included file '.$path[1].' is missing or unsafe.', false, [$file['name'].':'.($lineIndex + 1) => 'Missing declared input']);
                    }
                    $edges[strtolower($file['name'])][] = strtolower($resolved);
                }
                if (preg_match('/^SAVE\s+(.+)$/i', $code, $match)) {
                    ++$saveCount;
                    if (preg_match('/^\s*"([^"]*)"/', $match[1], $named)) {
                        $this->assertSavePath($named[1], $file['name'].':'.($lineIndex + 1), $files);
                    }
                }
                }
            }
        }
        /* A project that emits one binary writes one filename-free SAVE and the
         * adapter answers with what -o produced. A project that emits several —
         * a loader, a resident part, a set of levels — names each of them, which
         * is how every real BeebAsm project is written. Both are allowed; what
         * is not is a build that saves nothing, because then there is nothing to
         * answer with. */
        if ($saveCount < 1) {
            throw new ApiProblem(400, 'BEEBASM_SAVE_COUNT', 'The binary-output adapter requires at least one SAVE directive, so that the build produces something.');
        }
        if ($saveCount > BuildLimits::SAVE_DIRECTIVES) {
            throw new ApiProblem(400, 'BEEBASM_SAVE_COUNT', sprintf('At most %d SAVE directives are supported and this build has %d.', BuildLimits::SAVE_DIRECTIVES, $saveCount));
        }
        $this->assertAcyclic(strtolower($root['name']), $edges, []);
    }

    /**
     * Where a named SAVE may write.
     *
     * The output path used to be refused outright, on the grounds that the
     * build target owns it. That is true of the one binary the adapter answers
     * with, and false of everything else a real project emits: a loader, a
     * resident part, a set of level banks. Refusing them all meant no project
     * written for BeebAsm could be built here at all.
     *
     * So the path is checked rather than forbidden, against the same rule the
     * project store applies to anything it writes. It stays inside the job, it
     * does not climb out of it, and it does not overwrite a source that was
     * staged for this build — the last because a build that rewrites its own
     * input is not reproducible and the second run would differ from the first.
     *
     * @param array<string, array{id: string, name: string, content: string}> $files
     */
    private function assertSavePath(string $path, string $where, array $files): void
    {
        $normalized = str_replace('\\', '/', trim($path));
        $refusal = match (true) {
            $normalized === '' => 'names no file',
            str_starts_with($normalized, '/') => 'is an absolute path',
            (bool) preg_match('#(^|/)\.\.(/|$)#', $normalized) => 'climbs out of the build',
            (bool) preg_match('#(^|/)\.build(/|$)#i', $normalized) => 'writes into the directory the adapter owns',
            str_ends_with($normalized, '/') => 'names a directory rather than a file',
            isset($files[strtolower($normalized)]) => 'would overwrite a source file this build was given',
            default => null,
        };
        if ($refusal !== null) {
            throw new ApiProblem(400, 'BEEBASM_SAVE_FILENAME', sprintf('SAVE "%s" %s.', $path, $refusal), false, [$where => 'Unsafe output path rejected']);
        }
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

    /**
     * Which staged file an INCLUDE names, or null if none does.
     *
     * BeebAsm resolves an INCLUDE against the directory it was run from, not
     * against the file that wrote it: a project assembled from its own root
     * writes INCLUDE "src/rules.6502" inside src/main.6502 and that is what
     * BeebAsm reads. Resolving only beside the including file made every such
     * project look as though its sources were missing, which is what this
     * refused before. Beside the file is tried as well, because a project that
     * is written that way is not wrong either and BeebAsm will say so itself if
     * the file is not where it looks.
     *
     * @param array<string, array{id: string, name: string, content: string}> $files
     */
    private function resolveInclude(string $from, string $include, array $files): ?string
    {
        foreach ([$this->resolve('.', $include), $this->resolve($from, $include)] as $candidate) {
            if ($candidate !== null && isset($files[strtolower($candidate)])) {
                return $candidate;
            }
        }

        return null;
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
