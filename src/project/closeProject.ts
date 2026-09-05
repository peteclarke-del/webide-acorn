import type { StoredProject } from '../cloud/projectStoreClient';

/*
 * What closing a project means, and what it must ask first.
 *
 * Closing was not offered at all: the only way out of a project was to open
 * another one over the top of it. That is fine for a workbench that holds one
 * project and wrong for one that can hold sixty-four, because it leaves no way
 * to say what should happen to the copy the store is keeping — and deleting
 * that quietly, or keeping it quietly, are both decisions somebody else's work
 * should not have made for them.
 *
 * So closing states what it will do before it does it, and the question it asks
 * depends on what is actually there: nothing to ask about if the store holds no
 * copy, and nothing to ask about if there is no store.
 */

export type CloseChoice = 'keep-stored' | 'delete-stored' | 'nothing-stored';

export interface CloseQuestion {
  /** Whether the person has to answer before anything happens. */
  asks: boolean;
  /** What the store holds for this project, if anything. */
  stored: StoredProject | null;
  /** What closing will do, said before it is done. */
  detail: string;
}

/**
 * The question closing this project should ask.
 *
 * `projects` is null when the store could not be reached, which is different
 * from it holding nothing: one is "there is no copy" and the other is "nobody
 * knows", and saying the first when the second is true would be a lie about
 * where somebody's work is.
 */
export function closeQuestion(projectId: string, projects: StoredProject[] | null): CloseQuestion {
  if (projects === null) {
    return {
      asks: false,
      stored: null,
      detail: 'No project store answered, so nothing is stored anywhere but this browser and closing removes it from here.',
    };
  }
  const stored = projects.find((project) => project.id === projectId) ?? null;
  if (!stored) {
    return {
      asks: false,
      stored: null,
      detail: 'The store holds no copy of this project, so closing removes it from this browser and nowhere else.',
    };
  }
  const revisions = `${stored.revisions} revision${stored.revisions === 1 ? '' : 's'}`;
  return {
    asks: true,
    stored,
    detail: `The store holds ${stored.id} with ${revisions}. Closing removes this project from the browser either way; what it does with the stored copy is the choice below.`,
  };
}

/** What the workbench says once the choice has been carried out. */
export function closeOutcome(projectName: string, choice: CloseChoice, deleted: { revisions: number } | null, refusal?: string): string {
  if (choice === 'delete-stored') {
    if (refusal) return `Closed ${projectName}. The stored copy was not deleted: ${refusal}`;
    const revisions = deleted ? `${deleted.revisions} revision${deleted.revisions === 1 ? '' : 's'}` : 'its revisions';
    return `Closed ${projectName} and deleted ${revisions} from the store.`;
  }
  if (choice === 'keep-stored') return `Closed ${projectName}. The stored copy is untouched and can be opened again from the project store.`;
  return `Closed ${projectName}.`;
}
