// The Widow's Gallery rime egg sacs never move (playtest, 2026-10-12: "egg
// sacks are moving"). An authored-immobile template (moveSpeed 0) stays
// immobile on heroic: the heroic anti-kite floor (HEROIC_MIN_MOVE_SPEED) lifts
// slow walkers, never a mob authored to stand still. Real Sim ticks in a real
// claimed Hollow Crypt, on both difficulties.

import { describe, expect, it, vi } from 'vitest';
import { DUNGEONS, MOBS } from '../src/sim/data';
import {
  HEROIC_DUNGEON_IDS,
  HEROIC_MIN_MOVE_SPEED,
  mobTemplateForDungeonDifficulty,
} from '../src/sim/instances/difficulty';
import { claimedInstanceAt, enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';

vi.setConfig({ testTimeout: 120_000 });

const EGG = 'rime_egg_sac';

function crypt(difficulty: 'normal' | 'heroic') {
  const sim = new Sim({ seed: 23, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const tank = sim.player;
  sim.chat('/dev level 20', tank.id);
  sim.ctx.setDungeonDifficulty(difficulty, tank.id);
  enterDungeon(sim.ctx, 'hollow_crypt', tank.id, true);
  const inst = claimedInstanceAt(sim.ctx, tank.pos);
  if (!inst) throw new Error('no crypt claim');
  const eggs = inst.mobIds
    .map((id) => sim.ctx.entities.get(id))
    .filter((e): e is Entity => e?.templateId === EGG);
  return { sim, tank, inst, eggs };
}

function drift(e: Entity, from: { x: number; z: number }): number {
  return Math.hypot(e.pos.x - from.x, e.pos.z - from.z);
}

describe('heroic move-speed floor', () => {
  it('lifts a slow walker to the floor and leaves an immobile template immobile', () => {
    expect(MOBS[EGG].moveSpeed).toBe(0);
    const egg = mobTemplateForDungeonDifficulty(MOBS[EGG], 'hollow_crypt', 'heroic');
    expect(egg.moveSpeed).toBe(0);
    // The floor still does its job on everything that walks.
    const slow = MOBS.crypt_ossuary_warrior;
    expect(slow.moveSpeed).toBeGreaterThan(0);
    expect(slow.moveSpeed).toBeLessThan(HEROIC_MIN_MOVE_SPEED);
    expect(mobTemplateForDungeonDifficulty(slow, 'hollow_crypt', 'heroic').moveSpeed).toBe(
      HEROIC_MIN_MOVE_SPEED,
    );
  });

  it('never mobilizes an immobile template in any heroic dungeon or raid', () => {
    // Every template authored immobile, placed or summoned by an encounter,
    // through every heroic record (the five-mans and the raid rooms).
    const immobile = Object.values(MOBS).filter((m) => m.moveSpeed <= 0);
    const ids = new Set(immobile.map((m) => m.id));
    // One of each kind the shared floor used to set walking: the sacs, a
    // summoned totem, a rooted boss and its parts, shackles, a cage, raid
    // set pieces.
    for (const id of [
      EGG,
      'sunbone_totem',
      'the_gorgebloom',
      'ysolei',
      'choirmother_selthe',
      'mere_hydra_head_center',
      'sanctum_shackle_hammer',
      'bastion_gaol_cage',
      'crypt_bone_pile',
      'nythraxis_bone_spike',
      'ignivar_heart_of_the_end',
    ])
      expect(ids.has(id), id).toBe(true);
    const heroicIds = [...HEROIC_DUNGEON_IDS].filter((id) => DUNGEONS[id] !== undefined);
    expect(heroicIds).toEqual(
      expect.arrayContaining([
        'hollow_crypt',
        'sunken_bastion',
        'drowned_temple',
        'wildheart_basin',
        'gravewyrm_sanctum',
        'nythraxis_boss_arena',
      ]),
    );
    for (const dungeonId of heroicIds) {
      for (const base of immobile) {
        const heroic = mobTemplateForDungeonDifficulty(base, dungeonId, 'heroic');
        expect(heroic.moveSpeed, `${dungeonId} ${base.id}`).toBe(base.moveSpeed);
      }
      // And every placed walker of that dungeon or raid room still gets the floor.
      for (const spawn of DUNGEONS[dungeonId].spawns) {
        const base = MOBS[spawn.mobId];
        if (base.moveSpeed <= 0) continue;
        const heroic = mobTemplateForDungeonDifficulty(base, dungeonId, 'heroic');
        if (heroic === base) continue; // a room with no heroic record of its own
        expect(heroic.moveSpeed, `${dungeonId} ${spawn.mobId}`).toBeGreaterThanOrEqual(
          HEROIC_MIN_MOVE_SPEED,
        );
      }
    }
  });
});

for (const difficulty of ['normal', 'heroic'] as const) {
  describe(`the rime egg sacs (${difficulty})`, () => {
    it('stay where they were laid while nobody is near', () => {
      const { sim, eggs } = crypt(difficulty);
      expect(eggs).toHaveLength(4);
      const start = eggs.map((e) => ({ x: e.pos.x, z: e.pos.z }));
      for (let t = 0; t < 45; t += DT) sim.tick();
      for (const [i, e] of eggs.entries()) {
        expect(e.dead).toBe(false);
        expect(e.moveSpeed).toBe(0);
        expect(drift(e, start[i])).toBe(0);
      }
    });

    it('do not walk at a player who draws their aggro', () => {
      const { sim, tank, eggs } = crypt(difficulty);
      const egg = eggs[0];
      const start = { x: egg.pos.x, z: egg.pos.z };
      // Fifteen yards off: outside the 4 yd proximity that springs the sac.
      tank.pos = sim.ctx.groundPos(egg.pos.x + 15, egg.pos.z);
      tank.prevPos = { ...tank.pos };
      sim.ctx.grid.update(tank);
      sim.ctx.aggroMob(egg, tank, false);
      for (let t = 0; t < 8; t += DT) {
        tank.hp = tank.maxHp;
        sim.tick();
      }
      expect(egg.dead).toBe(false);
      expect(drift(egg, start)).toBe(0);
    });
  });
}
