/* Standalone user guides, rendered from the guides that are already in the IDE.
 *
 * DOC-901 asks for user guides covering every area of the product. DOC-901A
 * already shipped those guides inside the IDE, searchable and deep-linkable.
 * Writing a second set by hand would be a second copy of the same facts, and
 * two declarations of one fact are a defect: they agree on the day they are
 * written and disagree from then on, with nothing to say which is right.
 *
 * So the standalone guides are generated from the same topics the IDE reads,
 * and the gate regenerates them and fails if what is committed differs. There
 * is one source and one procedure, published twice.
 *
 * The areas below are DOC-901's own list. Each one names the topics that cover
 * it, so an area nobody documented fails the gate rather than quietly
 * producing a shorter book.
 */

/** DOC-901's areas, and the topics that answer each of them. */
export const GUIDE_AREAS = [
  { id: 'first-run', title: 'First run', topics: ['first-run', 'using-help', 'sample-projects', 'settings-layers'] },
  { id: 'target-selection', title: 'Choosing a target', topics: ['target-selection'] },
  { id: 'rom-import', title: 'Importing firmware', topics: ['rom-import'] },
  { id: 'projects', title: 'Projects and source', topics: ['projects', 'import-codebase', 'source-provenance', 'source-comparison'] },
  { id: 'editing', title: 'Writing and editing source', topics: ['editor', 'source-text-format', 'editor-splits', 'bookmarks', 'clipboard-safety', 'safe-rename-quick-fixes', 'basic-numbering', 'basic-range-renumber', 'basic-line-diagnostics'] },
  { id: 'navigation', title: 'Finding your way around a codebase', topics: ['source-navigation-workflow', 'symbol-navigation', 'go-to-source', 'call-hierarchy', 'target-navigation', 'generated-symbol-navigation', 'sdk-document-navigation', 'c-source-relationships'] },
  { id: 'assistance', title: 'Completion, signatures and type hints', topics: ['context-completion', 'completion-interaction', 'completion-snippets', 'target-reference-completion', 'c-scope-completion', 'token-help', 'signature-help', 'source-type-hints', 'language-request-safety'] },
  { id: 'builds', title: 'Building', topics: ['build-targets', 'analysis', 'analysis-annotations'] },
  { id: 'media', title: 'Discs, tapes and media', topics: ['media', 'disk-sets', 'emulator-media-eject', 'emulator-guest-disk-export'] },
  { id: 'emulator', title: 'Running a machine, and controlling it', topics: ['emulator', 'emulator-power-speed', 'emulator-keyboard-input', 'emulator-key-remap', 'emulator-gamepad', 'emulator-bbc-mouse-joystick', 'emulator-a310-mouse', 'emulator-atom-atommc', 'emulator-display-scaling', 'emulator-display-effects', 'emulator-audio-filter', 'emulator-machine-state', 'emulator-storage-quota', 'emulator-wav-capture', 'emulator-a310-wav-capture', 'emulator-session-provenance', 'emulator-program-provenance'] },
  { id: 'debugging', title: 'Debugging and tracing', topics: ['debugger-6502', 'debugger-arm', 'breakpoint-persistence', 'hardware-trace'] },
  { id: 'tests', title: 'Tests', topics: ['tests', 'headless-ci'] },
  { id: 'assets', title: 'The asset editors', topics: ['assets', 'tile-maps', 'asset-fonts', 'asset-screens', 'asset-palettes', 'asset-sound', 'asset-samples'] },
  { id: 'research', title: 'Reference and research', topics: ['research'] },
  { id: 'accessibility', title: 'Accessibility', topics: ['keyboard-accessibility', 'shortcut-remapping'] },
  { id: 'troubleshooting', title: 'Troubleshooting', topics: ['troubleshooting'] },
];

/**
 * Areas of DOC-901 this build has no feature for, and therefore no guide.
 *
 * A guide to a feature that does not exist is fiction, and a book that quietly
 * omits an area reads as a book that covered everything. So the area is named,
 * the reason is given, and `absentMarkers` names what would appear in the
 * interface source if the feature had in fact shipped — which makes this a
 * check that can fail rather than a note. Ship the feature and the gate demands
 * the guide.
 */
