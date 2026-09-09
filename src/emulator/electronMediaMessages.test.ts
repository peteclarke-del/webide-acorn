import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * The words the Elkulator bridge uses for media, and the words the workbench
 * listens for.
 *
 * They were different. jsbeeb and the A310 announce a mount as `media-loaded`;
 * the Elkulator bridge announces it as `media` with an action. Only the first
 * was listened for, so a disc the Electron really had mounted was never
 * recorded anywhere: the command went out, the core accepted it and answered,
 * and the workbench went on showing "No media is mounted in this session".
 * Every end was correct and the join was not, which is why nothing failed.
 *
 * Both files are read here so neither can add or rename a message without the
 * other being held to it.
 */
const RUNTIME = readFileSync(resolve(process.cwd(), 'public/elkulator-runtime.js'), 'utf8');
const WORKBENCH = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

/** Every media action the bridge can send, taken from the bridge. */
function actionsTheBridgeSends(): string[] {
  const sends = [...RUNTIME.matchAll(/send\(\{\s*type:\s*'media',\s*action:\s*'([a-z-]+)'/g)].map((match) => match[1]!);
  return [...new Set(sends)].sort();
}

describe('what the Electron says about its media', () => {
  it('sends the four actions this contract is about', () => {
    expect(actionsTheBridgeSends()).toEqual(['eject-disc', 'eject-tape', 'load-disc', 'load-tape']);
  });

  it('is listened for by the workbench, action by action', () => {
    /* The handler is keyed on the action, so each one has to be named in it. */
    expect(WORKBENCH, 'the workbench listens for the bridge message at all').toContain("event.data.type === 'media'");
    for (const action of actionsTheBridgeSends()) {
      expect(WORKBENCH, `nothing handles the bridge's ${action}`).toContain(`action === '${action}'`);
    }
  });

  it('still listens for the other cores, which say it differently', () => {
    /* jsbeeb and the A310 announce a mount as media-loaded, and that handling
     * must survive: the point was to speak both, not to swap one for the
     * other. */
    expect(WORKBENCH).toContain("event.data.type === 'media-loaded'");
  });
});
