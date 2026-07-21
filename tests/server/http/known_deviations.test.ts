// Freshness + grounding gate for the known-deviations ledger (characterization spine).
//
// The ledger only earns its keep if every entry stays grounded in reality: it
// must name routes that actually exist in the surface inventory, phases inside
// the real re-architecture window, unique ids, and golden fixtures that are
// genuinely on disk. This test hard-fails the moment a deviation drifts from any
// of those (a renamed route, a typo phase number, a duplicate id, a missing
// fixture), so later changes land against a true baseline.
//
// It anchors on route STRINGS and fixture PATHS, never line numbers.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEVIATION_ID,
  DEVIATION_PHASE_MAX,
  DEVIATION_PHASE_MIN,
  KNOWN_DEVIATIONS,
} from './known_deviations';
import { SURFACE_INVENTORY } from './surface_inventory';

// Repo root, resolved from this file (never the cwd: a shared worktree can run
// the suite from elsewhere). `../../../` climbs http -> server -> tests -> root.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// Every path the inventory dispatches (the regex `:param` rows carry the human
// pattern form, e.g. /api/characters/:id/sheet, which is exactly what a
// deviation references).
const INVENTORY_PATHS = new Set(SURFACE_INVENTORY.map((r) => r.path));

// The full set of named ids, so the test catches an entry whose id is not a
// registered DEVIATION_ID constant.
const REGISTERED_IDS = new Set<string>(Object.values(DEVIATION_ID));

describe('known deviations ledger: grounding gate', () => {
  it('is non-vacuous (the ledger has entries to check)', () => {
    expect(KNOWN_DEVIATIONS.length).toBeGreaterThan(0);
  });

  it('every deviation id is unique', () => {
    const ids = KNOWN_DEVIATIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every deviation id is a registered DEVIATION_ID named constant', () => {
    for (const d of KNOWN_DEVIATIONS) {
      expect(REGISTERED_IDS.has(d.id)).toBe(true);
    }
  });

  it('every routes[] entry exists as a path in SURFACE_INVENTORY', () => {
    for (const d of KNOWN_DEVIATIONS) {
      // A deviation with no routes is meaningless; it must anchor on at least one.
      expect(d.routes.length).toBeGreaterThan(0);
      for (const route of d.routes) {
        // Hard-fail (with the offending pair named) if a deviation invents a route.
        expect(INVENTORY_PATHS.has(route), `${d.id} -> ${route}`).toBe(true);
      }
    }
  });

  it('every introducedInPhase is null or an integer in [4, 25]', () => {
    for (const d of KNOWN_DEVIATIONS) {
      if (d.introducedInPhase === null) continue;
      expect(Number.isInteger(d.introducedInPhase), `${d.id} phase`).toBe(true);
      expect(d.introducedInPhase).toBeGreaterThanOrEqual(DEVIATION_PHASE_MIN);
      expect(d.introducedInPhase).toBeLessThanOrEqual(DEVIATION_PHASE_MAX);
    }
  });

  it('every listed goldenFixtures path exists on disk', () => {
    for (const d of KNOWN_DEVIATIONS) {
      if (!d.goldenFixtures) continue;
      // An empty goldenFixtures array is a documentation error: omit the field
      // instead of listing nothing.
      expect(d.goldenFixtures.length, `${d.id} fixtures`).toBeGreaterThan(0);
      for (const rel of d.goldenFixtures) {
        // Fixture paths are repo-root relative; resolve against ROOT, never cwd.
        const abs = ROOT + rel;
        expect(existsSync(abs), `${d.id} -> ${rel}`).toBe(true);
      }
    }
  });

  it('every deviation carries the full set of characterization fields', () => {
    for (const d of KNOWN_DEVIATIONS) {
      expect(d.currentBehavior.length, `${d.id} currentBehavior`).toBeGreaterThan(0);
      expect(d.intendedBehavior.length, `${d.id} intendedBehavior`).toBeGreaterThan(0);
      expect(d.reason.length, `${d.id} reason`).toBeGreaterThan(0);
    }
  });
});