export const UNAVAILABLE_AREAS = [
  {
    id: 'cloud',
    title: 'Cloud projects, revisions and sharing',
    reason:
      'This build stores projects in the browser and on disk, and has no server-side project store, no revision history and no sharing. There is nothing to write a procedure for, and a procedure for an absent feature would be read as evidence the feature exists. The work is tracked as CLD-800 onward and this guide is due with it.',
    absentMarkers: ['CloudProjectWorkspace', 'RevisionHistoryPanel', 'aria-label="Share project"'],
  },
];

const bullet = (heading, entries) =>
  entries.length === 0 ? [] : ['', `**${heading}**`, '', ...entries.map((entry) => `- ${entry}`)];

/** One topic, as a section of a guide. */
export function renderTopic(topic, index) {
  const lines = [`## ${index}. ${topic.title}`, '', topic.summary];
  lines.push(...bullet('Before you start', topic.prerequisites));
  if (topic.steps.length > 0) {
    lines.push('', '**Procedure**', '', ...topic.steps.map((step, at) => `${at + 1}. ${step}`));
  }
  lines.push(...bullet('What should happen', topic.expected));
  lines.push(...bullet('Limits', topic.limitations));
  lines.push(...bullet('If it goes wrong', topic.recovery));
  if (topic.screenshot) {
    lines.push('', `![${topic.screenshot.alt}](../../public${topic.screenshot.src})`, '', `*${topic.screenshot.caption}*`);
  }
  lines.push('', `In the IDE: Help → \`#help/${topic.id}\``, '');
  return lines.join('\n');
}

/** One area, as a whole file. */
export function renderGuide(area, byId) {
  const missing = area.topics.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error(`The ${area.id} guide names topics that do not exist: ${missing.join(', ')}`);
  return [
    `# ${area.title}`,
    '',
    GENERATED_NOTE,
    '',
    ...area.topics.map((id, index) => renderTopic(byId.get(id), index + 1)),
  ].join('\n');
}

export const GENERATED_NOTE =
  '<!-- Generated by scripts/generateGuides.mjs from src/help/helpTopics.ts. Edit the topics, not this file. -->';

export function renderIndex(topics) {
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const lines = [
    '# User guides',
    '',
    GENERATED_NOTE,
    '',
    'These are the same procedures the IDE carries under Help, published so they can be read',
    'without starting it. They are generated from one source, so the two cannot disagree.',
    '',
    `${topics.length} procedures across ${GUIDE_AREAS.length} areas.`,
    '',
  ];
  for (const area of GUIDE_AREAS) {
    lines.push(`## [${area.title}](${area.id}.md)`, '');
    for (const id of area.topics) lines.push(`- **${byId.get(id)?.title ?? id}** — ${byId.get(id)?.summary ?? ''}`);
    lines.push('');
  }
  lines.push('## Areas with no guide, and why', '');
  for (const area of UNAVAILABLE_AREAS) lines.push(`### ${area.title}`, '', area.reason, '');
  return lines.join('\n');
}

/** Every file the guides consist of, keyed by name. */
export function guideFiles(topics) {
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const files = new Map([['index.md', renderIndex(topics)]]);
  for (const area of GUIDE_AREAS) files.set(`${area.id}.md`, renderGuide(area, byId));
  return files;
}

/**
 * Topics no area publishes.
 *
 * A topic that reaches the IDE and not the book is the drift this generator
 * exists to prevent, so it is a failure rather than an omission.
 */
export function unpublishedTopics(topics) {
  const published = new Set(GUIDE_AREAS.flatMap((area) => area.topics));
  return topics.filter((topic) => !published.has(topic.id)).map((topic) => topic.id);
}

/** Areas declared absent that the interface source shows are not absent. */
export function unavailableFailures(sourceText) {
  const failures = [];
  for (const area of UNAVAILABLE_AREAS) {
    for (const marker of area.absentMarkers) {
      if (sourceText.includes(marker)) {
        failures.push(`The guides declare ${area.title} absent from this build, but the interface source contains ${marker}. Write the guide or correct the declaration.`);
      }
    }
  }
  return failures;
}
