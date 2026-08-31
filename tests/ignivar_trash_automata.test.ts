import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  IGNIVAR_EMBER_SENTINEL_ID,
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_SECOND_WING_ID,
} from '../src/sim/ignivar_raid_ids';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import {
  IGNIVAR_CINDER_LANCE_CAST_ID,
  IGNIVAR_CINDER_LANCE_CAST_SECONDS,
  IGNIVAR_CINDER_LANCE_DAMAGE_MAX_HP,
  IGNIVAR_CINDER_LANCE_RADIUS,
  updateIgnivarTrashAutomaton,
} from '../src/sim/mob/ignivar_trash_automata';
import { Sim } from '../src/sim/sim';
import { DT, type DungeonDifficulty, type Entity } from '../src/sim/types';

function claimedRoom(
  dungeonId: string,
  difficulty: DungeonDifficulty = 'normal',
): { sim: Sim; mobs: Entity[] } {
  const sim = new Sim({ seed: 8124, playerClass: 'warrior', devCommands: true });
  sim.setDungeonDifficulty(difficulty, sim.player.id);
  expect(enterDungeon(sim.ctx, dungeonId, sim.player.id, true)).toBe(true);
  const instance = sim.instances.find(
    (candidate) => candidate.dungeonId === dungeonId && candidate.partyKey !== null,
  );
  if (!instance) throw new Error(`Missing claimed room ${dungeonId}`);
  return {
    sim,
    mobs: instance.mobIds.flatMap((id) => {
      const mob = sim.entities.get(id);
      return mob ? [mob] : [];
    }),
  };
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
  sim.player.pos = sim.groundPos(mob.pos.x + 6, mob.pos.z);
  sim.player.prevPos = { ...sim.player.pos };
  sim.rebucket(sim.player);
}

