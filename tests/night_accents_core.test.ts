import { describe, expect, it } from 'vitest';
import {
  emberSites,
  FLORA_CAP_POOL,
  FLORA_CELL,
  FLORA_DENSITY,
  FLORA_TINT,
  type FloraProbes,
  fireflyBlink,
  fireflyHabitat,
  floraCellChanged,
  floraCellOf,
  type GlowFloraCap,
  glowFloraCaps,
} from '../src/render/night_accents_core';
import { CAMPS, getActiveWorldContent } from '../src/sim/data';
import { hash2 } from '../src/sim/rng';
import type { BiomeId } from '../src/sim/types';

// night_accents_core: the placement math for the map-wide night accents. Pure,
// so the layout is asserted here rather than eyeballed in a screenshot.

describe('emberSites (a warm pool at every fire and camp)', () => {
  it('gives every authored campfire its own tight pool', () => {
    const sites = emberSites(
      [
        [10, 10],
        [200, 200],
      ],
      [],
    );
    expect(sites).toHaveLength(2);
    expect(sites[0]).toMatchObject({ x: 10, z: 10 });
    expect(sites[0].radius).toBeGreaterThan(0);
  });

  it('gives a camp with no fire a WIDER, and therefore fainter, pool', () => {
    const fire = emberSites([[0, 0]], [])[0];
    const camp = emberSites([], [{ center: { x: 0, z: 0 } }])[0];
    expect(camp.radius).toBeGreaterThan(fire.radius);
  });

  it('does not stack a camp pool on a campfire that already lights it', () => {
    // The two tables overlap by design: most camps get a campfire prop, and a
    // wide camp pool over a bright fire pool is how a camp ends up reading as a
    // bonfire from across the valley.
    const sites = emberSites([[100, 100]], [{ center: { x: 104, z: 97 } }]);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ x: 100, z: 100 });
  });

  it('still lights a camp whose nearest fire is far away', () => {
    const sites = emberSites([[100, 100]], [{ center: { x: 400, z: 400 } }]);
    expect(sites).toHaveLength(2);
  });

  it('covers the real world map without running away', () => {
    const content = getActiveWorldContent();
    const sites = emberSites(content.props.campfires, CAMPS);
    expect(sites.length).toBeGreaterThan(content.props.campfires.length);
    // one instanced draw per zone: a runaway count here is a perf regression
    expect(sites.length).toBeLessThan(400);
  });
});

describe('glowFloraCaps (world-anchored luminous clusters)', () => {
  const probes = (over: Partial<FloraProbes> = {}): FloraProbes => ({
    hash: (cx, cz, salt) => hash2(cx, cz, 0x9e37 + salt * 2654435761),
    groundAt: () => 12,
    biomeAt: () => 'marsh' as BiomeId,
    excluded: () => false,
    ...over,
  });

  it('fills a caller-owned array and reports a count, allocating nothing after the first pass', () => {
    const out: GlowFloraCap[] = [];
    const first = glowFloraCaps(0, 0, probes(), out);
    expect(first).toBeGreaterThan(0);
    const grown = out.length;
    const second = glowFloraCaps(0, 0, probes(), out);
    expect(second).toBe(first);
    expect(out.length).toBe(grown); // reused the slots, did not push again
  });

  it('is world-ANCHORED: the same cluster comes back when you walk away and return', () => {
    // A mushroom that teleports when you walk past it is a bug, which is the
    // whole reason this is a cell hash and not the motes.ts random pool.
    const near: GlowFloraCap[] = [];
    const nearCount = glowFloraCaps(0, 0, probes(), near);
    const snapshot = near.slice(0, nearCount).map((c) => ({ x: c.x, y: c.y, z: c.z }));

    const far: GlowFloraCap[] = [];
    glowFloraCaps(0, FLORA_CELL * 3, probes(), far); // walk three cells north
    const back: GlowFloraCap[] = [];
    const backCount = glowFloraCaps(0, 0, probes(), back);

    expect(backCount).toBe(nearCount);
    expect(back.slice(0, backCount).map((c) => ({ x: c.x, y: c.y, z: c.z }))).toEqual(snapshot);
  });

  it('keeps a shared cell identical between two overlapping camera windows', () => {
    const a: GlowFloraCap[] = [];
    const aCount = glowFloraCaps(0, 0, probes(), a);
    const b: GlowFloraCap[] = [];
    const bCount = glowFloraCaps(FLORA_CELL, 0, probes(), b);
    const key = (c: GlowFloraCap) => `${c.x.toFixed(6)}:${c.z.toFixed(6)}`;
    const aKeys = new Set(a.slice(0, aCount).map(key));
    const shared = b.slice(0, bCount).filter((c) => aKeys.has(key(c)));
    // the windows overlap heavily, so a real shared set must exist
    expect(shared.length).toBeGreaterThan(0);
  });

  it('grows nothing where the ground is excluded', () => {
    const out: GlowFloraCap[] = [];
    expect(glowFloraCaps(0, 0, probes({ excluded: () => true }), out)).toBe(0);
  });

  it('respects the pool cap so the instanced mesh can never overflow', () => {
    const out: GlowFloraCap[] = [];
    // a realm at full density with nothing excluded is the worst case
    const count = glowFloraCaps(0, 0, probes({ biomeAt: () => 'night' as BiomeId }), out, 12);
    expect(count).toBeLessThanOrEqual(12);
  });

  it('sits every cap on the ground the probe reports', () => {
    const out: GlowFloraCap[] = [];
    const count = glowFloraCaps(0, 0, probes({ groundAt: () => 7.25 }), out);
    for (let i = 0; i < count; i++) expect(out[i].y).toBe(7.25);
  });

  it('grows SOMETHING in every realm: the whole map gets night interest', () => {
    // The brief is map-wide, so a realm may be sparse but never bare. A zero or
    // missing density would leave a whole region of the world dark and dead.
    for (const biome of Object.keys(FLORA_DENSITY) as BiomeId[]) {
      expect(FLORA_DENSITY[biome], biome).toBeGreaterThan(0);
      expect(FLORA_DENSITY[biome], biome).toBeLessThanOrEqual(1);
      expect(FLORA_TINT[biome], biome).toBeGreaterThan(0);
    }
  });

  it('actually places caps in the sparsest realm, not just the lush ones', () => {
    const out: GlowFloraCap[] = [];
    const count = glowFloraCaps(0, 0, probes({ biomeAt: () => 'desert' as BiomeId }), out);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(FLORA_CAP_POOL);
  });
});

