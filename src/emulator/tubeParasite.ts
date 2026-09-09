/*
 * Which second processor is on the other side of the Tube.
 *
 * The engine picks one by host: the Turbo board for a Master, the 6502 board
 * for everything else, because that is what Acorn sold for each. That is the
 * right default and the wrong rule. Neither parasite model is tied to a host,
 * and a PiTube Direct puts a 65C102 behind the Tube of whatever machine it is
 * plugged into, which is how people run one today.
 *
 * So the parasite is a capability rather than a consequence of the host. A
 * BBC-family machine offers the second processor Acorn sold for it, and offers
 * a 65C102 alongside, and either is fitted by switching it on.
 *
 * A Model B with a 65C102 behind the Tube was booted to check this is real
 * rather than plausible; see `tubeParasiteMeasurements.ts`.
 */
import { TubeModel, TurboTubeModel } from 'jsbeeb/src/models.js';

/** The capability that fits a 65C102 rather than the machine's own parasite. */
export const TURBO_CAPABILITY = 'tube-turbo';

/** The capability that fits the second processor the machine was sold with. */
export const TUBE_CAPABILITY = 'tube';

export interface TubeParasite {
  id: string;
  label: string;
  /** The parasite's own boot ROM, in the firmware vault's own paths. */
  romPath: string;
  clockMhz: number;
}

export const TUBE_PARASITES: Readonly<Record<'6502' | '65c102', TubeParasite>> = Object.freeze({
  '6502': Object.freeze({ id: 'tube6502', label: '6502 second processor', romPath: 'tube/6502Tube.rom', clockMhz: 3 }),
  '65c102': Object.freeze({ id: 'tube65c102', label: '65C102 Turbo second processor', romPath: 'tube/65C102Tube.rom', clockMhz: 4 }),
});

/**
 * The parasite a session fits, or null when it fits none.
 *
 * The Turbo wins where both are switched on, because a machine has one Tube and
 * the faster processor is the one somebody meant.
 */
export function parasiteFor(model: JsBeebModel, enabledCapabilities: readonly string[]): JsBeebModel | null {
  if (enabledCapabilities.includes(TURBO_CAPABILITY)) return TurboTubeModel;
  if (!enabledCapabilities.includes(TUBE_CAPABILITY)) return null;
  /* What the machine was sold with: the Turbo board for a Master, the 6502
   * board for the rest. */
  return model.isMaster ? TurboTubeModel : TubeModel;
}

/** Which of the two a resolved parasite is, for anything that has to name it. */
export function parasiteIdentity(parasite: JsBeebModel | null): TubeParasite | null {
  if (!parasite) return null;
  return parasite.name === 'Tube65C102' ? TUBE_PARASITES['65c102'] : TUBE_PARASITES['6502'];
}
