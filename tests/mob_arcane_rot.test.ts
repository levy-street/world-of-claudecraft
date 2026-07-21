import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

const SEED = 31337;
const makeSim = (cls: 'warrior' | 'mage' = 'warrior') => new Sim({ seed: SEED, playerClass: cls });

// Spawn Deacon Voss adjacent to the player and hand it back.
function spawnDeacon(sim: Sim, id = 980001, level = 12) {
  const p = sim.entities.get(sim.playerId)!;
  const mob = createMob(id, MOBS.deacon_voss, level, { x: p.pos.x, y: p.pos.y, z: p.pos.z });
  sim.entities.set(mob.id, mob);
  return mob;
}

// mobSwing rolls the hit table, so a single swing may miss/dodge. Swing in a
// loop until the target carries the arcane-rot aura (the chance is 1 in tests).
function swingUntilRot(sim: Sim, mob: any, target: any, tries = 60): boolean {
  for (let i = 0; i < tries; i++) {
    (sim as any).mobSwing(mob, target);
    if (target.auras.some((a: any) => a.id === 'arcaneRot_deacon_voss')) return true;
  }
  return false;
}

describe('mob arcane rot (on-hit arcane DoT)', () => {
  it('Deacon Voss carries arcaneRot data tuned to an arcane DoT', () => {
    const v = MOBS.deacon_voss.arcaneRot!;
    expect(v).toBeDefined();
    expect(v.school).toBe('arcane');
    expect(v.chance).toBeGreaterThan(0);
    expect(v.perTick).toBeGreaterThan(0);
    expect(v.interval).toBeGreaterThan(0);
    expect(v.duration).toBeGreaterThan(v.interval);
  });

  it('a landed swing brands the struck player with an arcane DoT', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const mob = spawnDeacon(sim);
    const orig = MOBS.deacon_voss.arcaneRot!.chance;
    MOBS.deacon_voss.arcaneRot!.chance = 1;
    try {
      expect(swingUntilRot(sim, mob, player)).toBe(true);
    } finally {
      MOBS.deacon_voss.arcaneRot!.chance = orig;
    }
    const aura = player.auras.find((a) => a.id === 'arcaneRot_deacon_voss')!;
    expect(aura.kind).toBe('dot');
    expect(aura.school).toBe('arcane');
    expect(aura.sourceId).toBe(mob.id);
    expect(aura.remaining).toBeCloseTo(MOBS.deacon_voss.arcaneRot!.duration);
  });

  it('the arcane DoT ticks damage to the player over time', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const mob = spawnDeacon(sim);
    const orig = MOBS.deacon_voss.arcaneRot!.chance;
    MOBS.deacon_voss.arcaneRot!.chance = 1;
    try {
      expect(swingUntilRot(sim, mob, player)).toBe(true);
    } finally {
      MOBS.deacon_voss.arcaneRot!.chance = orig;
    }
    // Park the mob out of melee so only the DoT (not swings) chips the player.
    mob.pos = { x: player.pos.x + 500, y: player.pos.y, z: player.pos.z };
    const before = player.hp;
    // interval=3, so a ~7s window outpaces out-of-combat regen on a boundary tick.
    for (let i = 0; i < 20 * 7; i++) sim.tick();
    expect(player.hp).toBeLessThan(before);
  });

  it('a mob without arcaneRot (forest wolf) applies no arcane DoT', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const wolf = createMob(980050, MOBS.forest_wolf, 4, { x: player.pos.x, y: player.pos.y, z: player.pos.z });
    sim.entities.set(wolf.id, wolf);
    for (let i = 0; i < 40; i++) (sim as any).mobSwing(wolf, player);
    expect(player.auras.some((a) => a.kind === 'dot')).toBe(false);
  });

  it('refreshes (does not infinitely stack) on repeated brands from the same deacon', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const mob = spawnDeacon(sim);
    const orig = MOBS.deacon_voss.arcaneRot!.chance;
    MOBS.deacon_voss.arcaneRot!.chance = 1;
    try {
      swingUntilRot(sim, mob, player);
      swingUntilRot(sim, mob, player);
      swingUntilRot(sim, mob, player);
    } finally {
      MOBS.deacon_voss.arcaneRot!.chance = orig;
    }
    const rotAuras = player.auras.filter((a) => a.id === 'arcaneRot_deacon_voss');
    expect(rotAuras.length).toBe(1);
  });
});
