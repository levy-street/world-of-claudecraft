import { describe, expect, it } from 'vitest';
import { anchorProbeInOpenField } from '../scripts/probe_anchor';
import { shouldDeliverCombatEventToViewer } from '../server/event_delivery';
import { isBlocked } from '../src/sim/colliders';
import { abilityCastSurvivesMovement } from '../src/sim/combat/cast_move_gate';
import { isPlayingDead } from '../src/sim/combat/hunter_play_dead';
import { ABILITIES } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { GroundAoE } from '../src/sim/entity_roster';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { DT, dist2d } from '../src/sim/types';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';

// PR 4488 follow-up: mobile hunter casts, Play Dead's moving grace, instant
// Volley and Fieldcraft's Phosphor Flask, Scatterbolt, aimed and hidden traps,
// and the Bear Trap.

type TestSim = Sim & {
  addEntity(entity: Entity): void;
  nextId: number;
  ctx: { groundAoEs: GroundAoE[] };
};

function hunter(spec: string | null = 'survival', seed = 4501): TestSim {
  const sim = new Sim({ seed, playerClass: 'hunter', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  anchorProbeInOpenField(sim);
  sim.player.facing = 0;
  sim.player.resource = sim.player.maxResource;
  return sim;
}

/** A training dummy at (dx, dz) from the hunter; facing 0 looks down +z. */
function addMob(sim: TestSim, dx: number, dz: number, template = MOBS.training_dummy): Entity {
  const mob = createMob(
    sim.nextId++,
    template,
    20,
    sim.groundPos(sim.player.pos.x + dx, sim.player.pos.z + dz),
  );
  mob.hostile = true;
  mob.moveSpeed = 0;
  mob.aiState = 'idle';
  mob.maxHp = 1_000_000;
  mob.hp = mob.maxHp;
  sim.addEntity(mob);
  return mob;
}

function ticks(sim: Sim, n: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...sim.tick());
  return events;
}

function traps(sim: TestSim): GroundAoE[] {
  return sim.ctx.groundAoEs.filter((zone) => zone.hunterTrap !== undefined);
}

describe('hunter casts while moving', () => {
  it('flags every hunter cast-time or channeled ability as mobile', () => {
    const casts = Object.values(ABILITIES).filter(
      (def) => def.class === 'hunter' && ((def.castTime ?? 0) > 0 || def.channel),
    );
    expect(casts.map((def) => def.id).sort()).toEqual(
      ['aimed_shot', 'measured_shot', 'rapid_fire', 'revive_pet', 'tame_beast'].sort(),
    );
    for (const def of casts) {
      expect(abilityCastSurvivesMovement({ auras: [] } as never, def.id, { def }), def.id).toBe(
        true,
      );
    }
  });

  it('keeps a Long Draw cast going while the hunter runs', () => {
    const sim = hunter('marksmanship');
    const mob = addMob(sim, 0, 20);
    sim.player.targetId = mob.id;
    sim.castAbility('aimed_shot');
    sim.moveInput.forward = true;
    ticks(sim, 5);
    expect(sim.player.castingAbility).toBe('aimed_shot');
  });
});

describe('Play Dead moving grace', () => {
  it('cast while moving survives held keys for 1 sec, then movement ends it', () => {
    const sim = hunter();
    sim.moveInput.forward = true;
    sim.tick();
    sim.castAbility('play_dead');
    sim.tick();
    expect(isPlayingDead(sim.player)).toBe(true);
    const lyingAt = { ...sim.player.pos };
    ticks(sim, Math.round(0.8 / DT));
    expect(isPlayingDead(sim.player)).toBe(true);
    // The body does not slide while the keys are still held.
    expect(dist2d(sim.player.pos, lyingAt)).toBeLessThan(0.01);
    ticks(sim, Math.round(0.4 / DT));
    expect(isPlayingDead(sim.player)).toBe(false);
  });

  it.each([0, 1])('ignores held swim jump during the grace at depth %s', (depth) => {
    const sim = hunter('survival', 42);
    let water: { x: number; z: number } | undefined;
    for (let z = -300; z <= 300 && !water; z += 8) {
      for (let x = -300; x <= 300; x += 8) {
        if (terrainHeight(x, z, 42) < WATER_LEVEL - 3 && !isBlocked(42, x, z, 1)) {
          water = { x, z };
          break;
        }
      }
    }
    expect(water).toBeDefined();
    if (!water) throw new Error('no deep water found');
    const y = WATER_LEVEL - 0.75 - depth;
    sim.player.pos = { ...water, y };
    sim.player.prevPos = { ...sim.player.pos };
    sim.player.onGround = true;
    sim.player.swimDiving = depth > 0;
    sim.moveInput.jump = true;
    sim.castAbility('play_dead');
    ticks(sim, 10);
    expect(isPlayingDead(sim.player)).toBe(true);
    expect(sim.player.pos.y).toBeCloseTo(y, 8);
    expect(sim.player.jumping).toBe(false);
    // The same held key still ends Play Dead when the one-second grace expires.
    ticks(sim, 12);
    expect(isPlayingDead(sim.player)).toBe(false);
  });

  it('letting go inside the grace keeps the hunter down; a later press stands them up', () => {
    const sim = hunter();
    sim.moveInput.forward = true;
    sim.tick();
    sim.castAbility('play_dead');
    ticks(sim, 4);
    sim.moveInput.forward = false;
    ticks(sim, 40);
    expect(isPlayingDead(sim.player)).toBe(true);
    sim.moveInput.forward = true;
    sim.tick();
    expect(isPlayingDead(sim.player)).toBe(false);
  });
});

describe('Volley and Phosphor Flask', () => {
  it('gives Fieldcraft Phosphor Flask in place of Volley; the other specs keep Volley', () => {
    const survival = hunter('survival');
    expect(survival.resolvedAbility('phosphor_flask')).toBeTruthy();
    expect(survival.known.some((k) => k.def.id === 'volley')).toBe(false);
    for (const spec of ['beast_mastery', 'marksmanship']) {
      const sim = hunter(spec);
      expect(sim.resolvedAbility('volley')?.cooldown).toBe(10);
      expect(sim.known.some((k) => k.def.id === 'phosphor_flask')).toBe(false);
    }
  });

  it('is instant, and the flames burn only enemies standing in them, for the full 3 sec', () => {
    const sim = hunter('survival');
    const inside = addMob(sim, 0, 15);
    const outside = addMob(sim, 12, 15);
    const aim = { x: inside.pos.x, z: inside.pos.z };
    sim.castAbility('phosphor_flask', sim.playerId, aim);
    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.channeling).toBe(false);
    const zone = sim.ctx.groundAoEs.find((z) => z.abilityId === 'phosphor_flask');
    expect(zone?.school).toBe('fire');
    expect(zone?.armorMitigated).toBeUndefined();
    // Walking away does not stop the zone.
    sim.moveInput.forward = true;
    const events = ticks(sim, Math.round(3.2 / DT));
    const pulses = events.filter(
      (e) => e.type === 'damage' && e.targetId === inside.id && e.ability === 'Phosphor Flask',
    );
    // The cast pulse plus one every 0.5 sec while the zone lives: 6 in all.
    expect(pulses).toHaveLength(6);
    expect(outside.hp).toBe(outside.maxHp);
    // No burn lingers on the target after the zone ends.
    expect(inside.auras.some((a) => a.kind === 'dot' && a.sourceId === sim.playerId)).toBe(false);
  });

  it('Volley rolls armor on every pulse like the old channel', () => {
    const sim = hunter('marksmanship');
    const soft = addMob(sim, -3, 15);
    const hard = addMob(sim, 3, 15);
    soft.stats.armor = 0;
    hard.stats.armor = 20_000;
    sim.castAbility('volley', sim.playerId, { x: sim.player.pos.x, z: sim.player.pos.z + 15 });
    ticks(sim, Math.round(3.2 / DT));
    expect(soft.maxHp - soft.hp).toBeGreaterThan(hard.maxHp - hard.hp);
  });
});

