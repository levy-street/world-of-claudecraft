// The Rift forge pair's wire dispatch (rift_upgrade_item / rift_socket_gem),
// lifted out of the GameServer command switch so the arms share one parse and
// one ack contract. (rift_enchant_item retired with the band item-level ladder;
// its token is a no-op tombstone arm in game.ts, never routed here.)
//
// Every arm parses the same shape (`item` required, `slot` an optional bag
// index that reads as undefined for anything but an integer, never as 0) and
// returns the sim's RiftForgeResult so the caller can answer the commandOutcome
// ack with `ok`. The client forge window awaits that ack (src/net/online.ts
// cmdWithOutcome), which is why a malformed frame returns null (no ack, the
// same silence every other malformed command gets) while a well-formed one
// always acks, refused or not. The sim re-validates everything (place gate,
// ownership, cost, gem identity), so nothing here trusts client data.

import type { RiftForgeResult } from '../src/sim/rift/progression';
import type { Sim } from '../src/sim/sim';

type ForgeMessage = Readonly<Record<string, unknown>> & { cmd?: string };

/** Run one forge command against the sim; null when the frame is malformed
 *  or names a non-forge token. Named for the copy-addressing guard, which
 *  derives `dispatchRiftCommand` from this module's name. */
export function dispatchRiftCommand(
  sim: Pick<Sim, 'upgradeRiftItem' | 'socketRiftGem'>,
  msg: ForgeMessage,
  pid: number,
): RiftForgeResult | null {
  if (typeof msg.item !== 'string') return null;
  switch (msg.cmd) {
    case 'rift_upgrade_item': {
      // The optional bag index: an integer reads as itself, anything else as
      // undefined (never 0). Parsed in each arm so the copy-addressing guard
      // can see it beside the sim call.
      const slot = Number.isInteger(msg.slot) ? Number(msg.slot) : undefined;
      return sim.upgradeRiftItem(msg.item, pid, slot);
    }
    case 'rift_socket_gem': {
      if (typeof msg.gem !== 'string') return null;
      const slot = Number.isInteger(msg.slot) ? Number(msg.slot) : undefined;
      return sim.socketRiftGem(msg.item, msg.gem, pid, slot);
    }
    default:
      return null;
  }
}
