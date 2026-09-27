import { afterEach, describe, expect, it, vi } from 'vitest';
import { meleeSwing } from '../src/sim/combat/auto_attack';
import { grantDawnsWrath } from '../src/sim/combat/paladin_dawns_wrath';
import { ABILITIES, MOBS } from '../src/sim/data';
import * as tuning from '../src/sim/dawnreaver_damage';
import { createMob } from '../src/sim/entity';
import { activateDivineAscension, grantDevotion } from '../src/sim/paladin_devotion';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

type Damage = Extract<SimEvent, { type: 'damage' }>;
type Options = {
  spec?: 'retribution' | 'holy' | 'protection';
  power?: number;
  targets?: number;
  ascended?: boolean;
  echo?: boolean;
  wrath?: boolean;
  set?: boolean;
  seeded?: boolean;
};

function rig(options: Options = {}) {
  const sim = new Sim({ seed: 2701, playerClass: 'paladin', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'retribution',
      rows: options.echo ? { 20: 'pal_r20_dawn_echo' } : {},
    }),
  ).toBe(true);
  if (options.set) {
    for (const slot of ['helmet', 'shoulder', 'chest', 'gloves', 'legs']) {
      sim.addItem(`zealfire_${slot}`, 1);
      sim.equipItem(`zealfire_${slot}`);
    }
  }
  if (options.power !== undefined) {
    const power = options.power;
    sim.player.attackPower = power;
    sim.player.spellPower = power;
    sim.player.weapon = { min: 40 + power / 4, max: 40 + power / 4, speed: 3.5 };
  }
  sim.player.resource = sim.player.maxResource;
  sim.player.autoAttack = false;
  // Identical, non-critical hit rolls isolate the complete-hit multiplier.
  if (!options.seeded) {
    sim.rng.next = () => 0.5;
    sim.rng.chance = (chance) => chance > 0.5;
  }
  const targets: Entity[] = [];
  for (let i = 0; i < (options.targets ?? 1); i++) {
    const target = createMob(9701 + i, MOBS.forest_wolf, 20, {
      x: sim.player.pos.x + i * 0.05,
      y: sim.player.pos.y,
      z: sim.player.pos.z + 2,
    });
    target.maxHp = 1_000_000;
    target.hp = 100_000; // Ordinary Tolling Hammer is eligible below 20%.
    target.hostile = true;
    target.swingTimer = 999;
    target.moveSpeed = 0;
    (sim as unknown as { addEntity(entity: Entity): void }).addEntity(target);
    targets.push(target);
  }
  sim.player.facing = 0;
  sim.targetEntity(targets[0].id);
  if (options.ascended) {
    grantDevotion(sim.player, 20);
    expect(activateDivineAscension(sim.player)).toBe(true);
  }
  if (options.echo) {
    sim.player.procState = { counters: { paladin_dawn_echo: 2 }, icds: {} };
  }
  if (options.wrath) grantDawnsWrath(sim.ctx, sim.player);
  sim.drainEvents();
  return { sim, targets };
}

function cast(sim: Sim, id: string): Damage[] {
  sim.player.gcdRemaining = 0;
  sim.player.cooldowns.clear();
  sim.player.resource = sim.player.maxResource;
  sim.castAbility(id);
  const events = sim.drainEvents();
  // Complete projectiles and ground ticks through the production tick driver.
  for (let tick = 0; tick < 40; tick++) events.push(...sim.tick());
  expect(events.filter((event) => event.type === 'error')).toEqual([]);
  return events.filter(
    (event): event is Damage => event.type === 'damage' && event.sourceId === sim.player.id,
  );
}

function measured(id: string, options: Options = {}, neutral = false): Damage[] {
  const spy = neutral ? vi.spyOn(tuning, 'dawnreaverDamageMultiplier').mockReturnValue(1) : null;
  try {
    const { sim, targets } = rig(options);
    if (id === 'auto') {
      meleeSwing(sim.ctx, sim.player, targets[0], 0, null, { autoAttack: true });
      return sim.drainEvents().filter((event): event is Damage => event.type === 'damage');
    }
    return cast(sim, id);
  } finally {
    spy?.mockRestore();
  }
}

