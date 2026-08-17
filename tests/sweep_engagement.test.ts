import { describe, expect, it } from 'vitest';
import {
  attributeSweepDamage,
  DAMAGE_EFFECTS,
  DEAD_ZONE_MARGIN,
  engagementDistance,
  MELEE_REACH,
  STATION_DEAD_BAND,
  station,
} from '../scripts/lib/sweep_engagement.mjs';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { TALENTS } from '../src/sim/content/talents';
import { CLASSES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, MAX_LEVEL, type PlayerClass } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

// The row sweep used to walk every class to melee reach, which put the hunter inside
// the 8 yard dead zone its whole ranged kit refuses to fire from, so the sweep
// measured a hunter as a bad melee class. These pin the standoff rule that replaced
// it, including the deliberate no-op for every class that has no dead zone.

const TICKS_PER_SECOND = 20;
const APPROACH_SPEED = 7;

describe('engagementDistance', () => {
  it('holds melee reach when nothing in the kit has a minimum range', () => {
    expect(engagementDistance([{ range: 30 }, { range: 0 }], { maxRange: 30 })).toBe(MELEE_REACH);
  });

  it('handles an empty or missing kit', () => {
    expect(engagementDistance([], null)).toBe(MELEE_REACH);
    expect(engagementDistance(undefined, undefined)).toBe(MELEE_REACH);
  });

  it('clears the largest minimum range by the margin', () => {
    expect(engagementDistance([{ minRange: 8, range: 35 }], { maxRange: 35 })).toBe(
      8 + DEAD_ZONE_MARGIN,
    );
    expect(
      engagementDistance(
        [
          { minRange: 8, range: 35 },
          { minRange: 12, range: 35 },
        ],
        null,
      ),
    ).toBe(12 + DEAD_ZONE_MARGIN);
  });

  it('never steps past the shortest reachable ceiling', () => {
    expect(engagementDistance([{ minRange: 8, range: 9 }], { maxRange: 35 })).toBe(9);
    expect(engagementDistance([{ minRange: 8, range: 35 }], { maxRange: 9 })).toBe(9);
  });

  it('ignores the range of abilities that declared no dead zone', () => {
    // A short-range ability with no minRange must not drag the standoff back into
    // the dead zone the ranged kit needs cleared.
    expect(engagementDistance([{ minRange: 8, range: 35 }, { range: 3 }], null)).toBe(
      8 + DEAD_ZONE_MARGIN,
    );
  });

  it('tolerates a dead-zone ability that declares no range', () => {
    expect(engagementDistance([{ minRange: 8 }], null)).toBe(8 + DEAD_ZONE_MARGIN);
  });

  it('falls back to the floor when the ceiling is inside the dead zone', () => {
    expect(engagementDistance([{ minRange: 8, range: 6 }], { maxRange: 6 })).toBe(
      8 + DEAD_ZONE_MARGIN,
    );
  });
});

describe('engagementDistance against the kits the sweep actually runs', () => {
  // Built the way runBuild() builds them: real Sim, level cap, spec applied, and the
  // talent rows allocated. abilitiesKnownAt() alone misses 13 damaging abilities the
  // sweep sees (spec-gated and talent-granted ones), so evaluating the rule against
  // it would verify a different kit than the one being measured.
  function sweptKit(cls: PlayerClass, rows: Record<number, string> = {}) {
    const sim = new Sim({
      seed: 7300,
      playerClass: 'warrior',
      noPlayer: true,
      autoEquip: true,
      world: EMPTY_TEST_WORLD,
    });
    const pid = sim.addPlayer(cls, 'Sweep') as number;
    sim.setPlayerLevel(MAX_LEVEL, pid);
    sim.applyTalents({ spec: TALENTS[cls].specs[0]?.id ?? null, rows }, pid);
    const meta = sim.meta(pid);
    if (!meta) throw new Error(`no meta for ${cls}`);
    return meta.known
      .filter((a) => a.def.effects.some((e) => DAMAGE_EFFECTS.has(e.type)))
      .map((a) => a.def);
  }

  const standoff = (cls: PlayerClass, rows?: Record<number, string>) =>
    engagementDistance(sweptKit(cls, rows), CLASSES[cls].ranged);

  it('stations the hunter outside its dead zone', () => {
    const stand = standoff('hunter');
    expect(stand).toBeGreaterThan(8);
    expect(stand).toBe(10);
    expect(stand).toBeLessThanOrEqual(CLASSES.hunter.ranged?.maxRange ?? 35);
  });

  it('is the hunter alone, across every talent row option', () => {
    // The narrow scope is the point: fixing the sweep must not silently move the
    // eight classes whose numbers were already measured correctly. Checked against
    // every single-row build too, so a talent-granted minRange ability on another
    // class fails here rather than quietly relocating it in the sweep.
    const moved = new Set<string>();
    for (const cls of ALL_CLASSES) {
      if (standoff(cls) !== MELEE_REACH) moved.add(cls);
      for (const row of CHOICE_ROWS[cls].rows) {
        for (const option of row.options) {
          if (standoff(cls, { [row.level]: option.id }) !== MELEE_REACH) moved.add(cls);
        }
      }
    }
    expect([...moved]).toEqual(['hunter']);
  });
});

