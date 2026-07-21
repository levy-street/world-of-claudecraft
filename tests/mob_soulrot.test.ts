import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

const SEED = 31337;
const makeSim = (cls: 'warrior' | 'mage' = 'warrior') => new Sim({ seed: SEED, playerClass: cls });

// Spawn restless bones adjacent to the player and hand them back.
function spawnBones(sim: Sim, id = 980001, level = 6) {
  const p = sim.entities.get(sim.playerId)!;
  const mob = createMob(id, MOBS.restless_bones, level, { x: p.pos.x, y: p.pos.y, z: p.pos.z });
  sim.entities.set(mob.id, mob);
  return mob;
}

// mobSwing rolls the hit table, so a single swing may miss/dodge. Swing in a
// loop until the target carries the soulrot aura (the chance is forced to 1 here).
function swingUntilRot(sim: Sim, mob: any, target: any, tries = 40): boolean {
  for (let i = 0; i < tries; i++) {
    (sim as any).mobSwing(mob, target);
    if (target.auras.some((a: any) => a.id === 'soulrot_restless_bones')) return true;
  }
  return false;
}

describe('mob soulrot (on-hit shadow DoT)', () => {
  it('Restless Bones carry soulrot data tuned to a shadow DoT', () => {
    const r = MOBS.restless_bones.soulrot!;
    expect(r).toBeDefined();
    // school defaults to shadow when omitted on the template; assert the runtime default below.
    expect(r.chance).toBeGreaterThan(0);
    expect(r.perTick).toBeGreaterThan(0);
    expect(r.interval).toBeGreaterThan(0);
    expect(r.duration).toBeGreaterThan(r.interval);
  });

  it('a landed grave-touch swing festers a shadow DoT on the struck player', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const mob = spawnBones(sim);
    const orig = MOBS.restless_bones.soulrot!.chance;
    MOBS.restless_bones.soulrot!.chance = 1;
    try {
      expect(swingUntilRot(sim, mob, player)).toBe(true);
    } finally {
      MOBS.restless_bones.soulrot!.chance = orig;
    }
    const aura = player.auras.find((a) => a.id === 'soulrot_restless_bones')!;
    expect(aura.kind).toBe('dot');
    expect(aura.school).toBe('shadow');
    expect(aura.sourceId).toBe(mob.id);
    expect(aura.remaining).toBeCloseTo(MOBS.restless_bones.soulrot!.duration);
  });

  it('the shadow DoT ticks damage to the player over time', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const mob = spawnBones(sim);
    const orig = MOBS.restless_bones.soulrot!.chance;
    MOBS.restless_bones.soulrot!.chance = 1;
    try {
      expect(swingUntilRot(sim, mob, player)).toBe(true);
    } finally {
      MOBS.restless_bones.soulrot!.chance = orig;
    }
    // Park the mob far out of melee so only the DoT (not swings) chips the player.
    mob.pos = { x: player.pos.x + 500, y: player.pos.y, z: player.pos.z };
    const before = player.hp;
    for (let i = 0; i < 20 * 7; i++) sim.tick(); // 7s — covers at least two 3s tick intervals
    expect(player.hp).toBeLessThan(before);
  });

  it('a non-rotting mob (forest wolf) applies no shadow DoT', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const wolf = createMob(980050, MOBS.forest_wolf, 4, { x: player.pos.x, y: player.pos.y, z: player.pos.z });
    sim.entities.set(wolf.id, wolf);
    for (let i = 0; i < 40; i++) (sim as any).mobSwing(wolf, player);
    expect(player.auras.some((a) => a.kind === 'dot')).toBe(false);
  });

  it('refreshes (does not infinitely stack) on repeated grave-touches from the same mob', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const mob = spawnBones(sim);
    const orig = MOBS.restless_bones.soulrot!.chance;
    MOBS.restless_bones.soulrot!.chance = 1;
    try {
      swingUntilRot(sim, mob, player);
      swingUntilRot(sim, mob, player);
      swingUntilRot(sim, mob, player);
    } finally {
      MOBS.restless_bones.soulrot!.chance = orig;
    }
    const rotAuras = player.auras.filter((a) => a.id === 'soulrot_restless_bones');
    expect(rotAuras.length).toBe(1);
  });
});
