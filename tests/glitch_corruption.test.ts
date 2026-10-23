import { describe, expect, it } from 'vitest';
import {
  CORRUPTION_DECAY_OUT_OF_COMBAT,
  CORRUPTION_PER_ZONE,
  corruptionForEffectAge,
  FEEDBACK_PCT_PER_EFFECT,
  GLITCH_EFFECT_AURA_IDS,
  glitchFeedbackMult,
} from '../src/sim/combat/glitch_corruption';
import { CLASSES } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { GroundAoE } from '../src/sim/entity_roster';
import { classListAllows } from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { OPEN_FIELD, placePlayerInOpenField } from './helpers/open_field';

// The Glitch class (src/sim/content/glitch.ts) and its Instability resource
// (src/sim/combat/glitch_corruption.ts): the bar builds from the Glitch's own
// running effects, faster the older they are, and its hits compound per effect.

function place(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos = { x, y: groundHeight(x, z, sim.cfg.seed), z };
  e.prevPos = { ...e.pos };
}

function makeGlitch(level = 20): { sim: Sim; me: Entity } {
  const sim = new Sim({ seed: 7, playerClass: 'glitch', noPlayer: true });
  const pid = sim.addPlayer('glitch', 'Glitchy');
  placePlayerInOpenField(sim, pid);
  sim.setPlayerLevel(level, pid);
  const me = sim.entities.get(pid);
  if (!me) throw new Error('no glitch');
  place(sim, me, OPEN_FIELD.x, OPEN_FIELD.z);
  return { sim, me };
}

function spawnDummy(sim: Sim, x: number, z: number): Entity {
  const s = sim as unknown as { nextId: number; addEntity(e: Entity): void };
  const mob = createMob(s.nextId++, MOBS.forest_wolf, 1, {
    x,
    y: groundHeight(x, z, sim.cfg.seed),
    z,
  });
  mob.maxHp = 100000;
  mob.hp = 100000;
  mob.hostile = true;
  mob.aiState = 'idle';
  s.addEntity(mob);
  return mob;
}

function target(sim: Sim, me: Entity, mob: Entity): void {
  me.targetId = mob.id;
  me.facing = Math.atan2(mob.pos.x - me.pos.x, mob.pos.z - me.pos.z);
}

function ticks(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.tick();
}

function glitchAuras(mob: Entity, me: Entity): Aura[] {
  return mob.auras.filter((a) => a.sourceId === me.id && GLITCH_EFFECT_AURA_IDS.has(a.id));
}

describe('Glitch class definition', () => {
  it('is a Instability class that starts with an empty bar capped at 100', () => {
    expect(CLASSES.glitch.resourceType).toBe('corruption');
    const { me } = makeGlitch();
    expect(me.resourceType).toBe('corruption');
    expect(me.maxResource).toBe(100);
    expect(me.resource).toBe(0);
  });

  it('shares the cloth-caster gear group but not single-class locks', () => {
    expect(classListAllows(['mage', 'priest', 'warlock', 'druid'], 'glitch')).toBe(true);
    expect(classListAllows(['warlock'], 'glitch')).toBe(false);
    expect(classListAllows(['warrior', 'paladin'], 'glitch')).toBe(false);
    // Every other class is unaffected.
    expect(classListAllows(['mage', 'warlock'], 'priest')).toBe(false);
  });
});

describe('Instability generation', () => {
  it('ages: an effect builds more per tick the longer it has run, up to a cap', () => {
    expect(corruptionForEffectAge(0)).toBe(1);
    expect(corruptionForEffectAge(3.9)).toBe(1);
    expect(corruptionForEffectAge(4)).toBe(2);
    expect(corruptionForEffectAge(8)).toBe(3);
    expect(corruptionForEffectAge(12)).toBe(4);
    expect(corruptionForEffectAge(60)).toBe(4);
  });

  it('builds from a running Corrupt Byte, faster as it ages', () => {
    const { sim, me } = makeGlitch();
    const mob = spawnDummy(sim, OPEN_FIELD.x + 10, OPEN_FIELD.z);
    target(sim, me, mob);
    sim.castAbility('glitch_corrupt_byte', me.id);
    ticks(sim, 40); // the 1.5 sec cast lands
    expect(glitchAuras(mob, me)).toHaveLength(1);

    // Sample the bar on consecutive regen ticks: each gain is at least the last.
    const gains: number[] = [];
    let last = me.resource;
    for (let i = 0; i < 4; i++) {
      ticks(sim, 40);
      gains.push(me.resource - last);
      last = me.resource;
    }
    expect(gains[0]).toBeGreaterThan(0);
    for (let i = 1; i < gains.length; i++) expect(gains[i]).toBeGreaterThanOrEqual(gains[i - 1]);
    expect(gains[gains.length - 1]).toBeGreaterThan(gains[0]);
  });

  it('counts every running effect: two effects build faster than one', () => {
    const one = makeGlitch();
    const two = makeGlitch();
    for (const g of [one, two]) {
      const mob = spawnDummy(g.sim, OPEN_FIELD.x + 10, OPEN_FIELD.z);
      target(g.sim, g.me, mob);
      g.sim.castAbility('glitch_corrupt_byte', g.me.id);
      ticks(g.sim, 40);
      if (g === two) {
        g.sim.castAbility('glitch_memory_leak', g.me.id);
        ticks(g.sim, 2);
      }
      g.me.resource = 0;
      ticks(g.sim, 40);
    }
    expect(two.me.resource).toBeGreaterThan(one.me.resource);
  });

  it('counts a placed Noise Field while it lasts', () => {
    const { sim, me } = makeGlitch();
    sim.castAbility('glitch_noise_field', me.id, { x: OPEN_FIELD.x + 12, z: OPEN_FIELD.z });
    const zones = (sim as unknown as { groundAoEs: GroundAoE[] }).groundAoEs;
    expect(zones.some((z) => z.abilityId === 'glitch_noise_field')).toBe(true);
    me.resource = 0;
    ticks(sim, 40);
    expect(me.resource).toBe(CORRUPTION_PER_ZONE);
  });

  it('drains out of combat with nothing running', () => {
    const { sim, me } = makeGlitch();
    me.resource = 50;
    ticks(sim, 40);
    expect(me.resource).toBe(50 - CORRUPTION_DECAY_OUT_OF_COMBAT);
  });
});

