import { describe, expect, it } from 'vitest';
import { CORPSE_DURATION } from '../src/sim/combat/damage';
import { DUNGEON_X_THRESHOLD, MOBS, riftInstanceOrigin } from '../src/sim/data';
import { summonQuestMob } from '../src/sim/encounters/quest_summon';
import { createMob } from '../src/sim/entity';
import {
  applyBossCorpseHold,
  BOSS_CORPSE_HOLD_SECONDS,
  bossCorpseHoldSeconds,
  isHeldBossTemplate,
} from '../src/sim/mob/boss_corpse_hold';
import { corpseHasDecayed } from '../src/sim/respawn_policy';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { DT, type Entity } from '../src/sim/types';
import { WORLD_BOSS_CORPSE_SECONDS } from '../src/sim/world_boss';
import { EMPTY_TEST_WORLD } from './sim_shared';

// Boss corpse hold (mob/boss_corpse_hold.ts): a slain instance boss keeps its
// lootable corpse for BOSS_CORPSE_HOLD_SECONDS instead of the CORPSE_DURATION
// window trash gets. The bug this pins: an instance boss never respawns in
// place, so its corpse used to be lootable for as long as the instance stood,
// but once corpseTimer hit zero the decay signal (corpseHasDecayed) made it
// unlootable and invisible after 60s while a member's personal first-clear
// ring was still sitting on the entity.

type SimInternals = {
  entities: Map<number, Entity>;
  players: Map<number, PlayerMeta>;
  ctx: SimContext;
  addEntity(e: Entity): void;
};

const RIFT_POS = { ...riftInstanceOrigin(0, 0), y: 0 };
const WORLD_POS = { x: 0, y: 0, z: 0 };
const RING_ID = 'riftbound_band_of_might';

function setup(seed = 11) {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: EMPTY_TEST_WORLD });
  const internals = sim as unknown as SimInternals;
  const pid = sim.addPlayer('warrior', 'Walla');
  sim.tick();
  return { sim, internals, pid };
}

function placePlayer(
  internals: SimInternals,
  pid: number,
  pos: { x: number; y: number; z: number },
) {
  const e = internals.entities.get(pid);
  if (!e) throw new Error('player entity missing');
  e.pos = { ...pos };
  e.prevPos = { ...pos };
}

function kill(sim: Sim, internals: SimInternals, killerId: number, mob: Entity): void {
  const killer = internals.entities.get(killerId);
  if (!killer) throw new Error('killer entity missing');
  sim.dealDamage(killer, mob, 999_999, false, 'physical', null, 'hit');
  expect(mob.dead).toBe(true);
}

function spawnAndKill(
  sim: Sim,
  internals: SimInternals,
  killerId: number,
  templateId: string,
  pos: { x: number; y: number; z: number },
): Entity {
  const template = MOBS[templateId];
  const mob = createMob(9000 + internals.entities.size, template, template.maxLevel, { ...pos });
  internals.addEntity(mob);
  kill(sim, internals, killerId, mob);
  return mob;
}

function tickSeconds(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.ceil(seconds / DT) + 1; i++) sim.tick();
}

/** A minimal dead-mob shape for the pure leaf: a camp-placed mob unless told otherwise. */
function corpse(x: number, flags: { summonedAdd?: boolean; runScoped?: boolean } = {}) {
  return {
    spawnPos: { x, y: 0, z: 0 },
    summonedAdd: flags.summonedAdd ?? false,
    runScoped: flags.runScoped ?? false,
  };
}

