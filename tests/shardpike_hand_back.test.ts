// The Shardpike goes back where it came from, and nobody ever holds two.
//
// Skerrit's pike (q_socketwrights_due) and the muster rack's lent copy are both undiscardable
// and unsellable, so before this a pike could sit stuck in the bags forever: Skerrit's after
// the quest was turned in (it was "yours"), and a lent copy swapped into the bags by hand.
// Pinned here through the real Sim paths:
//   - Skerrit takes his pike back on turn-in and abandon (hands and bags alike), and talking
//     to him with the quest not in the log hands back any copy still carried
//     (src/sim/quests/quest_tool_return.ts);
//   - while the quest is active, talking to him trims extras to one, and the pike is
//     soulbound so it cannot be traded away and re-granted;
//   - using the muster rack again with a lent pike hands it back, and the rack lends nothing
//     to a player already carrying Skerrit's (src/sim/muster_pike.ts).
import { describe, expect, it } from 'vitest';
import { MUSTER_RACK } from '../src/sim/content/mirefen_muster';
import {
  MUSTER_PIKE_DRAWN_EVENT,
  MUSTER_PIKE_DRILL_QUEST_ID,
} from '../src/sim/content/mirefen_muster_quests';
import { BUILTIN_WORLD, ITEMS, NPCS, QUESTS } from '../src/sim/data';
import { SKERRITS_SHARDPIKE_ID } from '../src/sim/lance_balance_core';
import type { MusterArmyState } from '../src/sim/mirefen_muster';
import { MUSTER_SHARDPIKE_ID, SHARDPIKE_CARRIED_REFUSAL } from '../src/sim/muster_pike';
import { turnInQuestCore } from '../src/sim/quests/quest_commands';
import { QUEST_TOOL_RETURNED_TEXT } from '../src/sim/quests/quest_tool_return';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent, WorldContent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { WORLD_BOSSES } from '../src/sim/world_boss';
import { localizeSimText } from '../src/ui/sim_i18n';

const QUEST = 'q_socketwrights_due';
const SKERRIT = 'socketwright_skerrit';

const place = (sim: Sim, e: Entity, x: number, z: number) => {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
};

