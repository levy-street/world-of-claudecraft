import type { Entity } from '../src/sim/types';

/** Inspect-only projection, serialized immediately by the identity wire.
 * The owner sees complete custody data through the separate self snapshot.
 * Keep this allowlist in lockstep with publicInstanceView.
 */
export function equippedInstanceWire(e: Pick<Entity, 'equippedInstances'>) {
  let eqi: Record<string, unknown> | undefined;
  for (const [slot, inst] of Object.entries(e.equippedInstances)) {
    if (!inst) continue;
    const pub: Record<string, unknown> = {};
    if (inst.signer !== undefined) pub.signer = inst.signer;
    if (inst.enchant !== undefined) pub.enchant = inst.enchant;
    if (inst.rolled !== undefined) pub.rolled = inst.rolled;
    if (inst.name !== undefined) pub.name = inst.name;
    if (inst.perfected === true) pub.perfected = inst.perfected;
    if (inst.rift !== undefined) pub.rift = inst.rift;
    if (inst.lootQuality !== undefined) pub.lootQuality = inst.lootQuality;
    for (const _ in pub) {
      if (eqi === undefined) eqi = {};
      eqi[slot] = pub;
      break;
    }
  }
  return eqi;
}
