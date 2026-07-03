// Direct unit tests for src/sim/combat/auto_attack.ts (C5). These drive the EXPORTED
// module functions against a real Sim's SimContext (sim.ctx) so the moved swing logic
// is exercised on its own, independent of the parity golden: the melee white-hit table
// (hit / forced crit / forced miss / forced dodge -> Overpower window), the ranged
// Auto Shot vs Wand branch, the updatePlayerAutoAttack ranged-vs-melee dispatch, the
// start/stopAutoAttack entries, and a determinism (seeded replay) assertion. Proves the
// extracted module is callable and the move preserved behavior.

import { describe, expect, it } from 'vitest';
import {
  meleeSwing,
  rangedSwing,
  startAutoAttack,
  stopAutoAttack,
  updatePlayerAutoAttack,
} from '../src/sim/combat/auto_attack';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;
type Ev = {
  type?: string;
  kind?: string;
  school?: string;
  ability?: string | null;
  sourceId?: number;
  targetId?: number;
  amount?: number;
  crit?: boolean;
};

function makeSim(
  cls: PlayerClass,
  level: number,
  seed = 7,
): { sim: AnySim; p: AnyEntity; meta: any } {
  const sim = new Sim({ seed, playerClass: cls, autoEquip: true }) as AnySim;
  sim.setPlayerLevel(level);
  const p = sim.player as AnyEntity;
  const meta = sim.players.get(p.id);
  p.resource = p.maxResource;
  return { sim, p, meta };
}

// An idle hostile mob, beefed, in front of the player at distance dz, targeted + faced.
function spawnDummy(sim: AnySim, p: AnyEntity, level = 5, dz = 2): AnyEntity {
  const mob = createMob(sim.nextId++, MOBS['forest_wolf'], level, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  }) as AnyEntity;
  mob.maxHp = 500000;
  mob.hp = 500000;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
  return mob;
}

// Capture the event stream. ctx.emit is late-bound, so swapping sim.emit is observed.
function capture(sim: AnySim): Ev[] {
  const events: Ev[] = [];
  const orig = (sim as any).emit.bind(sim);
  (sim as any).emit = (e: Ev) => {
    events.push(e);
    orig(e);
  };
  return events;
}

// Ranged/spell damage now lands when the projectile arrives (projectile_travel), not
// the tick it is fired. Advance the sim until the captured stream shows the awaited
// event (or a tick cap), so a deferred Auto Shot / Wand bolt has time to connect.
function landProjectiles(sim: AnySim, events: Ev[], pred: (e: Ev) => boolean, maxTicks = 40) {
  for (let i = 0; i < maxTicks && !events.some(pred); i++) sim.tick();
}

describe('auto_attack meleeSwing: the white-hit table', () => {
  it('a swing that passes the table connects and deals physical damage', () => {
    const { sim, p } = makeSim('warrior', 12);
    const mob = spawnDummy(sim, p, 1); // far below level -> floor miss chance
    const events = capture(sim);
    const hp0 = mob.hp;
    const connected = meleeSwing(sim.ctx, p, mob, 0, null, { cannotBeDodged: true });
    expect(connected).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === 'damage' && e.kind === 'hit' && e.school === 'physical' && e.sourceId === p.id,
      ),
    ).toBe(true);
    expect(mob.hp).toBeLessThan(hp0);
  });

  it('critChance 1 forces a crit (double damage) on a connected swing', () => {
    const { sim, p } = makeSim('warrior', 12);
    p.critChance = 1; // every hit crits (rng.chance(1) still draws, returns true)
    const mob = spawnDummy(sim, p, 1);
    const events = capture(sim);
    const connected = meleeSwing(sim.ctx, p, mob, 0, null, { cannotBeDodged: true });
    expect(connected).toBe(true);
    expect(events.some((e) => e.type === 'damage' && e.kind === 'hit' && e.crit === true)).toBe(
      true,
    );
  });

  it('a 100% blind forces a miss: returns false, emits a miss, deals no damage', () => {
    const { sim, p } = makeSim('warrior', 12);
    const mob = spawnDummy(sim, p, 1);
    p.auras.push({
      id: 'blind_x',
      name: 'Blinding Powder',
      kind: 'blind',
      remaining: 5,
      duration: 5,
      value: 1,
      sourceId: 999,
      school: 'physical',
    } as any);
    const events = capture(sim);
    const hp0 = mob.hp;
    const connected = meleeSwing(sim.ctx, p, mob, 0, null, { cannotBeDodged: true });
    expect(connected).toBe(false);
    expect(
      events.some((e) => e.type === 'damage' && e.kind === 'miss' && e.sourceId === p.id),
    ).toBe(true);
    expect(mob.hp).toBe(hp0);
  });

  it('a guaranteed dodge returns false, emits a dodge, and opens the Overpower window', () => {
    const { sim, p } = makeSim('warrior', 30); // high level -> floor miss chance (0.005)
    const targetPid = sim.addPlayer('rogue', 'Dodgy') as number;
    sim.setPlayerLevel(1, targetPid);
    const target = sim.entities.get(targetPid) as AnyEntity;
    target.dodgeChance = 1; // player target -> dodgeChance read straight from the field
    p.overpowerUntil = 0;
    const events = capture(sim);
    const connected = meleeSwing(sim.ctx, p, target, 0, null, {});
    expect(connected).toBe(false);
    expect(
      events.some((e) => e.type === 'damage' && e.kind === 'dodge' && e.sourceId === p.id),
    ).toBe(true);
    expect(p.overpowerUntil).toBeGreaterThan(0); // attacker.overpowerUntil = time + 5
  });
});