describe('Scatterbolt', () => {
  it('shoves enemies in the 8-yard cone back to 20 yards and deals no damage, off the GCD', () => {
    const sim = hunter('beast_mastery');
    const near = addMob(sim, 0, 4, MOBS.forest_wolf);
    const behind = addMob(sim, 0, -4, MOBS.forest_wolf);
    const far = addMob(sim, 0, 12, MOBS.forest_wolf);
    sim.castAbility('scatterbolt');
    sim.tick();
    expect(dist2d(near.pos, sim.player.pos)).toBeGreaterThan(18);
    expect(near.hp).toBe(near.maxHp);
    expect(dist2d(behind.pos, sim.player.pos)).toBeCloseTo(4, 0);
    expect(dist2d(far.pos, sim.player.pos)).toBeCloseTo(12, 0);
    expect(sim.player.cooldowns.get('scatterbolt')).toBeGreaterThan(14);
    expect(ABILITIES.scatterbolt.offGcd).toBe(true);
  });

  it('keeps practice dummies planted under the shared knockback guard', () => {
    const sim = hunter('beast_mastery');
    const dummy = addMob(sim, 0, 4);
    const start = { ...dummy.pos };
    sim.castAbility('scatterbolt');
    sim.tick();
    expect(dist2d(dummy.pos, start)).toBeLessThan(0.01);
  });

  it('never moves a crowd-control-immune boss', () => {
    const sim = hunter('beast_mastery');
    const boss = addMob(sim, 0, 4, MOBS.forest_wolf);
    boss.ccImmune = true;
    const start = { ...boss.pos };
    sim.castAbility('scatterbolt');
    sim.tick();
    expect(dist2d(boss.pos, start)).toBeLessThan(0.01);
  });
});

