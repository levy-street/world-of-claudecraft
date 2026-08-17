// The Nythraxis arena wardstones share their item id with the overworld "Sunken
// Bastion" quest ward stone (`bastion_ward_stone`, collected for q_bastion_door). The
// ground-object quest gate (src/sim/quest_gated_entity.ts) hides a collectable whose
// quest is not on the viewer's log, which is right for the zone 2 pickup and wrong for
// the raid: the arena wards are an interact-only encounter mechanic (the Deathless Rage
// channel), and a raider who finished the Bastion quest long ago lost every one of them
// (no model, no minimap mark, no interact) and could no longer counter the cast.
//
// The dungeon declares such objects `interactOnly`; the gate reads that off the
// instance the object stands in and never hides them.

import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, DUNGEONS, ITEMS, instanceOrigin, QUESTS } from '../src/sim/data';
import { isQuestGatedGroundObjectHidden } from '../src/sim/quest_gated_entity';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, type WorldContent } from '../src/sim/types';

const WARD_ITEM_ID = 'bastion_ward_stone';
const BASTION_QUEST_ID = 'q_bastion_door';

const RAID_TEST_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: RAID_TEST_WORLD });
}

function enterRaid(sim: Sim, pid: number) {
  sim.players.get(pid)!.questsDone.add('q_nythraxis_bound_guardian');
  while ((sim.partyOf(pid)?.members.length ?? 1) < 5) {
    const fill = sim.addPlayer('priest', `RaidFill${sim.players.size}`);
    sim.partyInvite(fill, pid);
    sim.partyAccept(fill);
  }
  sim.convertPartyToRaid(pid);
  sim.enterDungeon('nythraxis_boss_arena', pid);
  const p = sim.entities.get(pid)!;
  return instanceOrigin(DUNGEONS.nythraxis_boss_arena.index, sim.instanceSlotAt(p.pos)!);
}

function arenaWards(sim: Sim, origin: { x: number; z: number }): Entity[] {
  return [...sim.entities.values()].filter(
    (e) =>
      e.kind === 'object' &&
      e.objectItemId === WARD_ITEM_ID &&
      dist2d(e.pos, { x: origin.x, y: 0, z: origin.z }) < 140,
  );
}

describe('Nythraxis arena wardstones vs the quest-collectable display gate', () => {
  it('pins the premise: the ward item is a collect target of the Bastion quest', () => {
    // If this ever changes the arena wards no longer need the exemption, and the
    // dungeon flag becomes dead data worth removing.
    expect(ITEMS[WARD_ITEM_ID]?.questId).toBe(BASTION_QUEST_ID);
    expect(
      QUESTS[BASTION_QUEST_ID].objectives.some(
        (o) => o.type === 'collect' && o.itemId === WARD_ITEM_ID,
      ),
    ).toBe(true);
  });

  it('declares every arena wardstone interact-only in the dungeon content', () => {
    const wards = (DUNGEONS.nythraxis_boss_arena.objects ?? []).filter(
      (o) => o.itemId === WARD_ITEM_ID,
    );
    expect(wards).toHaveLength(3);
    for (const ward of wards) expect(ward.interactOnly).toBe(true);
  });

  it('shows all three arena wards to a raider who has never taken the Bastion quest', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Raider');
    const origin = enterRaid(sim, pid);
    const wards = arenaWards(sim, origin);
    expect(wards).toHaveLength(3);
    const questLog = sim.players.get(pid)!.questLog;
    expect(questLog.has(BASTION_QUEST_ID)).toBe(false);
    for (const ward of wards) expect(isQuestGatedGroundObjectHidden(ward, questLog)).toBe(false);
  });

  it('shows all three arena wards to a raider who turned the Bastion quest in', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Raider');
    const origin = enterRaid(sim, pid);
    const questLog = sim.players.get(pid)!.questLog;
    questLog.set(BASTION_QUEST_ID, { questId: BASTION_QUEST_ID, counts: [1], state: 'done' });
    for (const ward of arenaWards(sim, origin)) {
      expect(isQuestGatedGroundObjectHidden(ward, questLog)).toBe(false);
    }
  });

  it('still hides the overworld Bastion ward stone from a player who is not on the quest', () => {
    // The zone 2 pickup keeps the collectable behaviour: same item id, no exemption.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Gate' });
    const overworld = [...sim.entities.values()].filter(
      (e) => e.kind === 'object' && e.objectItemId === WARD_ITEM_ID,
    );
    expect(overworld.length).toBeGreaterThan(0);
    for (const stone of overworld) {
      expect(isQuestGatedGroundObjectHidden(stone, sim.questLog)).toBe(true);
    }
    sim.questLog.set(BASTION_QUEST_ID, { questId: BASTION_QUEST_ID, counts: [0], state: 'active' });
    for (const stone of overworld) {
      expect(isQuestGatedGroundObjectHidden(stone, sim.questLog)).toBe(false);
    }
  });

  it('keeps the crypt relics gated: only objects the dungeon flags are exempt', () => {
    // The attunement crypt places real collectables (the keystones and diary of
    // q_nythraxis_sealed_crypt) through the same dungeon objects list; they carry no
    // flag and stay hidden off-quest.
    const crypt = DUNGEONS.nythraxis_crypt.objects ?? [];
    const relics = crypt.filter((o) => {
      const questId = ITEMS[o.itemId]?.questId;
      const quest = questId ? QUESTS[questId] : undefined;
      return !!quest && quest.objectives.some((q) => q.type === 'collect' && q.itemId === o.itemId);
    });
    expect(relics.length).toBeGreaterThan(0);
    for (const relic of relics) expect(relic.interactOnly).toBeUndefined();
  });
});
