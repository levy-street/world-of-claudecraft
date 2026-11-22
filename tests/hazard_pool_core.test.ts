// The hazard pool's pure decisions (src/render/hazard_pool/hazard_pool_core.ts):
// the footprint is the mechanic (never drawn inside the sim radius), a dropped
// pool shows its whole footprint at once and is full by its first damage tick,
// and the Litany's tiers map to two distinguishable looks.

import { describe, expect, it } from 'vitest';
import {
  HAZARD_POOL_DRAIN_SEC,
  HAZARD_POOL_EDGE_SOFT,
  HAZARD_POOL_ISLAND_TOP,
  HAZARD_POOL_LOOKS,
  HAZARD_POOL_STATIC_PHASE,
  hazardPoolDiscExtent,
  hazardPoolEdgeMargin,
  hazardPoolPeak,
  hazardPoolPhase,
  hazardPoolSeed,
  litanyHazardStyle,
} from '../src/render/hazard_pool/hazard_pool_core';
import { litanyModuleGeometry } from '../src/sim/delve_litany_layout';
import type { HazardPoolStyle } from '../src/world_api/dungeons';

const STYLES: HazardPoolStyle[] = ['marsh', 'ember', 'violet'];

describe('hazard pool looks', () => {
  it('maps the Litany tiers: shallow to marsh tar, deep and untiered (sim: deep) to ember tar', () => {
    expect(litanyHazardStyle('shallow')).toBe('marsh');
    expect(litanyHazardStyle('deep')).toBe('ember');
    expect(litanyHazardStyle(undefined)).toBe('ember');
  });

  it('draws deep above shallow and a boss pool above both, all in the encounter band below telegraphs', () => {
    expect(HAZARD_POOL_LOOKS.ember.step).toBeGreaterThan(HAZARD_POOL_LOOKS.marsh.step);
    expect(HAZARD_POOL_LOOKS.violet.step).toBeGreaterThan(HAZARD_POOL_LOOKS.ember.step);
    // Boss telegraphs in the band start at step 8 (rift death zone).
    for (const s of STYLES) expect(HAZARD_POOL_LOOKS[s].step).toBeLessThan(8);
  });

  it('makes the deep tar thicker than the shallow tar', () => {
    expect(HAZARD_POOL_LOOKS.ember.thick).toBeGreaterThan(HAZARD_POOL_LOOKS.marsh.thick);
    expect(hazardPoolPeak('ember')).toBeGreaterThan(hazardPoolPeak('marsh'));
  });

  it('keeps every pool under the dry stepping stones so an island always reads dry', () => {
    for (const s of STYLES) expect(hazardPoolPeak(s)).toBeLessThan(HAZARD_POOL_ISLAND_TOP);
  });

  it('gives each style distinct colours', () => {
    const keys = STYLES.map((s) => `${HAZARD_POOL_LOOKS[s].glow}:${HAZARD_POOL_LOOKS[s].film}`);
    expect(new Set(keys).size).toBe(STYLES.length);
  });
});

describe('hazard pool footprint', () => {
  it('only ever widens the damage radius, by a small bounded margin', () => {
    for (const r of [1, 4, 5, 8, 22]) {
      const m = hazardPoolEdgeMargin(r);
      expect(m).toBeGreaterThan(0);
      expect(m).toBeLessThanOrEqual(0.6);
      // The disc reaches past the radius by the margin plus the soft rim.
      expect(hazardPoolDiscExtent(r) * r).toBeCloseTo(r + m + HAZARD_POOL_EDGE_SOFT, 9);
      expect(hazardPoolDiscExtent(r)).toBeGreaterThan(1);
    }
  });

  it('covers every Litany hazard zone with a disc at least as large as the zone', () => {
    for (const id of [
      'litany_sluice',
      'litany_ledger',
      'litany_ring',
      'litany_baptistry',
      'litany_choir_loft',
      'litany_causeway',
      'litany_apse',
    ] as const) {
      for (const h of litanyModuleGeometry(id)!.hazards) {
        expect(hazardPoolDiscExtent(h.r)).toBeGreaterThan(1);
      }
    }
  });

  it('seeds pools deterministically and differently by position', () => {
    expect(hazardPoolSeed(3, 4)).toBe(hazardPoolSeed(3, 4));
    expect(hazardPoolSeed(3, 4)).not.toBe(hazardPoolSeed(-8, 18));
    const s = hazardPoolSeed(1234.5, -987.25);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(97);
  });
});

describe('hazard pool lifecycle (boss-dropped pools)', () => {
  it('shows the whole footprint from the first frame', () => {
    const p = hazardPoolPhase(0, 1, null);
    expect(p.film).toBe(1);
    expect(p.arming).toBe(1);
    expect(p.fade).toBe(0);
  });

  it('is fully formed by its first damage tick and stays that way while listed', () => {
    expect(hazardPoolPhase(0.5, 1, null).body).toBeGreaterThan(0);
    expect(hazardPoolPhase(0.5, 1, null).body).toBeLessThan(1);
    for (const age of [1, 2, 7.99, 8, 30]) {
      const p = hazardPoolPhase(age, 1, null);
      expect(p.body).toBe(1);
      expect(p.arming).toBe(0);
      expect(p.fade).toBe(0);
    }
  });

  it('grows its body monotonically while arming', () => {
    let last = -1;
    for (let age = 0; age <= 1.0001; age += 0.05) {
      const b = hazardPoolPhase(age, 1, null).body;
      expect(b).toBeGreaterThanOrEqual(last);
      last = b;
    }
  });

  it('drains only after the world drops it, over the drain window', () => {
    expect(hazardPoolPhase(8, 1, 0).fade).toBe(0);
    expect(hazardPoolPhase(8, 1, HAZARD_POOL_DRAIN_SEC / 2).fade).toBeCloseTo(0.5, 9);
    expect(hazardPoolPhase(8, 1, HAZARD_POOL_DRAIN_SEC).fade).toBe(1);
    // A pool dropped while still arming stops pulsing as it drains.
    expect(hazardPoolPhase(0.3, 1, 0.1).arming).toBe(0);
  });

  it('treats a pool with no arming window as fully formed at once', () => {
    expect(hazardPoolPhase(0, 0, null)).toEqual({ film: 1, body: 1, arming: 0, fade: 0 });
  });

  it('draws static dressing fully formed', () => {
    expect(HAZARD_POOL_STATIC_PHASE).toEqual({ film: 1, body: 1, arming: 0, fade: 0 });
  });

  it('writes into a caller-owned phase without allocating', () => {
    const out = { film: 0, body: 0, arming: 0, fade: 0 };
    expect(hazardPoolPhase(2, 1, null, out)).toBe(out);
  });
});
