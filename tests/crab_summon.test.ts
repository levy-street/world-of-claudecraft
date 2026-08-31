// The tide-pool miniboss (q_ps_mother_of_pearl): the pure summon gates, the
// lure granted on accept and never consumed, the item-use summon at the pool,
// the quest-gated pearl on the corpse, the ring hand-in, and the no-strand
// retry rules (a wipe or an unlooted corpse can always summon again).

import { describe, expect, it } from 'vitest';
import { PROVING_SHORE_NPCS } from '../src/sim/content/proving_shore';
import { MOBS, QUESTS } from '../src/sim/data';
import { summonQuestMob } from '../src/sim/encounters/quest_summon';
import { runDespawnDecay } from '../src/sim/entity_roster';
import {
  CRAB_MOB_ID,
  CRAB_QUEST_ID,
  CRAB_SUMMON_RANGE,
  CRAB_SUMMON_SITE,
  crabSummonCheck,
  LURE_ITEM_ID,
} from '../src/sim/interactions/crab_summon';
import { completeTame, petOf, tameError } from '../src/sim/pet/pet_commands';
import { isQuestGatedEntityHidden } from '../src/sim/quest_gated_entity';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, type Entity, type SimEvent, TICK_RATE } from '../src/sim/types';

const PEARL_ITEM_ID = 'ps_lustrous_pearl';
const RING_ITEM_ID = 'mother_of_pearl';
const FIVE_MINUTES_SECONDS = 5 * 60;

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

function requireLiveBoss(sim: Sim): Entity {
  const boss = liveBoss(sim);
  if (!boss) throw new Error('Expected a live Mister Crabs');
  return boss;
}

function errorTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

/** Clear the prerequisite and take the quest at Nel's watch (the real accept
 *  path, so the requiredItems grant runs). */
