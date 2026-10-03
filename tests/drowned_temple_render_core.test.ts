// The Drowned Temple's pure render cores (src/render/drowned_temple/*_core.ts):
// the crater ring stays clear of every walkway, the dressing stands in open
// water, the Walk's overhang buries into the crater face, the Great Conch's
// throat light sits in its turned mouth, and every boss and trash cast that
// paints the floor has a telegraph spec.

import { describe, expect, it } from 'vitest';
import {
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
import { COLOSSUS_MOONLIGHT_LANCE, HYDRA_TIDE_BREATH } from '../src/sim/encounters/drowned_temple';
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
