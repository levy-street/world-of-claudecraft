// Saving and applying a loadout's gear set, through the real Sim.
//
// The planner is unit-tested in tests/loadout_gear.test.ts. This drives the whole
// path instead: capture the worn set on save, switch away, switch back, and assert
// the SAVED COPY came back rather than the newest matching one. That distinction is
// the entire point of the feature and is invisible to a test that only checks item
// ids, because both copies share an id.

import { describe, expect, it } from 'vitest';
import { itemCopyPin } from '../src/sim/item_copy_ref';
import { Sim } from '../src/sim/sim';
import type { ItemInstancePayload, SimEvent } from '../src/sim/types';

const ENCHANT = { enchantId: 'ench_test' } as unknown as ItemInstancePayload;

function makeSim(): Sim {
  return new Sim({ seed: 11, playerClass: 'warrior', autoEquip: false });
}

function gearResults(events: SimEvent[]) {
  return events.filter((e): e is Extract<SimEvent, { type: 'loadoutGearResult' }> => {
    return e.type === 'loadoutGearResult';
  });
}

/** Pick a real chest-slot armor id from the live tables, so nothing is fabricated. */
async function chestItemId(): Promise<string> {
  const { ITEMS } = await import('../src/sim/data');
  const found = Object.values(ITEMS).find((d) => d.slot === 'chest' && d.kind === 'armor');
  if (!found) throw new Error('no chest item fixture');
  return found.id;
}

describe('a loadout captures and restores the gear it was saved with', () => {
  it('re-equips the SAVED copy, not the newest copy of the same id', async () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('no meta');
    const itemId = await chestItemId();

    // Wear the ENCHANTED copy, and hold a plain duplicate in the bags. The legacy
    // equip walk takes the newest match, so a set that stored only the id would
    // hand back the plain one.
    meta.inventory.length = 0;
    meta.equipment.chest = itemId;
    meta.equipmentInstance = { chest: ENCHANT };
    sim.drainEvents();

    // Save WITH gear capture, then strip the body and put both copies in the bags.
    const saved = sim.saveLoadout('PvP', [], pid, undefined, true);
    expect(saved, 'the save succeeded').toBeGreaterThanOrEqual(0);
    const stored = meta.loadouts[saved];
    expect(stored.gear?.chest?.itemId, 'the set captured the chest slot').toBe(itemId);
    expect(stored.gear?.chest?.pin, 'and pinned the enchanted copy').toBe(
      itemCopyPin({ itemId, count: 1, instance: ENCHANT }),
    );

    delete meta.equipment.chest;
    meta.equipmentInstance = {};
    meta.inventory.length = 0;
    meta.inventory.push({ itemId, count: 1, instance: ENCHANT });
    meta.inventory.push({ itemId, count: 1 });
    sim.drainEvents();

    expect(sim.switchLoadout(saved, pid)).toBe(true);

    // The enchanted copy is worn, and the plain one is what is left in the bags.
    expect(meta.equipment.chest).toBe(itemId);
    expect(meta.equipmentInstance?.chest, 'the enchant came back with it').toBeDefined();
    const left = meta.inventory.filter((s) => s.itemId === itemId);
    expect(left).toHaveLength(1);
    expect(left[0].instance, 'the plain duplicate stayed in the bags').toBeUndefined();
  });

  it('omits the gear key entirely when capture was not requested', async () => {
    // Additive persistence: a talent-only loadout has to serialize exactly as it did
    // before this feature, or every existing loadout's wire payload changes.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('no meta');
    meta.equipment.chest = await chestItemId();

    const saved = sim.saveLoadout('Talents only', [], pid);
    expect(Object.hasOwn(meta.loadouts[saved], 'gear')).toBe(false);
  });

  it('reports missing pieces instead of equipping a plain copy in their place', async () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('no meta');
    const itemId = await chestItemId();

    meta.equipment.chest = itemId;
    meta.equipmentInstance = { chest: ENCHANT };
    const saved = sim.saveLoadout('PvP', [], pid, undefined, true);

    // Strip the body and leave ONLY a plain copy: the saved piece is gone.
    delete meta.equipment.chest;
    meta.equipmentInstance = {};
    meta.inventory.length = 0;
    meta.inventory.push({ itemId, count: 1 });
    sim.drainEvents();

    sim.switchLoadout(saved, pid);
    const results = gearResults(sim.drainEvents());
    expect(results).toHaveLength(1);
    expect(results[0].copyGone, 'the enchanted copy is reported gone').toBe(1);
    expect(results[0].equipped, 'and nothing was equipped in its place').toBe(0);
    expect(meta.equipment.chest, 'the plain copy was NOT substituted').toBeUndefined();
  });

  it('still applies the talents when a gear piece is missing', async () => {
    // The switch must not fail on gear. Talents committing is what callers rely on.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('no meta');
    meta.equipment.chest = await chestItemId();
    meta.equipmentInstance = { chest: ENCHANT };
    const saved = sim.saveLoadout('PvP', [], pid, undefined, true);

    delete meta.equipment.chest;
    meta.equipmentInstance = {};
    meta.inventory.length = 0;
    sim.drainEvents();

    expect(sim.switchLoadout(saved, pid), 'the switch still succeeds').toBe(true);
    expect(meta.activeLoadout).toBe(saved);
    expect(gearResults(sim.drainEvents())[0]?.notHeld).toBe(1);
  });

  it('emits no gear result for a loadout that captured nothing', async () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const saved = sim.saveLoadout('Talents only', [], pid);
    sim.drainEvents();
    sim.switchLoadout(saved, pid);
    expect(gearResults(sim.drainEvents())).toEqual([]);
  });
});

