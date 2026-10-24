// The drowned garrison's effects plan (src/render/sunken_bastion/
// bastion_drowned_fx_core.ts): the water runs off the helm's brim and the
// buckler at the right heights, a blow throws brine AWAY from the attacker,
// only a real rush (the Onrush dash, three times its run) kicks spray, and the
// budgets shed with the effects tier but never vanish.
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { modelPointWorld, modelScale } from '../src/render/sunken_bastion/bastion_creature_fx_core';
import {
  DROWNED_FX,
  deathBurstCounts,
  drownedFxSpec,
  hitSprayCount,
  isRushing,
  nextDripIndex,
  RUSH_SPEED_RATIO,
  sprayDirection,
} from '../src/render/sunken_bastion/bastion_drowned_fx_core';
import { MOBS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';

const out = () => ({ x: 0, y: 0, z: 0 });

describe('the drowned effects plan', () => {
  it('names only real drowned templates, each wearing its own Blender body', () => {
    for (const id of Object.keys(DROWNED_FX)) {
      expect(MOBS[id], id).toBeDefined();
      const key = visualKeyFor({ kind: 'mob', templateId: id } as Entity);
      expect(VISUALS[key].url, id).toMatch(/^models\/creatures\//);
      expect(VISUALS[key].authoredAtlas, id).toBe(true);
    }
    expect(drownedFxSpec('bastion_revenant')).toBe(DROWNED_FX.bastion_revenant);
    expect(drownedFxSpec('barnacle_crawler')).toBeNull();
    expect(drownedFxSpec(undefined)).toBeNull();
  });

  it('drips from the brim at head height and from the buckler and the blade, never the floor', () => {
    const spec = DROWNED_FX.bastion_revenant;
    const key = visualKeyFor({ kind: 'mob', templateId: 'bastion_revenant' } as Entity);
    const drawn = VISUALS[key].height * (MOBS.bastion_revenant.scale ?? 1);
    const k = modelScale(VISUALS[key].height, MOBS.bastion_revenant.scale ?? 1, spec.rawHeight);
    const heights = spec.drips.map((d) => modelPointWorld(0, 0, 0, 0, k, d, out()).y);
    // The brim drips sit in the top fifth of the body, the rest (the buckler,
    // the blade held low) well off the floor.
    expect(Math.max(...heights)).toBeGreaterThan(drawn * 0.8);
    for (const h of heights) expect(h).toBeGreaterThan(drawn * 0.2);
    // The chest and the eyes are where they should be.
    expect(modelPointWorld(0, 0, 0, 0, k, spec.chest, out()).y).toBeGreaterThan(drawn * 0.5);
    expect(modelPointWorld(0, 0, 0, 0, k, spec.eyes, out()).y).toBeGreaterThan(drawn * 0.8);
    expect(nextDripIndex(spec.drips.length - 1, spec)).toBe(0);
  });

  it('sets the anchors of every body on its drawn body: eyes up top, drips off the floor', () => {
    for (const [id, spec] of Object.entries(DROWNED_FX)) {
      const key = visualKeyFor({ kind: 'mob', templateId: id } as Entity);
      const scale = MOBS[id].scale ?? 1;
      const drawn = VISUALS[key].height * scale;
      const k = modelScale(VISUALS[key].height, scale, spec.rawHeight);
      for (const d of spec.drips) {
        const y = modelPointWorld(0, 0, 0, 0, k, d, out()).y;
        expect(y, id).toBeGreaterThan(drawn * 0.2);
        expect(y, id).toBeLessThan(drawn * 1.05);
      }
      expect(modelPointWorld(0, 0, 0, 0, k, spec.eyes, out()).y, id).toBeGreaterThan(drawn * 0.75);
      expect(modelPointWorld(0, 0, 0, 0, k, spec.chest, out()).y, id).toBeGreaterThan(drawn * 0.4);
    }
  });

  it('throws the brine away from the blow', () => {
    // The attacker stands west of the body: the spray goes east.
    const d = sprayDirection(10, 0, 4, 0, 0, { x: 0, z: 0 });
    expect(d.x).toBeCloseTo(1);
    expect(d.z).toBeCloseTo(0);
    // Same spot: off its back (facing yaw 0 looks along +z).
    const back = sprayDirection(3, 3, 3, 3, 0, { x: 0, z: 0 });
    expect(back.z).toBeCloseTo(-1);
  });

  it('kicks spray only on a real rush, never on its plain run', () => {
    const run = MOBS.bastion_revenant.moveSpeed;
    expect(isRushing(run * 0.2, 0, 0.2, run)).toBe(false);
    expect(isRushing(run * 0.2 * RUSH_SPEED_RATIO * 0.95, 0, 0.2, run)).toBe(false);
    // The Onrush dash runs at three times its move speed.
    expect(isRushing(run * 3 * 0.2, 0, 0.2, run)).toBe(true);
    expect(isRushing(5, 0, 0, run)).toBe(false);
  });

  it('sheds its budgets on the low tier but always draws something', () => {
    expect(hitSprayCount(true, 1)).toBeGreaterThan(hitSprayCount(false, 1));
    expect(hitSprayCount(false, 0.4)).toBeLessThan(hitSprayCount(false, 1));
    expect(hitSprayCount(false, 0)).toBeGreaterThan(0);
    const full = deathBurstCounts(1);
    const low = deathBurstCounts(0.4);
    expect(low.brine).toBeLessThan(full.brine);
    expect(deathBurstCounts(0).motes).toBeGreaterThan(0);
  });
});