function startQuest(sim: Sim): void {
  const meta = sim.players.get(sim.playerId);
  if (!meta) throw new Error('Expected the primary player metadata');
  meta.questsDone.add('q_ps_shell_and_claw');
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

    const boss = requireLiveBoss(sim);
    expect(boss.hostile).toBe(true);
    expect(boss.maxHp).toBe(42);
    expect(boss.hp).toBe(42);
    // Tapped to the summoner, so nobody else can steal the credit.
    expect(boss.tappedById).toBe(sim.playerId);
    // The lure is reusable: never consumed, so a wipe can always retry.
    expect(sim.countItem(LURE_ITEM_ID)).toBe(1);
    // A second use while he prowls warns instead of double-summoning.
    sim.drainEvents();
    sim.useItem(LURE_ITEM_ID);
    expect(errorTexts(sim.drainEvents())).toContain('Mister Crabs already prowls the pool!');

    sim.ctx.dealDamage(sim.player, boss, 9_999, false, 'physical', null, 'hit');
    expect(boss.dead).toBe(true);
    teleportTo(sim, boss.pos.x, boss.pos.z);
    sim.lootCorpse(boss.id);
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

  it('lets a non-questing player target and kill the summoner-owned crab', () => {
    const sim = makeSim();
    startQuest(sim);
    teleportTo(sim, CRAB_SUMMON_SITE.x, CRAB_SUMMON_SITE.z);
    sim.useItem(LURE_ITEM_ID);
    const boss = requireLiveBoss(sim);
    const helperPid = sim.addPlayer('mage', 'Helpful Stranger');
    const helper = sim.entities.get(helperPid);
    const helperMeta = sim.players.get(helperPid);
    if (!helper || !helperMeta) throw new Error('Expected the helper player to join');
    helper.pos.x = boss.pos.x;
    helper.pos.z = boss.pos.z + 1;

    expect(helperMeta.questLog.has(CRAB_QUEST_ID)).toBe(false);
    expect(isQuestGatedEntityHidden(boss, helperMeta.questLog)).toBe(false);
    expect(sim.ctx.isHostileTo(helper, boss)).toBe(true);
    sim.targetEntity(boss.id, helperPid);
    expect(helper.targetId).toBe(boss.id);

    const hpBefore = boss.hp;
    const dealt = sim.ctx.dealDamage(helper, boss, 1, false, 'physical', null, 'hit');
    expect(dealt).toBeGreaterThan(0);
    expect(boss.hp).toBeLessThan(hpBefore);
    expect(boss.tappedById).toBe(sim.playerId);

    sim.ctx.dealDamage(helper, boss, 9_999, false, 'physical', null, 'hit');
    expect(boss.dead).toBe(true);
    const progress = sim.questLog.get(CRAB_QUEST_ID);
    if (!progress) throw new Error('Expected the summoner quest to stay active');
    expect(progress.counts[0]).toBe(1);
    teleportTo(sim, boss.pos.x, boss.pos.z);
    sim.lootCorpse(boss.id);
    expect(sim.countItem(PEARL_ITEM_ID)).toBe(1);
    expect(sim.questState(CRAB_QUEST_ID)).toBe('ready');

    // A scripted summon has no wild respawn scheduled. Advance its shortened
    // corpse window through the real mob tick and prove it is dropped instead.
    expect(boss.respawnTimer).toBe(Number.POSITIVE_INFINITY);
    boss.corpseTimer = 1 / TICK_RATE;
    sim.tick();
    expect(sim.entities.has(boss.id)).toBe(false);
  });

  it('cannot be tamed into a permanent hunter pet that bypasses its lifetime', () => {
    const sim = makeSim();
    startQuest(sim);
    teleportTo(sim, CRAB_SUMMON_SITE.x, CRAB_SUMMON_SITE.z);
    sim.useItem(LURE_ITEM_ID);
    const boss = requireLiveBoss(sim);
    const hunterPid = sim.addPlayer('hunter', 'Crab Collector');
    sim.setPlayerLevel(10, hunterPid);
    const hunter = sim.entities.get(hunterPid);
    if (!hunter) throw new Error('Expected the hunter player to join');

    expect(tameError(sim.ctx, hunter, boss)).toBe('That beast is too strong to tame.');
    completeTame(sim.ctx, hunter, boss);
    expect(sim.entities.has(boss.id)).toBe(true);
    expect(petOf(sim.ctx, hunterPid, true)).toBeNull();
  });

  it('despawns five minutes after the lure summons it', () => {
    const sim = makeSim();
    startQuest(sim);
    teleportTo(sim, CRAB_SUMMON_SITE.x, CRAB_SUMMON_SITE.z);
    sim.useItem(LURE_ITEM_ID);
    const boss = requireLiveBoss(sim);

    expect(boss.hardDespawnTimer).toBe(FIVE_MINUTES_SECONDS);
    for (let i = 0; i < FIVE_MINUTES_SECONDS * TICK_RATE - 1; i++) {
      runDespawnDecay(sim.ctx);
    }
    expect(sim.entities.has(boss.id)).toBe(true);
    runDespawnDecay(sim.ctx);
    expect(sim.entities.has(boss.id)).toBe(false);

    sim.useItem(LURE_ITEM_ID);
    const replacement = requireLiveBoss(sim);
    expect(replacement.id).not.toBe(boss.id);
  });

  it('keeps the five-minute lifetime after the summoner dies and a helper takes aggro', () => {
    const sim = makeSim();
    startQuest(sim);
    teleportTo(sim, CRAB_SUMMON_SITE.x, CRAB_SUMMON_SITE.z);
    sim.useItem(LURE_ITEM_ID);
    const boss = requireLiveBoss(sim);
    const helperPid = sim.addPlayer('mage', 'Helpful Survivor');
    const helper = sim.entities.get(helperPid);
    if (!helper) throw new Error('Expected the helper player to join');
    helper.pos.x = boss.pos.x;
    helper.pos.z = boss.pos.z + 1;
    sim.ctx.dealDamage(helper, boss, 1, false, 'physical', null, 'hit');

    sim.ctx.dealDamage(boss, sim.player, 9_999, false, 'physical', null, 'hit');
    expect(sim.player.dead).toBe(true);
    expect(boss.aggroTargetId).toBe(helperPid);

    for (let i = 0; i < FIVE_MINUTES_SECONDS * TICK_RATE; i++) {
      runDespawnDecay(sim.ctx);
    }
    expect(sim.entities.has(boss.id)).toBe(false);
  });

  it('lets an unlooted kill summon again, so the pearl can never strand', () => {
    const sim = makeSim();
    startQuest(sim);
    teleportTo(sim, CRAB_SUMMON_SITE.x, CRAB_SUMMON_SITE.z);
    sim.useItem(LURE_ITEM_ID);
    const first = requireLiveBoss(sim);
    sim.ctx.dealDamage(sim.player, first, 9_999, false, 'physical', null, 'hit');
    expect(first.dead).toBe(true);
    // Kill credited but the pearl never looted (say the corpse faded): the
    // quest stays active, so the lure works again.
    expect(sim.questState(CRAB_QUEST_ID)).toBe('active');
    sim.useItem(LURE_ITEM_ID);
    const second = requireLiveBoss(sim);
    expect(second.id).not.toBe(first.id);
    // The kill objective stays capped at its requirement across the rekill.
    sim.ctx.dealDamage(sim.player, second, 9_999, false, 'physical', null, 'hit');
    const qp = sim.questLog.get(CRAB_QUEST_ID);
    if (!qp) throw new Error('Expected the summon quest progress');
    expect(qp.counts[0]).toBe(1);

    // Summon-only corpses must have no ordinary one-minute wild-mob respawn
    // scheduled. Move both decay windows to their last production tick: the
    // summoned-add branch must drop them instead of reviving either copy.
    expect(first.respawnTimer).toBe(Number.POSITIVE_INFINITY);
    expect(second.respawnTimer).toBe(Number.POSITIVE_INFINITY);
    first.corpseTimer = 1 / TICK_RATE;
    second.corpseTimer = 1 / TICK_RATE;
    sim.tick();
    expect(sim.entities.has(first.id)).toBe(false);
    expect(sim.entities.has(second.id)).toBe(false);
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
    const strangers = requireLiveBoss(sim);
    expect(strangers.tappedById).toBe(-1);
    expect(strangers.hardDespawnTimer).toBeUndefined();
    expect(strangers.runScoped).toBeUndefined();
    expect(strangers.summonedAdd).toBe(false);
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

  it('pins the public fight and reward wiring on the content records', () => {
    // Anyone can help damage the summoner-owned crab, while the pearl remains
    // quest-gated and EVERY class is paid the same ring. Not three archetypes:
    // the ring is the island's keepsake and the vehicle for its equip lesson,
    // so a paladin or a druid used to finish
    // the detour, be told to slide it on, and have no ring to slide.
    expect(MOBS[CRAB_MOB_ID].hpBase).toBe(42);
    expect(MOBS[CRAB_MOB_ID].requiresQuestId).toBeUndefined();
    expect(MOBS[CRAB_MOB_ID].untameable).toBe(true);
    const pearlEntry = (MOBS[CRAB_MOB_ID].loot ?? []).find((l) => l.itemId === PEARL_ITEM_ID);
    expect(pearlEntry).toMatchObject({ chance: 1, questId: CRAB_QUEST_ID });
    expect(QUESTS[CRAB_QUEST_ID].itemRewards).toEqual(
      Object.fromEntries(ALL_CLASSES.map((cls) => [cls, RING_ITEM_ID])),
    );
    expect(QUESTS[CRAB_QUEST_ID].requiredItems).toEqual([LURE_ITEM_ID]);
  });
});