describe('the flora cell gate (rebuild on a crossing, never per frame)', () => {
  it('reports no change while the camera stays inside its cell', () => {
    const { cx, cz } = floraCellOf(0, 0);
    expect(floraCellChanged(1, 1, cx, cz)).toBe(false);
    expect(floraCellChanged(FLORA_CELL - 0.1, 0, cx, cz)).toBe(false);
  });

  it('reports a change the moment the camera crosses into the next cell', () => {
    const { cx, cz } = floraCellOf(0, 0);
    expect(floraCellChanged(FLORA_CELL + 0.1, 0, cx, cz)).toBe(true);
    expect(floraCellChanged(0, -0.1, cx, cz)).toBe(true);
  });

  it('agrees with floraCellOf on negative coordinates', () => {
    const cell = floraCellOf(-1, -1);
    expect(floraCellChanged(-1, -1, cell.cx, cell.cz)).toBe(false);
  });
});

describe('fireflyHabitat', () => {
  it('never settles a firefly over open water', () => {
    expect(fireflyHabitat(-1, 0, 'vale')).toBe(false);
    expect(fireflyHabitat(0, 0, 'vale')).toBe(false);
  });

  it('settles on a water edge in ANY realm (the brief: near water)', () => {
    for (const biome of ['peaks', 'frost', 'desert', 'ember'] as BiomeId[]) {
      expect(fireflyHabitat(1, 0, biome), biome).toBe(true);
    }
  });

  it('settles inland only in the leafy realms', () => {
    expect(fireflyHabitat(40, 0, 'jungle')).toBe(true);
    expect(fireflyHabitat(40, 0, 'vale')).toBe(true);
    // bare rock and snow: a drifting bug there reads as a rendering fault
    expect(fireflyHabitat(40, 0, 'peaks')).toBe(false);
    expect(fireflyHabitat(40, 0, 'frost')).toBe(false);
  });
});

describe('fireflyBlink', () => {
  it('spends most of its cycle dark, which is what makes it read as an insect', () => {
    let lit = 0;
    const steps = 400;
    for (let i = 0; i < steps; i++) if (fireflyBlink(i / steps / 0.55, 0) > 0.05) lit++;
    expect(lit / steps).toBeLessThan(0.5);
    expect(lit / steps).toBeGreaterThan(0.05);
  });

  it('stays inside 0..1 and reaches full brightness at the flash', () => {
    let peak = 0;
    for (let i = 0; i < 500; i++) {
      const v = fireflyBlink(i * 0.01, 0.3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      if (v > peak) peak = v;
    }
    expect(peak).toBeGreaterThan(0.95);
  });

  it('spreads the pool apart by phase so they never pulse in unison', () => {
    const a = fireflyBlink(0.2, 0);
    const b = fireflyBlink(0.2, 0.5);
    expect(a).not.toBeCloseTo(b, 3);
  });
});
