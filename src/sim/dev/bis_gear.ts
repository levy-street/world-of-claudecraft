// /dev bis: outfit the caller with a deterministic best-in-slot epic set so
// playtesting at the level cap never starts with a vendor shopping trip. Dev
// command only (never reachable in production); picks are pure functions of
// the item table, the player's class, and the selected spec, so repeated runs
// equip the identical set. Draws no rng.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random or
// Date.now (enforced by tests/architecture.test.ts).

import { ITEMS } from '../data';
import { recalcPlayerStats } from '../entity';
import { canEquipItemInSlot, MASTERWROUGHT_EQUIP_CAP } from '../equipment_rules';
import type { SimContext } from '../sim_context';
import type { EquipSlot, ItemDef } from '../types';
import { ALL_EQUIP_SLOTS } from '../types';

// Rough single-number item power: weapon dps dominates for weapons, stat
// budget plus armor carries the rest. Only used to ORDER epics per slot.
function score(item: ItemDef): number {
  let total = 0;
  if (item.kind === 'weapon' && item.weapon) {
    total += (((item.weapon.min + item.weapon.max) / 2) * 12) / Math.max(0.1, item.weapon.speed);
  }
  for (const value of Object.values(item.stats ?? {})) total += value as number;
  return total;
}

// Craven Thrust and the Duskveil openers require a mainhand dagger, so every
// rogue gets one unless they have explicitly committed to Thuggery (the one
// spec that never thrusts and prefers raw weapon damage). A spec-less rogue
// running /dev bis before picking must not be locked out of half the kit.
function wantsDaggerMainhand(cls: string, spec: string | null): boolean {
  return cls === 'rogue' && spec !== 'combat';
}

export function bestEpicGearFor(
  cls: string,
  spec: string | null,
): Partial<Record<EquipSlot, string>> {
  const epics = Object.values(ITEMS).filter(
    (item) => item.quality === 'epic' && (item.kind === 'armor' || item.kind === 'weapon'),
  );
  const picks: Partial<Record<EquipSlot, string>> = {};
  const used = new Set<string>();
  const bestFor = (slot: EquipSlot, extra?: (item: ItemDef) => boolean): ItemDef | undefined => {
    let candidates = epics.filter(
      (item) =>
        !used.has(item.id) &&
        (!extra || extra(item)) &&
        canEquipItemInSlot(cls as Parameters<typeof canEquipItemInSlot>[0], item, slot, spec),
    );
    // A dagger class fantasy (Craven Thrust and the Duskveil openers require
    // one) narrows the mainhand to daggers whenever any dagger epic exists.
    if (slot === 'mainhand' && wantsDaggerMainhand(cls, spec)) {
      const daggers = candidates.filter(
        (item) => item.kind === 'weapon' && item.weapon?.dagger === true,
      );
      if (daggers.length > 0) candidates = daggers;
    }
    // A mainhand two-hander would block the offhand: rogues and other
    // dual-wielders read strictly better with two one-handers here, so keep
    // the mainhand one-handed whenever a one-hander exists for the class.
    if (slot === 'mainhand' || slot === 'offhand') {
      const oneHanders = candidates.filter(
        (item) => item.kind !== 'weapon' || item.hand !== 'twohand',
      );
      if (oneHanders.length > 0) candidates = oneHanders;
    }
    candidates.sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return candidates[0];
  };
  for (const slot of ALL_EQUIP_SLOTS) {
    const best = bestFor(slot);
    if (!best) continue;
    picks[slot] = best.id;
    used.add(best.id);
  }
  // Masterwrought cap arm (phase 08): equipBestInSlotForDev writes equipment
  // directly and never runs masterwroughtConflictSlot, so without this the
  // dev outfit could silently exceed the counted-family cap the moment
  // flagged pieces out-score their references (the pbe_boost twin,
  // enforceMasterwroughtCap, hit exactly that). Keep the cap-highest scoring
  // flagged picks and refill each demoted slot with its best unflagged
  // candidate under the same slot rules.
  const flagged = (Object.entries(picks) as [EquipSlot, string][]).filter(
    ([, id]) => ITEMS[id]?.masterwrought,
  );
  if (flagged.length > MASTERWROUGHT_EQUIP_CAP) {
    const scored = flagged
      .map(([slot, id]) => ({ slot, id, s: score(ITEMS[id]) }))
      .sort((a, b) => b.s - a.s || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const demoted of scored.slice(MASTERWROUGHT_EQUIP_CAP)) {
      used.delete(demoted.id);
      const fallback = bestFor(demoted.slot, (item) => !item.masterwrought);
      if (fallback) {
        picks[demoted.slot] = fallback.id;
        used.add(fallback.id);
      } else {
        delete picks[demoted.slot];
      }
    }
  }
  return picks;
}

// Applies the picks to the caller: dev-only direct equipment write, cleared
// crafted-instance payloads, one stat recalc. Returns the equipped count.
export function equipBestInSlotForDev(ctx: SimContext, pid: number): number {
  const meta = ctx.players.get(pid);
  const player = ctx.entities.get(pid);
  if (!meta || !player) return 0;
  const picks = bestEpicGearFor(meta.cls, meta.talents?.spec ?? null);
  let equipped = 0;
  for (const [slot, itemId] of Object.entries(picks) as [EquipSlot, string][]) {
    meta.equipment[slot] = itemId;
    if (meta.equipmentInstance) delete meta.equipmentInstance[slot];
    equipped++;
  }
  recalcPlayerStats(player, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  player.hp = player.maxHp;
  return equipped;
}
