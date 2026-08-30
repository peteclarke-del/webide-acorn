/* Every limit this product enforces, in one place, with why.
 *
 * The limits themselves were already enforced, each in the module that owns
 * it. What did not exist was anywhere a person could see them. That matters
 * more than it sounds: a limit you only meet by exceeding it is indistinguish-
 * able from a bug, and the first thing someone does when an import stops half
 * way is assume the product is broken rather than that it told them something.
 *
 * So this is a register rather than a second set of constants. Every number is
 * imported from the module that enforces it, so the register cannot say one
 * thing while the code does another, and a contract checks each one.
 *
 * Every entry carries the reason the limit exists. A number with no reason is
 * a number nobody can argue with later, and limits are exactly the thing that
 * needs arguing with when a real project turns out to be bigger than someone
 * assumed.
 */
import { MAX_SOURCE_FILE_BYTES, MAX_PROJECT_SOURCE_BYTES } from '../editor/sourceTextFormat';
import { MAX_FILENAME_LENGTH } from './safeNames';
import { MAX_IMPORT_FILES } from './codebaseImport';
import { MAX_DIRECTORY_BYTES, MAX_DIRECTORY_FILES } from './directoryAccess';
import { MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_FILE_BYTES, MAX_ARCHIVE_TOTAL_BYTES } from './archiveImport';
import { MAX_TRASH_ENTRIES } from './projectTrash';
import { MAX_PROJECT_SEARCH_CHARACTERS, MAX_PROJECT_SEARCH_MATCHES, MAX_PROJECT_SEARCH_QUERY } from './projectSearch';
import { MAX_DISCS_PER_SET } from '../media/diskSet';
import { MAX_TAPE_IMAGE_BYTES } from '../media/tapeFormat';
import { MAX_CLIPBOARD_TEXT_CHARACTERS } from '../editor/plainTextClipboard';
import { MACHINE_STATE_LIMIT } from '../emulator/machineStateEnvelope';
import { MACHINE_TEXT_LIMIT } from '../emulator/keyboardInputModel';
import { MAX_COMMENTS, MAX_ENTRY_POINTS, MAX_LABELS, MAX_REGIONS } from '../analysis/analysisAnnotations';
import { MAX_MAP_CELLS, MAX_MAP_DIMENSION, MAX_MAP_LAYERS, MAX_MAP_OBJECTS } from '../assets/tileMapDocument';

export type LimitKind = 'size' | 'count' | 'retention' | 'concurrency';

export interface ProductLimit {
  id: string;
  /** What is limited, in the words a person would use. */
  label: string;
  kind: LimitKind;
  value: number;
  /** 'bytes', 'characters', 'files', and so on. Used to render the value. */
  unit: string;
  /** Why the limit exists. Never omitted. */
  reason: string;
  /** What the product does when it is reached. Never "it fails". */
  onReaching: string;
}

/* The most concurrent native builds `executeBuildAll` will start. Declared
 * here as a named constant because the clamp inside that function is the only
 * other place it appears, and a person reading this register should not have
 * to find it. The contract below checks the two agree. */
export const MAX_BUILD_CONCURRENCY = 4;

