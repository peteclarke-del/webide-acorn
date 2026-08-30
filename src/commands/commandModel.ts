export interface WorkbenchCommand {
  id: string;
  label: string;
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
