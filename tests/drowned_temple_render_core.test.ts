// The Drowned Temple's pure render cores (src/render/drowned_temple/*_core.ts):
// the crater ring stays clear of every walkway, the dressing stands in open
// water, the Walk's overhang buries into the crater face, the Great Conch's
// throat light sits in its turned mouth, every boss and trash cast that
// paints the floor has a telegraph spec, and the Tideglass Fracture's slices
// read their round and charge off the Colossus's own bar.

import { describe, expect, it } from 'vitest';
import {
  FRACTURE_CALM_PULSE,
  fractureClock,
  fractureSliceLook,
  templeTelegraphFill,
  templeTelegraphSpecs,
  templeTimedFill,
  tideLook,
} from '../src/render/drowned_temple/temple_fx_core';
import {
  CONCH,
  CRATER_CREST,
  craterCrest,
  insideCrater,
  isLagoon,
  planTempleDressing,
  planTempleLights,
  WALK_OVERHANG,
} from '../src/render/drowned_temple/temple_plan_core';
import { TELEGRAPH_THREAT_COLORS } from '../src/render/floor_telegraph/telegraph_look_core';
import {
  COLOSSUS_MOONLIGHT_LANCE,
  COLOSSUS_TIDEGLASS_FRACTURE,
  COLOSSUS_TUNING,
  HYDRA_TIDE_BREATH,
  SELTHE_DROWNING_ARIA,
  SELTHE_MERE_SURGE,
  SELTHE_MOONWATER_BOLT,
  SELTHE_TUNING,
} from '../src/sim/encounters/drowned_temple';
import {
  fractureChannel,
  fractureWarn,
} from '../src/sim/encounters/drowned_temple/tideglass_fracture';
import { TEMPLE_SNAP, TEMPLE_TRIDENT_SWEEP } from '../src/sim/mob/trash_kit/temple_cast_ids';

describe('the crater ring', () => {
  it('every crest point stands over open lagoon, never over a walkway', () => {
    for (const [x, z] of craterCrest(4)) expect(isLagoon(x, z), `${x},${z}`).toBe(true);
  });

  it('closes a ring around the whole route', () => {
    expect(CRATER_CREST.length).toBeGreaterThan(12);
    expect(insideCrater(0, -230)).toBe(true); // the Moongate Landing
    expect(insideCrater(-30, 206)).toBe(true); // the Moon Altar
    expect(insideCrater(0, 400)).toBe(false);
  });
});

describe('the dressing', () => {
  it('stands every piece in open water or on its own absolute height', () => {
    for (const d of planTempleDressing()) {
      expect(Number.isFinite(d.x) && Number.isFinite(d.z), d.piece).toBe(true);
      expect(insideCrater(d.x, d.z), `${d.piece} at ${d.x},${d.z}`).toBe(true);
    }
  });

  it('turns the Great Conch off the court axis and lights its mouth', () => {
    expect(Math.abs(CONCH.rot)).toBeGreaterThan(0.5);
    const conch = planTempleDressing().find((d) => d.piece === 'Kit_GreatConch');
    expect(conch?.rot).toBe(CONCH.rot);
    const light = planTempleLights().find((l) => l.kind === 'conch');
    expect(light).toBeDefined();
    // 8 yd out along the shell's axis toward the court (mouth at local -z).
    expect(light?.x).toBeCloseTo(CONCH.x - 8 * Math.sin(CONCH.rot), 5);
    expect(light?.z).toBeCloseTo(CONCH.z - 8 * Math.cos(CONCH.rot), 5);
  });

  it("buries the Walk's overhang into the crater face", () => {
    // The back end of the shelf (along the walk's outward normal) reaches
    // past the crest, so no gap of sky shows between the rock and the wall.
    const ux = 0.85;
    const uz = -0.52;
    const bx = WALK_OVERHANG.x + (ux * WALK_OVERHANG.depth) / 2;
    const bz = WALK_OVERHANG.z + (uz * WALK_OVERHANG.depth) / 2;
    expect(insideCrater(bx, bz, 0)).toBe(false);
    // Its lip still hangs over the lagoon side of the walk.
    expect(insideCrater(WALK_OVERHANG.x - (ux * WALK_OVERHANG.depth) / 2, WALK_OVERHANG.z)).toBe(
      true,
    );
  });
});

