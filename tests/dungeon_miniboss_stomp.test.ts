import { describe, expect, it } from 'vitest';
import { IGNIVAR_FORGE_APPROACH_ID } from '../src/sim/ignivar_raid_ids';
import { enterDungeon } from '../src/sim/instances/dungeons';
import {
  DUNGEON_MINIBOSS_STOMP_ABILITY_ID,
  DUNGEON_MINIBOSS_STOMP_DAMAGE_MAX_HP,
  DUNGEON_MINIBOSS_STOMP_FIRST_SECONDS,
  DUNGEON_MINIBOSS_STOMP_RADIUS,
  DUNGEON_MINIBOSS_STOMP_REPEAT_SECONDS,
} from '../src/sim/mob/dungeon_miniboss_stomp';
import { Sim } from '../src/sim/sim';
import { DT, type DungeonDifficulty, type Entity } from '../src/sim/types';

function claimedApproach(difficulty: DungeonDifficulty = 'normal') {
  const sim = new Sim({ seed: 9821, playerClass: 'warrior', devCommands: true });
  sim.setDungeonDifficulty(difficulty, sim.player.id);
  expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, sim.player.id, true)).toBe(true);
  const instance = sim.instances.find(
    (candidate) => candidate.dungeonId === IGNIVAR_FORGE_APPROACH_ID && candidate.partyKey !== null,
  );
  if (!instance) throw new Error('Approach claim did not form');
  const mobs = instance.mobIds.flatMap((id) => {
    const mob = sim.entities.get(id);
    return mob ? [mob] : [];
  });
  return { sim, mobs };
}

function engage(sim: Sim, mob: Entity): void {
  for (const entity of sim.entities.values()) {
    if (entity.kind === 'mob' && entity.id !== mob.id) entity.dead = true;
  }
  mob.inCombat = true;
  mob.aiState = 'attack';
  mob.aggroTargetId = sim.player.id;
  mob.swingTimer = 999;
  mob.moveSpeed = 0;
  sim.player.pos = sim.groundPos(mob.pos.x + 2, mob.pos.z);
  sim.player.prevPos = { ...sim.player.pos };
  sim.rebucket(sim.player);
}

describe('promoted dungeon Warden Stomp', () => {
  it('pins the instant body-attack identity and cadence', () => {
    expect(DUNGEON_MINIBOSS_STOMP_ABILITY_ID).toBe('Crucible Stomp');
    expect(DUNGEON_MINIBOSS_STOMP_RADIUS).toBe(9);
    expect(DUNGEON_MINIBOSS_STOMP_DAMAGE_MAX_HP).toBe(0.4);
    expect(DUNGEON_MINIBOSS_STOMP_FIRST_SECONDS).toBe(6);
    expect(DUNGEON_MINIBOSS_STOMP_REPEAT_SECONDS).toBe(12);
  });

  it('stomps instantly only from a promoted placement and suppresses its Quake cast', () => {
    const { sim, mobs } = claimedApproach();
    const promoted = mobs.find((mob) => mob.dungeonSpawnMiniboss);
    if (!promoted) throw new Error('Promoted Warden did not spawn');
    engage(sim, promoted);
    promoted.stompTimer = DT;
    promoted.bigCastTimer = DT;
    const healthBefore = sim.player.hp;

    const events = sim.tick();

    expect(promoted.castingAbility).toBeNull();
    expect(promoted.stompTimer).toBe(DUNGEON_MINIBOSS_STOMP_REPEAT_SECONDS);
    expect(healthBefore - sim.player.hp).toBe(
      Math.ceil(sim.player.maxHp * DUNGEON_MINIBOSS_STOMP_DAMAGE_MAX_HP),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'spellfxAt',
          sourceId: promoted.id,
          ability: DUNGEON_MINIBOSS_STOMP_ABILITY_ID,
          radius: DUNGEON_MINIBOSS_STOMP_RADIUS,
        }),
      ]),
    );
  });

  it('damages the exact nine-yard boundary but not a player just outside it', () => {
    const { sim, mobs } = claimedApproach();
    const promoted = mobs.find((mob) => mob.dungeonSpawnMiniboss);
    if (!promoted) throw new Error('Promoted Warden did not spawn');
    engage(sim, promoted);
    const boundaryId = sim.addPlayer('mage', 'Boundary');
    const outsideId = sim.addPlayer('mage', 'Outside');
    const boundary = sim.entities.get(boundaryId);
    const outside = sim.entities.get(outsideId);
    if (!boundary || !outside) throw new Error('Stomp range players did not spawn');
    boundary.pos = sim.groundPos(promoted.pos.x + DUNGEON_MINIBOSS_STOMP_RADIUS, promoted.pos.z);
    boundary.prevPos = { ...boundary.pos };
    outside.pos = sim.groundPos(
      promoted.pos.x + DUNGEON_MINIBOSS_STOMP_RADIUS + 0.01,
      promoted.pos.z,
    );
    outside.prevPos = { ...outside.pos };
    sim.rebucket(boundary);
    sim.rebucket(outside);
    const boundaryHp = boundary.hp;
    const outsideHp = outside.hp;
    promoted.stompTimer = DT;

    sim.tick();

    expect(boundary.hp).toBeLessThan(boundaryHp);
    expect(outside.hp).toBe(outsideHp);
  });

  it('routes Heroic Stomp damage through the live promoted placement', () => {
    const { sim, mobs } = claimedApproach('heroic');
    const promoted = mobs.find((mob) => mob.dungeonSpawnMiniboss);
    if (!promoted) throw new Error('Heroic promoted Warden did not spawn');
    engage(sim, promoted);
    sim.player.maxHp = 1_000;
    sim.player.hp = 1_000;
    promoted.stompTimer = DT;

    sim.tick();

    expect(sim.player.hp).toBe(300);
  });

  it('leaves an ordinary Warden on its interruptible Crucible Quake template cadence', () => {
    const { sim, mobs } = claimedApproach();
    const ordinary = mobs.find(
      (mob) => mob.templateId === 'ignivar_crucible_warden' && !mob.dungeonSpawnMiniboss,
    );
    if (!ordinary) throw new Error('Ordinary Warden did not spawn');
    engage(sim, ordinary);
    ordinary.bigCastTimer = DT;

    sim.tick();

    expect(ordinary.castingAbility).toBe('crucible_quake');
  });
});