describe('auto_attack rangedSwing: Auto Shot vs Wand', () => {
  it('Auto Shot is a physical projectile (armor-mitigated)', () => {
    const { sim, p } = makeSim('hunter', 12);
    const mob = spawnDummy(sim, p, 8, 20);
    const events = capture(sim);
    rangedSwing(sim.ctx, p, mob, { min: 5, max: 9, speed: 2.3 });
    expect(events.some((e) => e.type === 'spellfx' && e.school === 'physical')).toBe(true);
    landProjectiles(sim, events, (e) => e.type === 'damage' && e.ability === 'Auto Shot');
    expect(events.some((e) => e.type === 'damage' && e.ability === 'Auto Shot')).toBe(true);
  });

  it('Wand is an arcane bolt (no dead zone, ignores armor)', () => {
    const { sim, p } = makeSim('mage', 12);
    const mob = spawnDummy(sim, p, 8, 15);
    const events = capture(sim);
    rangedSwing(sim.ctx, p, mob, { min: 3, max: 6, speed: 1.8, wand: true, school: 'arcane' });
    expect(events.some((e) => e.type === 'spellfx' && e.school === 'arcane')).toBe(true);
    landProjectiles(
      sim,
      events,
      (e) => e.type === 'damage' && e.ability === 'Wand' && e.school === 'arcane',
    );
    expect(
      events.some((e) => e.type === 'damage' && e.ability === 'Wand' && e.school === 'arcane'),
    ).toBe(true);
  });
});

describe('auto_attack updatePlayerAutoAttack: ranged-vs-melee dispatch', () => {
  it('a hunter at range takes the ranged branch (Auto Shot), arming ranged-speed cadence', () => {
    const { sim, p, meta } = makeSim('hunter', 12);
    const mob = spawnDummy(sim, p, 8, 20); // beyond the 8yd dead zone, within 35
    p.autoAttack = true;
    p.swingTimer = 0;
    const events = capture(sim);
    updatePlayerAutoAttack(sim.ctx, p, meta);
    expect(p.swingTimer).toBeGreaterThan(0); // reset to ranged.speed * swingIntervalMult (at fire time)
    landProjectiles(sim, events, (e) => e.type === 'damage' && e.ability === 'Auto Shot');
    expect(events.some((e) => e.type === 'damage' && e.ability === 'Auto Shot')).toBe(true);
  });

  it('a warrior in melee takes the melee branch, arming weapon-speed cadence', () => {
    const { sim, p, meta } = makeSim('warrior', 12);
    const mob = spawnDummy(sim, p, 5, 2); // within MELEE_RANGE
    p.autoAttack = true;
    p.swingTimer = 0;
    const events = capture(sim);
    updatePlayerAutoAttack(sim.ctx, p, meta);
    expect(
      events.some((e) => e.type === 'damage' && e.school === 'physical' && e.sourceId === p.id),
    ).toBe(true);
    expect(p.swingTimer).toBeCloseTo(p.weapon.speed * sim.swingIntervalMult(p));
  });

  it('the swing timer decrements every tick even while not auto-attacking', () => {
    const { sim, p, meta } = makeSim('warrior', 12);
    p.autoAttack = false;
    p.swingTimer = 1;
    updatePlayerAutoAttack(sim.ctx, p, meta);
    expect(p.swingTimer).toBeLessThan(1); // the decrement runs before the !autoAttack bail
  });
});

describe('auto_attack start/stopAutoAttack', () => {
  it('startAutoAttack rejects an invalid target and sets the flag for a valid one', () => {
    const { sim, p } = makeSim('warrior', 12);
    p.targetId = null;
    const events = capture(sim);
    startAutoAttack(sim.ctx, p.id);
    expect(p.autoAttack).toBe(false);
    expect(events.some((e) => e.type === 'error')).toBe(true); // "Invalid attack target."

    const mob = spawnDummy(sim, p, 5, 2);
    startAutoAttack(sim.ctx, p.id);
    expect(p.autoAttack).toBe(true);
    expect(mob.aggroTargetId).toBe(p.id); // idle mob pulled into combat (ctx.aggroMob)
  });

  it('stopAutoAttack clears the flag', () => {
    const { sim, p } = makeSim('warrior', 12);
    p.autoAttack = true;
    stopAutoAttack(sim.ctx, p.id);
    expect(p.autoAttack).toBe(false);
  });
});

describe('auto_attack determinism', () => {
  it('identical seeds produce an identical swing-damage sequence (seeded replay)', () => {
    const run = (): number[] => {
      const { sim, p, meta } = makeSim('warrior', 15, 4242);
      const mob = spawnDummy(sim, p, 10, 2);
      p.autoAttack = true;
      const dmg: number[] = [];
      const orig = (sim as any).emit.bind(sim);
      (sim as any).emit = (e: Ev) => {
        if (e.type === 'damage' && e.sourceId === p.id) dmg.push(e.amount ?? 0);
        orig(e);
      };
      for (let i = 0; i < 20; i++) {
        p.swingTimer = 0; // force a swing each call
        updatePlayerAutoAttack(sim.ctx, p, meta);
        mob.hp = mob.maxHp; // keep the target alive across the whole sequence
      }
      return dmg;
    };
    const a = run();
    const b = run();
    expect(a.length).toBeGreaterThan(5); // actually produced swings
    expect(a).toEqual(b); // byte-identical across the replay
  });
});
