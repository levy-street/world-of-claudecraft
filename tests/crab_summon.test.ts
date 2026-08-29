// The tide-pool miniboss (q_ps_mother_of_pearl): the pure summon gates, the
// lure granted on accept and never consumed, the item-use summon at the pool,
// the quest-gated pearl on the corpse, the ring hand-in, and the no-strand
// retry rules (a wipe or an unlooted corpse can always summon again).

import { describe, expect, it } from 'vitest';
import { PROVING_SHORE_NPCS } from '../src/sim/content/proving_shore';
import { MOBS, QUESTS } from '../src/sim/data';
import { summonQuestMob } from '../src/sim/encounters/quest_summon';
import {
  CRAB_MOB_ID,
  CRAB_QUEST_ID,
  CRAB_SUMMON_RANGE,
  CRAB_SUMMON_SITE,
  crabSummonCheck,
  LURE_ITEM_ID,
} from '../src/sim/interactions/crab_summon';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, type Entity, type SimEvent } from '../src/sim/types';

const PEARL_ITEM_ID = 'ps_lustrous_pearl';
const RING_ITEM_ID = 'mother_of_pearl';

function makeSim(seed = 4120): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

function teleportTo(sim: Sim, x: number, z: number): void {
  sim.player.pos.x = x;
  sim.player.pos.z = z;
}

function liveBoss(sim: Sim): Entity | null {
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && e.templateId === CRAB_MOB_ID && !e.dead) return e;
  }
  return null;
}

function errorTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

/** Clear the prerequisite and take the quest at Nel's watch (the real accept
 *  path, so the requiredItems grant runs). */
function startQuest(sim: Sim): void {
  sim.players.get(sim.playerId)!.questsDone.add('q_ps_shell_and_claw');
  const nel = PROVING_SHORE_NPCS.tidewarden_nel.pos;
  teleportTo(sim, nel.x + 1, nel.z);
  sim.drainEvents();
  sim.acceptQuest(CRAB_QUEST_ID);
  expect(sim.questState(CRAB_QUEST_ID)).toBe('active');
}

describe('crabSummonCheck: the pure gates', () => {
  it('walks the reason ladder in blame order', () => {
    expect(crabSummonCheck({ questState: null, distance: 0, bossAlive: false })).toEqual({
      ok: false,
      reason: 'notOnQuest',
    });
    expect(crabSummonCheck({ questState: 'ready', distance: 0, bossAlive: false })).toEqual({
      ok: false,
      reason: 'questDone',
    });
    // A live boss outranks distance: "he is already up" is the useful answer
    // wherever the player stands.
    expect(crabSummonCheck({ questState: 'active', distance: 999, bossAlive: true })).toEqual({
      ok: false,
      reason: 'alreadyProwling',
    });
    expect(
      crabSummonCheck({
        questState: 'active',
        distance: CRAB_SUMMON_RANGE + 0.1,
        bossAlive: false,
      }),
    ).toEqual({ ok: false, reason: 'tooFar' });
    expect(
      crabSummonCheck({ questState: 'active', distance: CRAB_SUMMON_RANGE, bossAlive: false }),
    ).toEqual({ ok: true });
  });
});

