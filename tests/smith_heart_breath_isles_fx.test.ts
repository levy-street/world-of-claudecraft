// The Islands of the Wind's look (src/render/smith_heart_fx/breath_isles_fx_core.ts):
// each isle is its own Blender sculpt of the Breath kit, riding the wind on a
// bob that holds all but still while the round is on, its stones drifting in
// the open air round it (never inside its crag), the routes run on the ride's
// own arc from each circle to where it carries, the Bulwark thins and cracks
// as its absorb runs down and its vortex's bands peel away in turn, a cut
// Mending Gale parts and fades, the launch funnel flares and thins, the
// objects are told apart, and the new bars have their display names.

import { describe, expect, it } from 'vitest';
import { SMITH_HEART_BREATH_KIT_PIECES } from '../scripts/assets/smith_heart_breath_kit/build.mjs';
import {
  BULWARK_BANDS,
  BULWARK_DEBRIS,
  beamCutLook,
  bulwarkBandLife,
  bulwarkDebris,
  bulwarkDebrisCount,
  bulwarkLook,
  circleRoute,
  driftStone,
  FUNNEL_SECONDS,
  funnelLook,
  ISLE_BOB,
  ISLE_KIT,
  isleBob,
  isleDepth,
  isleObjectKind,
} from '../src/render/smith_heart_fx/breath_isles_fx_core';
import { BREATH, BREATH_ISLES } from '../src/sim/content/smith_heart_layout';
import {
  galePathTemplate,
  homeGaleTemplate,
  ISLE_CASTS,
  isleSpots,
  rideArc,
  rideTemplate,
} from '../src/sim/encounters/smith_heart';
import { castDisplayName } from '../src/ui/cast_display_name';

