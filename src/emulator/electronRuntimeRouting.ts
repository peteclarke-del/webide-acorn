/*
 * Which Electron core a ROM set starts, and where to send its commands.
 *
 * There are two Electron cores in this build and they are not interchangeable:
 * one page, one channel and one refusal table each. Which one runs is decided by
 * the ROM set the person selected, and that decision used to live as a
 * conditional inside the emulator panel where nothing could check it.
 *
 * It matters more than it looks. Sending a command on the wrong channel is
 * silent — the runtime ignores anything not addressed to it — so a workbench
 * pointed at the right page with the wrong channel would show a machine that
 * never answered, with no error anywhere to say why.
 *
 * So the mapping is one function, and a contract checks each half of it against
 * the runtime file that actually implements it.
 */

/** The engines this build can start an Acorn Electron on. */
export type ElectronEngineId = 'elkjs' | 'elkulator';

export interface ElectronRuntimeRoute {
  /** The document the emulator panel frames. */
  page: string;
  /** The channel every command and event is stamped with. */
  channel: string;
  /** What to call this core when telling somebody what is attached. */
  label: string;
}

const ROUTES: Readonly<Record<ElectronEngineId, ElectronRuntimeRoute>> = Object.freeze({
  elkjs: Object.freeze({ page: '/electron.html', channel: '8bit-net-electron', label: 'ElkJS' }),
  elkulator: Object.freeze({ page: '/elkulator.html', channel: '8bit-net-elkulator', label: 'Elkulator' }),
});

/** Whether this engine identifier names an Electron core rather than another machine's. */
export function isElectronEngine(engineId: string | undefined): engineId is ElectronEngineId {
  return engineId === 'elkjs' || engineId === 'elkulator';
}

/**
 * Where an Electron engine's runtime lives.
 *
 * An engine this build cannot start is not routed to a default: answering with
 * one core's page for another core's identifier is how a machine comes to be
 * started that nobody asked for.
 */
export function electronRuntimeRoute(engineId: string | undefined): ElectronRuntimeRoute | null {
  return isElectronEngine(engineId) ? ROUTES[engineId] : null;
}
