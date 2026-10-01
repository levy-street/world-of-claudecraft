// The online `inspectMob` wire command: the pure boundary validator + rate
// limit behind the mob inspect window's live stat read (server/CLAUDE.md, "New
// WS/loop-side behavior": decision logic in a host-agnostic module, never
// inline in game.ts's dispatch switch). The sibling of
// corpse_harvest_inspection.ts: nothing reaches the sim unless the frame
// carries a positive safe integer `id` AND `rid` (a malformed frame is
// uncorrelatable and gets no reply), and `pid` always comes from the caller's
// authenticated session, never the payload.
//
// Rate limited per session by a small token bucket in SIM time
// (MOB_INSPECT_BURST reads, refilling MOB_INSPECT_PER_SEC a second), checked
// BEFORE the sim is asked. A bucket rather than a single interval, so a player
// re-pointing the window from one mob to the next is answered, while a flood
// is not. An empty bucket still answers on the request's own id/rid: the
// previous answer for the same subject (so a quick re-open is never told
// "unknown"), else null. The per-session state lives in a WeakMap keyed by
// the session object, so it dies with the session: no DB, timers, or
// background work, and no field on the game.ts session record.

import type { MobInspectInfo } from '../src/world_api';

const MOB_INSPECT_BURST = 4;
const MOB_INSPECT_PER_SEC = 4;

export interface InspectMobPayload {
  readonly id?: unknown;
  readonly rid?: unknown;
}

export interface MobInspectionSim {
  readonly time: number;
  mobInspectInfo(id: number, pid?: number): MobInspectInfo | null;
}

export interface MobInspectInfoReplyBody {
  readonly id: number;
  readonly rid: number;
  readonly info: MobInspectInfo | null;
}

interface SessionInspectState {
  tokens: number;
  at: number;
  sim: MobInspectionSim;
  pid: number;
  id: number;
  info: MobInspectInfo | null;
}

const sessionState = new WeakMap<object, SessionInspectState>();

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function validInspectMobCommand(
  msg: InspectMobPayload,
): msg is { readonly id: number; readonly rid: number } {
  return isPositiveSafeInteger(msg.id) && isPositiveSafeInteger(msg.rid);
}

/** The `{id, rid, info}` reply body for one `inspectMob` request, or null when
 *  the frame is too malformed to correlate at all (send nothing). */
export function mobInspectionReply(
  sim: MobInspectionSim,
  session: object,
  msg: InspectMobPayload,
  pid: number,
): MobInspectInfoReplyBody | null {
  if (!validInspectMobCommand(msg)) return null;
  const { id, rid } = msg;
  const now = sim.time;
  const prev = sessionState.get(session);
  // A different sim (a realm restart under a live session object) starts full.
  const elapsed = prev && prev.sim === sim ? Math.max(0, now - prev.at) : Infinity;
  const tokens = Math.min(MOB_INSPECT_BURST, (prev?.tokens ?? 0) + elapsed * MOB_INSPECT_PER_SEC);
  if (prev && tokens < 1) {
    prev.tokens = tokens;
    prev.at = now;
    const info = prev.sim === sim && prev.pid === pid && prev.id === id ? prev.info : null;
    return { id, rid, info };
  }
  const info = sim.mobInspectInfo(id, pid);
  sessionState.set(session, { tokens: tokens - 1, at: now, sim, pid, id, info });
  return { id, rid, info };
}

/** The whole dispatch-switch case body, so server/game.ts calls one helper
 *  and nothing else. */
export function dispatchMobInspection(
  sim: MobInspectionSim,
  session: object,
  msg: InspectMobPayload,
  pid: number,
  send: (frame: { t: 'mobInspectInfo' } & MobInspectInfoReplyBody) => void,
): void {
  const body = mobInspectionReply(sim, session, msg, pid);
  if (body) send({ t: 'mobInspectInfo', ...body });
}