describe('aimed, hidden traps', () => {
  it('lands Frostjaw at the aimed point, clamped to range, for 1 min', () => {
    const sim = hunter('marksmanship');
    sim.castAbility('frostjaw_trap', sim.playerId, {
      x: sim.player.pos.x,
      z: sim.player.pos.z + 100,
    });
    const trap = traps(sim)[0];
    expect(trap.pos.z - sim.player.pos.z).toBeCloseTo(30, 0);
    expect(trap.remaining).toBe(60);
    expect(trap.hunterTrap?.concealed).toBe(true);
  });

  it('emits its placement and shimmer only on the concealed channel', () => {
    const sim = hunter('marksmanship');
    sim.drainEvents();
    sim.castAbility('frostjaw_trap', sim.playerId, {
      x: sim.player.pos.x,
      z: sim.player.pos.z + 10,
    });
    const events = [...sim.drainEvents(), ...ticks(sim, 80)];
    const trapFx = events.filter(
      (e): e is Extract<SimEvent, { type: 'spellfxAt' }> =>
        e.type === 'spellfxAt' && e.ability === 'frostjaw_trap',
    );
    expect(trapFx.length).toBeGreaterThan(1);
    for (const fx of trapFx) {
      expect(fx.concealedFromHostiles).toBe(true);
      expect(fx.sourceId).toBe(sim.playerId);
    }
  });

  it('keeps one Frostjaw and one Bear Trap down at the same time', () => {
    const sim = hunter('marksmanship');
    const at = (dz: number) => ({ x: sim.player.pos.x, z: sim.player.pos.z + dz });
    sim.castAbility('frostjaw_trap', sim.playerId, at(10));
    ticks(sim, 40); // clear the GCD
    sim.castAbility('bear_trap', sim.playerId, at(20));
    expect(
      traps(sim)
        .map((t) => t.abilityId)
        .sort(),
    ).toEqual(['bear_trap', 'frostjaw_trap']);
    sim.player.cooldowns.delete('frostjaw_trap');
    ticks(sim, 40);
    sim.castAbility('frostjaw_trap', sim.playerId, at(5));
    expect(traps(sim)).toHaveLength(2);
  });
});

describe('concealed trap event delivery', () => {
  const shimmer: SimEvent = {
    type: 'spellfxAt',
    x: 0,
    z: 0,
    school: 'frost',
    fx: 'nova',
    radius: 1.2,
    ability: 'frostjaw_trap',
    sourceId: 10,
    concealedFromHostiles: true,
  };
  const ownerOf = (): number | null => null;

  it('reaches the hunter and their group, never anyone else', () => {
    expect(shouldDeliverCombatEventToViewer(shimmer, 10, null, ownerOf)).toBe(true);
    expect(shouldDeliverCombatEventToViewer(shimmer, 11, { members: [10, 11] }, ownerOf)).toBe(
      true,
    );
    expect(shouldDeliverCombatEventToViewer(shimmer, 12, { members: [12] }, ownerOf)).toBe(false);
    expect(shouldDeliverCombatEventToViewer(shimmer, 12, null, ownerOf)).toBe(false);
  });

  it('leaves ordinary ground effects public', () => {
    const { concealedFromHostiles: _hidden, ...open } = shimmer as Extract<
      SimEvent,
      { type: 'spellfxAt' }
    >;
    expect(shouldDeliverCombatEventToViewer(open, 12, null, ownerOf)).toBe(true);
  });
});

describe('Bear Trap', () => {
  it('bleeds the first enemy for 1.5x Venom Barb and slows it by 50% for 4 sec', () => {
    const sim = hunter('marksmanship');
    const rap = sim.player.rangedPower;
    const spot = { x: sim.player.pos.x, z: sim.player.pos.z + 10 };
    sim.castAbility('bear_trap', sim.playerId, spot);
    ticks(sim, 20); // armed
    const victim = addMob(sim, 0, 14);
    victim.prevPos = { ...victim.pos };
    victim.pos = sim.groundPos(spot.x, spot.z);
    sim.tick();
    const bleed = victim.auras.find((a) => a.id === 'bear_trap_bleed');
    const slow = victim.auras.find((a) => a.id === 'bear_trap_slow');
    expect(bleed?.kind).toBe('dot');
    expect(bleed?.school).toBe('physical');
    expect(bleed?.duration).toBe(15);
    expect(bleed?.tickInterval).toBe(3);
    // Venom Barb top rank is 55 base + 15% Ranged AP over 15 sec; 1.5x that is
    // 82.5 (authored as 83) + 22.5% Ranged AP, over 5 ticks.
    expect(bleed?.value).toBe(Math.round((83 + rap * 0.225) / 5));
    expect(slow?.kind).toBe('slow');
    expect(slow?.value).toBe(0.5);
    expect(slow?.duration).toBe(4);
    expect(victim.auras.some((a) => a.kind === 'root')).toBe(false);
    expect(traps(sim)).toHaveLength(0);
  });
});
