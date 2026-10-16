import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { WYRMS_HOLLOW } from '../src/sim/content/gravewyrm_sanctum_layout';
import { BUILTIN_WORLD, DUNGEON_X_THRESHOLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  BOSS_ROOM_SEAL_DELAY_TICKS,
  dungeonGateState,
  tickDungeonGates,
} from '../src/sim/instances/dungeon_gates';
import { claimedInstanceAt, enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';

const dungeon = DUNGEONS.gravewyrm_sanctum;

function room() {
  const sim = new Sim({
    seed: 41,
    playerClass: 'warrior',
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  });
  expect(enterDungeon(sim.ctx, dungeon.id, sim.player.id)).toBe(true);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('no Sanctum claim');
  return { sim, inst, o: instanceOrigin(dungeon.index, inst.slot) };
}

describe('Gravewyrm Sanctum party access', () => {
  it("keeps the entire descending ramp inside Velkhar's sealed arena", () => {
    const { sim, inst, o } = room();
    for (const id of inst.mobIds) {
      const mob = sim.entities.get(id) as Entity;
      if (mob.templateId !== 'grand_necromancer_velkhar') mob.dead = true;
      else {
        mob.inCombat = true;
        mob.aiState = 'attack';
      }
    }
    tickDungeonGates(sim.ctx);
    const ward = dungeon.gates?.find((g) => g.id === 'vault_ward');
    if (!ward) throw new Error('no vault ward');
    // A boss room seals BOSS_ROOM_SEAL_DELAY_TICKS into the fight (instances/dungeon_gates.ts):
    // the ward stays down until the clock runs out, with Velkhar fighting throughout.
    expect(dungeonGateState(sim.ctx, inst, ward)).toBe('open');
    sim.tickCount += BOSS_ROOM_SEAL_DELAY_TICKS;
    tickDungeonGates(sim.ctx);
    expect(dungeonGateState(sim.ctx, inst, ward)).toBe('sealed');
    expect(ward.z).toBeLessThan(79);
    // Party members already descending can reach the tank across the old seal line.
    for (let z = 80; z <= 96; z += 0.25) {
      expect(isBlocked(41, o.x, o.z + z, 0.5), `ramp z=${z}`).toBe(false);
    }
    expect(isBlocked(41, o.x, o.z + ward.z, 0.5)).toBe(true);
  });

  it('opens a grounded exit at the lake rim and lets the party walk out after Korzul dies', () => {
    const { sim, inst, o } = room();
    const p = sim.player;
    const korzul = inst.mobIds
      .map((id) => sim.entities.get(id))
      .find((e): e is Entity => e?.templateId === 'korzul_the_gravewyrm');
    if (!korzul) throw new Error('no Korzul');
    expect(inst.bossExitId).toBeNull();
    for (const id of inst.mobIds) {
      const mob = sim.entities.get(id);
      if (mob && mob !== korzul) sim.ctx.handleDeath(mob, p);
    }
    expect(inst.bossExitId).toBeNull();
    sim.ctx.handleDeath(korzul, p);
    const exit = sim.entities.get(inst.bossExitId as number);
    if (!exit) throw new Error('no boss exit');
    const distance = Math.hypot(
      exit.pos.x - o.x - WYRMS_HOLLOW.x,
      exit.pos.z - o.z - WYRMS_HOLLOW.z,
    );
    expect(distance).toBeGreaterThan(WYRMS_HOLLOW.lakeR + 1);
    expect(distance).toBeLessThan(WYRMS_HOLLOW.shelfR - 1);
    expect(exit.pos.y).toBe(WYRMS_HOLLOW.h);
    expect(isBlocked(41, exit.pos.x, exit.pos.z, 0.5)).toBe(false);
    // Walk from the middle of the finished boss arena to the visible rim portal.
    p.pos = sim.ctx.groundPos(o.x + WYRMS_HOLLOW.x, o.z + WYRMS_HOLLOW.z);
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    const meta = sim.meta(p.id);
    if (!meta) throw new Error('no player metadata');
    for (let t = 0; t < 20 / DT && p.pos.x >= DUNGEON_X_THRESHOLD; t++) {
      p.facing = Math.atan2(exit.pos.x - p.pos.x, exit.pos.z - p.pos.z);
      meta.moveInput.forward = true;
      sim.tick();
    }
    expect(p.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
    expect(p.dead).toBe(false);
  });
});