describe('station', () => {
  const at = (x: number) => ({ pos: { x, z: 0 } }) as { pos: { x: number; z: number } };

  it('closes toward the reach', () => {
    const mover = at(0);
    station(mover, at(30), 10, APPROACH_SPEED, TICKS_PER_SECOND);
    expect(mover.pos.x).toBeCloseTo(APPROACH_SPEED / TICKS_PER_SECOND, 5);
  });

  it('backs off when it is too close, which the old mover never did', () => {
    // The sign is load-bearing: inverted, the character walks to zero range and
    // reproduces the exact dead-zone defect this rule exists to fix.
    const mover = at(0);
    station(mover, at(2.25), 10, APPROACH_SPEED, TICKS_PER_SECOND);
    expect(mover.pos.x).toBeLessThan(0);
  });

  it('converges on the reach and then holds without oscillating', () => {
    const mover = at(0);
    const target = at(30);
    for (let i = 0; i < 200; i++) station(mover, target, 10, APPROACH_SPEED, TICKS_PER_SECOND);
    const settled = mover.pos.x;
    // It comes to rest within the dead band of the reach, never exactly on it.
    expect(Math.abs(Math.abs(30 - settled) - 10)).toBeLessThan(STATION_DEAD_BAND);
    for (let i = 0; i < 20; i++) station(mover, target, 10, APPROACH_SPEED, TICKS_PER_SECOND);
    expect(mover.pos.x).toBe(settled); // dead band: fully at rest, not jittering
  });

  it('never overshoots the reach in a single step', () => {
    const mover = at(9.9);
    station(mover, at(20), 10, APPROACH_SPEED, TICKS_PER_SECOND);
    expect(20 - mover.pos.x).toBeGreaterThanOrEqual(10);
  });

  it('does not move a casting character, or one at zero separation', () => {
    const casting = { pos: { x: 0, z: 0 }, castingAbility: 'aimed_shot' };
    station(casting, at(30), 10, APPROACH_SPEED, TICKS_PER_SECOND);
    expect(casting.pos.x).toBe(0);
    const stacked = at(5);
    station(stacked, at(5), 10, APPROACH_SPEED, TICKS_PER_SECOND);
    expect(stacked.pos.x).toBe(5);
  });
});

describe('attributeSweepDamage', () => {
  it('credits the player their own damage', () => {
    expect(attributeSweepDamage(7, 7, { kind: 'player' })).toBe('player');
  });

  it('credits the player their own pet', () => {
    expect(attributeSweepDamage(42, 7, { kind: 'mob', ownerId: 7 })).toBe('pet');
  });

  it('ignores another player and their pet', () => {
    expect(attributeSweepDamage(9, 7, { kind: 'player' })).toBeNull();
    expect(attributeSweepDamage(42, 7, { kind: 'mob', ownerId: 9 })).toBeNull();
  });

  it('ignores an unowned mob and a missing source', () => {
    expect(attributeSweepDamage(42, 7, { kind: 'mob', ownerId: null })).toBeNull();
    expect(attributeSweepDamage(42, 7, undefined)).toBeNull();
  });
});
