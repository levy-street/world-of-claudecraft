// The World PvP wire, pulled out of game.ts (the vehicle_command_wire.ts and
// vault_wire.ts precedents): the `/pvp` flag and Skull Bag command boundary,
// the `wpvp` self key's cadence, and the Skull Bag's own `skb` self key.
//
// Commands: every field is checked here at the trust boundary; src/sim/pvp/
// owns every rule, and the Skull Bag's sim entry re-validates the whole action.
//
// `skb`: the Skull Bag's contents (src/sim/pvp/skull_bag.ts) have no cap, one
// bucket per victim, so they never ride the 2 Hz `wpvp` readout (that would
// re-stringify a career-sized list every half second for every owner).
// Instead the bag is sent on its own key, and only when it actually changed:
// the composition is replaced whole on every write (never edited in place),
// so its identity plus the carried flag is the revision. The check costs one
// identity compare and a scan of the carried bags, at the `wpvp` cadence.

import { skillEventBoltsFor, skillEventMarksFor } from '../src/sim/pvp/skill_events';
import { skullBagInfoFor } from '../src/sim/pvp/skull_bag';
import type { PlayerMeta } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { DT } from '../src/sim/types';
import type { SkullBagAction } from '../src/world_api';

// World PvP `wpvp` self key (and the King of the Hill `hill` key, whose 60 s
// contest bar and whole-minute clock tolerate half-second steps, and the Skull
// Bag's `skb`): 2 Hz; the viewer's own World PvP commands re-arm the gate so a
// press answers at once.
const WPVP_WIRE_HZ = 2;
export const WPVP_WIRE_INTERVAL_TICKS = Math.max(1, Math.round(1 / (DT * WPVP_WIRE_HZ)));

export interface WorldPvpCommands {
  setWorldPvpFlag(enabled: boolean, pid: number): void;
  skullBagAction(action: SkullBagAction, pid: number): void;
  joinSkillEvent(pid: number): void;
  skillEventAction(verb: string, pid: number): void;
  skillEventPickKeepsake(abilityId: string, pid: number): void;
}

export function dispatchWorldPvpCommand(
  sim: WorldPvpCommands,
  pid: number,
  msg: Record<string, unknown>,
): void {
  // A non-boolean flag is a malformed frame and is ignored.
  if (msg.cmd === 'pvp_flag' && typeof msg.on === 'boolean') sim.setWorldPvpFlag(msg.on, pid);
  // The hourly skill event's join prompt (src/sim/pvp/skill_events.ts checks
  // reach, level and the realm switch); the frame carries nothing else.
  else if (msg.cmd === 'skill_event') dispatchSkillEvent(sim, pid, msg);
  else if (msg.cmd === 'skull_bag' && msg.op === 'store') sim.skullBagAction({ op: 'store' }, pid);
  else if (msg.cmd === 'skull_bag' && msg.op === 'take' && Array.isArray(msg.sources))
    // The buckets stay untrusted: the sim reads them through the canonical
    // material-source validator (src/sim/pvp/skull_bag.ts) and refuses any
    // selection the bag does not hold.
    sim.skullBagAction({ op: 'take', sources: msg.sources }, pid);
}

/** The hourly skill event's one command: join, a kit verb, or the keepsake. Short
 *  strings only reach the sim, which validates the event, the verb and the pick. */
function dispatchSkillEvent(
  sim: WorldPvpCommands,
  pid: number,
  msg: Record<string, unknown>,
): void {
  if (msg.op === 'join') sim.joinSkillEvent(pid);
  else if (msg.op === 'action' && typeof msg.verb === 'string' && msg.verb.length <= 24)
    sim.skillEventAction(msg.verb, pid);
  else if (msg.op === 'keepsake' && typeof msg.ability === 'string' && msg.ability.length <= 64)
    sim.skillEventPickKeepsake(msg.ability, pid);
}

interface SkullBagSent {
  pid: number;
  stored: PlayerMeta['skullBag'];
  owned: boolean;
}

/** What this viewer's client last received, per session. Weak, so a closed
 *  session leaves nothing behind. */
const skullBagSent = new WeakMap<object, SkullBagSent>();

/** Emit `skb` (the Skull Bag readout, or null) when it changed since this
 *  session last received it, or when the session's sent-record was reset (a
 *  fresh join, a spectate swap, a full resync). */
export function emitSkullBagSelfKey(
  emit: (key: 'skb', value: unknown) => void,
  sim: { meta(pid: number): PlayerMeta | null | undefined },
  session: { lastSent: Record<string, string> },
  anchorPid: number,
): void {
  const meta = sim.meta(anchorPid);
  const info = meta ? skullBagInfoFor(meta) : undefined;
  const next: SkullBagSent = {
    pid: anchorPid,
    stored: meta?.skullBag,
    owned: info?.owned === true,
  };
  const last = skullBagSent.get(session);
  if (
    session.lastSent.skb !== undefined &&
    last !== undefined &&
    last.pid === next.pid &&
    last.stored === next.stored &&
    last.owned === next.owned
  ) {
    return;
  }
  emit('skb', info ?? null);
  skullBagSent.set(session, next);
}

