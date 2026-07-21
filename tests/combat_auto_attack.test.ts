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
import { advancePendingProjectiles } from '../src/sim/projectile_travel';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type PlayerClass } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;
type Ev = {
  type?: string;
  kind?: string;
  school?: string;
  fx?: string;
  ability?: string | null;
  sourceId?: number;
  targetId?: number;
  amount?: number;
  crit?: boolean;
  attackAnimation?: 'ranged-shot';
  attackAnimationStarted?: true;
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

describe('auto_attack meleeSwing: landed talent procs resolve before retaliation', () => {
  const addImbue = (player: AnyEntity): void => {
    player.auras.push({
      id: 'test_imbue',
      name: 'Test Imbue',
      kind: 'imbue',
      remaining: 30,
      duration: 30,
      value: 0,
      sourceId: player.id,
      school: 'nature',
    });
  };

  const addThorns = (target: AnyEntity, value: number): void => {
    target.auras.push({
      id: 'test_thorns',
      name: 'Punishing Thorns',
      kind: 'thorns',
      remaining: 30,
      duration: 30,
      value,
      sourceId: target.id,
      school: 'nature',
    });
  };

  it('lets Imbued Lifeblood save its owner from otherwise lethal thorns', () => {
    const { sim, p } = makeSim('shaman', 20, 1756);
    expect(sim.applyTalents({ spec: null, rows: { 5: 'sha_r5_imbue_mastery' } })).toBe(true);
    const mob = spawnDummy(sim, p, 1);
    addImbue(p);
    addThorns(mob, 10);
    p.mainhandItemId = null;
    p.hp = 5;
    const events = capture(sim);
    const draws: number[] = [];
    sim.rng.setObserver((value: number) => draws.push(value));

    const connected = meleeSwing(sim.ctx, p, mob, 0, null, { cannotBeDodged: true });
    sim.rng.setObserver(null);

    const healIndex = events.findIndex(
      (event) => event.type === 'heal2' && event.ability === 'Imbued Lifeblood',
    );
    const thornsIndex = events.findIndex(
      (event) =>
        event.type === 'damage' &&
        event.sourceId === mob.id &&
        event.targetId === p.id &&
        event.ability === 'Punishing Thorns',
    );
    expect(connected).toBe(true);
    expect(healIndex).toBeGreaterThan(-1);
    expect(thornsIndex).toBeGreaterThan(healIndex);
    expect(p.dead).toBe(false);
    expect(p.hp).toBeGreaterThan(0);
    // Hit table, weapon roll, swing crit, then Lifeblood's normal heal-crit roll.
    expect(draws).toHaveLength(4);
  });

  it.each([
    {
      name: 'Oathwheel cooldown refund',
      cls: 'paladin' as const,
      row: { 14: 'pal_r14_righteous_cause' },
      prepare: (player: AnyEntity) => player.cooldowns.set('judgement', 5),
      read: (player: AnyEntity) => player.cooldowns.get('judgement'),
      expected: 4.5,
    },
    {
      name: 'Imbued Tempo cooldown refund',
      cls: 'shaman' as const,
      row: { 14: 'sha_r14_weapon_fury' },
      prepare: (player: AnyEntity) => player.cooldowns.set('earth_shock', 5),
      read: (player: AnyEntity) => player.cooldowns.get('earth_shock'),
      expected: 4.5,
    },
  ])('applies $name before thorns without changing the shared RNG trace', (testCase) => {
    const run = (active: boolean) => {
      const { sim, p } = makeSim(testCase.cls, 20, 26014);
      if (active) {
        expect(sim.applyTalents({ spec: null, rows: testCase.row })).toBe(true);
      }
      const mob = spawnDummy(sim, p, 1);
      addImbue(p);
      addThorns(mob, 1);
      p.mainhandItemId = null;
      testCase.prepare(p);
      let valueAtRetaliation: unknown;
      const dealDamage = sim.ctx.dealDamage;
      sim.ctx.dealDamage = ((source: Entity | null, target: Entity, ...args: unknown[]) => {
        if (source?.id === mob.id && target.id === p.id && args[3] === 'Punishing Thorns') {
          valueAtRetaliation = testCase.read(p);
        }
        return (dealDamage as (...callArgs: unknown[]) => unknown)(source, target, ...args);
      }) as typeof sim.ctx.dealDamage;
      const draws: number[] = [];
      sim.rng.setObserver((value: number) => draws.push(value));

      const connected = meleeSwing(sim.ctx, p, mob, 0, null, { cannotBeDodged: true });
      sim.rng.setObserver(null);

      expect(connected).toBe(true);
      return { draws, valueAtRetaliation };
    };

    const baseline = run(false);
    const active = run(true);
    expect(active.valueAtRetaliation).toBe(testCase.expected);
    expect(active.draws).toEqual(baseline.draws);
    expect(active.draws).toHaveLength(3);
  });

  it('Venom Dividend rolls its chance before thorns and pays only on success', () => {
    // Balance pass: the flat 5-per-swing became the Combat Potency shape (20%
    // chance for 10 energy), so the proc now draws exactly one rng roll per
    // poisoned swing; the roll resolves before the thorns retaliation.
    const run = (active: boolean) => {
      const { sim, p } = makeSim('rogue', 20, 26014);
      if (active) {
        expect(sim.applyTalents({ spec: null, rows: { 14: 'rog_r14_deadly_brew' } })).toBe(true);
      }
      const mob = spawnDummy(sim, p, 1);
      addImbue(p);
      addThorns(mob, 1);
      p.mainhandItemId = null;
      p.resource = 0;
      let valueAtRetaliation: unknown;
      const dealDamage = sim.ctx.dealDamage;
      sim.ctx.dealDamage = ((source: Entity | null, target: Entity, ...args: unknown[]) => {
        if (source?.id === mob.id && target.id === p.id && args[3] === 'Punishing Thorns') {
          valueAtRetaliation = p.resource;
        }
        return (dealDamage as (...callArgs: unknown[]) => unknown)(source, target, ...args);
      }) as typeof sim.ctx.dealDamage;
      const draws: number[] = [];
      sim.rng.setObserver((value: number) => draws.push(value));
      const connected = meleeSwing(sim.ctx, p, mob, 0, null, { cannotBeDodged: true });
      sim.rng.setObserver(null);
      expect(connected).toBe(true);
      return { draws, valueAtRetaliation, resource: p.resource };
    };

    const baseline = run(false);
    const active = run(true);
    expect(active.draws).toHaveLength(baseline.draws.length + 1); // the chance roll
    expect(active.valueAtRetaliation).toBe(active.resource); // resolved before thorns
    expect([0, 10]).toContain(active.resource); // pays 10 or nothing, never 5
  });
});

describe('auto_attack rangedSwing: Auto Shot vs Wand', () => {
  it('Auto Shot is a physical projectile (armor-mitigated)', () => {
    const { sim, p } = makeSim('hunter', 12);
    const mob = spawnDummy(sim, p, 8, 20);
    const events = capture(sim);
    rangedSwing(sim.ctx, p, mob, { min: 5, max: 9, speed: 2.3 });
    expect(
      events.some(
        (e) =>
          e.type === 'spellfx' && e.school === 'physical' && e.attackAnimation === 'ranged-shot',
      ),
    ).toBe(true);
    landProjectiles(sim, events, (e) => e.type === 'damage' && e.ability === 'Auto Shot');
    expect(
      events.some(
        (e) =>
          e.type === 'damage' && e.ability === 'Auto Shot' && e.attackAnimationStarted === true,
      ),
    ).toBe(true);
  });

  it('Auto Shot launches on the swing tick without adding a universal draw delay', () => {
    const { sim, p } = makeSim('hunter', 12);
    const mob = spawnDummy(sim, p, 8, 20);
    void mob;
    const events = capture(sim);
    rangedSwing(sim.ctx, p, mob, { min: 5, max: 9, speed: 2.3 });
    expect(events.some((e) => e.type === 'spellfx' && e.fx === 'projectile')).toBe(true);
    expect(events.some((e) => e.type === 'spellfx' && e.fx === 'windup')).toBe(false);
    // Damage still lands on ARRIVAL, never on the swing tick.
    expect(events.some((e) => e.type === 'damage' && e.ability === 'Auto Shot')).toBe(false);
    landProjectiles(sim, events, (e) => e.type === 'damage' && e.ability === 'Auto Shot');
    expect(events.some((e) => e.type === 'damage' && e.ability === 'Auto Shot')).toBe(true);
  });

  it('Wand keeps its instant tracer: projectile fx on the swing tick, no windup', () => {
    const { sim, p } = makeSim('mage', 12);
    const mob = spawnDummy(sim, p, 8, 15);
    const events = capture(sim);
    rangedSwing(sim.ctx, p, mob, { min: 3, max: 6, speed: 1.8, wand: true, school: 'arcane' });
    expect(events.some((e) => e.type === 'spellfx' && e.fx === 'projectile')).toBe(true);
    expect(events.some((e) => e.type === 'spellfx' && e.fx === 'windup')).toBe(false);
    expect(events.some((e) => e.attackAnimation !== undefined)).toBe(false);
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
    expect(p.swingTimer).toBeGreaterThan(0); // reset to the weapon's speed * swingIntervalMult (at fire time)
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

  it('a ranged attacker whose swing timer is still up does NOT fire (once per weapon interval, not per tick)', () => {
    // Regression (restored from the pre-revert payload): the dual-wield-aware
    // guard sits AFTER the ranged branch, so a ranged attacker needs its own
    // swing-timer gate before it or it re-enters and fires on all 20 ticks per
    // second.
    const { sim, p, meta } = makeSim('hunter', 12);
    spawnDummy(sim, p, 8, 20);
    p.autoAttack = true;
    p.swingTimer = 0;
    const shots = (evs: Ev[]): Ev[] =>
      evs.filter((e) => e.type === 'spellfx' && e.fx === 'projectile' && e.sourceId === p.id);
    // First tick: one legitimate shot fired, and the timer is armed to the interval.
    const first = capture(sim);
    updatePlayerAutoAttack(sim.ctx, p, meta);
    expect(shots(first)).toHaveLength(1);
    expect(p.swingTimer).toBeGreaterThan(0);
    // Next 10 ticks (0.5s, still well inside a ~2.3s interval): no further shots.
    const rest = capture(sim);
    for (let i = 0; i < 10; i++) updatePlayerAutoAttack(sim.ctx, p, meta);
    expect(shots(rest)).toHaveLength(0);
  });

  it('the swing timer decrements every tick even while not auto-attacking', () => {
    const { sim, p, meta } = makeSim('warrior', 12);
    p.autoAttack = false;
    p.swingTimer = 1;
    updatePlayerAutoAttack(sim.ctx, p, meta);
    expect(p.swingTimer).toBeLessThan(1); // the decrement runs before the !autoAttack bail
  });
});

describe('auto_attack Auto Shot scales off the equipped weapon (ranged DPS)', () => {
  // A hunter has no separate ranged slot, so Auto Shot fires with the equipped
  // weapon: its cadence follows the weapon's speed (not the class ranged speed),
  // and its damage follows the weapon's damage range (its DPS), on top of the
  // agility-driven ranged attack power.
  it('arms the cadence from the equipped weapon speed, not the class ranged speed', () => {
    const { sim, p, meta } = makeSim('hunter', 20);
    spawnDummy(sim, p, 20, 20); // beyond the 8yd dead zone, within 35
    // A deliberately slow bow, distinct from the class ranged speed (2.3).
    p.weapon = { min: 40, max: 60, speed: 4 };
    p.rangedHaste = 0;
    p.autoAttack = true;
    p.swingTimer = 0;
    updatePlayerAutoAttack(sim.ctx, p, meta);
    expect(p.swingTimer).toBeCloseTo(4 * sim.swingIntervalMult(p));
    // and NOT the old class-fixed 2.3 cadence
    expect(p.swingTimer).not.toBeCloseTo(2.3 * sim.swingIntervalMult(p));
  });

  it('a heavier-hitting weapon yields a bigger Auto Shot than a weak one', () => {
    const shoot = (weaponMin: number, weaponMax: number): number => {
      const { sim, p, meta } = makeSim('hunter', 20, 3);
      const mob = spawnDummy(sim, p, 1, 20); // far below level -> floored miss chance
      mob.armor = 0; // isolate the weapon-damage signal from armor mitigation
      p.critChance = 0; // no crit variance
      p.weapon = { min: weaponMin, max: weaponMax, speed: 2 };
      p.autoAttack = true;
      const events = capture(sim);
      let best = 0;
      // fire several shots so at least one lands past the floored miss chance
      for (let s = 0; s < 12; s++) {
        p.swingTimer = 0;
        updatePlayerAutoAttack(sim.ctx, p, meta);
        landProjectiles(sim, events, (e) => e.type === 'damage' && e.ability === 'Auto Shot');
      }
      for (const e of events) {
        if (e.type === 'damage' && e.ability === 'Auto Shot' && e.kind === 'hit') {
          best = Math.max(best, e.amount ?? 0);
        }
      }
      return best;
    };
    const weak = shoot(2, 4);
    const strong = shoot(300, 320);
    expect(weak).toBeGreaterThan(0);
    // The heavy weapon hits far harder. (Both shots share the same agility-driven
    // ranged AP floor, and only part of the weapon roll carries to a shot, so the
    // ratio is well below the raw weapon-damage ratio, but still large.)
    expect(strong).toBeGreaterThan(weak * 3);
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

  it('silently no-ops on a target that just died (no spurious "Invalid attack target." toast)', () => {
    const { sim, p } = makeSim('warrior', 12);
    const mob = spawnDummy(sim, p, 5, 2);
    mob.dead = true; // the engaging spell landed the killing blow this same tick
    p.targetId = mob.id;
    const events = capture(sim);
    startAutoAttack(sim.ctx, p.id);
    expect(p.autoAttack).toBe(false); // no engage on a corpse
    expect(events.some((e) => e.type === 'error')).toBe(false); // and NO error toast
  });

  it('stopAutoAttack clears the flag', () => {
    const { sim, p } = makeSim('warrior', 12);
    p.autoAttack = true;
    stopAutoAttack(sim.ctx, p.id);
    expect(p.autoAttack).toBe(false);
  });
});

describe('auto_attack startAutoAttack: ranged engage must not pre-aggro (issue #1)', () => {
  // Casting a damaging spell engages the wand / auto-shot via the "Attack on Ability
  // Use" QoL (default on). That must NOT aggro a distant mob the instant the cast
  // starts: ranged threat comes from the shot LANDING (rangedSwing schedules a
  // projectile), exactly like the spell it accompanies. Only melee, where a swing
  // lands at once, seeds aggro on engage.
  it('a wand caster engaging at ranged distance does NOT aggro an idle mob', () => {
    const { sim, p } = makeSim('mage', 12);
    const mob = spawnDummy(sim, p, 12, 25); // 25yd: inside the 30yd wand range, beyond melee
    startAutoAttack(sim.ctx, p.id);
    expect(p.autoAttack).toBe(true); // auto-attack still engages
    expect(mob.aiState).toBe('idle'); // but the mob is NOT pulled at engage time
    expect(mob.aggroTargetId).toBe(null);
  });

  it('melee engage still seeds aggro immediately (unchanged behavior)', () => {
    const { sim, p } = makeSim('warrior', 12);
    const mob = spawnDummy(sim, p, 12, 2); // 2yd: melee range, a swing lands at once
    startAutoAttack(sim.ctx, p.id);
    expect(p.autoAttack).toBe(true);
    expect(mob.aggroTargetId).toBe(p.id);
  });

  it('a wand caster still aggros the mob when the shot actually lands', () => {
    const { sim, p } = makeSim('mage', 12);
    const mob = spawnDummy(sim, p, 12, 25);
    const events = capture(sim);
    startAutoAttack(sim.ctx, p.id);
    expect(mob.aggroTargetId).toBe(null); // not at engage
    landProjectiles(sim, events, (e) => e.type === 'damage' && e.sourceId === p.id, 60);
    expect(mob.aggroTargetId).toBe(p.id); // aggroed on impact, the classic-correct moment
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

describe('startAutoAttack while casting (the aggro-before-damage bug)', () => {
  it('a mid-cast Attack press queues the swing but does NOT aggro the untouched target', () => {
    const { sim, p } = makeSim('priest', 10);
    const mob = spawnDummy(sim, p, 5, 2);
    sim.castAbility('smite', p.id); // timed cast in progress
    expect(p.castingAbility).toBe('smite');
    startAutoAttack(sim.ctx, p.id);
    // the toggle still arms white swings for after the cast...
    expect(p.autoAttack).toBe(true);
    // ...but no damage has landed, so the idle mob must not come running
    expect(mob.aiState).toBe('idle');
    expect(mob.aggroTargetId).toBe(null);
  });

  it('outside a cast the toggle still pulls the idle target at once (unchanged)', () => {
    const { sim, p } = makeSim('warrior', 10);
    const mob = spawnDummy(sim, p, 5, 2);
    startAutoAttack(sim.ctx, p.id);
    expect(mob.aiState).not.toBe('idle');
    expect(p.inCombat).toBe(true);
  });
});

// Pins RANGED_WEAPON_COEFF (0.6) at the DAMAGE level, not just profile selection:
// a fixed-roll weapon (min == max) and a hand-set rangedPower make every landed
// hit exact, so dropping the coefficient, or applying it to wands, changes the
// number and fails here. Misses (amount 0) and crits (x2) are asserted around it.
describe('rangedSwing damage: the 0.6 weapon coefficient is Auto Shot only', () => {
  it('a hunter shot lands at 0.6 x weapon roll + the AP term', () => {
    const { sim, p } = makeSim('hunter', 20);
    const mob = spawnDummy(sim, p, 5, 8);
    mob.stats = { ...mob.stats, armor: 0 }; // no armor mitigation: keeps the hit exact
    p.rangedPower = 140; // AP term: (140 / 14) x speed 2 = 20
    const events = capture(sim);
    for (let i = 0; i < 60; i++) rangedSwing(sim.ctx, p, mob, { min: 100, max: 100, speed: 2 });
    for (let i = 0; i < 400 && sim.ctx.pendingProjectiles.length > 0; i++)
      advancePendingProjectiles(sim.ctx);
    const hits = events.filter(
      (e) => e.type === 'damage' && e.ability === 'Auto Shot' && e.kind === 'hit',
    );
    expect(hits.length).toBeGreaterThan(10);
    expect(hits.some((h) => !h.crit)).toBe(true);
    // 0.6 x 100 + 20 = 80 (would be 120 with the coefficient dropped)
    for (const h of hits) expect(h.amount).toBe(h.crit ? 160 : 80);
  });

  it('a wand bolt lands at the FULL weapon roll (no coefficient)', () => {
    const { sim, p } = makeSim('mage', 20);
    const mob = spawnDummy(sim, p, 5, 8);
    p.rangedPower = 140; // same AP term as above, isolating the coefficient arm
    const events = capture(sim);
    for (let i = 0; i < 60; i++)
      rangedSwing(sim.ctx, p, mob, { min: 100, max: 100, speed: 2, wand: true, school: 'arcane' });
    for (let i = 0; i < 400 && sim.ctx.pendingProjectiles.length > 0; i++)
      advancePendingProjectiles(sim.ctx);
    const hits = events.filter(
      (e) => e.type === 'damage' && e.ability === 'Wand' && e.kind === 'hit',
    );
    expect(hits.length).toBeGreaterThan(10);
    expect(hits.some((h) => !h.crit)).toBe(true);
    // 100 + 20 = 120 (would be 80 if the 0.6 leaked onto wands)
    for (const h of hits) expect(h.amount).toBe(h.crit ? 240 : 120);
  });
});

// A hunter's Auto Shot strikes with the equipped mainhand, so an on-hit weapon proc
// (Thronebane's Chain Arc, trigger 'weaponHit') must fire from a ranged shot too, not
// just a melee swing. A caster's wand bolt does NOT swing the mainhand, so it never
// rolls the mainhand's proc.
describe('rangedSwing fires weaponHit procs (Thronebane on a hunter Auto Shot)', () => {
  const chainArcs = (events: Ev[]) =>
    events.filter((e) => e.type === 'damage' && e.ability === 'Chain Arc' && e.school === 'nature');

  it('a hunter wielding Thronebane procs Chain Arc off Auto Shot', () => {
    const { sim, p } = makeSim('hunter', 20);
    const mob = spawnDummy(sim, p, 1, 20); // far below level -> floored miss chance
    mob.stats = { ...mob.stats, armor: 0 };
    p.mainhandItemId = 'kingsbane_last_oath'; // Thronebane: 10% weaponHit Chain Arc
    p.critChance = 0;
    const events = capture(sim);
    for (let i = 0; i < 200; i++) rangedSwing(sim.ctx, p, mob, { min: 50, max: 50, speed: 2.8 });
    for (let i = 0; i < 800 && sim.ctx.pendingProjectiles.length > 0; i++)
      advancePendingProjectiles(sim.ctx);
    // over ~200 landed shots at a 10% proc, the seeded run lands multiple arcs
    expect(chainArcs(events).length).toBeGreaterThan(0);
    expect(chainArcs(events)[0].amount).toBe(42); // Chain Arc primary damage
  });

  it('a wand caster wielding Thronebane never rolls the mainhand proc off a bolt', () => {
    const { sim, p } = makeSim('mage', 20);
    const mob = spawnDummy(sim, p, 1, 15);
    p.mainhandItemId = 'kingsbane_last_oath';
    const events = capture(sim);
    for (let i = 0; i < 200; i++)
      rangedSwing(sim.ctx, p, mob, { min: 50, max: 50, speed: 1.8, wand: true, school: 'arcane' });
    for (let i = 0; i < 800 && sim.ctx.pendingProjectiles.length > 0; i++)
      advancePendingProjectiles(sim.ctx);
    expect(chainArcs(events).length).toBe(0);
  });
});