describe('multi-piece and crafted restores (review findings)', () => {
  async function twoSlots(): Promise<{ chest: string; feet: string }> {
    const { ITEMS } = await import('../src/sim/data');
    const chest = Object.values(ITEMS).find((d) => d.slot === 'chest' && d.kind === 'armor');
    const feet = Object.values(ITEMS).find((d) => d.slot === 'feet' && d.kind === 'armor');
    if (!chest || !feet) throw new Error('need chest and feet fixtures');
    return { chest: chest.id, feet: feet.id };
  }

  it('restores the SAVED copy for every slot, not just the first', async () => {
    // The stale-index blocker. The plan resolves all indices up front, then each
    // equip splices its slot out and shifts every higher index down one, so the
    // second piece consumed whatever slid into its recorded index. The bags below
    // hold a plain duplicate of the feet piece specifically so a shifted index
    // lands on the WRONG copy rather than merely on nothing.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('no meta');
    const { chest, feet } = await twoSlots();

    meta.equipment.chest = chest;
    meta.equipment.feet = feet;
    meta.equipmentInstance = { chest: ENCHANT, feet: ENCHANT };
    const saved = sim.saveLoadout('PvP', [], pid, undefined, true);

    delete meta.equipment.chest;
    delete meta.equipment.feet;
    meta.equipmentInstance = {};
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: chest, count: 1, instance: ENCHANT });
    meta.inventory.push({ itemId: feet, count: 1, instance: ENCHANT });
    meta.inventory.push({ itemId: feet, count: 1 });
    sim.drainEvents();

    sim.switchLoadout(saved, pid);

    expect(meta.equipment.chest).toBe(chest);
    expect(meta.equipment.feet).toBe(feet);
    expect(meta.equipmentInstance?.chest, 'the chest enchant came back').toBeDefined();
    expect(meta.equipmentInstance?.feet, 'and so did the feet enchant').toBeDefined();
    const plainLeft = meta.inventory.filter((s) => s.itemId === feet && !s.instance);
    expect(plainLeft, 'the plain duplicate stayed in the bags').toHaveLength(1);
  });

  it('restores a CRAFTED piece, whose provenance is packed differently when worn', async () => {
    // The crafted blocker. equipmentPayloadFor packs craftedRecipeId INTO the worn
    // payload while returnEquippedItemToBags unpacks it back to the InvSlot field,
    // so the two shapes pin differently and the saved copy read as gone.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('no meta');
    const { chest } = await twoSlots();

    meta.equipment.chest = chest;
    meta.equipmentInstance = { chest: { craftedRecipeId: 'r_test' } as never };
    const saved = sim.saveLoadout('Crafted', [], pid, undefined, true);

    delete meta.equipment.chest;
    meta.equipmentInstance = {};
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: chest, count: 1, craftedRecipeId: 'r_test' });
    sim.drainEvents();

    sim.switchLoadout(saved, pid);

    expect(meta.equipment.chest, 'the crafted copy was found and worn').toBe(chest);
    const results = gearResults(sim.drainEvents());
    expect(results[0]?.copyGone, 'and not reported gone').toBe(0);
  });

  it('reports what actually happened, not what was planned', async () => {
    // equipped: was plan.equips.length, computed before any equip ran, so a piece
    // the equip path itself refused was still reported as restored.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('no meta');
    const { chest } = await twoSlots();

    meta.equipment.chest = chest;
    const saved = sim.saveLoadout('Plain', [], pid, undefined, true);
    delete meta.equipment.chest;
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: chest, count: 1 });
    sim.drainEvents();

    sim.switchLoadout(saved, pid);
    const results = gearResults(sim.drainEvents());
    expect(results[0]?.equipped, 'one real transition').toBe(1);
    expect(meta.equipment.chest).toBe(chest);
  });
});

