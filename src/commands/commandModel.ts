import type { IconName } from '../components/Icon';
export interface WorkbenchCommand {
  id: string;
  /**
   * What the command palette shows and searches against, which is why it is a
   * whole descriptive phrase rather than a menu's word or two.
   */
  label: string;
  /**
   * What a menu shows: a word or two, the way a desktop application's menus
   * read. The full `label` becomes the entry's tooltip, so the detail is a
   * hover away rather than spent on the width of the menu. Absent where the
   * label is already short enough to be one.
   */
  short?: string;
  /** A small icon beside the entry, where one makes it faster to find. */
  icon?: IconName;
  /**
   * Whether the thing this command shows is showing. A menu draws it as a
   * tick beside a stable name, the way a desktop View menu does, rather than
   * renaming the entry between Show and Hide as the palette's label does.
   */
  checked?: boolean;
  category: string;
  keywords?: string[];
  shortcut?: string;
  enabled: boolean;
  disabledReason?: string;
  run: () => void;
}

export function filterCommands(commands: WorkbenchCommand[], rawQuery: string): WorkbenchCommand[] {
  const terms = normalize(rawQuery).split(' ').filter(Boolean);
  if (!terms.length) return commands;
  return commands.map((command, order) => ({ command, order, score: scoreCommand(command, terms) }))
    .filter((candidate) => candidate.score >= 0)
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .map((candidate) => candidate.command);
}

function scoreCommand(command: WorkbenchCommand, terms: string[]): number {
  const label = normalize(command.label);
  const category = normalize(command.category);
  const keywords = normalize(command.keywords?.join(' ') ?? '');
  let score = 0;
  for (const term of terms) {
    if (label === term) score += 100;
    else if (label.startsWith(term)) score += 50;
    else if (label.includes(term)) score += 25;
    else if (category.includes(term)) score += 12;
    else if (keywords.includes(term)) score += 8;
    else return -1;
  }
  return score;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