export const PRODUCT_LIMITS: readonly ProductLimit[] = Object.freeze([
  {
    id: 'source-file-bytes',
    label: 'One source file',
    kind: 'size',
    value: MAX_SOURCE_FILE_BYTES,
    unit: 'bytes',
    reason: 'A source file is edited in a text area and re-analysed on every keystroke. Past about a megabyte the browser, not the product, becomes the limit.',
    onReaching: 'The file is refused on import and the edit is refused on save, naming the file and the limit. Nothing already in the project changes.',
  },
  {
    id: 'project-source-bytes',
    label: 'All source in one project',
    kind: 'size',
    value: MAX_PROJECT_SOURCE_BYTES,
    unit: 'bytes',
    reason: 'The whole project is held in browser storage and written on every change. Beyond this the save itself becomes the slow part of editing.',
    onReaching: 'The import or edit that would cross it is refused with the current total and the limit. The project is left as it was.',
  },
  {
    id: 'filename-length',
    label: 'A filename',
    kind: 'size',
    value: MAX_FILENAME_LENGTH,
    unit: 'characters',
    reason: 'Well inside what every filesystem accepts, so a project can always be written back to disk under the names it holds.',
    onReaching: 'The name is shortened, keeping its extension so the language is still known, and the change is reported with the reason.',
  },
  {
    id: 'import-files',
    label: 'Files in one folder import',
    kind: 'count',
    value: MAX_IMPORT_FILES,
    unit: 'files',
    reason: 'An import plans and previews every file before anything is created. Past this the preview stops being something a person can read.',
    onReaching: 'The plan says it stopped early and how many it read. Nothing is imported until the plan is accepted.',
  },
  {
    id: 'directory-files',
    label: 'Files read from a folder on disk',
    kind: 'count',
    value: MAX_DIRECTORY_FILES,
    unit: 'files',
    reason: 'Matches the import limit, so a folder read through the file-system API and one read through the directory input behave the same.',
    onReaching: 'The read reports that it was cut short, and the plan shows what it did read.',
  },
  {
    id: 'directory-bytes',
    label: 'Bytes read from a folder on disk',
    kind: 'size',
    value: MAX_DIRECTORY_BYTES,
    unit: 'bytes',
    reason: 'Matches the project source total, because a folder is imported into a project.',
    onReaching: 'The read stops at the limit and says so rather than appearing to have finished.',
  },
  {
    id: 'archive-entries',
    label: 'Files in one zip archive',
    kind: 'count',
    value: MAX_ARCHIVE_ENTRIES,
    unit: 'files',
    reason: 'Matches the folder import, since an archive reaches the same plan.',
    onReaching: 'Entries past the limit are refused by name and the read is marked as cut short.',
  },
  {
    id: 'archive-file-bytes',
    label: 'One file expanded from an archive',
    kind: 'size',
    value: MAX_ARCHIVE_FILE_BYTES,
    unit: 'bytes',
    reason: 'An archive header is a claim, not a fact. Decompression stops at this bound, so the memory a hostile archive can make the tab allocate is this number and not whatever the archive intended.',
    onReaching: 'The entry is refused by name, whether it declared its size honestly or lied about it.',
  },
  {
    id: 'archive-total-bytes',
    label: 'Everything expanded from one archive',
    kind: 'size',
    value: MAX_ARCHIVE_TOTAL_BYTES,
    unit: 'bytes',
    reason: 'A second bound, so one large entry cannot spend the whole budget and leave nothing for the rest of the archive.',
    onReaching: 'The remaining entries are refused by name and the read is marked as cut short.',
  },
  {
    id: 'trash-entries',
    label: 'Files kept in the project trash',
    kind: 'retention',
    value: MAX_TRASH_ENTRIES,
    unit: 'files',
    reason: 'The trash travels inside the project document, so it cannot grow without bound. This is enough to undo a session of deletions.',
    onReaching: 'The oldest entries are dropped, and the deletion reports exactly which ones it dropped rather than discarding them quietly.',
  },
  {
    id: 'discs-per-set',
    label: 'Discs in one disk set',
    kind: 'count',
    value: MAX_DISCS_PER_SET,
    unit: 'discs',
    reason: 'A set is a release of one program. Beyond this it is a collection, which is a different thing and is not modelled.',
    onReaching: 'Adding another disc is refused with the limit stated.',
  },
  {
    id: 'tape-image-bytes',
    label: 'A tape image',
    kind: 'size',
    value: MAX_TAPE_IMAGE_BYTES,
    unit: 'bytes',
    reason: 'Larger than any real tape of the era, and small enough to hold and parse in a browser tab.',
    onReaching: 'The image is refused with its size and the limit. Nothing is loaded.',
  },
  {
    id: 'machine-state-bytes',
    label: 'A saved machine state',
    kind: 'size',
    value: MACHINE_STATE_LIMIT,
    unit: 'bytes',
    reason: 'Covers the RAM, video and expansion memory of every machine this build runs, with room for the envelope around it.',
    onReaching: 'The state is refused rather than truncated, because a truncated machine state restores to a machine that never existed.',
  },
  {
    id: 'machine-text',
    label: 'Text typed into a running machine at once',
    kind: 'size',
    value: MACHINE_TEXT_LIMIT,
    unit: 'characters',
    reason: 'Text is entered through the real keyboard matrix at firmware-safe pacing. A larger paste takes longer than anyone would wait and would look like a hang.',
    onReaching: 'The paste is refused with its length and the limit, rather than being silently cut.',
  },
  {
    id: 'clipboard-characters',
    label: 'Text pasted into the editor',
    kind: 'size',
    value: MAX_CLIPBOARD_TEXT_CHARACTERS,
    unit: 'characters',
    reason: 'Matches the project source total, since a paste can only ever become project source.',
    onReaching: 'The paste is refused and the document is unchanged.',
  },
  {
    id: 'search-query',
    label: 'A project search query',
    kind: 'size',
    value: MAX_PROJECT_SEARCH_QUERY,
    unit: 'characters',
    reason: 'A query longer than this is not a search, and bounding it bounds the work each file costs.',
    onReaching: 'The query is refused with the limit stated.',
  },
  {
    id: 'search-matches',
    label: 'Matches one search returns',
    kind: 'count',
    value: MAX_PROJECT_SEARCH_MATCHES,
    unit: 'matches',
    reason: 'A result list longer than this is not readable, and rendering it is what makes a search feel slow.',
    onReaching: 'The search reports that it stopped at the limit, so a short list is never mistaken for a complete one.',
  },
  {
    id: 'search-characters',
    label: 'Characters one search reads',
    kind: 'size',
    value: MAX_PROJECT_SEARCH_CHARACTERS,
    unit: 'characters',
    reason: 'Bounds the work of a single search independently of how many matches it finds.',
    onReaching: 'The search reports that it stopped early rather than presenting partial results as complete.',
  },
  {
    id: 'annotation-entry-points',
    label: 'Extra entry points on one analysed program',
    kind: 'count',
    value: MAX_ENTRY_POINTS,
    unit: 'entry points',
    reason: 'Each one starts a separate walk of the program, so this bounds the analysis.',
    onReaching: 'The annotation document is refused on the way in, naming the limit.',
  },
  {
    id: 'annotation-regions',
    label: 'Code and data regions on one analysed program',
    kind: 'count',
    value: MAX_REGIONS,
    unit: 'regions',
    reason: 'Enough to describe a whole 64 KB program in detail, and bounded so a document cannot grow without limit.',
    onReaching: 'The annotation document is refused on the way in, naming the limit.',
  },
  {
    id: 'annotation-comments',
    label: 'Comments on one analysed program',
    kind: 'count',
    value: MAX_COMMENTS,
    unit: 'comments',
    reason: 'More than one per sixteen bytes of a full 64 KB program.',
    onReaching: 'The annotation document is refused on the way in, naming the limit.',
  },
  {
    id: 'annotation-labels',
    label: 'Labels on one analysed program',
    kind: 'count',
    value: MAX_LABELS,
    unit: 'labels',
    reason: 'More than one per sixteen bytes of a full 64 KB program.',
    onReaching: 'The annotation document is refused on the way in, naming the limit.',
  },
  {
    id: 'map-dimension',
    label: 'Width or height of a tile map',
    kind: 'count',
    value: MAX_MAP_DIMENSION,
    unit: 'tiles',
    reason: 'A map is edited on a canvas and exported as bytes for an 8-bit machine. Past this it is larger than the machine could hold.',
    onReaching: 'The map document is refused with the dimension and the limit.',
  },
  {
    id: 'map-cells',
    label: 'Cells in one tile map',
    kind: 'count',
    value: MAX_MAP_CELLS,
    unit: 'cells',
    reason: 'Bounds the total independently of the shape, so a long thin map cannot exceed what the width and height limits allow.',
    onReaching: 'The map document is refused with its size and the limit.',
  },
  {
    id: 'map-layers',
    label: 'Layers in one tile map',
    kind: 'count',
    value: MAX_MAP_LAYERS,
    unit: 'layers',
    reason: 'Each layer is a full copy of the map in the exported bytes.',
    onReaching: 'The map document is refused with the limit stated.',
  },
  {
    id: 'map-objects',
    label: 'Objects in one tile map',
    kind: 'count',
    value: MAX_MAP_OBJECTS,
    unit: 'objects',
    reason: 'More than any 8-bit machine can track at once.',
    onReaching: 'The map document is refused with the limit stated.',
  },
  {
    id: 'build-concurrency',
    label: 'Builds running at once',
    kind: 'concurrency',
    value: MAX_BUILD_CONCURRENCY,
    unit: 'builds',
    reason: 'Building everything runs targets in dependency order and in parallel where the graph allows. More than this competes for the same worker and container without finishing sooner.',
    onReaching: 'Further targets wait in the queue and are reported as queued rather than started.',
  },
]);

