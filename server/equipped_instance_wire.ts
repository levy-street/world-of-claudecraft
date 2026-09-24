import { isValidLootQuality } from '../src/sim/loot_quality/types';
import type { Entity } from '../src/sim/types';

/** Inspect-only projection, serialized immediately by the identity wire.
 * The owner sees complete custody data through the separate self snapshot.
 * Keep this allowlist in lockstep with publicInstanceView: three source pins
 * (tests/item_instance_transfer.test.ts, tests/enchant_apply_view.test.ts,
 * tests/legendary_regalia.test.ts) scrape this loop for exactly one dotted
 * own-field copy per projected field (no clones, spreads or helpers), and they
 * read comments too, so keep that shape out of the prose here.
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
    // Validated like publicInstanceView, so a malformed descriptor never rides
    // the wire; copied by reference (not cloned) because the projection is
    // serialized immediately and the pins above want the dotted own-field copy.
    if (isValidLootQuality(inst.lootQuality)) pub.lootQuality = inst.lootQuality;
    for (const _ in pub) {
      if (eqi === undefined) eqi = {};
      eqi[slot] = pub;
      break;
    }
  }
  return eqi;
}
