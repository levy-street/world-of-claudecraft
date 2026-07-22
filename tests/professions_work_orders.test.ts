// Repeatable craft work orders (Professions 2.0 Phase 14): the six masters each
// take a stack of their craft's staple material for coin on a fixed cadence
// (WORK_ORDER_CADENCE_TICKS). This suite pins the economics as a deliberate,
// live-data-derived contract so a later material sell-value retune or a count
// change reds it on purpose:
//   - copperReward == floor(0.5 * summed vendor sell value of the requested
//     materials), computed from LIVE ITEMS + the LIVE quest objective count;
//   - the turn-in consumes EXACTLY the required materials (no more, no less);
//   - an immediate re-turn-in inside the cadence window is refused (unavailable);
//   - the payout is strictly a coin sink (never gold-positive vs vendoring);
//   - xpReward is the make-amends repeatable band (100).
import { describe, expect, it } from 'vitest';
import { ITEMS, QUESTS } from '../src/sim/data';
import { WORK_ORDER_CADENCE_TICKS } from '../src/sim/professions/cadence';
import { Sim } from '../src/sim/sim';

// questId -> the seated master who gives and takes it (content, Phase 14). The
// material id, count, and reward are all read from LIVE data below, never
// duplicated here, so this table only records the routing the content defines.
const WORK_ORDERS: { questId: string; master: string }[] = [
  { questId: 'q_prof_workorder_forge', master: 'forgemistress_darva' },
  { questId: 'q_prof_workorder_kitchens', master: 'cook_marlow' },
  { questId: 'q_prof_workorder_loom', master: 'weaver_ottilie' },
  { questId: 'q_prof_workorder_toolworks', master: 'tinker_gizzel' },
  { questId: 'q_prof_workorder_tannery', master: 'tanner_hesk' },
  { questId: 'q_prof_workorder_apothecary', master: 'alchemist_verane' },
];

function makeSim(seed = 4411): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

function moveToNpc(sim: Sim, templateId: string, pid = sim.playerId): void {
  const npc = [...sim.entities.values()].find((e) => e.templateId === templateId);
  if (!npc) throw new Error(`${templateId} missing`);
  const player = sim.entities.get(pid);
  if (!player) throw new Error('player missing');
  player.pos.x = npc.pos.x + 1;
  player.pos.z = npc.pos.z;
}

/** The single collect objective of a work order, read from live content. */
function collectObjective(questId: string): { itemId: string; count: number } {
  const quest = QUESTS[questId];
  const obj = quest.objectives.find((o) => o.type === 'collect');
  if (!obj || obj.type !== 'collect' || !obj.itemId) {
    throw new Error(`${questId} has no collect objective`);
  }
  return { itemId: obj.itemId, count: obj.count };
}

/** floor(0.5 * summed vendor sell value of every collect objective's materials),
 *  computed from LIVE item data so a sell-value retune reds the reward pin. */
function expectedReward(questId: string): number {
  let sum = 0;
  for (const obj of QUESTS[questId].objectives) {
    if (obj.type === 'collect' && obj.itemId) {
      sum += obj.count * (ITEMS[obj.itemId].sellValue ?? 0);
    }
  }
  return Math.floor(0.5 * sum);
}

/** The vendor sell value of the full requested material stack (what a player
 *  would net just selling it to a vendor instead of turning it in). */
function vendorValue(questId: string): number {
  let sum = 0;
  for (const obj of QUESTS[questId].objectives) {
    if (obj.type === 'collect' && obj.itemId) {
      sum += obj.count * (ITEMS[obj.itemId].sellValue ?? 0);
    }
  }
  return sum;
}

/** Accept, supply the materials, force ready, and turn in at the master (the
 *  cadence-suite idiom, extended to seed the bags with exactly `provide`). */
function turnIn(sim: Sim, questId: string, master: string, itemId: string, provide: number): void {
  moveToNpc(sim, master);
  sim.acceptQuest(questId);
  const qp = sim.questLog.get(questId);
  if (!qp) throw new Error(`${questId} was not accepted`);
  sim.addItem(itemId, provide, sim.playerId);
  qp.counts = [collectObjective(questId).count];
  qp.state = 'ready';
  moveToNpc(sim, master);
  sim.turnInQuest(questId);
}

describe.each(WORK_ORDERS)('$questId economics (Phase 14, live data)', ({ questId }) => {
  it('pays floor(0.5 * summed material sell value), from live item data', () => {
    const quest = QUESTS[questId];
    expect(quest.copperReward).toBe(expectedReward(questId));
  });

  it('carries the make-amends xp band, repeatable, on the shared cadence window', () => {
    const quest = QUESTS[questId];
    expect(quest.xpReward).toBe(100);
    expect(quest.repeatable).toBe(true);
    expect(quest.repeatCadenceTicks).toBe(WORK_ORDER_CADENCE_TICKS);
  });

  it('is strictly a coin sink: the payout is less than vendoring the materials', () => {
    // The 0.5 multiplier on a positive vendor value guarantees strict inequality,
    // so handing the stack in is never gold-positive versus just selling it.
    const value = vendorValue(questId);
    expect(value).toBeGreaterThan(0);
    expect(QUESTS[questId].copperReward).toBeLessThan(value);
  });
});

describe.each(WORK_ORDERS)('$questId turn-in behavior (Phase 14, Sim)', ({ questId, master }) => {
  it('consumes exactly the required materials and pays the coin once', () => {
    const sim = makeSim();
    const { itemId, count } = collectObjective(questId);
    const meta = sim.players.get(sim.playerId)!;
    const copperBefore = meta.copper;
    // Seed one extra unit so "exactly count consumed" is decisive: one remains.
    turnIn(sim, questId, master, itemId, count + 1);
    expect(sim.countItem(itemId)).toBe(1);
    expect(meta.copper).toBe(copperBefore + QUESTS[questId].copperReward);
  });

  it('refuses an immediate re-turn-in inside the cadence window (unavailable)', () => {
    const sim = makeSim();
    const { itemId, count } = collectObjective(questId);
    turnIn(sim, questId, master, itemId, count);
    // Armed on turn-in; the quest is unavailable and cannot even be re-accepted.
    expect(sim.questState(questId)).toBe('unavailable');
    const meta = sim.players.get(sim.playerId)!;
    expect(meta.questCadence.get(questId)).toBe(sim.tickCount + WORK_ORDER_CADENCE_TICKS);
    moveToNpc(sim, master);
    sim.acceptQuest(questId);
    expect(sim.questLog.has(questId)).toBe(false);
  });
});