describe('an overwrite does not silently discard a captured set', () => {
  it('keeps the gear when a plain Save Build overwrites a gear-carrying loadout', async () => {
    // Tweak one talent on your PvP build, hit Save, and the pinned set used to be
    // gone with no warning, because the overwrite rebuilds the whole record.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('no meta');
    meta.equipment.chest = await chestItemId();
    meta.equipmentInstance = { chest: ENCHANT };

    const saved = sim.saveLoadout('PvP', [], pid, undefined, true);
    expect(meta.loadouts[saved].gear, 'captured on the first save').toBeDefined();

    // Same NAME, no capture requested: an overwrite of the same record.
    sim.saveLoadout('PvP', [], pid);
    expect(meta.loadouts[saved].gear, 'the set survives the overwrite').toBeDefined();
  });

  it('still creates a gear-free loadout when the name is new', async () => {
    // Guards the guard: preservation must key on the EXISTING record, not blanket
    // re-attach gear to every save.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('no meta');
    meta.equipment.chest = await chestItemId();
    sim.saveLoadout('PvP', [], pid, undefined, true);
    const plain = sim.saveLoadout('PvE', [], pid);
    expect(Object.hasOwn(meta.loadouts[plain], 'gear')).toBe(false);
  });
});

describe('the result event describes the swap that actually happened', () => {
  it('counts a same-id copy UPGRADE as equipped, not as a failure', async () => {
    // The flagship case, and it was being reported as a failure. The transition
    // check pinned bare ids, which made the pin comparison identical to an id
    // comparison, so restoring the enchanted copy over a worn plain one of the same
    // id fell into the else arm: equipped 0, copyGone 1, and the HUD told the player
    // "not the copy this build pinned" about the swap that had just worked. Every
    // other apply test empties the slot first, which is why this stayed uncovered.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('no meta');
    const itemId = await chestItemId();

    meta.equipment.chest = itemId;
    meta.equipmentInstance = { chest: ENCHANT };
    const saved = sim.saveLoadout('PvP', [], pid, undefined, true);

    // Now wear the PLAIN copy and hold the enchanted one.
    meta.equipment.chest = itemId;
    meta.equipmentInstance = {};
    meta.inventory.length = 0;
    meta.inventory.push({ itemId, count: 1, instance: ENCHANT });
    sim.drainEvents();

    sim.switchLoadout(saved, pid);
    const results = gearResults(sim.drainEvents());
    expect(meta.equipmentInstance?.chest, 'the enchanted copy is worn').toBeDefined();
    expect(results[0]?.equipped, 'and it counts as restored').toBe(1);
    expect(results[0]?.copyGone, 'not as a missing copy').toBe(0);
  });

  it('says takenByOtherSlot when an earlier slot in the same apply took the copy', async () => {
    // Re-derived at apply time. The per-slot re-plan starts a fresh claim set each
    // time, so the planner's own reason is unreachable from the live path and this
    // reported notHeld: "you no longer have" a ring the player is wearing one slot
    // over. A dead schema field that looks live is worse than no field.
    const { ITEMS } = await import('../src/sim/data');
    const ring = Object.values(ITEMS).find((d) => d.slot === 'ring');
    if (!ring) throw new Error('no ring fixture');
    const sim = makeSim();
    sim.setPlayerLevel(20); // epic rings carry a level requirement
    const pid = sim.playerId;
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('no meta');

    meta.equipment.ring1 = ring.id;
    meta.equipment.ring2 = ring.id;
    meta.equipmentInstance = {};
    const saved = sim.saveLoadout('Rings', [], pid, undefined, true);

    // Only ONE copy held for two saved ring slots.
    delete meta.equipment.ring1;
    delete meta.equipment.ring2;
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: ring.id, count: 1 });
    sim.drainEvents();

    sim.switchLoadout(saved, pid);
    const r = gearResults(sim.drainEvents())[0];
    expect(r?.equipped, 'one ring goes on').toBe(1);
    expect(r?.takenByOtherSlot, 'and the other is reported as taken, not missing').toBe(1);
    expect(r?.notHeld).toBe(0);
  });
});