describe('the telegraphs', () => {
  it('paints the trash sweeps and the boss breath and lance', () => {
    const specs = templeTelegraphSpecs();
    for (const id of [TEMPLE_TRIDENT_SWEEP, TEMPLE_SNAP, HYDRA_TIDE_BREATH]) {
      expect(specs[id]?.shape, id).toBe('cone');
      expect(specs[id]?.range, id).toBeGreaterThan(0);
    }
    expect(specs[COLOSSUS_MOONLIGHT_LANCE]?.shape).toBe('lane');
  });

  it('fills from 0 as a bar opens to 1 as it lands', () => {
    expect(templeTelegraphFill(2, 2)).toBe(0);
    expect(templeTelegraphFill(1, 2)).toBeCloseTo(0.5, 5);
    expect(templeTelegraphFill(0, 2)).toBe(1);
    expect(templeTimedFill(0, 5)).toBe(0);
    expect(templeTimedFill(9, 5)).toBe(1);
  });

  it('hides a dry tide half, shimmers a warned one and fills a flooded one', () => {
    expect(tideLook('dry', 1).visible).toBe(false);
    const warn = tideLook('warn', 1);
    expect(warn.visible).toBe(true);
    expect(warn.fill).toBeLessThan(1);
    expect(tideLook('flood', 1)).toEqual({ visible: true, fill: 1, fade: 1 });
  });
});

describe('the caster pass: Selthe’s marks and the Tideglass Fracture’s slices', () => {
  it('paints the Mere Surge wedge with the sim’s own reach and arc, and a kick glyph under her bolt and aria', () => {
    const specs = templeTelegraphSpecs();
    const surge = specs[SELTHE_MERE_SURGE];
    expect(surge?.shape).toBe('cone');
    expect(surge?.range).toBe(SELTHE_TUNING.surgeRange);
    expect(surge?.arcDeg).toBe(SELTHE_TUNING.surgeArcDeg);
    expect(surge?.color).toBe(TELEGRAPH_THREAT_COLORS.danger);
    for (const id of [SELTHE_MOONWATER_BOLT, SELTHE_DROWNING_ARIA]) {
      expect(specs[id]?.shape, id).toBe('sigil');
      expect(specs[id]?.color, id).toBe(TELEGRAPH_THREAT_COLORS.interrupt);
    }
    // The fracture's slices are objects, never a caster telegraph.
    expect(specs[COLOSSUS_TIDEGLASS_FRACTURE]).toBeUndefined();
  });

  it('reads the round and its charge off the channel bar, normal and heroic alike', () => {
    const crack = COLOSSUS_TUNING.fractureCast;
    for (const heroic of [false, true]) {
      const total = fractureChannel(heroic);
      const warn = fractureWarn(heroic);
      expect(fractureClock(total, total, crack)).toEqual({ round: -1, charge: 0 });
      expect(fractureClock(total, total - crack + 0.01, crack).round).toBe(-1);
      for (let r = 0; r < 3; r++) {
        const mid = fractureClock(total, total - crack - warn * (r + 0.5), crack);
        expect(mid.round).toBe(r);
        expect(mid.charge).toBeCloseTo(0.5, 6);
      }
      expect(fractureClock(total, 0, crack)).toEqual({ round: 2, charge: 1 });
    }
  });

  it('red glass heats toward its detonation with a quickening pulse; clear glass is safe', () => {
    const cold = fractureSliceLook('red', 0);
    const hot = fractureSliceLook('red', 1);
    expect(hot.heat).toBeGreaterThan(cold.heat);
    expect(hot.pulse).toBeGreaterThan(cold.pulse);
    expect(cold.clear).toBe(0);
    const safe = fractureSliceLook('safe', 1);
    expect(safe.heat).toBe(0);
    expect(safe.clear).toBe(1);
    expect(fractureSliceLook('crack', 0).crack).toBe(1);
    // Reduced motion holds the pulse down, never the heat (the actionable part).
    const calm = fractureSliceLook('red', 1, true);
    expect(calm.pulse).toBeLessThanOrEqual(FRACTURE_CALM_PULSE);
    expect(calm.heat).toBe(hot.heat);
    // A reused look is fully rewritten (no stale clear glass on a red slice).
    const out = fractureSliceLook('safe', 0);
    fractureSliceLook('red', 0.5, false, out);
    expect(out.clear).toBe(0);
    expect(out.heat).toBeGreaterThan(0);
  });
});