describe('Instability spending', () => {
  it('refuses a spender without enough Instability, then lands it once banked', () => {
    const { sim, me } = makeGlitch();
    const mob = spawnDummy(sim, OPEN_FIELD.x + 10, OPEN_FIELD.z);
    target(sim, me, mob);
    sim.drainEvents();
    sim.castAbility('glitch_overflow', me.id);
    const errs = sim
      .drainEvents()
      .filter((e) => e.type === 'error')
      .map((e) => (e as { text: string }).text);
    expect(errs).toContain('Not enough Instability!');
    expect(mob.hp).toBe(100000);

    me.resource = 40;
    sim.castAbility('glitch_overflow', me.id);
    expect(me.resource).toBe(10);
    ticks(sim, 20); // the bolt travels to the target
    expect(mob.hp).toBeLessThan(100000);
  });
});

describe('Feedback (compounding damage)', () => {
  const source = { id: 1, kind: 'player', resourceType: 'corruption' } as Entity;
  const dot = (id: string, sourceId = 1): Aura =>
    ({ id, sourceId, remaining: 10, duration: 12 }) as Aura;

  it('amplifies per OTHER Glitch effect on the target', () => {
    const t = { auras: [] as Aura[] } as Entity;
    expect(glitchFeedbackMult(source, t)).toBe(1);
    t.auras.push(dot('glitch_corrupt_byte'));
    expect(glitchFeedbackMult(source, t)).toBe(1);
    t.auras.push(dot('glitch_memory_leak'));
    expect(glitchFeedbackMult(source, t)).toBeCloseTo(1 + FEEDBACK_PCT_PER_EFFECT);
    t.auras.push(dot('glitch_bit_rot'));
    expect(glitchFeedbackMult(source, t)).toBeCloseTo(1 + 2 * FEEDBACK_PCT_PER_EFFECT);
  });

  it('ignores other casters, non-Glitch auras, and non-Glitch sources', () => {
    const t = {
      auras: [dot('glitch_corrupt_byte', 2), dot('glitch_memory_leak', 2), dot('corruption')],
    } as Entity;
    expect(glitchFeedbackMult(source, t)).toBe(1);
    const warlock = { id: 2, kind: 'player', resourceType: 'mana' } as Entity;
    expect(glitchFeedbackMult(warlock, t)).toBe(1);
    expect(glitchFeedbackMult(null, t)).toBe(1);
  });
});

describe('Location abilities', () => {
  it('Cascade extends Glitch effects in the area and keeps their age', () => {
    const { sim, me } = makeGlitch();
    const mob = spawnDummy(sim, OPEN_FIELD.x + 10, OPEN_FIELD.z);
    target(sim, me, mob);
    sim.castAbility('glitch_corrupt_byte', me.id);
    ticks(sim, 60);
    const [aura] = glitchAuras(mob, me);
    const age = aura.duration - aura.remaining;
    const remaining = aura.remaining;
    me.resource = 100;
    sim.castAbility('glitch_cascade', me.id, { x: mob.pos.x, z: mob.pos.z });
    expect(aura.remaining).toBeCloseTo(remaining + 4);
    expect(aura.duration - aura.remaining).toBeCloseTo(age);
  });

  it('Phase Skip moves the Glitch to the aimed point, clamped to range', () => {
    const { sim, me } = makeGlitch();
    sim.castAbility('glitch_phase_skip', me.id, { x: OPEN_FIELD.x + 15, z: OPEN_FIELD.z });
    expect(me.pos.x).toBeCloseTo(OPEN_FIELD.x + 15, 0);
    expect(me.pos.z).toBeCloseTo(OPEN_FIELD.z, 0);
  });

  it('is deterministic: the same seed and inputs build the same bar', () => {
    const run = (): number => {
      const { sim, me } = makeGlitch();
      const mob = spawnDummy(sim, OPEN_FIELD.x + 10, OPEN_FIELD.z);
      target(sim, me, mob);
      sim.castAbility('glitch_corrupt_byte', me.id);
      ticks(sim, 40);
      sim.castAbility('glitch_noise_field', me.id, { x: mob.pos.x, z: mob.pos.z });
      ticks(sim, 200);
      return me.resource * 1e6 + mob.hp;
    };
    expect(run()).toBe(run());
  });
});