function withSkerrit() {
  const sim = new Sim({ seed: 21, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(10);
  const ctx = (sim as unknown as { ctx: SimContext }).ctx;
  const npc = [...sim.entities.values()].find((e) => e.kind === 'npc' && e.templateId === SKERRIT);
  if (!npc) throw new Error('Skerrit is not placed');
  place(sim, sim.player, npc.pos.x + 2, npc.pos.z);
  const meta = () => {
    const m = sim.players.get(sim.playerId);
    if (!m) throw new Error('no meta');
    return m;
  };
  /** Bags plus worn copies of Skerrit's pike. */
  const held = () =>
    sim.countItem(SKERRITS_SHARDPIKE_ID) +
    Object.values(meta().equipment).filter((id) => id === SKERRITS_SHARDPIKE_ID).length;
  const talk = (): SimEvent[] => {
    sim.talkToNpc(npc.id);
    return sim.tick();
  };
  return { sim, ctx, npc, meta, held, talk };
}

const logs = (events: SimEvent[]) =>
  events.filter((e) => e.type === 'log').map((e) => (e as { text: string }).text);

describe("Skerrit's Shardpike goes back to Skerrit", () => {
  it('is soulbound, so a traded-away copy can never be re-granted into a second', () => {
    expect(ITEMS[SKERRITS_SHARDPIKE_ID]?.soulbound).toBe(true);
    expect(ITEMS[SKERRITS_SHARDPIKE_ID]?.questId).toBe(QUEST);
    expect(QUESTS[QUEST].requiredItems).toEqual([SKERRITS_SHARDPIKE_ID]);
  });

  it('accepting grants exactly one, and turning in takes the wielded pike back', () => {
    const h = withSkerrit();
    h.sim.acceptQuest(QUEST);
    expect(h.meta().questLog.has(QUEST)).toBe(true);
    expect(h.held()).toBe(1);
    h.sim.equipItem(SKERRITS_SHARDPIKE_ID);
    expect(h.meta().equipment.mainhand).toBe(SKERRITS_SHARDPIKE_ID);
    const qp = h.meta().questLog.get(QUEST);
    if (!qp) throw new Error('quest not in log');
    qp.counts = [1];
    qp.state = 'ready';
    expect(turnInQuestCore(h.ctx, QUEST, QUESTS[QUEST], h.meta())).toBe(true);
    expect(h.meta().questsDone.has(QUEST)).toBe(true);
    expect(h.held()).toBe(0);
    expect(h.meta().equipment.mainhand).toBeUndefined();
  });

  it('abandoning takes it back from the hands and the bags', () => {
    const h = withSkerrit();
    h.sim.acceptQuest(QUEST);
    h.sim.equipItem(SKERRITS_SHARDPIKE_ID);
    h.sim.addItem(SKERRITS_SHARDPIKE_ID, 1);
    expect(h.held()).toBe(2);
    h.sim.abandonQuest(QUEST);
    expect(h.held()).toBe(0);
  });

  it('a pike left over from a finished quest is handed back by talking to him', () => {
    const h = withSkerrit();
    h.meta().questsDone.add(QUEST);
    h.sim.addItem(SKERRITS_SHARDPIKE_ID, 1);
    expect(h.held()).toBe(1);
    const events = h.talk();
    expect(h.held()).toBe(0);
    expect(logs(events)).toContain(QUEST_TOOL_RETURNED_TEXT);
    // A second talk has nothing to hand back and says nothing.
    expect(logs(h.talk())).not.toContain(QUEST_TOOL_RETURNED_TEXT);
  });

  it('a worn leftover goes back too, and the brace state with it', () => {
    const h = withSkerrit();
    h.meta().questsDone.add(QUEST);
    h.sim.addItem(SKERRITS_SHARDPIKE_ID, 1);
    h.sim.equipItem(SKERRITS_SHARDPIKE_ID);
    expect(h.meta().equipment.mainhand).toBe(SKERRITS_SHARDPIKE_ID);
    h.talk();
    expect(h.held()).toBe(0);
    expect(h.meta().equipment.mainhand).toBeUndefined();
  });

  it('while the quest is active, talking to him keeps exactly one (the wielded copy)', () => {
    const h = withSkerrit();
    h.sim.acceptQuest(QUEST);
    h.sim.equipItem(SKERRITS_SHARDPIKE_ID);
    h.sim.addItem(SKERRITS_SHARDPIKE_ID, 2);
    expect(h.held()).toBe(3);
    h.talk();
    expect(h.held()).toBe(1);
    expect(h.meta().equipment.mainhand).toBe(SKERRITS_SHARDPIKE_ID);
    expect(h.sim.countItem(SKERRITS_SHARDPIKE_ID)).toBe(0);
    // And with the one in hand, the re-grant never adds another.
    h.talk();
    expect(h.held()).toBe(1);
  });

  it('talking to an unrelated NPC never takes his pike', () => {
    const h = withSkerrit();
    h.meta().questsDone.add(QUEST);
    h.sim.addItem(SKERRITS_SHARDPIKE_ID, 1);
    const other = [...h.sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'warden_fenwick',
    );
    if (!other) throw new Error('Fenwick is not placed');
    place(h.sim, h.sim.player, other.pos.x + 2, other.pos.z);
    h.sim.talkToNpc(other.id);
    h.sim.tick();
    expect(h.held()).toBe(1);
  });

  it('the bank refuses his pike, and a copy banked earlier still goes home', () => {
    const h = withSkerrit();
    const banker = [...h.sim.entities.values()].find(
      (e) => e.kind === 'npc' && NPCS[e.templateId]?.banker === true,
    );
    if (!banker) throw new Error('no banker placed');
    place(h.sim, h.sim.player, banker.pos.x + 1.5, banker.pos.z);
    h.sim.addItem(SKERRITS_SHARDPIKE_ID, 1);
    const slot = h.meta().inventory.findIndex((s) => s.itemId === SKERRITS_SHARDPIKE_ID);
    const deposit = h.sim as unknown as { bankDeposit(i: number): void };
    // Control: an ordinary item deposits from the same spot, so the refusal is not range.
    h.sim.addItem('linen_cloth', 1);
    const linen = h.meta().inventory.findIndex((s) => s.itemId === 'linen_cloth');
    deposit.bankDeposit(linen);
    expect(h.meta().bank.inventory.some((s) => s.itemId === 'linen_cloth')).toBe(true);
    deposit.bankDeposit(slot);
    expect(h.meta().bank.inventory.some((s) => s.itemId === SKERRITS_SHARDPIKE_ID)).toBe(false);
    expect(h.sim.countItem(SKERRITS_SHARDPIKE_ID)).toBe(1);
    // A copy banked before the refusal landed (a save from an older build).
    h.sim.removeItem(SKERRITS_SHARDPIKE_ID, 1);
    h.meta().bank.inventory.push({ itemId: SKERRITS_SHARDPIKE_ID, count: 1 });
    h.meta().questsDone.add(QUEST);
    const rev = h.meta().bankWireRev;
    place(h.sim, h.sim.player, h.npc.pos.x + 2, h.npc.pos.z);
    h.talk();
    expect(h.meta().bank.inventory.some((s) => s.itemId === SKERRITS_SHARDPIKE_ID)).toBe(false);
    expect(h.meta().bankWireRev).toBeGreaterThan(rev);
  });

  it('every new line reaches the player through the client matcher', () => {
    for (const text of [
      QUEST_TOOL_RETURNED_TEXT,
      SHARDPIKE_CARRIED_REFUSAL,
      'You return the Shardpike to the muster rack.',
    ]) {
      expect(localizeSimText(text), text).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// The muster rack
// ---------------------------------------------------------------------------

const TEST_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
const lair = (() => {
  const row = WORLD_BOSSES.find((b) => b.templateId === 'balgath_cyclops');
  if (!row) throw new Error('balgath_cyclops is not in WORLD_BOSSES');
  return row.pos;
})();

function atTheRack() {
  const sim = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: true, world: TEST_WORLD });
  const inner = sim as unknown as {
    musterArmy: MusterArmyState;
    spawnDevBoss(t: string, x: number, z: number): number;
  };
  inner.spawnDevBoss('balgath_cyclops', lair.x, lair.z);
  for (let i = 0; i < 25 && inner.musterArmy.soldierIds.length === 0; i++) sim.tick();
  const army = inner.musterArmy;
  const rack = sim.entities.get(army.rackId ?? -1);
  if (!rack) throw new Error('no rack');
  place(sim, sim.player, MUSTER_RACK.x + 2, MUSTER_RACK.z - 2);
  const useRack = (): SimEvent[] => {
    sim.player.targetId = rack.id;
    sim.interact();
    return sim.tick();
  };
  const meta = () => {
    const m = sim.players.get(sim.playerId);
    if (!m) throw new Error('no meta');
    return m;
  };
  const lentHeld = () =>
    sim.countItem(MUSTER_SHARDPIKE_ID) +
    Object.values(meta().equipment).filter((id) => id === MUSTER_SHARDPIKE_ID).length;
  return { sim, army, useRack, meta, lentHeld };
}

describe('the muster rack takes its pike back on request', () => {
  it('using the rack again hands the wielded pike back and restores the weapon', () => {
    const r = atTheRack();
    const before = r.meta().equipment.mainhand;
    expect(before).toBeTruthy();
    r.useRack();
    expect(r.meta().equipment.mainhand).toBe(MUSTER_SHARDPIKE_ID);
    const events = r.useRack();
    expect(r.lentHeld()).toBe(0);
    expect(r.meta().equipment.mainhand).toBe(before);
    expect(r.army.lent.has(r.sim.playerId)).toBe(false);
    expect(logs(events)).toContain('You return the Shardpike to the muster rack.');
  });

  it('a lent pike swapped into the bags is handed back, never stuck there', () => {
    const r = atTheRack();
    const before = r.meta().equipment.mainhand;
    r.useRack();
    if (!before) throw new Error('no starting weapon');
    r.sim.equipItem(before);
    expect(r.meta().equipment.mainhand).toBe(before);
    expect(r.sim.countItem(MUSTER_SHARDPIKE_ID)).toBe(1);
    r.useRack();
    expect(r.lentHeld()).toBe(0);
    expect(r.meta().equipment.mainhand).toBe(before);
  });

  it("lends nothing to a player already carrying Skerrit's pike in the bags", () => {
    const r = atTheRack();
    r.sim.addItem(SKERRITS_SHARDPIKE_ID, 1);
    const events = r.useRack();
    expect(r.lentHeld()).toBe(0);
    expect(r.sim.countItem(SKERRITS_SHARDPIKE_ID)).toBe(1);
    const errors = events
      .filter((e) => e.type === 'error')
      .map((e) => (e as { text: string }).text);
    expect(errors).toContain(SHARDPIKE_CARRIED_REFUSAL);
  });

  it('a pike holder whose drill still wants the draw gets the credit and keeps the pike', () => {
    const r = atTheRack();
    r.useRack();
    expect(r.meta().equipment.mainhand).toBe(MUSTER_SHARDPIKE_ID);
    const quest = QUESTS[MUSTER_PIKE_DRILL_QUEST_ID];
    const drawIndex = quest.objectives.findIndex(
      (o) => o.type === 'event' && o.eventId === MUSTER_PIKE_DRAWN_EVENT,
    );
    expect(drawIndex).toBeGreaterThanOrEqual(0);
    r.meta().questLog.set(MUSTER_PIKE_DRILL_QUEST_ID, {
      questId: MUSTER_PIKE_DRILL_QUEST_ID,
      state: 'active',
      counts: quest.objectives.map(() => 0),
    });
    r.useRack();
    expect(r.meta().equipment.mainhand).toBe(MUSTER_SHARDPIKE_ID);
    expect(r.meta().questLog.get(MUSTER_PIKE_DRILL_QUEST_ID)?.counts[drawIndex]).toBe(1);
    // With the step done, the next use is a hand-back again.
    r.useRack();
    expect(r.lentHeld()).toBe(0);
  });
});
