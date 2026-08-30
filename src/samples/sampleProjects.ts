import { parseProject, type LocalProject } from '../project/project';
import type { BuildTarget } from '../build/buildTarget';

/* Samples declare the portable fields an author would write by hand. The rest
 * of a build target is filled in by the same migration the project parser
 * applies to any imported project, so a sample cannot drift from the schema
 * real projects are held to. */
export type SampleBuildTarget = Pick<BuildTarget, 'schemaVersion' | 'id' | 'name' | 'entryFileId' | 'toolchainId' | 'outputName' | 'sourceFileIds'>;

export interface SampleProjectDocument extends Omit<LocalProject, 'buildTargets'> {
  buildTargets: SampleBuildTarget[];
}

/** A worked example that opens as a real, buildable browser-local project. */
export interface SampleProject {
  id: string;
  name: string;
  /** Authoring language, for the catalogue entry. */
  language: string;
  /** Machine and display mode the sample is written for. */
  machine: string;
  summary: string;
  /** What the sample demonstrates, one claim per entry. */
  highlights: string[];
  /** True when running it needs firmware the user supplies themselves. */
  requiresRoms: boolean;
  project: SampleProjectDocument;
}

/* The catalogue is imported on demand so the sample sources stay out of the
 * initial workbench chunk. */
export async function loadSampleProjects(): Promise<SampleProject[]> {
  const [{ ACORN_HARVEST }, { ACORN_CATCHER }] = await Promise.all([
    import('./acornHarvest'),
    import('./acornCatcher'),
  ]);
  return [ACORN_HARVEST, ACORN_CATCHER];
}

export async function loadSampleProject(id: string): Promise<SampleProject | undefined> {
  return (await loadSampleProjects()).find((sample) => sample.id === id);
}

/** Opening a sample runs it through the ordinary project parser, so it is
 * validated and migrated exactly like a project a user imports. */
export function sampleLocalProject(sample: SampleProject): LocalProject {
  return parseProject(JSON.stringify(sample.project));
}