describe('breath_isles_fx_core', () => {
  it('dresses each isle with its own kit sculpt, riding the wind but still under a body', () => {
    expect(ISLE_KIT.length).toBeGreaterThanOrEqual(BREATH_ISLES.length);
    expect(new Set(ISLE_KIT.map((k) => k.piece)).size).toBe(ISLE_KIT.length);
    for (const k of ISLE_KIT) expect(SMITH_HEART_BREATH_KIT_PIECES).toContain(k.piece.slice(4));
    BREATH_ISLES.forEach((_, i) => {
      expect(isleDepth(i)).toBeGreaterThan(15);
      let free = 0;
      let held = 0;
      for (let t = 0; t < 20; t += 0.25) {
        free = Math.max(free, Math.abs(isleBob(i, t, 0).y));
        held = Math.max(held, Math.abs(isleBob(i, t, 1).y));
      }
      // Free on the wind it visibly rides; held, a body never sinks into it.
      expect(free).toBeGreaterThan(0.2);
      expect(held).toBeLessThanOrEqual(ISLE_BOB.held * 1.4);
      expect(held).toBeLessThan(0.06);
    });
  });

  it('drifts its stones round the isle in the open air, never inside its crag', () => {
    BREATH_ISLES.forEach((isle, i) => {
      for (let k = 0; k < 9; k++)
        for (const t of [0, 7, 31]) {
          const s = driftStone(i, k, t);
          const r = Math.hypot(s.x - isle.x, s.z - isle.z);
          // The crag narrows as it hangs: a stone further down may come in.
          const down = Math.max(0, (isle.h - s.y) / isleDepth(i));
          expect(r, `${i}/${k}`).toBeGreaterThan(isle.r * (1.25 - 0.9 * down));
          expect(s.y).toBeLessThan(isle.h + 3);
        }
    });
  });

  it('runs each route on the ride arc from its circle to where it carries', () => {
    BREATH_ISLES.forEach((isle, i) => {
      const s = isleSpots()[i];
      const out = circleRoute(i, 'path', 20, { cornice: BREATH.cornice.h });
      expect(out[0].x).toBeCloseTo(s.path.x, 6);
      expect(out[20].x).toBeCloseTo(s.land.x, 6);
      expect(out[20].y).toBeCloseTo(isle.h, 6);
      const mid = rideArc(
        { x: s.path.x, y: BREATH.cornice.h, z: s.path.z },
        { x: s.land.x, y: isle.h, z: s.land.z },
        0.5,
      );
      expect(out[10].y).toBeCloseTo(mid.y, 6);
      const home = circleRoute(i, 'home', 20, { cornice: BREATH.cornice.h });
      expect(home[20].z).toBeCloseTo(s.back.z, 6);
    });
  });

  it('the Bulwark thins and cracks as its absorb runs down', () => {
    const full = bulwarkLook(100, 100, 0);
    const half = bulwarkLook(50, 100, 0);
    const low = bulwarkLook(5, 100, 0);
    expect(full.crack).toBe(0);
    expect(half.solid).toBeLessThan(full.solid);
    expect(low.crack).toBeGreaterThan(half.crack);
    expect(low.solid).toBeGreaterThan(0.3);
  });

  it("the Bulwark's vortex peels away band by band, its stones thinning", () => {
    // Whole: every band and every stone.
    for (const b of BULWARK_BANDS) expect(bulwarkBandLife(1, b.over), String(b.over)).toBe(1);
    expect(bulwarkDebrisCount(1, 1)).toBe(BULWARK_DEBRIS);
    // Under two thirds the crown is gone, the waist still turns.
    const crown = BULWARK_BANDS.reduce((a, b) => (b.over > a.over ? b : a));
    expect(bulwarkBandLife(0.6, crown.over)).toBe(0);
    expect(bulwarkBandLife(0.6, 1 / 3)).toBeGreaterThan(0.9);
    // Near broken only the foot holds, dim, and few stones.
    expect(bulwarkBandLife(0.1, 1 / 3)).toBe(0);
    const foot = BULWARK_BANDS.find((b) => b.over === 0);
    expect(foot).toBeDefined();
    expect(bulwarkBandLife(0.1, 0)).toBeGreaterThan(0.4);
    expect(bulwarkBandLife(0.1, 0)).toBeLessThan(bulwarkBandLife(1, 0));
    expect(bulwarkDebrisCount(0.1, 1)).toBeLessThan(BULWARK_DEBRIS / 2);
    expect(bulwarkDebrisCount(1, 0.35)).toBeLessThan(BULWARK_DEBRIS);
    // Its stones orbit outside the shell.
    const d = { x: 0, y: 0, z: 0, spin: 0, size: 0 };
    for (let j = 0; j < BULWARK_DEBRIS; j++)
      expect(Math.hypot(bulwarkDebris(j, 3, 1, d).x, d.z)).toBeGreaterThan(1.15);
  });

  it('a cut Mending Gale parts at its middle and fades; the launch funnel flares and thins', () => {
    expect(beamCutLook(0).cut).toBe(0);
    expect(beamCutLook(0.25).cut).toBeGreaterThan(0.4);
    expect(beamCutLook(0.25).glow).toBeGreaterThan(0.5);
    expect(beamCutLook(1).glow).toBe(0);
    expect(funnelLook(0).life).toBe(0);
    expect(funnelLook(FUNNEL_SECONDS * 0.15).life).toBeGreaterThan(0.9);
    expect(funnelLook(FUNNEL_SECONDS).life).toBe(0);
    expect(funnelLook(FUNNEL_SECONDS * 0.8).h).toBeGreaterThan(funnelLook(0.05).h);
  });

  it('tells its objects apart, and names its bars', () => {
    expect(isleObjectKind(galePathTemplate(1))).toBe('path');
    expect(isleObjectKind(homeGaleTemplate(0))).toBe('home');
    expect(isleObjectKind(rideTemplate('out', 1, 3.2))).toBe('ride');
    expect(isleObjectKind('sh_breath_vortex')).toBeNull();
    for (const id of Object.values(ISLE_CASTS)) expect(castDisplayName(id), id).not.toBe(id);
    expect(castDisplayName('heart_breath_cradle_channel')).toBe("Thunder's Cradle");
  });
});
