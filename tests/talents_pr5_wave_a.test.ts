import { describe, expect, it } from 'vitest';
import { PROPS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, MAX_LEVEL } from '../src/sim/types';
import { groundHeight, WATER_LEVEL } from '../src/sim/world';

const SEED = 20061;
const MIN_DRY_GROUND = WATER_LEVEL - 0.8;

function makeSim(cls: 'warrior' | 'mage'): Sim {
  const sim = new Sim({ seed: SEED, playerClass: cls });
  sim.setPlayerLevel(MAX_LEVEL);
  return sim;
}

function teleportTo(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

function firstWolf(sim: Sim): Entity {
  const wolf = [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === 'forest_wolf',
  );
  if (!wolf) throw new Error('missing forest wolf');
  wolf.maxHp = 10000;
  wolf.hp = 10000;
  return wolf;
}

function pickDryToDeepSegment(): {
  x: number;
  z: number;
  facing: number;
  destX: number;
  destZ: number;
} {
  for (let x = -180; x <= 180; x += 2) {
    for (let z = -60; z <= 760; z += 2) {
      if (groundHeight(x, z, SEED) <= MIN_DRY_GROUND) continue;
      for (let i = 0; i < 32; i++) {
        const facing = (i / 32) * Math.PI * 2;
        const destX = x + Math.sin(facing) * 15;
        const destZ = z + Math.cos(facing) * 15;
        if (groundHeight(destX, destZ, SEED) < MIN_DRY_GROUND)
          return { x, z, facing, destX, destZ };
      }
    }
  }
  throw new Error('missing dry-to-deep blink segment');
}

function pickDryToCliffSegment(): { x: number; z: number; facing: number } {
  for (let x = -180; x <= 180; x += 2) {
    for (let z = -60; z <= 760; z += 2) {
      const h0 = groundHeight(x, z, SEED);
      if (h0 <= MIN_DRY_GROUND) continue;
      for (let i = 0; i < 16; i++) {
        const facing = (i / 16) * Math.PI * 2;
        let prevX = x;
        let prevZ = z;
        let prevH = h0;
        for (let d = 1; d <= 15; d++) {
          const nx = x + Math.sin(facing) * d;
          const nz = z + Math.cos(facing) * d;
          const h1 = groundHeight(nx, nz, SEED);
          const step = Math.hypot(nx - prevX, nz - prevZ);
          if (h1 > prevH && (h1 - prevH) / step > 1.5) return { x, z, facing };
          prevX = nx;
          prevZ = nz;
          prevH = h1;
        }
      }
    }
  }
  throw new Error('missing dry-to-cliff blink segment');
}

describe('Talents 2.0 PR5 Wave A regressions', () => {
  it('Blink sweeps movement and cannot cross an authored fence', () => {
    const sim = makeSim('mage');
    expect(sim.chooseRow(17, 'mag_r17_blink')).toBe(true);
    const p = sim.player;
    const fence = PROPS.fences[0];
    const mx = (fence.x1 + fence.x2) / 2;
    const mz = (fence.z1 + fence.z2) / 2;
    const dx = fence.x2 - fence.x1;
    const dz = fence.z2 - fence.z1;
    const len = Math.hypot(dx, dz);
    const nx = -dz / len;
    const nz = dx / len;
    teleportTo(sim, p, mx - nx * 7, mz - nz * 7);
    p.facing = Math.atan2(nx, nz);

    sim.castAbility('blink');

    const side = (p.pos.x - mx) * nx + (p.pos.z - mz) * nz;
    expect(side).toBeLessThan(-0.5);
  });

  it('Blink covers the full 15 yd in an open field', () => {
    const sim = makeSim('mage');
    expect(sim.chooseRow(17, 'mag_r17_blink')).toBe(true);
    const p = sim.player;
    teleportTo(sim, p, 0, -40);
    p.facing = 0;
    const start = { ...p.pos };

    sim.castAbility('blink');

    expect(dist2d(start, p.pos)).toBeCloseTo(15, 1);
  });

  it('Blink stops short of deep water and unclimbable cliffs', () => {
    const water = makeSim('mage');
    expect(water.chooseRow(17, 'mag_r17_blink')).toBe(true);
    const waterSegment = pickDryToDeepSegment();
    teleportTo(water, water.player, waterSegment.x, waterSegment.z);
    water.player.facing = waterSegment.facing;
    water.castAbility('blink');
    expect(groundHeight(water.player.pos.x, water.player.pos.z, SEED)).toBeGreaterThanOrEqual(
      MIN_DRY_GROUND,
    );
    expect(
      dist2d(water.player.pos, { x: waterSegment.destX, y: 0, z: waterSegment.destZ }),
    ).toBeGreaterThan(0.5);

    const cliff = makeSim('mage');
    expect(cliff.chooseRow(17, 'mag_r17_blink')).toBe(true);
    const cliffSegment = pickDryToCliffSegment();
    teleportTo(cliff, cliff.player, cliffSegment.x, cliffSegment.z);
    cliff.player.facing = cliffSegment.facing;
    const start = { ...cliff.player.pos };
    cliff.castAbility('blink');
    expect(dist2d(start, cliff.player.pos)).toBeLessThan(15);
  });

  it('Heroic Leap sweeps movement and cannot cross an authored fence', () => {
    const sim = makeSim('warrior');
    expect(sim.chooseRow(5, 'war_r5_heroic_leap')).toBe(true);
    const p = sim.player;
    const fence = PROPS.fences[0];
    const mx = (fence.x1 + fence.x2) / 2;
    const mz = (fence.z1 + fence.z2) / 2;
    const dx = fence.x2 - fence.x1;
    const dz = fence.z2 - fence.z1;
    const len = Math.hypot(dx, dz);
    const nx = -dz / len;
    const nz = dx / len;
    teleportTo(sim, p, mx - nx * 7, mz - nz * 7);

    sim.castAbilityAt('heroic_leap', { x: mx + nx * 7, z: mz + nz * 7 });

    const side = (p.pos.x - mx) * nx + (p.pos.z - mz) * nz;
    expect(side).toBeLessThan(-0.5);
  });

  it('blocks Heroic Leap while rooted', () => {
    const sim = makeSim('warrior');
    expect(sim.chooseRow(5, 'war_r5_heroic_leap')).toBe(true);
    const p = sim.player;
    teleportTo(sim, p, 0, -40);
    p.auras.push({
      id: 'test_root',
      name: 'Test Root',
      kind: 'root',
      remaining: 5,
      duration: 5,
      value: 0,
      sourceId: p.id,
      school: 'physical',
    });
    const start = { ...p.pos };

    sim.castAbilityAt('heroic_leap', { x: 10, z: -40 });

    expect(dist2d(start, p.pos)).toBe(0);
    expect(p.cooldowns.has('heroic_leap')).toBe(false);
  });

  it('Warbringer roots Charge targets', () => {
    const sim = makeSim('warrior');
    expect(sim.chooseRow(5, 'war_r5_warbringer')).toBe(true);
    const p = sim.player;
    const wolf = firstWolf(sim);
    teleportTo(sim, p, wolf.pos.x - 18, wolf.pos.z);
    p.facing = Math.atan2(wolf.pos.x - p.pos.x, wolf.pos.z - p.pos.z);
    sim.targetEntity(wolf.id);

    sim.castAbility('charge');

    expect(wolf.auras.some((a) => a.kind === 'root' && a.id === 'charge_root')).toBe(true);
  });

  it('Concussive Clap roots without dealing a second damage event', () => {
    const sim = makeSim('warrior');
    expect(sim.chooseRow(8, 'war_r8_concussive_clap')).toBe(true);
    const p = sim.player;
    p.resource = 100;
    teleportTo(sim, p, 0, -40);
    const wolf = firstWolf(sim);
    teleportTo(sim, wolf, 2, -40);

    sim.castAbility('thunder_clap');

    const damageEvents = sim.events.filter(
      (event) => event.type === 'damage' && event.ability === 'Thunder Clap',
    );
    expect(damageEvents).toHaveLength(1);
    expect(wolf.auras.some((a) => a.kind === 'root' && a.id === 'thunder_clap_root')).toBe(true);
  });
});