describe('Ignivar trash automata', () => {
  it.each([IGNIVAR_FORGE_APPROACH_ID, IGNIVAR_MOLTEN_ASSEMBLY_ID])(
    'casts a persistent, interruptible Cinder Lance warning and resolves it in %s',
    (roomId) => {
      const { sim, mobs } = claimedRoom(roomId);
      const sentinel = mobs.find((mob) => mob.templateId === IGNIVAR_EMBER_SENTINEL_ID);
      if (!sentinel) throw new Error('Ember Sentinel missing');
      engage(sim, sentinel);
      sentinel.ignivarTrashSpellTimer = DT;
      const warningPoint = { ...sim.player.pos };
      const healthBefore = sim.player.hp;

      const startEvents = sim.tick();

      expect(sentinel.castingAbility).toBe(IGNIVAR_CINDER_LANCE_CAST_ID);
      expect(sentinel.castAim).toEqual(warningPoint);
      const warning = sim.activeIgnivarMeteors.find((candidate) =>
        candidate.id.startsWith(`ignivar-trash:${sentinel.id}:`),
      );
      expect(warning).toMatchObject({
        x: warningPoint.x,
        z: warningPoint.z,
        radius: IGNIVAR_CINDER_LANCE_RADIUS,
        duration: IGNIVAR_CINDER_LANCE_CAST_SECONDS,
      });
      expect(startEvents).toContainEqual(
        expect.objectContaining({
          type: 'spellfxAt',
          ability: IGNIVAR_CINDER_LANCE_CAST_ID,
          fx: 'meteorFall',
          persistentId: warning?.id,
        }),
      );
      expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[IGNIVAR_CINDER_LANCE_CAST_ID]).toEqual({
        school: 'fire',
      });

      for (let tick = 0; tick < Math.ceil(IGNIVAR_CINDER_LANCE_CAST_SECONDS / DT); tick++) {
        sim.tick();
      }

      expect(healthBefore - sim.player.hp).toBe(
        Math.ceil(sim.player.maxHp * IGNIVAR_CINDER_LANCE_DAMAGE_MAX_HP),
      );
      expect(sentinel.castingAbility).toBeNull();
      expect(sim.activeIgnivarMeteors.some((candidate) => candidate.id === warning?.id)).toBe(
        false,
      );
    },
  );

  it('cancels Cinder Lance through a real Pummel and retries without damage', () => {
    const { sim, mobs } = claimedRoom(IGNIVAR_FORGE_APPROACH_ID);
    const sentinel = mobs.find((mob) => mob.templateId === IGNIVAR_EMBER_SENTINEL_ID);
    if (!sentinel) throw new Error('Ember Sentinel missing');
    sim.setPlayerLevel(20);
    engage(sim, sentinel);
    sentinel.ignivarTrashSpellTimer = DT;
    const healthBefore = sim.player.hp;
    sim.tick();
    expect(sentinel.castingAbility).toBe(IGNIVAR_CINDER_LANCE_CAST_ID);

    const meta = sim.players.get(sim.playerId);
    const pummel = (
      sim as unknown as { resolvedAbility(id: string, pid: number): unknown }
    ).resolvedAbility('pummel', sim.playerId);
    if (!meta) throw new Error('Player metadata missing');
    (
      sim.ctx as unknown as {
        runEffects(player: Entity, meta: unknown, target: Entity, ability: unknown): void;
      }
    ).runEffects(sim.player, meta, sentinel, pummel);

    expect(sentinel.castingAbility).toBeNull();
    expect(sentinel.auras.some((aura) => aura.kind === 'lockout' && aura.school === 'fire')).toBe(
      true,
    );
    sim.tick();
    expect(sentinel.ignivarTrashSpellTimer).toBeCloseTo(5);
    for (let tick = 0; tick < Math.ceil(IGNIVAR_CINDER_LANCE_CAST_SECONDS / DT); tick++) sim.tick();
    expect(sim.player.hp).toBe(healthBefore);
  });

  it('routes Heroic Cinder Lance damage through the live corridor cast', () => {
    const { sim, mobs } = claimedRoom(IGNIVAR_FORGE_APPROACH_ID, 'heroic');
    const sentinel = mobs.find((mob) => mob.templateId === IGNIVAR_EMBER_SENTINEL_ID);
    if (!sentinel) throw new Error('Heroic Ember Sentinel missing');
    engage(sim, sentinel);
    sim.player.maxHp = 1_000;
    sim.player.hp = 1_000;
    sentinel.ignivarTrashSpellTimer = DT;

    sim.tick();
    for (let tick = 0; tick < Math.ceil(IGNIVAR_CINDER_LANCE_CAST_SECONDS / DT); tick++) {
      sim.tick();
    }

    expect(sim.player.hp).toBe(450);
  });

  it('does not grant Cinder Lance to the same Sentinel template in Varkhul room', () => {
    const { sim } = claimedRoom(IGNIVAR_SECOND_WING_ID);
    const instance = sim.instances.find(
      (candidate) => candidate.dungeonId === IGNIVAR_SECOND_WING_ID && candidate.partyKey !== null,
    );
    if (!instance) throw new Error('Inner Crucible claim missing');
    const template = MOBS[IGNIVAR_EMBER_SENTINEL_ID];
    const sentinel = createMob(
      sim.nextId++,
      template,
      template.maxLevel,
      sim.groundPos(sim.player.pos.x + 4, sim.player.pos.z),
    );
    sim.ctx.addEntity(sentinel);
    instance.mobIds.push(sentinel.id);
    sentinel.inCombat = true;
    sentinel.aiState = 'attack';
    sentinel.aggroTargetId = sim.player.id;
    sentinel.ignivarTrashSpellTimer = DT;

    expect(updateIgnivarTrashAutomaton(sim.ctx, sentinel)).toBe(false);
    expect(sentinel.castingAbility).toBeNull();
    expect(sentinel.ignivarTrashSpellTimer).toBeUndefined();
  });
});