/** A limit's value written for a person, in the unit it is measured in. */
export function formatLimit(limit: ProductLimit): string {
  if (limit.unit !== 'bytes') return `${limit.value.toLocaleString()} ${limit.unit}`;
  if (limit.value >= 1024 * 1024) return `${(limit.value / (1024 * 1024)).toFixed(limit.value % (1024 * 1024) ? 1 : 0)} MiB`;
  return `${(limit.value / 1024).toFixed(0)} KiB`;
}

/** The limits of one kind, in the order they are declared. */
export function limitsOfKind(kind: LimitKind): ProductLimit[] {
  return PRODUCT_LIMITS.filter((limit) => limit.kind === kind);
}

export interface LimitProblem {
  where: string;
  problem: string;
}

/**
 * Check the register against the rules it depends on. Run by a contract: a
 * register that disagrees with the code is a build defect, and one that names
 * a limit without saying why is a number nobody can argue with later.
 */
export function validateLimits(limits: readonly ProductLimit[] = PRODUCT_LIMITS): LimitProblem[] {
  const problems: LimitProblem[] = [];
  const ids = new Set<string>();
  for (const limit of limits) {
    const where = limit.id || '(a limit with no id)';
    if (!limit.id) problems.push({ where, problem: 'has no identifier' });
    if (ids.has(limit.id)) problems.push({ where, problem: 'shares its identifier with another limit' });
    ids.add(limit.id);
    if (!limit.label.trim()) problems.push({ where, problem: 'has no label' });
    if (!Number.isInteger(limit.value) || limit.value <= 0) problems.push({ where, problem: 'has no positive whole value' });
    if (!limit.unit.trim()) problems.push({ where, problem: 'states no unit, so its value cannot be read' });
    if (limit.reason.trim().length < 40) problems.push({ where, problem: 'does not say why it exists' });
    if (limit.onReaching.trim().length < 40) problems.push({ where, problem: 'does not say what happens when it is reached' });
    if (/\bfails?\b/i.test(limit.onReaching) && !/rather than|instead/i.test(limit.onReaching)) {
      problems.push({ where, problem: 'says only that it fails, which tells a person nothing they can act on' });
    }
  }
  return problems;
}
