/*
 * When a breakpoint should be armed on the machine.
 *
 * This is one line of logic and it was wrong in a way nothing noticed, so it
 * lives here where it can be tested rather than inside a component.
 *
 * The question that has to be asked is "is the machine holding this program",
 * and what used to be asked was "is the program counter inside this program".
 * Those look alike and are not. The first breakpoint anybody sets is on their
 * program's entry, set before pressing Run — and at that moment the machine is
 * sitting in the operating system, so nothing was armed. The workbench saved
 * the breakpoint, resolved it, listed it as resolved, and the machine never had
 * it. Pressing Run then ran straight past.
 *
 * The same question is asked again every time the program calls the operating
 * system, because the program counter leaves the program to do it. So a
 * breakpoint added while stopped inside OSWRCH was dropped too.
 *
 * The machine reports which program it is holding, so that is what is asked.
 * The program-counter test is kept as a second way of saying yes, for a program
 * that arrived by a route that carries no manifest.
 */

/** What the machine says about the program it was given. */
export interface LoadedProgramReport {
  origin: number;
  bytes: number;
}

/** What the workbench built and is setting breakpoints against. */
export interface BuiltArtifactExtent {
  origin: number;
  byteLength: number;
}

export function machineHoldsArtifact(
  artifact: BuiltArtifactExtent | null | undefined,
  loadedProgram: LoadedProgramReport | null | undefined,
  programCounter: number | null | undefined,
): boolean {
  if (!artifact) return false;
  if (loadedProgram && loadedProgram.origin === artifact.origin && loadedProgram.bytes === artifact.byteLength) return true;
  if (typeof programCounter !== 'number') return false;
  return programCounter >= artifact.origin && programCounter < artifact.origin + artifact.byteLength;
}
