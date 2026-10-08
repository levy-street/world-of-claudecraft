// The Shardpike's equip gate (src/sim/content/zone2.ts + src/sim/item_level_req.ts).
//
// The trial this item exists for is DELIBERATELY level-blind: its quest is minLevel 6, the
// thrust does fixed damage no level scales, and the encounter's whole level-spread design
// is "a low-level player opens the window a high-level player spends". The item is rare
// quality for flavour and has no derivable drop source, so the generic rare band claimed
// it and required level 12 to equip: the quest handed a level 6 a pike they could not
// hold. Nothing about that is visible from the sim side (the trial's own gates all pass,
// the equip just refuses), and nothing about it is visible from the content side either
// (the quest's minLevel and the item's derived requirement live in different files).
import { describe, expect, it } from 'vitest';
import { ITEMS, QUESTS } from '../src/sim/data';
import { requiredLevelFor } from '../src/sim/item_level_req';
import { LANCE_ITEM_ID } from '../src/sim/lance_trial';
import { Sim } from '../src/sim/sim';

const pike = () => {
  const def = ITEMS[LANCE_ITEM_ID];
  if (!def) throw new Error('no shardpike');
  return def;
};

describe('the quest tool is holdable by the players its quest is for', () => {
  it('never gates above the level of the quest that hands it out', () => {
    // The decisive pin: derived from the QUEST rather than a literal, so retuning either
    // side cannot silently re-open the gap.
    const quest = Object.values(QUESTS).find((q) => q.requiredItems?.includes(LANCE_ITEM_ID));
    if (!quest) throw new Error('no quest grants the shardpike');
    expect(requiredLevelFor(pike())).toBeLessThanOrEqual(quest.minLevel ?? 1);
  });

  it('is equippable by a fresh level 1 character', () => {
    const sim = new Sim({ seed: 5, playerClass: 'warrior', autoEquip: true });
    expect(sim.player.level).toBe(1);
    sim.addItem(LANCE_ITEM_ID, 1);
    sim.equipItem(LANCE_ITEM_ID);
    expect(sim.equipment.mainhand).toBe(LANCE_ITEM_ID);
  });

  it('emits no level refusal on the equip', () => {
    const sim = new Sim({ seed: 5, playerClass: 'warrior', autoEquip: true });
    sim.addItem(LANCE_ITEM_ID, 1);
    sim.tick();
    sim.equipItem(LANCE_ITEM_ID);
    const refusals = sim
      .tick()
      .filter((e) => e.type === 'error')
      .map((e) => (e as { text: string }).text);
    expect(refusals.filter((t) => /level/i.test(t))).toEqual([]);
  });

  it('stays a quest TOOL rather than becoming free rare gear', () => {
    // The reason ungating it is safe: the weapon rolls 1 to 2 and it cannot be sold,
    // listed, or discarded. If any of that changes, an ungated rare 2H at level 1 is a
    // real twink item and this pin should be the thing that argues about it.
    const def = pike();
    expect(def.questTool).toBe(true);
    expect(def.weapon?.max).toBeLessThanOrEqual(3);
    expect(def.noVendorSell).toBe(true);
    expect(def.noMarketList).toBe(true);
    expect(def.sellValue).toBe(0);
  });

  it('leaves the shared rare band alone for everything else', () => {
    // The fix is a per-item override, not a rule change: an ordinary rare with no
    // derivable source must still gate where it always did.
    const ordinary = Object.values(ITEMS).filter(
      (i) => i.quality === 'rare' && i.id !== LANCE_ITEM_ID && !i.questTool && i.slot,
    );
    expect(ordinary.length).toBeGreaterThan(5);
    expect(ordinary.every((i) => requiredLevelFor(i) > 1)).toBe(true);
  });
});