describe('the Mother of Pearl chain in a real sim', () => {
  it('grants the lure on accept and refuses a summon away from the pool', () => {
    const sim = makeSim();
    startQuest(sim);
    expect(sim.countItem(LURE_ITEM_ID)).toBe(1);

    // Still standing at Nel's watch: the pool is a walk away.
    sim.drainEvents();
    sim.useItem(LURE_ITEM_ID);
    expect(errorTexts(sim.drainEvents())).toContain(
      'Carry the lure to the tide pool west of the wreck line.',
    );
    expect(liveBoss(sim)).toBeNull();
  });

  it('summons at the pool, drops the quest pearl, and pays the ring', () => {
    const sim = makeSim();
    startQuest(sim);
    teleportTo(sim, CRAB_SUMMON_SITE.x, CRAB_SUMMON_SITE.z);
    sim.drainEvents();
    sim.useItem(LURE_ITEM_ID);

    const boss = liveBoss(sim);
    expect(boss).toBeTruthy();
    expect(boss!.hostile).toBe(true);
    // Tapped to the summoner, so nobody else can steal the credit.
    expect(boss!.tappedById).toBe(sim.playerId);
    // The lure is reusable: never consumed, so a wipe can always retry.
    expect(sim.countItem(LURE_ITEM_ID)).toBe(1);
    // A second use while he prowls warns instead of double-summoning.
    sim.drainEvents();
    sim.useItem(LURE_ITEM_ID);
    expect(errorTexts(sim.drainEvents())).toContain('Mister Crabs already prowls the pool!');

    sim.ctx.dealDamage(sim.player, boss!, 9_999, false, 'physical', null, 'hit');
    expect(boss!.dead).toBe(true);
    teleportTo(sim, boss!.pos.x, boss!.pos.z);
    sim.lootCorpse(boss!.id);
    expect(sim.countItem(PEARL_ITEM_ID)).toBe(1);
    expect(sim.questState(CRAB_QUEST_ID)).toBe('ready');

    // Everything in hand: the lure now points at the hand-in, not a respawn.
    sim.drainEvents();
    sim.useItem(LURE_ITEM_ID);
    expect(errorTexts(sim.drainEvents())).toContain(
      'You have what you came for. Tidewarden Nel waits on your prize.',
    );

    const nel = PROVING_SHORE_NPCS.tidewarden_nel.pos;
    teleportTo(sim, nel.x + 1, nel.z);
    sim.turnInQuest(CRAB_QUEST_ID);
    expect(sim.questState(CRAB_QUEST_ID)).toBe('done');
    // The pearl is delivered, the ring is the pay: plus one to everything.
    // This sim runs autoEquip, so the reward lands straight on a finger,
    // which also proves the ring is genuinely equippable at level 1.
    expect(sim.countItem(PEARL_ITEM_ID)).toBe(0);
    expect(sim.equipment.ring1).toBe(RING_ITEM_ID);
  });

  it('lets an unlooted kill summon again, so the pearl can never strand', () => {
    const sim = makeSim();
    startQuest(sim);
    teleportTo(sim, CRAB_SUMMON_SITE.x, CRAB_SUMMON_SITE.z);
    sim.useItem(LURE_ITEM_ID);
    const first = liveBoss(sim);
    expect(first).toBeTruthy();
    sim.ctx.dealDamage(sim.player, first!, 9_999, false, 'physical', null, 'hit');
    expect(first!.dead).toBe(true);
    // Kill credited but the pearl never looted (say the corpse faded): the
    // quest stays active, so the lure works again.
    expect(sim.questState(CRAB_QUEST_ID)).toBe('active');
    sim.useItem(LURE_ITEM_ID);
    const second = liveBoss(sim);
    expect(second).toBeTruthy();
    expect(second!.id).not.toBe(first!.id);
    // The kill objective stays capped at its requirement across the rekill.
    sim.ctx.dealDamage(sim.player, second!, 9_999, false, 'physical', null, 'hit');
    const qp = sim.questLog.get(CRAB_QUEST_ID)!;
    expect(qp.counts[0]).toBe(1);
  });

  it('stays silent for a player who never took the quest', () => {
    const sim = makeSim();
    // No quest, standing right at the pool with a lure smuggled into bags:
    // the use is a silent no-op, never a toast and never a boss.
    sim.ctx.addItem(LURE_ITEM_ID, 1, sim.playerId);
    teleportTo(sim, CRAB_SUMMON_SITE.x, CRAB_SUMMON_SITE.z);
    sim.drainEvents();
    sim.useItem(LURE_ITEM_ID);
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(liveBoss(sim)).toBeNull();
  });

  it('shares the pool: a second summoner raises their OWN king', () => {
    // The island is shared, so the alive-gate is scoped to the caller's tap:
    // a stranger's crab prowling the pool never queues another quest holder.
    const sim = makeSim();
    startQuest(sim);
    teleportTo(sim, CRAB_SUMMON_SITE.x, CRAB_SUMMON_SITE.z);
    // A stranger's summon (an unrelated owner id) stands at the pool.
    summonQuestMob(
      sim.ctx,
      CRAB_MOB_ID,
      { x: CRAB_SUMMON_SITE.x, y: 0, z: CRAB_SUMMON_SITE.z },
      -1,
      { perOwner: true },
    );
    const strangers = liveBoss(sim);
    expect(strangers).toBeTruthy();
    expect(strangers!.tappedById).toBe(-1);
    // The player's own lure still works beside it.
    sim.drainEvents();
    sim.useItem(LURE_ITEM_ID);
    const crabs = [...sim.entities.values()].filter(
      (e) => e.kind === 'mob' && e.templateId === CRAB_MOB_ID && !e.dead,
    );
    expect(crabs).toHaveLength(2);
    expect(crabs.some((c) => c.tappedById === sim.playerId)).toBe(true);
    // But a SECOND use by the same player warns instead of stacking a third.
    sim.drainEvents();
    sim.useItem(LURE_ITEM_ID);
    expect(errorTexts(sim.drainEvents())).toContain('Mister Crabs already prowls the pool!');
  });

  it('pins the anti-grief and reward wiring on the content records', () => {
    // Only quest holders can damage him (nobody can grief a summon), the
    // pearl drops for quest holders only, and EVERY class is paid the same
    // ring. Not three archetypes: the ring is the island's keepsake and the
    // vehicle for its equip lesson, so a paladin or a druid used to finish
    // the detour, be told to slide it on, and have no ring to slide.
    expect(MOBS[CRAB_MOB_ID].requiresQuestId).toBe(CRAB_QUEST_ID);
    const pearlEntry = (MOBS[CRAB_MOB_ID].loot ?? []).find((l) => l.itemId === PEARL_ITEM_ID);
    expect(pearlEntry).toMatchObject({ chance: 1, questId: CRAB_QUEST_ID });
    expect(QUESTS[CRAB_QUEST_ID].itemRewards).toEqual(
      Object.fromEntries(ALL_CLASSES.map((cls) => [cls, RING_ITEM_ID])),
    );
    expect(QUESTS[CRAB_QUEST_ID].requiredItems).toEqual([LURE_ITEM_ID]);
  });
});
