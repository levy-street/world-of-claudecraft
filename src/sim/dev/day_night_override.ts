// [dev] /dev servertime: shift the day/night clock the SIM reads.
//
// The client's /daynight is render-only (src/game/daynight_dev_command.ts): it repaints
// the sky, but on the authoritative server the sim keeps reading the realm's own clock
// (server/sim_boot_config.ts `dayNightNowMs: () => Date.now()`), so a tester cannot see
// the slumbering world boss by night or at dawn without waiting for the real cycle.
//
// This changes nothing in the sim's logic and draws nothing: it swaps the HOST CLOCK the
// sim is handed (`cfg.dayNightNowMs`) for the same clock plus a fixed offset, chosen so
// the phase lands where asked and then keeps running at the real rate from there. `auto`
// hands the original clock back. A host with no clock at all (tests, the RL env) gets a
// frozen one at the asked phase, and `auto` returns it to having none.
//
// Reached only through handleDevChat behind ctx.devCommands (ALLOW_DEV_COMMANDS), so it
// does not exist in production. The sky: clients draw it from their OWN clock and nothing
// on the wire carries the phase (src/sim/day_night.ts), so the reply tells the tester to
// match it locally with /daynight.

import { cyclePhase, DAWN_PHASE, DUSK_PHASE, NOON_PHASE, phaseToCycleMs } from '../day_night';
import type { SimContext } from '../sim_context';

/** Named phases, matching the client /daynight presets. */
export const SERVER_TIME_PRESETS: Readonly<Record<string, number>> = {
  day: NOON_PHASE,
  noon: NOON_PHASE,
  night: 0,
  midnight: 0,
  dawn: DAWN_PHASE,
  dusk: DUSK_PHASE,
};

export type ServerTimeCommand = { kind: 'auto' } | { kind: 'set'; phase: number; label: string };

/** Parse `/dev servertime <arg>`. Null when the line is not this command; `usage` when the
 *  argument is missing or not a preset, `auto` or a phase in [0, 1]. */
export function parseServerTimeCommand(raw: string): ServerTimeCommand | 'usage' | null {
  const m = /^\/(?:dev\s+servertime|devservertime)(?:\s+(\S+))?\s*$/i.exec(raw);
  if (!m) return null;
  const arg = (m[1] ?? '').toLowerCase();
  if (arg === 'auto') return { kind: 'auto' };
  if (arg in SERVER_TIME_PRESETS)
    return { kind: 'set', phase: SERVER_TIME_PRESETS[arg], label: arg };
  if (/^(?:0(?:\.\d+)?|1(?:\.0+)?|\.\d+)$/.test(arg)) {
    const phase = Number(arg) % 1;
    return { kind: 'set', phase, label: arg };
  }
  return 'usage';
}

type Clock = (() => number) | undefined;

/** The clock each config was booted with, while an override replaces it. */
const originals = new WeakMap<object, { clock: Clock }>();

/** Whether this sim's clock is currently overridden. */
export function serverTimeOverridden(ctx: SimContext): boolean {
  return originals.has(ctx.cfg);
}

/**
 * Point the sim's day/night clock at `phase`, from where it keeps running at the real rate.
 * Re-setting while overridden re-anchors off the ORIGINAL clock, so offsets never stack.
 */
export function setServerTimePhase(ctx: SimContext, phase: number): 'running' | 'frozen' {
  const cfg = ctx.cfg;
  const saved = originals.get(cfg) ?? { clock: cfg.dayNightNowMs };
  originals.set(cfg, saved);
  const base = saved.clock;
  if (!base) {
    const frozen = phaseToCycleMs(phase);
    cfg.dayNightNowMs = () => frozen;
    return 'frozen';
  }
  const now = base();
  const offset = phaseToCycleMs(phase) - phaseToCycleMs(cyclePhase(now));
  cfg.dayNightNowMs = () => base() + offset;
  return 'running';
}

/** Hand the sim its real clock back. False when nothing was overridden. */
export function restoreServerTime(ctx: SimContext): boolean {
  const saved = originals.get(ctx.cfg);
  if (!saved) return false;
  ctx.cfg.dayNightNowMs = saved.clock;
  originals.delete(ctx.cfg);
  return true;
}
