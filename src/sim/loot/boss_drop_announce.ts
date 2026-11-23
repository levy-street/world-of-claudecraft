// Boss drop printout: when a party kills a boss, every member of the party that
// holds kill credit gets one loot line per shared drop, the moment the corpse's
// loot is rolled. It runs under every loot method, so a master looter cannot keep
// a drop quiet by never opening the corpse, and the group always sees what
// dropped before anyone leaves.
//
// Only shared drops are listed: personal quest copies and shared-personal
// participation tokens (any slot with `personalFor`) belong to specific players,
// not to the group's distribution. The party is the kill-credit player's
// (rollLoot's `meta`, the same key its `eligible` set comes from), not the raw
// tap: handleDeath falls back to the killer when the tapper is mid-logout, and
// the group that actually owns the loot is the one that must see it. Solo kills
// stay quiet (the killer sees the loot window anyway), and world bosses never
// reach this path (their personal loot runs through rollWorldBossLoot, not
// rollLoot).
//
// The line is English (`<Boss> dropped [[i:<id>]].`), re-localized client-side by
// the matching rule in src/ui/sim_i18n.ts. It is `silent` so a multi-item kill does
// not ring one loot cue per drop for every member. Draws no rng.

import { MOBS } from '../data';
import { publicInstanceView } from '../item_instance_transfer';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export function bossDropAnnouncementText(bossName: string, itemId: string): string {
  return `${bossName} dropped [[i:${itemId}]].`;
}

export function announceBossDrops(ctx: SimContext, mob: Entity, creditPid: number): void {
  const template = MOBS[mob.templateId];
  if (!template?.boss || !mob.loot) return;
  const party = ctx.partyOf(creditPid);
  if (!party) return;
  for (const slot of mob.loot.items) {
    if (slot.personalFor) continue;
    const text = bossDropAnnouncementText(template.name, slot.itemId);
    const instance = slot.instance ? publicInstanceView(slot.instance) : undefined;
    for (const pid of party.members)
      ctx.emit({
        type: 'loot',
        text,
        pid,
        itemId: slot.itemId,
        ...(instance ? { instance } : {}),
        silent: true,
      });
  }
}
