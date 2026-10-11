// The pure half of Gloamveil's floor and smoke layer: what each graphics tier
// and the reduced-motion setting keep, how the layer thins with distance, and
// the bounded roster of wearers. The body (the dark legs, the halo) is not a
// knob here at all: tests/gloam_climb_core.test.ts and
// tests/character_gloam_form.test.ts pin that it shows on every tier.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHARACTER_LOD_RANGE, CHARACTER_LOD_RANGE_SQ } from '../src/render/crowd_lod';
import {
  GLOAM_FAR_SMOKE_SCALE,
  GLOAM_MAX_WEARERS,
  GLOAM_WEARER_LINGER,
  type GloamPlan,
  GloamRoster,
  type GloamTier,
  gloamDistanceScale,
  gloamEmitCount,
  gloamGovernorScale,
  gloamPlan,
  gloamPoolDraped,
} from '../src/render/gloam_field_core';
import { GLOAM_WAKE_SECONDS } from '../src/render/gloam_pool_core';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

const TIERS: readonly GloamTier[] = ['low', 'medium', 'high', 'ultra', 'insane'];

describe('gloamPlan: what each tier keeps', () => {
  it('draws the approved look in full on high and every tier above it', () => {
    const full: GloamPlan = {
      smoke: 1,
      haze: true,
      bubbles: true,
      sparkles: true,
      wakeStains: 8,
      poolCells: 12,
      entry: 1,
      ring: true,
      living: true,
    };
    for (const tier of ['high', 'ultra', 'insane'] as const) {
      expect(gloamPlan(tier, false)).toEqual(full);
    }
  });

  it('sheds the sparkles and half the wake on medium', () => {
    expect(gloamPlan('medium', false)).toEqual({
      smoke: 0.7,
      haze: true,
      bubbles: true,
      sparkles: false,
      wakeStains: 4,
      poolCells: 8,
      entry: 0.7,
      ring: true,
      living: true,
    });
  });

  it('keeps the pool, the entry and a thin smoke on low', () => {
    expect(gloamPlan('low', false)).toEqual({
      smoke: 0.4,
      haze: false,
      bubbles: false,
      sparkles: false,
      wakeStains: 0,
      poolCells: 6,
      entry: 0.4,
      ring: true,
      living: true,
    });
  });

  it('never takes the pool, the entry or the smoke away on any tier', () => {
    for (const tier of TIERS) {
      const plan = gloamPlan(tier, false);
      // The pool is laid on at least a few cells, the entry plays, the ring
      // races out, the pool lives and some smoke rises: richness only is shed.
      expect(plan.poolCells).toBeGreaterThanOrEqual(6);
      expect(plan.entry).toBeGreaterThan(0);
      expect(plan.ring).toBe(true);
      expect(plan.living).toBe(true);
      expect(plan.smoke).toBeGreaterThan(0);
    }
  });

  it('only ever sheds going down the ladder', () => {
    for (let i = 1; i < TIERS.length; i++) {
      const lower = gloamPlan(TIERS[i - 1], false);
      const upper = gloamPlan(TIERS[i], false);
      expect(upper.smoke).toBeGreaterThanOrEqual(lower.smoke);
      expect(upper.entry).toBeGreaterThanOrEqual(lower.entry);
      expect(upper.wakeStains).toBeGreaterThanOrEqual(lower.wakeStains);
      expect(upper.poolCells).toBeGreaterThanOrEqual(lower.poolCells);
      for (const key of ['haze', 'bubbles', 'sparkles'] as const) {
        expect(Number(upper[key])).toBeGreaterThanOrEqual(Number(lower[key]));
      }
    }
  });

  it('falls back to the low plan for a tier it does not know', () => {
    expect(gloamPlan('potato' as GloamTier, false)).toBe(gloamPlan('low', false));
    expect(gloamPlan('potato' as GloamTier, true)).toBe(gloamPlan('low', true));
  });

  it('hands out shared, frozen plans (no allocation per frame, no caller edits)', () => {
    for (const tier of TIERS) {
      for (const still of [false, true]) {
        const plan = gloamPlan(tier, still);
        expect(gloamPlan(tier, still)).toBe(plan);
        expect(Object.isFrozen(plan)).toBe(true);
      }
    }
  });
});

