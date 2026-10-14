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

import { skullBagInfoFor } from '../src/sim/pvp/skull_bag';
import type { PlayerMeta } from '../src/sim/sim';
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
}

export function dispatchWorldPvpCommand(
  sim: WorldPvpCommands,
  pid: number,
  msg: Record<string, unknown>,
): void {
  // A non-boolean flag is a malformed frame and is ignored.
  if (msg.cmd === 'pvp_flag' && typeof msg.on === 'boolean') sim.setWorldPvpFlag(msg.on, pid);
  else if (msg.cmd === 'skull_bag' && msg.op === 'store') sim.skullBagAction({ op: 'store' }, pid);
  else if (msg.cmd === 'skull_bag' && msg.op === 'take' && Array.isArray(msg.sources))
    // The buckets stay untrusted: the sim reads them through the canonical
    // material-source validator (src/sim/pvp/skull_bag.ts) and refuses any
    // selection the bag does not hold.
    sim.skullBagAction({ op: 'take', sources: msg.sources }, pid);
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
