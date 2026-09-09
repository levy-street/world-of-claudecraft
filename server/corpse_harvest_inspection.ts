// Intentional Gathering PR3: the pure boundary validator + throttle for the
// online `inspectCorpseHarvest` wire command (server/CLAUDE.md, "New WS/loop-
// side behavior": pure decision logic behind a host-agnostic module, never
// inline in game.ts's dispatch switch). No admission, reservation, cast, or
// rng may ever be reached unless the frame carries a positive safe integer
// `id` AND `rid`: a malformed frame is UNCORRELATABLE (no reply at all, since
// the client's own decoder would drop it anyway). `pid` always comes from the
// caller's authenticated session, never the payload.
//
// Throttled to at most one real inspection per CORPSE_HARVEST_INSPECT_INTERVAL_SEC
// of SIM time per session, across every corpse id, checked BEFORE any call
// into the sim: a throttled request still answers null on the request's own
// id/rid (a valid correlation), but never reaches admission or an inventory
// scan. Transient session state and sim time only: no mutable cache, no DB,
// no timers, no polling without a request.

import type { CorpseHarvestInfo } from '../src/world_api';

const CORPSE_HARVEST_INSPECT_INTERVAL_SEC = 0.5;

export interface InspectCorpseHarvestPayload {
  readonly id?: unknown;
  readonly rid?: unknown;
}

export interface InspectCorpseHarvestSession {
  nextCorpseHarvestInspectAt?: number;
}

export interface CorpseHarvestInspectionSim {
  readonly time: number;
  corpseHarvestInfo(id: number, pid?: number): CorpseHarvestInfo | null;
}

export interface CorpseHarvestInfoReplyBody {
  readonly id: number;
  readonly rid: number;
  readonly info: CorpseHarvestInfo | null;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function validInspectCorpseHarvestCommand(
  msg: InspectCorpseHarvestPayload,
): msg is { readonly id: number; readonly rid: number } {
  return isPositiveSafeInteger(msg.id) && isPositiveSafeInteger(msg.rid);
}

/** The `{id, rid, info}` reply body for one `inspectCorpseHarvest` request, or
 *  null when the frame is too malformed to correlate at all (send nothing). */
export function corpseHarvestInspectionReply(
  sim: CorpseHarvestInspectionSim,
  session: InspectCorpseHarvestSession,
  msg: InspectCorpseHarvestPayload,
  pid: number,
): CorpseHarvestInfoReplyBody | null {
  if (!validInspectCorpseHarvestCommand(msg)) return null;
  const { id, rid } = msg;
  const now = sim.time;
  if ((session.nextCorpseHarvestInspectAt ?? 0) > now) return { id, rid, info: null };
  session.nextCorpseHarvestInspectAt = now + CORPSE_HARVEST_INSPECT_INTERVAL_SEC;
  return { id, rid, info: sim.corpseHarvestInfo(id, pid) };
}

/** The whole dispatch-switch case body, so server/game.ts calls one helper
 *  and nothing else: builds the reply above and hands it to `send` as the
 *  full `{t:'corpseHarvestInfo', ...}` frame, only when there is one to send. */
export function dispatchCorpseHarvestInspection(
  sim: CorpseHarvestInspectionSim,
  session: InspectCorpseHarvestSession,
  msg: InspectCorpseHarvestPayload,
  pid: number,
  send: (frame: { t: 'corpseHarvestInfo' } & CorpseHarvestInfoReplyBody) => void,
): void {
  const body = corpseHarvestInspectionReply(sim, session, msg, pid);
  if (body) send({ t: 'corpseHarvestInfo', ...body });
}