describe('bossCorpseHoldSeconds (pure leaf)', () => {
  const instance = DUNGEON_X_THRESHOLD + 1;
  const world = 0;

  it('is thirty minutes and applies to boss templates that are not world bosses', () => {
    expect(BOSS_CORPSE_HOLD_SECONDS).toBe(30 * 60);
    expect(isHeldBossTemplate({ boss: true })).toBe(true);
    expect(isHeldBossTemplate({ boss: true, worldBoss: true })).toBe(false);
    expect(isHeldBossTemplate({ worldBoss: true })).toBe(false);
    expect(isHeldBossTemplate({ elite: true, rare: true } as never)).toBe(false);
    expect(isHeldBossTemplate({})).toBe(false);
    expect(isHeldBossTemplate(undefined)).toBe(false);
  });

  it('grants nothing to a non-boss, wherever it died', () => {
    expect(bossCorpseHoldSeconds({}, corpse(instance))).toBe(0);
    expect(bossCorpseHoldSeconds({ elite: true } as never, corpse(instance))).toBe(0);
    expect(bossCorpseHoldSeconds(undefined, corpse(instance))).toBe(0);
  });

  it('gives an instance boss the full hold', () => {
    expect(bossCorpseHoldSeconds({ boss: true }, corpse(instance))).toBe(BOSS_CORPSE_HOLD_SECONDS);
    // The threshold itself is the open-world side, exactly like the respawn gate.
    expect(bossCorpseHoldSeconds({ boss: true }, corpse(DUNGEON_X_THRESHOLD))).toBe(0);
  });

  it('leaves an open-world boss on the classic decay: its in-place respawn owns the window', () => {
    expect(bossCorpseHoldSeconds({ boss: true }, corpse(world))).toBe(0);
    expect(bossCorpseHoldSeconds(MOBS.warlord_drogmar, corpse(world))).toBe(0);
    expect(bossCorpseHoldSeconds(MOBS.bound_guardian, corpse(world))).toBe(0);
  });

  it('an authored fixed schedule caps the hold, like the decay cap in handleDeath', () => {
    expect(bossCorpseHoldSeconds({ boss: true, respawnSeconds: 120 }, corpse(instance))).toBe(120);
    // A schedule longer than the hold does not extend it.
    expect(bossCorpseHoldSeconds({ boss: true, respawnSeconds: 7200 }, corpse(instance))).toBe(
      BOSS_CORPSE_HOLD_SECONDS,
    );
  });

  it('leaves a world boss to its scheduler-owned window', () => {
    // The world-boss corpse also blocks the next scheduled spawn, so its window
    // is not the hold's to lengthen. Pinned at the pure leaf AND at the writer.
    expect(bossCorpseHoldSeconds({ boss: true, worldBoss: true }, corpse(instance))).toBe(0);
    const template = MOBS.thunzharr_waking_peak;
    expect(template.worldBoss).toBe(true);
    const boss = createMob(3, template, template.maxLevel, { ...WORLD_POS });
    boss.corpseTimer = WORLD_BOSS_CORPSE_SECONDS;
    boss.respawnTimer = Number.POSITIVE_INFINITY;
    applyBossCorpseHold(boss, template);
    expect(boss.corpseTimer).toBe(WORLD_BOSS_CORPSE_SECONDS);
  });

  it('leaves a per-player summon (run-scoped or summoned add) on the classic decay', () => {
    expect(bossCorpseHoldSeconds({ boss: true }, corpse(instance, { runScoped: true }))).toBe(0);
    expect(bossCorpseHoldSeconds({ boss: true }, corpse(instance, { summonedAdd: true }))).toBe(0);
  });

  it('applyBossCorpseHold only ever raises corpseTimer', () => {
    const template = MOBS.rift_boss_frost;
    const boss = createMob(1, template, template.maxLevel, { ...RIFT_POS });
    boss.corpseTimer = CORPSE_DURATION;
    applyBossCorpseHold(boss, template);
    expect(boss.corpseTimer).toBe(BOSS_CORPSE_HOLD_SECONDS);
    // A longer window already granted (a pending loot roll, say) stands.
    boss.corpseTimer = BOSS_CORPSE_HOLD_SECONDS + 100;
    applyBossCorpseHold(boss, template);
    expect(boss.corpseTimer).toBe(BOSS_CORPSE_HOLD_SECONDS + 100);
    const trash = createMob(2, MOBS.rift_frost_revenant, 20, { ...RIFT_POS });
    trash.corpseTimer = CORPSE_DURATION;
    applyBossCorpseHold(trash, MOBS.rift_frost_revenant);
    expect(trash.corpseTimer).toBe(CORPSE_DURATION);
  });
});

