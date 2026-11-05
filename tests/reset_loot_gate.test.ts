import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import {
  corpseBlocksInstanceReset,
  isPersonalQuestSlot,
} from '../src/sim/instances/reset_loot_gate';
import { Sim } from '../src/sim/sim';
import type { LootSlot } from '../src/sim/types';

// The Crucible report: Varkhul's guaranteed Forgefather's Ember sits on the
// corpse as a personal quest slot, and while nobody took it the raid could not
// change difficulty. A personal quest slot no longer blocks a reset; the reset
// delivers it to its recipients instead.
const QUEST_ITEM = 'forgefathers_ember';

function setup() {
  const sim = new Sim({
    seed: 99,
    playerClass: 'warrior',
    noPlayer: true,
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  });
  const leader = sim.addPlayer('warrior', 'Lead');
  const member = sim.addPlayer('priest', 'Member');
  sim.partyInvite(member, leader);
  sim.partyAccept(member);
  expect(sim.enterDungeon('hollow_crypt', member)).toBe(true);
  const inst = sim.instances.find((i) => i.partyKey !== null && i.dungeonId === 'hollow_crypt')!;
  sim.leaveDungeon(member);
  const mob = sim.entities.get(inst.mobIds[0])!;
  mob.dead = true;
  mob.lootable = true;
  sim.drainEvents();
  return { sim, leader, member, inst, mob };
}

function errors(sim: Sim): string[] {
  return sim
    .drainEvents()
    .filter((e) => e.type === 'error')
    .map((e) => (e as { text: string }).text);
}

describe('personal quest slot predicate', () => {
  it('matches only a live, recipient-bearing, non-shared quest slot', () => {
    expect(isPersonalQuestSlot({ itemId: QUEST_ITEM, count: 1, personalFor: [7] })).toBe(true);
    expect(isPersonalQuestSlot({ itemId: QUEST_ITEM, count: 0, personalFor: [7] })).toBe(false);
    expect(isPersonalQuestSlot({ itemId: QUEST_ITEM, count: 1, personalFor: [] })).toBe(false);
    expect(isPersonalQuestSlot({ itemId: QUEST_ITEM, count: 1 })).toBe(false);
    expect(
      isPersonalQuestSlot({ itemId: QUEST_ITEM, count: 1, personalFor: [7], sharedPersonal: true }),
    ).toBe(false);
    // A held roll award is personal gear, never a quest slot.
    expect(
      isPersonalQuestSlot({ itemId: 'varkhul_forgebreaker', count: 1, personalFor: [7] }),
    ).toBe(false);
  });
});

describe('instance reset loot gate', () => {
  it('a corpse holding only a personal quest slot does not block', () => {
    const { sim, mob, member } = setup();
    mob.loot = { copper: 0, items: [{ itemId: QUEST_ITEM, count: 1, personalFor: [member] }] };
    expect(corpseBlocksInstanceReset(sim.ctx, mob)).toBe(false);
  });

  it.each<[string, { copper: number; items: LootSlot[] }]>([
    ['copper', { copper: 5, items: [] }],
    ['a shared drop', { copper: 0, items: [{ itemId: 'varkhul_forgebreaker', count: 1 }] }],
    [
      'a held roll award',
      { copper: 0, items: [{ itemId: 'varkhul_forgebreaker', count: 1, personalFor: [1] }] },
    ],
  ])('a corpse with %s beside the quest slot still blocks', (_label, loot) => {
    const { sim, mob, member } = setup();
    loot.items.push({ itemId: QUEST_ITEM, count: 1, personalFor: [member] });
    mob.loot = loot;
    expect(corpseBlocksInstanceReset(sim.ctx, mob)).toBe(true);
  });

  it('a lootable corpse with no loot table still blocks (open roll or harvest window)', () => {
    const { sim, mob } = setup();
    mob.loot = null;
    expect(corpseBlocksInstanceReset(sim.ctx, mob)).toBe(true);
  });

  it('changes difficulty and delivers the quest item to its online recipient', () => {
    const { sim, leader, member, inst, mob } = setup();
    mob.loot = { copper: 0, items: [{ itemId: QUEST_ITEM, count: 1, personalFor: [member] }] };
    expect(sim.ctx.countItem(QUEST_ITEM, member)).toBe(0);
    sim.setDungeonDifficulty('heroic', leader);
    const text = errors(sim);
    expect(text).not.toContain('You cannot reset instances while loot remains inside.');
    expect(text).toContain('Dungeon difficulty set to Heroic.');
    expect(inst.difficulty).toBe('heroic');
    expect(sim.ctx.countItem(QUEST_ITEM, member)).toBe(1);
  });

  it('changes difficulty when the slot names a recipient who is no longer online', () => {
    const { sim, leader, member, inst, mob } = setup();
    const gone = 999_999;
    mob.loot = { copper: 0, items: [{ itemId: QUEST_ITEM, count: 1, personalFor: [gone] }] };
    sim.setDungeonDifficulty('heroic', leader);
    expect(errors(sim)).toContain('Dungeon difficulty set to Heroic.');
    expect(inst.difficulty).toBe('heroic');
    expect(sim.ctx.countItem(QUEST_ITEM, member)).toBe(0);
    expect(sim.ctx.countItem(QUEST_ITEM, leader)).toBe(0);
  });

  it('still refuses the change while real loot remains beside the quest slot', () => {
    const { sim, leader, member, inst, mob } = setup();
    mob.loot = {
      copper: 0,
      items: [
        { itemId: 'varkhul_forgebreaker', count: 1 },
        { itemId: QUEST_ITEM, count: 1, personalFor: [member] },
      ],
    };
    sim.setDungeonDifficulty('heroic', leader);
    expect(errors(sim)).toContain('You cannot reset instances while loot remains inside.');
    expect(inst.difficulty).toBe('normal');
    // A refused reset never hands the quest item out early.
    expect(sim.ctx.countItem(QUEST_ITEM, member)).toBe(0);
  });
});