describe('gloamPlan: reduced motion', () => {
  it('keeps the still pool on every tier and drops everything that moves', () => {
    for (const tier of TIERS) {
      const moving = gloamPlan(tier, false);
      expect(gloamPlan(tier, true)).toEqual({
        smoke: 0,
        haze: false,
        bubbles: false,
        sparkles: false,
        wakeStains: 0,
        // The pool is laid exactly as finely as the tier lays it.
        poolCells: moving.poolCells,
        entry: 0,
        ring: false,
        living: false,
      });
    }
  });
});

describe('the distance arm', () => {
  it('draws in full up close and thins the smoke to a floor at the fixed LOD range', () => {
    expect(gloamDistanceScale(0)).toBe(1);
    const full = CHARACTER_LOD_RANGE * 0.4;
    expect(gloamDistanceScale(full * full)).toBe(1);
    const mid = (full + CHARACTER_LOD_RANGE) / 2;
    expect(gloamDistanceScale(mid * mid)).toBeCloseTo((1 + GLOAM_FAR_SMOKE_SCALE) / 2, 9);
    expect(gloamDistanceScale(CHARACTER_LOD_RANGE_SQ)).toBe(GLOAM_FAR_SMOKE_SCALE);
    expect(gloamDistanceScale(CHARACTER_LOD_RANGE_SQ * 9)).toBe(GLOAM_FAR_SMOKE_SCALE);
    let last = 1;
    for (let yd = 0; yd <= CHARACTER_LOD_RANGE * 1.5; yd += 1) {
      const scale = gloamDistanceScale(yd * yd);
      expect(scale).toBeLessThanOrEqual(last + 1e-12);
      // Never zero: removal belongs to the entity loop, not to this fade.
      expect(scale).toBeGreaterThanOrEqual(GLOAM_FAR_SMOKE_SCALE);
      last = scale;
    }
    // A reading that is not a distance draws in full rather than vanishing.
    expect(gloamDistanceScale(Number.NaN)).toBe(1);
  });

  it('drapes the pool inside the fixed LOD range and lays it flat beyond', () => {
    expect(gloamPoolDraped(0)).toBe(true);
    expect(gloamPoolDraped(CHARACTER_LOD_RANGE_SQ - 1)).toBe(true);
    expect(gloamPoolDraped(CHARACTER_LOD_RANGE_SQ)).toBe(false);
    expect(gloamPoolDraped(CHARACTER_LOD_RANGE_SQ * 4)).toBe(false);
  });

  it('reads the fixed range and the static tier, never the governor or the live band', () => {
    const source = codeWithoutLineComments(
      readFileSync(
        fileURLToPath(new URL('../src/render/gloam_field_core.ts', import.meta.url)),
        'utf8',
      ),
    );
    // The only import is the fixed LOD anchor.
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['./crowd_lod']);
    for (const banned of ['render_budget', 'characterLodBands', 'governor(', 'fps', 'pressure']) {
      expect(source.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });
});

describe('the governor arm (smoke rate only)', () => {
  it('floors the rate the way every continuous aura in the cloud does', () => {
    expect(gloamGovernorScale(1)).toBe(1);
    expect(gloamGovernorScale(0)).toBe(0.35);
    expect(gloamGovernorScale(0.5)).toBeCloseTo(0.675, 12);
    expect(gloamGovernorScale(-4)).toBe(0.35);
    expect(gloamGovernorScale(9)).toBe(1);
    expect(gloamGovernorScale(Number.NaN)).toBe(1);
  });
});

describe('gloamEmitCount', () => {
  it('emits the whole expected count plus one on the fraction', () => {
    // 9 a second over a 250 ms frame: 2.25 expected.
    expect(gloamEmitCount(9, 0.25, 0.24)).toBe(3);
    expect(gloamEmitCount(9, 0.25, 0.25)).toBe(2);
    expect(gloamEmitCount(9, 0.25, 0.99)).toBe(2);
    // A fast frame: 0.15 expected, so usually none.
    expect(gloamEmitCount(9, 1 / 60, 0.14)).toBe(1);
    expect(gloamEmitCount(9, 1 / 60, 0.16)).toBe(0);
  });

  it('averages to the rate whatever the frame time', () => {
    for (const dt of [1 / 144, 1 / 60, 1 / 15]) {
      let emitted = 0;
      const frames = Math.round(20 / dt);
      for (let i = 0; i < frames; i++) emitted += gloamEmitCount(9, dt, (i * 0.61803) % 1);
      expect(emitted / (frames * dt)).toBeCloseTo(9, 0);
    }
  });

  it('emits nothing at a zero or negative rate', () => {
    expect(gloamEmitCount(0, 0.5, 0)).toBe(0);
    expect(gloamEmitCount(-3, 0.5, 0)).toBe(0);
    expect(gloamEmitCount(9, 0, 0)).toBe(0);
  });
});

describe('GloamRoster', () => {
  function rosterWith(capacity?: number) {
    const made: string[] = [];
    const released: string[] = [];
    let next = 0;
    return {
      roster: new GloamRoster<string>(capacity),
      make: () => {
        const item = `w${next++}`;
        made.push(item);
        return item;
      },
      release: (item: string) => {
        released.push(item);
      },
      made,
      released,
    };
  }

  it('makes an item on first sight and returns the same one afterwards', () => {
    const { roster, make, made } = rosterWith();
    const first = roster.touch(7, 0, make);
    expect(first).toBe('w0');
    expect(roster.touch(7, 0.1, make)).toBe('w0');
    expect(roster.touch(9, 0.1, make)).toBe('w1');
    expect(made).toEqual(['w0', 'w1']);
    expect(roster.size).toBe(2);
    expect(roster.get(7)).toBe('w0');
    expect(roster.get(8)).toBeUndefined();
    expect([roster.at(0), roster.at(1)].sort()).toEqual(['w0', 'w1']);
  });

  it('is bounded: a wearer past the capacity gets nothing and makes nothing', () => {
    const { roster, make, made } = rosterWith(3);
    for (let id = 0; id < 3; id++) expect(roster.touch(id, 0, make)).toBeDefined();
    expect(roster.touch(99, 0, make)).toBeUndefined();
    expect(roster.size).toBe(3);
    expect(made.length).toBe(3);
    // Ones already tracked are still served.
    expect(roster.touch(1, 1, make)).toBe('w1');
    expect(new GloamRoster<string>().touch(1, 0, make)).toBeDefined();
    expect(GLOAM_MAX_WEARERS).toBeGreaterThanOrEqual(8);
  });

  it('releases exactly the wearers nobody reported since the linger', () => {
    const { roster, make, release, released } = rosterWith();
    roster.touch(1, 0, make);
    roster.touch(2, 0, make);
    roster.touch(3, 0, make);
    roster.touch(2, 1, make);
    expect(roster.sweep(1, 0.5, release)).toBe(2);
    expect(released.sort()).toEqual(['w0', 'w2']);
    expect(roster.size).toBe(1);
    expect(roster.get(2)).toBe('w1');
    expect(roster.get(1)).toBeUndefined();
    // Exactly at the linger it is kept; just past it, it goes.
    expect(roster.sweep(1.5, 0.5, release)).toBe(0);
    expect(roster.sweep(1.5001, 0.5, release)).toBe(1);
    expect(roster.size).toBe(0);
    // The freed capacity is usable again.
    expect(roster.touch(1, 2, make)).toBe('w3');
  });

  it('keeps every survivor reachable after a removal in the middle', () => {
    const { roster, make, release } = rosterWith();
    for (let id = 10; id < 16; id++) roster.touch(id, 0, make);
    for (const id of [10, 12, 14, 15]) roster.touch(id, 5, make);
    expect(roster.sweep(5, 1, release)).toBe(2);
    expect(roster.size).toBe(4);
    expect([10, 12, 14, 15].map((id) => roster.get(id))).toEqual(['w0', 'w2', 'w4', 'w5']);
    const seen = new Set<string>();
    for (let i = 0; i < roster.size; i++) seen.add(roster.at(i));
    expect([...seen].sort()).toEqual(['w0', 'w2', 'w4', 'w5']);
  });

  it('drops one wearer at once, and everyone on clear, releasing each once', () => {
    const { roster, make, release, released } = rosterWith();
    roster.touch(1, 0, make);
    roster.touch(2, 0, make);
    roster.touch(3, 0, make);
    expect(roster.drop(2, release)).toBe(true);
    expect(roster.drop(2, release)).toBe(false);
    expect(roster.drop(77, release)).toBe(false);
    expect(released).toEqual(['w1']);
    expect(roster.get(1)).toBe('w0');
    expect(roster.get(3)).toBe('w2');
    roster.clear(release);
    expect(roster.size).toBe(0);
    expect(released.sort()).toEqual(['w0', 'w1', 'w2']);
  });

  it('lingers longer than a wake stain lives, so the last prints fade rather than pop', () => {
    expect(GLOAM_WEARER_LINGER).toBeGreaterThan(GLOAM_WAKE_SECONDS);
  });
});