describe('boss corpse hold through handleDeath', () => {
  it('a slain rift boss holds its corpse for the full hold, not the trash window', () => {
    const { sim, internals, pid } = setup();
    placePlayer(internals, pid, RIFT_POS);
    const boss = spawnAndKill(sim, internals, pid, 'rift_boss_frost', RIFT_POS);
    expect(MOBS.rift_boss_frost.boss).toBe(true);
    expect(boss.spawnPos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    expect(boss.corpseTimer).toBe(BOSS_CORPSE_HOLD_SECONDS);
    expect(boss.corpseTimer).not.toBe(CORPSE_DURATION);
  });

  it('rift trash on the same floor keeps the classic 60s decay', () => {
    const { sim, internals, pid } = setup();
    placePlayer(internals, pid, RIFT_POS);
    const trash = spawnAndKill(sim, internals, pid, 'rift_frost_revenant', RIFT_POS);
    expect(MOBS.rift_frost_revenant.boss).toBeUndefined();
    expect(trash.corpseTimer).toBe(CORPSE_DURATION);
    tickSeconds(sim, CORPSE_DURATION);
    expect(corpseHasDecayed(trash.dead, trash.corpseTimer)).toBe(true);
  });

  it('a personal first-clear ring is still lootable well past the old 60s decay', () => {
    const { sim, internals, pid } = setup();
    placePlayer(internals, pid, RIFT_POS);
    const boss = spawnAndKill(sim, internals, pid, 'rift_boss_frost', RIFT_POS);
    // The Walla-two shape: one ring, personal to one member, left on the corpse
    // while the party finishes up. addRiftProgressionLoot pushes exactly this.
    boss.loot = { copper: 0, items: [{ itemId: RING_ID, count: 1, personalFor: [pid] }] };
    boss.lootable = true;

    tickSeconds(sim, CORPSE_DURATION * 3);

    expect(boss.dead).toBe(true);
    expect(corpseHasDecayed(boss.dead, boss.corpseTimer)).toBe(false);
    expect(boss.lootable).toBe(true);
    expect(sim.lootCorpse(boss.id, pid)).toBe(true);
    const meta = internals.players.get(pid);
    expect(meta?.inventory.some((slot) => slot.itemId === RING_ID)).toBe(true);
  });

  it('the hold ends: after BOSS_CORPSE_HOLD_SECONDS the boss corpse decays like any other', () => {
    const { sim, internals, pid } = setup();
    placePlayer(internals, pid, RIFT_POS);
    const boss = spawnAndKill(sim, internals, pid, 'rift_boss_frost', RIFT_POS);
    boss.loot = { copper: 0, items: [{ itemId: RING_ID, count: 1, personalFor: [pid] }] };
    boss.lootable = true;
    // Jump to the last second of the hold rather than ticking half an hour.
    boss.corpseTimer = 1;
    tickSeconds(sim, 1);
    expect(corpseHasDecayed(boss.dead, boss.corpseTimer)).toBe(true);
    expect(boss.lootable).toBe(false);
    expect(sim.lootCorpse(boss.id, pid)).toBe(false);
  });

  it('an open-world quest boss is untouched: classic decay, respawn on schedule', () => {
    const { sim, internals, pid } = setup();
    placePlayer(internals, pid, WORLD_POS);
    const drogmar = spawnAndKill(sim, internals, pid, 'warlord_drogmar', WORLD_POS);
    expect(MOBS.warlord_drogmar.boss).toBe(true);
    expect(drogmar.spawnPos.x).toBeLessThanOrEqual(DUNGEON_X_THRESHOLD);
    expect(drogmar.respawnTimer).toBe(180);
    expect(drogmar.corpseTimer).toBe(CORPSE_DURATION);
    drogmar.loot = { copper: 650, items: [] };
    drogmar.lootable = true;
    tickSeconds(sim, 180);
    expect(drogmar.dead).toBe(false);
  });

  it('the Bound Guardian rite summon, spawned through the real script path, keeps the classic decay', () => {
    // summonQuestMob without a hard lifetime marks nothing on the mob (no
    // runScoped, no summonedAdd), so only the open-world placement rule keeps
    // this boss-flagged summon off the hold. Pinned through the real path so a
    // future camp marker cannot be assumed here.
    const { sim, internals, pid } = setup();
    placePlayer(internals, pid, WORLD_POS);
    summonQuestMob(internals.ctx, 'bound_guardian', { ...WORLD_POS }, pid);
    const guardian = [...internals.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'bound_guardian',
    );
    if (!guardian) throw new Error('bound_guardian did not summon');
    expect(MOBS.bound_guardian.boss).toBe(true);
    expect(guardian.runScoped).toBeFalsy();
    expect(guardian.summonedAdd).toBeFalsy();
    kill(sim, internals, pid, guardian);
    expect(guardian.corpseTimer).toBe(CORPSE_DURATION);
  });

  it('a slain world boss keeps its own window, so the hourly spawn cadence is untouched', () => {
    const { sim, internals, pid } = setup();
    placePlayer(internals, pid, WORLD_POS);
    const boss = spawnAndKill(sim, internals, pid, 'thunzharr_waking_peak', WORLD_POS);
    expect(boss.respawnTimer).toBe(Number.POSITIVE_INFINITY);
    expect(boss.corpseTimer).toBe(WORLD_BOSS_CORPSE_SECONDS);
    expect(boss.corpseTimer).not.toBe(BOSS_CORPSE_HOLD_SECONDS);
  });
});
