// The "host essentials" half of a perf report: the host facts only the desktop
// (Electron) shell can see, which a web or mobile client never sends. The
// narrowing lives here rather than in server/perf_report.ts because that file
// is already the ingest coordinator and pays for growth by extraction
// (server/CLAUDE.md, module-first).
//
// Two rules the caller must keep, both encoded in hostEssentialsRow:
//  1. The whole block is IGNORED unless the same report is a desktop-shell
//     report. A browser tab has no business claiming a Windows power plan, and
//     the endpoint accepts anonymous posts.
//  2. The two power settings are CLOSED VOCABULARIES with '' as the fallback.
//     The client never sends a raw Windows power-scheme GUID (the shell folds
//     it before it ever leaves the machine, because a custom plan's GUID
//     identifies one machine), and a report that does send one stores '' here:
//     a GUID is not a member of the vocabulary, so the fallback catches it.
//     This is the same posture the ingest already takes on refreshHz, which is
//     rounded to whole Hz for exactly this reason.

/** Closed vocabulary, kept equal to electron/host_essentials.cjs POWER_PLANS
 *  and src/game/desktop_host_essentials.ts HOST_POWER_PLANS by
 *  tests/host_essentials_vocabulary_parity.test.ts. */
export const HOST_POWER_PLANS = [
  '',
  'balanced',
  'high_performance',
  'power_saver',
  'ultimate',
  'other',
] as const;

/** Closed vocabulary for the Windows 10/11 power-mode slider overlay. */
export const HOST_POWER_MODES = [
  '',
  'best_efficiency',
  'balanced',
  'better_performance',
  'best_performance',
  'other',
] as const;

/** 4 TiB in MB: the ceiling the two HOST memory columns are clamped into. It has
 *  to be absurd, because it bounds a machine's installed RAM. */
export const HOST_MEM_MAX_MB = 4_194_304;

/** 64 GiB in MB: the tighter ceiling for the three APP process working sets.
 *  Those describe THIS app's own processes, which no real machine runs anywhere
 *  near, so the host ceiling would let one absurd anonymous value (this endpoint
 *  accepts anonymous posts) drag a future average over these columns by four
 *  million megabytes. Kept equal to the shell's own clamp
 *  (electron/host_essentials.cjs APP_MEM_MAX_MB) and the renderer narrowing's
 *  (src/game/desktop_host_essentials.ts) by
 *  tests/host_essentials_vocabulary_parity.test.ts. */
export const APP_MEM_MAX_MB = 65_536;

export interface HostEssentialsRow {
  hostMemTotalMb: number | null;
  hostMemFreeMb: number | null;
  appWorkingSetMb: number | null;
  appRendererWsMb: number | null;
  appGpuWsMb: number | null;
  hostOnBattery: boolean | null;
  hostPowerPlan: string;
  hostPowerMode: string;
  hostHags: boolean | null;
  hostGameMode: boolean | null;
}

/** Every field in its "no evidence" state: what a web report, a mobile report,
 *  and a desktop report whose shell could not collect anything all store. */
export const ABSENT_HOST_ESSENTIALS: Readonly<HostEssentialsRow> = Object.freeze({
  hostMemTotalMb: null,
  hostMemFreeMb: null,
  appWorkingSetMb: null,
  appRendererWsMb: null,
  appGpuWsMb: null,
  hostOnBattery: null,
  hostPowerPlan: '',
  hostPowerMode: '',
  hostHags: null,
  hostGameMode: null,
});

/**
 * A nullable whole-megabyte column. Absent, non-numeric, NaN, Infinity and
 * negative all store null (an absent dimension, not a zero, which would read as
 * "this machine has no memory"); anything above `maxMb` is clamped. The ceiling
 * is a parameter because the host columns and the app columns bound genuinely
 * different quantities (see APP_MEM_MAX_MB).
 */
export function hostMbIn(value: unknown, maxMb: number = HOST_MEM_MAX_MB): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.min(maxMb, Math.floor(value));
}

/**
 * A STRICT nullable boolean: only the actual booleans are accepted. `Boolean()`
 * would turn 'false', 0 and undefined into a stored answer, and the difference
 * between "off" and "could not be read" is the whole point of these two
 * columns.
 */
export function hostBoolIn(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** A closed-vocabulary column; anything else, a raw GUID included, stores ''. */
export function hostChoiceIn(value: unknown, choices: readonly string[]): string {
  return typeof value === 'string' && choices.includes(value) ? value : '';
}

/**
 * Narrow the host-essentials fields of one report body. `desktopShell` is the
 * ingest's already-resolved verdict for the SAME report (the payload flag or
 * the Electron user-agent fallback): when it is false the whole block is
 * ignored and every column stores its absent value.
 */
export function hostEssentialsRow(
  body: Record<string, unknown>,
  desktopShell: boolean,
): HostEssentialsRow {
  if (!desktopShell) return { ...ABSENT_HOST_ESSENTIALS };
  return {
    hostMemTotalMb: hostMbIn(body.hostMemTotalMb),
    hostMemFreeMb: hostMbIn(body.hostMemFreeMb),
    appWorkingSetMb: hostMbIn(body.appWorkingSetMb, APP_MEM_MAX_MB),
    appRendererWsMb: hostMbIn(body.appRendererWsMb, APP_MEM_MAX_MB),
    appGpuWsMb: hostMbIn(body.appGpuWsMb, APP_MEM_MAX_MB),
    hostOnBattery: hostBoolIn(body.hostOnBattery),
    hostPowerPlan: hostChoiceIn(body.hostPowerPlan, HOST_POWER_PLANS),
    hostPowerMode: hostChoiceIn(body.hostPowerMode, HOST_POWER_MODES),
    hostHags: hostBoolIn(body.hostHags),
    hostGameMode: hostBoolIn(body.hostGameMode),
  };
}
