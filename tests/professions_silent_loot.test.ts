import { describe, expect, it } from 'vitest';
import { GATHER_NODES } from '../src/sim/data';
import { nodeMaterialFor } from '../src/sim/professions/gathering';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

// Every grant in the game flows through the one shared inventory hub
// (Sim.addItem/addItemInstance), which unconditionally emitted a 'loot'
// event that hud.ts's case 'loot' turns into audio.lootItem()/coin() -
// BEFORE this change, that meant every gather/craft/disenchant/salvage/
// enchant-apply grant played the generic loot ding stacked on top of its
// own new dedicated cue (audio.gather/craftSuccess/disenchant/salvage/
// enchant). This pins that all five professions grant sites now pass
// { silent: true } so the loot event's TEXT still prints (no missing
// feedback) but the generic AUDIO CUE is suppressed, while every OTHER
// grant path (quest reward, vendor, mail, trade, corpse loot) is completely
// unaffected and stays loud.

function mustEntity(sim: Sim, pid: number): Entity {
  const entity = sim.entities.get(pid);
  if (!entity) throw new Error(`missing entity ${pid}`);
  return entity;
}

// A gather cast (Professions 2.0 Phase 12b) runs multiple real ticks, during
// which a nearby mob's damage can interrupt it (castStop, success: false);
// the gathering_rhythm.test.ts idiom silences mobs first so a cast survives
// to completion deterministically.
function despawnMobs(sim: Sim): void {
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob') continue;
    e.dead = true;
    e.hp = 0;
    e.aiState = 'dead';
    e.respawnTimer = 9999;
    e.corpseTimer = 9999;
    e.inCombat = false;
  }
}

function makeWorld(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true });
}

function teleportOntoNode(sim: Sim, pid: number, nodeId: string) {
  const node = GATHER_NODES.find((n) => n.id === nodeId);
  if (!node) throw new Error(`missing node ${nodeId}`);
  const p = mustEntity(sim, pid);
  p.pos.x = node.pos.x;
  p.pos.z = node.pos.z;
  p.pos.y = terrainHeight(node.pos.x, node.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

const NODE_ID = GATHER_NODES[0].id;
const NODE_MATERIAL = nodeMaterialFor(GATHER_NODES[0].type, GATHER_NODES[0].zoneId);

function lootEvents(events: SimEvent[]): Array<Extract<SimEvent, { type: 'loot' }>> {
  return events.filter((e): e is Extract<SimEvent, { type: 'loot' }> => e.type === 'loot');
}

describe('professions grants suppress the generic loot audio cue, not the text', () => {
  it('a gather harvest emits a silent loot event (text still prints)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Miner');
    // Bare-handed harvesting is denied even on a tier-1 node (the starting
    // kit carries no gathering tool); grant the matching tier-1 tool
    // (ore_eastbrook_1 is 'ore', see tests/gather_node_harvest.test.ts's
    // TIER1_TOOL_BY_NODE_TYPE for the full id mapping).
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing player meta');
    meta.inventory.push({ itemId: 'copper_mining_pick', count: 1 });
    teleportOntoNode(sim, pid, NODE_ID);
    despawnMobs(sim);

    // harvestNode only STARTS the gather cast (Professions 2.0 Phase 12b);
    // the actual grant lands later via completeGatherCast once the cast
    // timer runs out. GATHER_CAST_BASE_SEC (2.5s) is the longest possible
    // cast, so 3 seconds of ticks always clears it.
    expect(sim.harvestNode(NODE_ID, pid)).toBe(true);
    const events: SimEvent[] = [];
    for (let i = 0; i < 20 * 3; i++) events.push(...sim.tick());
    const loot = lootEvents(events);
    expect(loot.length).toBeGreaterThan(0);
    for (const ev of loot) {
      expect(ev.silent).toBe(true);
      expect(ev.text).toContain('You receive:');
    }
  });

  it('a plain addItem grant (every non-professions path) stays loud by default', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Vendee');
    sim.addItem(NODE_MATERIAL.itemId, 1, pid);
    const events = lootEvents(sim.tick());
    expect(events.length).toBe(1);
    expect(events[0].silent).toBeUndefined();
  });

  it('a plain addItemInstance grant stays loud by default too', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Enchanter');
    sim.addItemInstance(NODE_MATERIAL.itemId, { signer: 'Test' }, pid);
    const events = lootEvents(sim.tick());
    expect(events.length).toBe(1);
    expect(events[0].silent).toBeUndefined();
  });

  it('a successful craft emits (only) silent loot events', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    sim.addItem('spider_leg', 1, pid); // the reagent grant itself stays loud
    sim.craftItem('recipe_tough_jerky', false, pid);
    expect(sim.lastCraftResult?.ok).toBe(true);
    const events = lootEvents(sim.tick());
    // The reagent grant (loud) plus the crafted-output grant (silent): only
    // the output grant should be silenced, proving the flag is scoped to the
    // specific craft-output call site, not a blanket suppression.
    expect(events.some((e) => e.silent === true)).toBe(true);
    expect(events.some((e) => e.silent === undefined)).toBe(true);
  });

  it('a disenchant emits a silent loot event for the reclaimed material', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    sim.addItem('eastbrook_arming_sword', 1, pid);
    sim.tick(); // drain the (loud) sword grant before isolating the disenchant
    sim.disenchantItem('eastbrook_arming_sword', pid);
    expect(sim.lastDisenchantResult?.ok).toBe(true);
    const events = lootEvents(sim.tick());
    expect(events.length).toBe(1);
    expect(events[0].silent).toBe(true);
  });

  it('an apply-enchant emits a silent loot event for the enchanted copy', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    sim.addItem('eastbrook_arming_sword', 1, pid);
    sim.addItem('arcane_dust', 5, pid);
    sim.tick(); // drain the (loud) sword + reagent grants before isolating the enchant
    sim.applyEnchant('eastbrook_arming_sword', 'enchant_weapon_might');
    expect(sim.lastEnchantResult?.ok).toBe(true);
    const events = lootEvents(sim.tick());
    expect(events.length).toBe(1);
    expect(events[0].silent).toBe(true);
  });

  it('a salvage emits a silent loot event for the reclaimed material', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    sim.addItem('eastbrook_arming_sword', 1, pid);
    sim.tick(); // drain the (loud) sword grant before isolating the salvage
    sim.salvageItem('eastbrook_arming_sword', pid);
    expect(sim.lastSalvageResult?.ok).toBe(true);
    const events = lootEvents(sim.tick());
    expect(events.length).toBe(1);
    expect(events[0].silent).toBe(true);
  });
});