function expectScaled(actual: Damage[], control: Damage[], factor: number) {
  expect(control.length).toBeGreaterThan(0);
  expect(actual.length).toBe(control.length);
  for (let i = 0; i < control.length; i++) {
    expect(actual[i]).toMatchObject({
      ability: control[i].ability,
      targetId: control[i].targetId,
      crit: control[i].crit,
    });
    // The multiplier precedes integer hit rounding and target mitigation.
    expect(Math.abs(actual[i].amount - control[i].amount * factor)).toBeLessThanOrEqual(2);
  }
}

afterEach(() => vi.restoreAllMocks());

describe('Dawnreaver complete-hit damage tuning', () => {
  it('replays a seeded Ascension rotation exactly without changing the neutral RNG draw stream', () => {
    function replay(neutral = false) {
      const spy = neutral
        ? vi.spyOn(tuning, 'dawnreaverDamageMultiplier').mockReturnValue(1)
        : null;
      try {
        const { sim, targets } = rig({ seeded: true, ascended: true, echo: true, targets: 2 });
        const draws: number[] = [];
        sim.rng.setObserver((value) => draws.push(value));
        const damage: Damage[] = [];
        for (const id of [
          'sun_gods_verdict',
          'final_edict',
          'dawnfall',
          'hammer_of_wrath',
          'final_edict',
          'dawnfall',
          'final_edict',
          'hammer_of_wrath',
        ]) {
          damage.push(...cast(sim, id));
        }
        // High-HP targets keep kill-triggered RNG and execute thresholds out of the comparison.
        expect(targets.every((target) => !target.dead && target.hp > 90_000)).toBe(true);
        return { draws, damage };
      } finally {
        spy?.mockRestore();
      }
    }
    const buffed = replay();
    expect(replay()).toEqual(buffed);
    const neutral = replay(true);
    expect(buffed.draws.length).toBeGreaterThan(20);
    expect(buffed.draws).toEqual(neutral.draws);
    expect(buffed.damage.map(({ amount: _amount, ...event }) => event)).toEqual(
      neutral.damage.map(({ amount: _amount, ...event }) => event),
    );
    expect(buffed.damage.map((event) => event.ability)).toEqual(
      expect.arrayContaining([
        'Final Edict',
        'Dawnfall',
        'Tolling Hammer',
        'Verdict of the Sun God',
        'Dawn Echo',
      ]),
    );
    expect(
      buffed.damage.some((event) => event.ability === 'Final Edict' && event.targetId === 9702),
    ).toBe(true);
    expect(buffed.damage.reduce((sum, event) => sum + event.amount, 0)).toBeGreaterThan(
      neutral.damage.reduce((sum, event) => sum + event.amount, 0),
    );
  });

  it('restricts the four literal multipliers to Dawnreaver and leaves arbitrary IDs inert', () => {
    for (const [id, factor] of [
      ['final_edict', 2],
      ['dawnfall', 2],
      ['hammer_of_wrath', 1.75],
      ['sun_gods_verdict', 1.5],
    ] as const) {
      expect(tuning.dawnreaverDamageMultiplier('paladin', 'retribution', id)).toBe(factor);
      for (const spec of ['holy', 'protection', null, 'unknown']) {
        expect(tuning.dawnreaverDamageMultiplier('paladin', spec, id)).toBe(1);
      }
      expect(tuning.dawnreaverDamageMultiplier('warrior', 'retribution', id)).toBe(1);
      expect(tuning.dawnreaverDamageMultiplier(null, 'retribution', id)).toBe(1);
    }
    for (const id of ['hammer_of_grace', 'consecration', 'dawn_echo', 'unknown', null, undefined]) {
      expect(tuning.dawnreaverDamageMultiplier('paladin', 'retribution', id)).toBe(1);
    }
  });

  it.each([0, 280])(
    'scales weapon, AP and SP contributions at power %s, including Ascension',
    (power) => {
      for (const ascended of [false, true]) {
        for (const [id, factor] of [
          ['final_edict', 2],
          ['dawnfall', 2],
          ['hammer_of_wrath', 1.75],
        ] as const) {
          const options = { power, ascended, targets: 2 };
          const control = measured(id, options, true);
          const actual = measured(id, options);
          expectScaled(actual, control, factor);
          if (id === 'final_edict' && ascended) {
            // The appended Ascension explosion must scale along with the weapon hit.
            expect(actual.some((event) => event.targetId === 9702)).toBe(true);
          }
        }
      }
    },
  );

  it('preserves Dawnfall soft capping while doubling each complete hit', () => {
    const single = measured('dawnfall', { targets: 1 });
    const capped = measured('dawnfall', { targets: 10 });
    expect(capped).toHaveLength(10);
    expectScaled(capped, measured('dawnfall', { targets: 10 }, true), 2);
    // Five full-damage targets spread over ten victims halve each hit. Allow
    // one point because the capped and uncapped paths each round once.
    expect(Math.abs(capped[0].amount - single[0].amount / 2)).toBeLessThanOrEqual(1);
  });

  it.each(['final_edict', 'dawnfall'])(
    'scales the Verdict detonation selected by %s once',
    (finisher) => {
      function verdict(neutral: boolean) {
        const spy = neutral
          ? vi.spyOn(tuning, 'dawnreaverDamageMultiplier').mockReturnValue(1)
          : null;
        try {
          const { sim, targets } = rig({ targets: 10 });
          sim.castAbility('sun_gods_verdict');
          const mark = targets[0].auras.find((aura) => aura.kind === 'sun_verdict');
          expect(mark).toBeDefined();
          if (!mark) throw new Error('missing live Verdict mark');
          mark.value = 2;
          mark.stacks = 2;
          return cast(sim, finisher).filter((event) => event.ability === 'Verdict of the Sun God');
        } finally {
          spy?.mockRestore();
        }
      }
      const actual = verdict(false);
      expect(actual).toHaveLength(finisher === 'final_edict' ? 1 : 10);
      expectScaled(actual, verdict(true), 1.5);
    },
  );

  it('multiplies empowered Zealfire Hammer once without double-applying the set bonus', () => {
    // Use the real set-derived stats: consuming the proc recalculates stats.
    const options = { set: true, wrath: true };
    const empowered = measured('hammer_of_wrath', options);
    expectScaled(empowered, measured('hammer_of_wrath', options, true), 1.75);
    expectScaled(empowered, measured('hammer_of_wrath', { ...options, wrath: false }), 1.4);
  });

  it.each(['final_edict', 'hammer_of_wrath'])(
    'Dawn Echo inherits exactly 40%% of the boosted %s hit once',
    (id) => {
      const events = measured(id, { power: 280, echo: true });
      const primary = events.find((event) => event.ability !== 'Dawn Echo');
      const echoes = events.filter((event) => event.ability === 'Dawn Echo');
      expect(primary).toBeDefined();
      expect(echoes).toHaveLength(1);
      if (!primary) throw new Error('missing primary hit');
      expect(echoes[0].amount).toBe(Math.round(primary.amount * 0.4));
      expectScaled(
        events,
        measured(id, { power: 280, echo: true }, true),
        id === 'final_edict' ? 2 : 1.75,
      );
    },
  );

  it.each(['retribution', 'holy', 'protection'] as const)(
    'leaves shared damage and white swings unchanged for %s',
    (spec) => {
      for (const id of spec === 'holy'
        ? ['hammer_of_grace', 'auto']
        : ['hammer_of_grace', 'consecration', 'auto']) {
        const options = { spec, power: 280 };
        const current = measured(id, options);
        expect(current.length).toBeGreaterThan(0);
        expect(current).toEqual(measured(id, options, true));
      }
    },
  );

  it.each(['holy', 'protection'] as const)(
    'does not make Dawnreaver attacks available to %s',
    (spec) => {
      const { sim } = rig({ spec });
      for (const id of ['final_edict', 'dawnfall', 'hammer_of_wrath', 'sun_gods_verdict']) {
        expect(ABILITIES[id].specs).toEqual(['retribution']);
        sim.castAbility(id);
        const events = sim.drainEvents();
        expect(events.some((event) => event.type === 'damage')).toBe(false);
        expect(sim.player.cooldowns.has(id)).toBe(false);
      }
    },
  );
});