interface MarksSent {
  pid: number;
  ordinal: number;
  lastSeq: number;
}

/** Per session: whose marks were last streamed, for which event, up to which
 *  mark. Reset with the session's sent-record so a resync resends the book. */
const marksSent = new WeakMap<object, MarksSent>();

/** The Footprints in Ash marks (src/sim/pvp/skill_event_footprints.ts) on the
 *  self wire, every tick, only the ones new since the last send: a flat list of
 *  `seq, x, z, heading, kind, ageTenths` per mark (kind 0 a footprint, 1 a
 *  breath plume), or `null` once the viewer is out of the fight. Who left a
 *  mark is never sent. Decoded by src/net/skill_event_marks_mirror.ts. The
 *  cost is bounded by one event's fighters: a viewer outside the fight pays a
 *  map read and nothing else. */
export function emitSkillEventMarksKey(
  emitRaw: (key: 'sevm', serialized: string) => void,
  sim: { ctx: SimContext },
  session: { lastSent: Record<string, string> },
  anchorPid: number,
): void {
  const ctx = sim.ctx;
  const ev = ctx.skillEventState.active;
  const inFight = !!ev?.footprints && ev.phase === 'running' && ev.hearts.has(anchorPid);
  let last = marksSent.get(session);
  if (!ev || !inFight) {
    if (last) {
      if (session.lastSent.sevm !== undefined) emitRaw('sevm', 'null');
      marksSent.delete(session);
    }
    return;
  }
  if (
    !last ||
    last.pid !== anchorPid ||
    last.ordinal !== ev.ordinal ||
    session.lastSent.sevm === undefined
  ) {
    last = { pid: anchorPid, ordinal: ev.ordinal, lastSeq: 0 };
    marksSent.set(session, last);
  }
  const parts: number[] = [];
  for (const m of skillEventMarksFor(ctx, anchorPid)) {
    if (m.seq <= last.lastSeq) continue;
    parts.push(
      m.seq,
      Math.round(m.x * 100) / 100,
      Math.round(m.z * 100) / 100,
      Math.round(m.heading * 100) / 100,
      m.kind === 'breath' ? 1 : 0,
      Math.max(0, Math.round((ctx.time - m.at) * 10)),
    );
    last.lastSeq = m.seq;
  }
  // A first send with nothing on the ash yet still opens the book (`[]`), so
  // the session's sent-record marks the stream as live.
  if (parts.length > 0 || session.lastSent.sevm === undefined)
    emitRaw('sevm', JSON.stringify(parts));
}

const boltWires = new WeakMap<object, { tick: number; json: string }>();

/** Bankshot bolts in flight (src/sim/pvp/skill_event_bankshot.ts) on the self
 *  wire, for a viewer near the arena: the whole live list as a flat
 *  `id, x, z, dx, dz, harmful` per bolt, built and serialized ONCE per tick
 *  and shared by every viewer (the same list for all of them), then
 *  delta-guarded per session by `emitRaw`, so a still field costs nothing. */
export function emitSkillEventBoltsKey(
  emitRaw: (key: 'sevb', serialized: string) => void,
  sim: { ctx: SimContext },
  session: { lastSent: Record<string, string> },
  anchorPid: number,
): void {
  const ctx = sim.ctx;
  const bolts = skillEventBoltsFor(ctx, anchorPid);
  if (bolts.length === 0) {
    if (session.lastSent.sevb !== undefined && session.lastSent.sevb !== '[]') {
      emitRaw('sevb', '[]');
    }
    return;
  }
  let wire = boltWires.get(bolts);
  if (!wire || wire.tick !== ctx.tickCount) {
    const parts: number[] = [];
    for (const b of bolts) {
      parts.push(
        b.id,
        Math.round(b.x * 100) / 100,
        Math.round(b.z * 100) / 100,
        Math.round(b.dx * 100) / 100,
        Math.round(b.dz * 100) / 100,
        b.harmful ? 1 : 0,
      );
    }
    wire = { tick: ctx.tickCount, json: JSON.stringify(parts) };
    boltWires.set(bolts, wire);
  }
  emitRaw('sevb', wire.json);
}

/** The PvP-ledger scalars (delta-guarded like delve marks, so a fresh session
 *  gets both), the per-tick Footprints in Ash marks and the Bankshot bolts. */
export function emitPvpLedgerKeys(
  maybe: (key: string, value: unknown) => void,
  maybeRaw: (key: 'sevm' | 'sevb', serialized: string) => void,
  sim: { ctx: SimContext },
  session: { lastSent: Record<string, string> },
  meta: Pick<PlayerMeta, 'honor' | 'lifetimeHonor'>,
  anchorPid: number,
): void {
  maybe('honor', meta.honor);
  maybe('lhonor', meta.lifetimeHonor);
  emitSkillEventMarksKey(maybeRaw, sim, session, anchorPid);
  emitSkillEventBoltsKey(maybeRaw, sim, session, anchorPid);
}
