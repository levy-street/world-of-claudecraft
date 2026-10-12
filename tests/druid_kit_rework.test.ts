import { describe, expect, it } from 'vitest';
import { launchFallCredit } from '../src/sim/combat/knockback_launch';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { emptyModifiers } from '../src/sim/content/talents';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { CrowdControlDrCategory, Entity, SimEvent, WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { abilityDisplayDescription } from '../src/ui/ability_description';

// The druid kit pass: Slumber diminishing returns, Bloodrift doubled (pinned in
// tests/bloodrift_combo_scaling.test.ts and tests/rupture_rip_tooltip.test.ts),
// Flense's tooltip naming its whole bleed, Dash usable from any form, and the
// airborne Typhoon throw whose fall damage credits the druid
// (src/sim/combat/knockback_launch.ts).

const SEED = 7;
// No camps, NPCs or ground objects: every terrain field stays BUILTIN_WORLD's,
// and nothing wanders into the throw line.
const QUIET_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
// Open, level, contested ground (tests/world_pvp.test.ts OPEN_GROUND).
const OPEN = { x: 60, z: 700 };
const NO_SCALING = { spellPower: 0, healPower: 0, rangedPower: 0, attackPower: 0 };

type Internals = {
  rebucket(e: Entity): void;
  addEntity(e: Entity): void;
  time: number;
  diminishedCrowdControlDuration(
    source: Entity,
    target: Entity,
    category: CrowdControlDrCategory,
    duration: number,
  ): number | null;
};
const internals = (sim: Sim) => sim as unknown as Internals;

function place(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos = { x, y: groundHeight(x, z, SEED), z };
  e.prevPos = { ...e.pos };
  e.fallStartY = e.pos.y;
  e.onGround = true;
  internals(sim).rebucket(e);
}

/** A level-20 druid holding Typhoon (the row-11 grant) and a level-20 warrior,
 *  both flagged for world PvP on contested ground, the warrior 3 yd east. */
function pvpPair(): { sim: Sim; druid: Entity; victim: Entity } {
  const sim = new Sim({ seed: SEED, playerClass: 'druid', noPlayer: true, world: QUIET_WORLD });
  sim.resetDay = '2026-07-08';
  const d = sim.addPlayer('druid', 'Gale', { autoEquip: true });
  const v = sim.addPlayer('warrior', 'Victim', { autoEquip: true });
  for (const pid of [d, v]) sim.setPlayerLevel(20, pid);
  expect(sim.selectTalentRow(11, 'dru_r11_innervate', d)).toBe(true);
  // Past the flag toggle cooldown, so both flags go up.
  internals(sim).time += 400;
  sim.tick();
  sim.setWorldPvpFlag(true, d);
  sim.setWorldPvpFlag(true, v);
  const druid = sim.entities.get(d)!;
  const victim = sim.entities.get(v)!;
  place(sim, druid, OPEN.x - 3, OPEN.z);
  place(sim, victim, OPEN.x, OPEN.z);
  druid.facing = Math.PI / 2;
  druid.resource = druid.maxResource;
  victim.hp = victim.maxHp;
  expect(sim.ctx.isHostileTo(druid, victim)).toBe(true);
  return { sim, druid, victim };
}

describe('Slumber diminishing returns', () => {
  it('walks full, half, quarter, immune against a player, in its own category', () => {
    const { sim, druid, victim } = pvpPair();
    const dr = (category: CrowdControlDrCategory) =>
      internals(sim).diminishedCrowdControlDuration(druid, victim, category, 8);
    expect([dr('sleep'), dr('sleep'), dr('sleep'), dr('sleep')]).toEqual([8, 4, 2, null]);
    // A Sap after three Slumbers is still at full duration: separate buckets.
    expect(dr('incapacitate')).toBe(8);
  });

  it('a second cast on the same player lands at half duration', () => {
    const { sim, druid, victim } = pvpPair();
    const castSleep = () => {
      druid.resource = druid.maxResource;
      druid.gcdRemaining = 0;
      sim.targetEntity(victim.id, druid.id);
      sim.castAbility('hibernate', druid.id);
      for (let i = 0; i < 20 * 2; i++) sim.tick();
      return victim.auras.find((a) => a.id === 'hibernate_incap');
    };
    expect(castSleep()?.duration).toBe(8);
    victim.auras = victim.auras.filter((a) => a.id !== 'hibernate_incap');
    expect(castSleep()?.duration).toBe(4);
  });
});

describe('Flense tooltip', () => {
  it('names the whole bleed it really deals, tick rounding included', () => {
    expect(ABILITIES.rake.description).toContain('$o bleeding damage');
    const text = (level: number) => {
      const rake = abilitiesKnownAt('druid', level, emptyModifiers()).find(
        (known) => known.def.id === 'rake',
      );
      if (!rake) throw new Error('missing rake');
      return abilityDisplayDescription(rake, '', NO_SCALING);
    };
    // Rank 1: 30 over 6 ticks of 5. Rank 2: 99 authored lands as 6 ticks of
    // 17 (effect_dispatch.ts rounds total / ticks), so 102 is what it deals.
    expect(text(10)).toContain('30 bleeding damage');
    expect(text(20)).toContain('102 bleeding damage');
  });
});

describe('Dash from any form', () => {
  it('shifts a Bruin Form druid into Cat Form, sprints, and spends no GCD', () => {
    const { sim, druid } = pvpPair();
    sim.castAbility('bear_form', druid.id);
    for (let i = 0; i < 40; i++) sim.tick();
    expect(druid.auras.some((a) => a.kind === 'form_bear')).toBe(true);
    druid.gcdRemaining = 0;
    sim.castAbility('dash', druid.id);
    sim.tick();
    expect(druid.auras.some((a) => a.kind === 'form_cat')).toBe(true);
    expect(druid.auras.some((a) => a.kind === 'form_bear')).toBe(false);
    expect(druid.auras.find((a) => a.id === 'dash')?.value).toBeCloseTo(1.5);
    expect(druid.gcdRemaining).toBe(0);
  });

  it('works from caster form too', () => {
    const { sim, druid } = pvpPair();
    sim.castAbility('dash', druid.id);
    sim.tick();
    expect(druid.auras.some((a) => a.kind === 'form_cat')).toBe(true);
    expect(druid.auras.some((a) => a.id === 'dash')).toBe(true);
  });
});

describe('Typhoon throws enemy players through the air', () => {
  it('launches the victim on a straight 15 yd hop over level ground', () => {
    const { sim, druid, victim } = pvpPair();
    const start = { ...victim.pos };
    sim.castAbility('typhoon', druid.id);
    sim.tick();
    expect(victim.onGround).toBe(false);
    expect(victim.launchedBy?.sourceId).toBe(druid.id);
    let apex = victim.pos.y - start.y;
    let ticks = 0;
    while (!victim.onGround && ticks++ < 40) {
      sim.tick();
      apex = Math.max(apex, victim.pos.y - start.y);
      // A straight line due east: nothing drifts sideways mid-flight.
      expect(Math.abs(victim.pos.z - start.z)).toBeLessThan(1e-6);
    }
    expect(victim.onGround).toBe(true);
    sim.tick(); // one settled step ends the throw
    expect(victim.launchedBy).toBeUndefined();
    expect(victim.pos.x - start.x).toBeGreaterThan(14);
    expect(victim.pos.x - start.x).toBeLessThan(17);
    // "Slightly up": the Trailbreak hop crests about a yard.
    expect(apex).toBeGreaterThan(0.6);
    expect(apex).toBeLessThan(1.5);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('cannot be steered back while the throw is live', () => {
    const { sim, druid, victim } = pvpPair();
    sim.castAbility('typhoon', druid.id);
    sim.tick();
    // Victim holds "run back toward the druid" for the whole flight.
    victim.facing = -Math.PI / 2;
    const meta = (
      sim as unknown as { players: Map<number, { moveInput: { forward: boolean } }> }
    ).players.get(victim.id)!;
    meta.moveInput.forward = true;
    const vx = victim.vx;
    for (let i = 0; i < 5 && !victim.onGround; i++) {
      sim.tick();
      expect(victim.vx).toBeCloseTo(vx, 9);
    }
  });

  it('a feared player takes the grounded shove, never a frozen launch', () => {
    const { sim, druid, victim } = pvpPair();
    victim.auras.push({
      id: 'fear_incap',
      name: 'Fear',
      kind: 'incapacitate',
      remaining: 8,
      duration: 8,
      value: 0,
      sourceId: druid.id,
      school: 'shadow',
    });
    const before = { ...victim.pos };
    sim.castAbility('typhoon', druid.id);
    sim.tick();
    expect(victim.launchedBy).toBeUndefined();
    expect(victim.onGround).toBe(true);
    expect(victim.vy).toBe(0);
    expect(Math.hypot(victim.pos.x - before.x, victim.pos.z - before.z)).toBeGreaterThan(10);
  });

  it('the throw ends once the victim stands settled, and on death', () => {
    const { sim, druid, victim } = pvpPair();
    sim.castAbility('typhoon', druid.id);
    for (let i = 0; i < 40 && !victim.onGround; i++) sim.tick();
    expect(victim.onGround).toBe(true);
    sim.tick();
    expect(victim.launchedBy).toBeUndefined();
    // A later jump is steerable again, and a later fall is the victim's own.
    victim.launchedBy = { sourceId: druid.id, ticksLeft: 200 };
    sim.ctx.dealDamage(druid, victim, victim.hp + 1000, false, 'physical', 'Test', 'hit');
    expect(victim.dead).toBe(true);
    expect(victim.launchedBy).toBeUndefined();
  });

  it('a mob takes the grounded 15 yd shove instead', () => {
    const { sim, druid } = pvpPair();
    const mob = createMob(91_000, MOBS.forest_wolf, 20, { x: 0, y: 0, z: 0 });
    mob.hostile = true;
    internals(sim).addEntity(mob);
    place(sim, mob, OPEN.x, OPEN.z + 1);
    const before = { ...mob.pos };
    sim.castAbility('typhoon', druid.id);
    sim.tick();
    expect(mob.onGround).toBe(true);
    expect(mob.launchedBy).toBeUndefined();
    expect(Math.hypot(mob.pos.x - before.x, mob.pos.z - before.z)).toBeGreaterThan(10);
  });
});

describe('a fall off a Typhoon throw credits the druid', () => {
  /** Drop the victim from `height` yards as if still riding a live throw. */
  function dropFrom(sim: Sim, victim: Entity, height: number, launchedBy?: Entity): SimEvent[] {
    victim.pos.y += height;
    victim.prevPos = { ...victim.pos };
    victim.onGround = false;
    victim.jumping = true;
    victim.vx = 0;
    victim.vy = 0;
    victim.vz = 0;
    victim.fallStartY = victim.pos.y;
    if (launchedBy) victim.launchedBy = { sourceId: launchedBy.id, ticksLeft: 200 };
    const seen: SimEvent[] = [];
    for (let i = 0; i < 20 * 6 && !victim.onGround; i++) seen.push(...sim.tick());
    return seen;
  }

  it('deals the fall damage as the druid, and a fatal fall is their kill', () => {
    const { sim, druid, victim } = pvpPair();
    const events = dropFrom(sim, victim, 60, druid);
    const fall = events.find(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.targetId === victim.id && e.ability === 'Falling',
    );
    expect(fall?.sourceId).toBe(druid.id);
    expect(victim.dead).toBe(true);
    const death = events.find(
      (e): e is Extract<SimEvent, { type: 'playerDeath' }> => e.type === 'playerDeath',
    );
    expect(death?.killerId).toBe(druid.id);
    expect(death?.killerAbility).toBe('Falling');
    expect(events.some((e) => e.type === 'honor' && e.pid === druid.id)).toBe(true);
  });

  it('in a duel, a lethal thrown fall ends the duel like any other blow', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'druid', noPlayer: true, world: QUIET_WORLD });
    const d = sim.addPlayer('druid', 'Gale');
    const v = sim.addPlayer('warrior', 'Victim');
    sim.duels.set(d, { a: d, b: v, state: 'active', timer: 0 });
    sim.duels.set(v, sim.duels.get(d)!);
    const druid = sim.entities.get(d)!;
    const victim = sim.entities.get(v)!;
    place(sim, druid, OPEN.x - 3, OPEN.z);
    place(sim, victim, OPEN.x, OPEN.z);
    const events = dropFrom(sim, victim, 60, druid);
    expect(victim.dead).toBe(false);
    expect(victim.hp).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'playerDeath')).toBe(false);
    expect(sim.duels.get(v)?.state === 'active').toBe(false);
  });

  it('an ordinary fall stays sourceless', () => {
    const { sim, druid, victim } = pvpPair();
    const events = dropFrom(sim, victim, 60);
    const death = events.find(
      (e): e is Extract<SimEvent, { type: 'playerDeath' }> => e.type === 'playerDeath',
    );
    expect(victim.dead).toBe(true);
    expect(death?.killerId).toBeUndefined();
    expect(events.some((e) => e.type === 'honor' && e.pid === druid.id)).toBe(false);
  });

  it('credits nobody once the window lapses, the druid is gone, or they are no longer hostile', () => {
    const { sim, druid, victim } = pvpPair();
    victim.launchedBy = { sourceId: druid.id, ticksLeft: 200 };
    expect(launchFallCredit(sim.ctx, victim)).toBe(druid);
    victim.launchedBy = { sourceId: druid.id, ticksLeft: 0 };
    expect(launchFallCredit(sim.ctx, victim)).toBeNull();
    victim.launchedBy = { sourceId: 999_999, ticksLeft: 200 };
    expect(launchFallCredit(sim.ctx, victim)).toBeNull();
    victim.launchedBy = { sourceId: druid.id, ticksLeft: 200 };
    druid.dead = true;
    expect(launchFallCredit(sim.ctx, victim)).toBeNull();
  });
});
