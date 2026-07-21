import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

const SEED = 31337;
const makeSim = () => new Sim({ seed: SEED, playerClass: 'warrior' });
const AURA_ID = 'stackpoison_mirefen_broodmother';

// Spawn the Broodmother adjacent to the player, level-matched so the hit table
// is even (a big level gap would inflate her miss/dodge and starve the on-hit
// roll). gm keeps the player alive through the swing loop; applyAura still lands.
function spawnBroodmother(sim: Sim, id = 980001) {
  const p = sim.entities.get(sim.playerId)!;
  p.gm = true;
  const mob = createMob(id, MOBS.mirefen_broodmother, p.level, { x: p.pos.x, y: p.pos.y, z: p.pos.z });
  sim.entities.set(mob.id, mob);
  return mob;
}

// mobSwing rolls the hit table, so a single swing may miss/dodge. Swing until
// the poison reaches at least `stacks` applications (chance is forced to 1).
function swingToStacks(sim: Sim, mob: any, target: any, stacks: number, tries = 200): boolean {
  for (let i = 0; i < tries; i++) {
    (sim as any).mobSwing(mob, target);
    const a = target.auras.find((x: any) => x.id === AURA_ID);
    if (a && (a.stacks ?? 1) >= stacks) return true;
  }
  return false;
}

describe('mob stacking poison (ramping on-hit DoT)', () => {
  it('the Broodmother carries stackPoison data tuned to a capped nature DoT', () => {
    const sp = MOBS.mirefen_broodmother.stackPoison!;
    expect(sp).toBeDefined();
    expect(sp.school).toBe('nature');
    expect(sp.chance).toBeGreaterThan(0);
    expect(sp.perTick).toBeGreaterThan(0);
    expect(sp.interval).toBeGreaterThan(0);
    expect(sp.duration).toBeGreaterThan(sp.interval);
    expect(sp.maxStacks).toBeGreaterThan(1);
  });

  it('a landed bite applies a one-stack poison DoT on the struck player', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    const sp = MOBS.mirefen_broodmother.stackPoison!;
    const mob = spawnBroodmother(sim);
    const orig = sp.chance;
    sp.chance = 1;
    try {
      expect(swingToStacks(sim, mob, player, 1)).toBe(true);
    } finally {
      sp.chance = orig;
    }
    const aura = player.auras.find((a) => a.id === AURA_ID)!;
    expect(aura.kind).toBe('dot');
    expect(aura.school).toBe('nature');
    expect(aura.sourceId).toBe(mob.id);
    expect(aura.stacks).toBe(1);
    expect(aura.value).toBe(Math.round(sp.perTick));
    expect(aura.remaining).toBeCloseTo(sp.duration);
  });

  it('repeated bites ramp the per-tick damage with the stack count, capped at maxStacks', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    const sp = MOBS.mirefen_broodmother.stackPoison!;
    const mob = spawnBroodmother(sim);
    const orig = sp.chance;
    sp.chance = 1;
    try {
      expect(swingToStacks(sim, mob, player, sp.maxStacks)).toBe(true);
      // Keep biting past the cap — the stack count must not exceed maxStacks.
      for (let i = 0; i < 40; i++) (sim as any).mobSwing(mob, player);
    } finally {
      sp.chance = orig;
    }
    const auras = player.auras.filter((a) => a.id === AURA_ID);
    expect(auras.length).toBe(1); // one shared slot, never duplicated
    const aura = auras[0];
    expect(aura.stacks).toBe(sp.maxStacks);
    expect(aura.value).toBe(Math.round(sp.perTick * sp.maxStacks));
  });

  it('the poison DoT ticks damage to the player over time', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    const sp = MOBS.mirefen_broodmother.stackPoison!;
    const mob = spawnBroodmother(sim);
    player.gm = false; // gm gates dealDamage, which the DoT tick routes through
    player.maxHp = 5000;
    player.hp = 5000;
    const orig = sp.chance;
    sp.chance = 1;
    try {
      expect(swingToStacks(sim, mob, player, 1)).toBe(true);
    } finally {
      sp.chance = orig;
    }
    // Park the mob far away so only the DoT (not swings) chips the player.
    mob.pos = { x: player.pos.x + 500, y: player.pos.y, z: player.pos.z };
    const before = player.hp;
    for (let i = 0; i < 20 * 3; i++) sim.tick(); // 3s — at least one tick interval
    expect(player.hp).toBeLessThan(before);
  });

  it('a non-poisonous mob (forest wolf) applies no stacking-poison aura', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.gm = true;
    const wolf = createMob(980050, MOBS.forest_wolf, player.level, { x: player.pos.x, y: player.pos.y, z: player.pos.z });
    sim.entities.set(wolf.id, wolf);
    for (let i = 0; i < 40; i++) (sim as any).mobSwing(wolf, player);
    expect(player.auras.some((a) => a.id === AURA_ID)).toBe(false);
  });
});
