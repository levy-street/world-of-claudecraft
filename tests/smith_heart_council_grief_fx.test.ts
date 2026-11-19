// Grief of the Stone's look (src/render/smith_heart_fx/council_grief_core.ts and
// council_grief_fx.ts): the halo's breath and the onset's swell as numbers, the
// stream and the grief on one clock, and the painter over a fake host: the
// onset's flare and rings, the halo at a fixed beat on every tier, the embers
// thinned by the tier, nothing on a member that is not enraged.

import { describe, expect, it } from 'vitest';
import { COUNCIL_CUE_SOUNDS } from '../src/game/smith_heart_council_audio_core';
import { councilClaims, INHERIT_SECONDS } from '../src/render/smith_heart_fx/council_fx_core';
import {
  GRIEF_EMBERS,
  GRIEF_FLOW_SECONDS,
  GRIEF_HALO_BEAT,
  GRIEF_ONSET_SECONDS,
  GRIEF_THROB_EVERY,
  griefBodyHeight,
  griefHaloLook,
} from '../src/render/smith_heart_fx/council_grief_core';
import { CouncilGriefFx } from '../src/render/smith_heart_fx/council_grief_fx';
import type { CouncilFxHost } from '../src/render/smith_heart_fx/council_pillars_fx';
import {
  COUNCIL_AURAS,
  COUNCIL_CUES,
  COUNCIL_GUARDIAN,
  COUNCIL_SEAM_SINGER,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart/council_ids';
import type { Entity } from '../src/sim/types';

describe('Grief of the Stone: the look as numbers', () => {
  it('lands with the stream: the sim, the river of beads and the flare share one clock', () => {
    expect(GRIEF_FLOW_SECONDS).toBe(T.griefFlow);
    expect(INHERIT_SECONDS).toBe(T.griefFlow);
    expect(councilClaims(COUNCIL_CUES.grief)).toBe(true);
    expect(COUNCIL_CUE_SOUNDS[COUNCIL_CUES.grief]).toBeDefined();
  });

  it('the halo breathes round the steady glow and swells with the onset, then settles', () => {
    const h = griefBodyHeight('guardian');
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < 4; t += 0.05) {
      const l = griefHaloLook(t, 99, h, false);
      lo = Math.min(lo, l.alpha);
      hi = Math.max(hi, l.alpha);
      expect(l.grow).toBeGreaterThan(l.size);
    }
    expect(hi - lo).toBeGreaterThan(0.05);
    // Wide enough to stand out past the body, never wider than it is tall.
    expect(lo).toBeGreaterThan(0);
    expect(griefHaloLook(0, 99, h, false).grow).toBeLessThan(h);
    expect(griefHaloLook(0, 99, h, false).size).toBeGreaterThan(h * 0.4);
    const onset = griefHaloLook(0, 0, h, false);
    const settled = griefHaloLook(0, GRIEF_ONSET_SECONDS, h, false);
    expect(onset.size).toBeGreaterThan(settled.size);
    expect(onset.alpha).toBeGreaterThan(settled.alpha);
    expect(onset.alpha).toBeLessThanOrEqual(0.85);
    // Before any onset was seen it is the steady halo.
    expect(griefHaloLook(0, -Infinity, h, false)).toEqual(settled);
  });

  it('reduced motion holds the halo still and keeps the swell small', () => {
    const h = griefBodyHeight('singer');
    const a = griefHaloLook(0.1, 99, h, true);
    const b = griefHaloLook(1.3, 99, h, true);
    expect(a).toEqual(b);
    expect(griefHaloLook(0, 0, h, true).size).toBeLessThan(griefHaloLook(0, 0, h, false).size);
  });
});

/** A fake host recording what the painter emits. */
function fakeHost(density: number, entities: Map<number, Entity>) {
  let clock = 0;
  const puffs: { pool?: string; n: number; alpha: number }[] = [];
  const rings: { radius: number }[] = [];
  const shakes: number[] = [];
  const host = {
    entity: (id: number) => entities.get(id),
    particles: {
      puff: (_x: number, _y: number, _z: number, n: number, o: { pool?: string; alpha: number }) =>
        puffs.push({ pool: o.pool, n, alpha: o.alpha }),
      shockRing: (_x: number, _z: number, _c: number, radius: number) => rings.push({ radius }),
    },
    groundY: () => 0,
    now: () => clock,
    density,
    reducedMotion: () => false,
    shakeNear: (_x: number, _z: number, amount: number) => shakes.push(amount),
  } as unknown as CouncilFxHost;
  return {
    host,
    puffs,
    rings,
    shakes,
    advance: (fx: CouncilGriefFx, seconds: number) => {
      for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
        clock += 1 / 60;
        fx.update(1 / 60);
      }
    },
  };
}

function member(id: number, templateId: string, enraged: boolean): Entity {
  return {
    id,
    templateId,
    dead: false,
    pos: { x: 10, y: 0, z: 10 },
    auras: enraged ? [{ id: COUNCIL_AURAS.enraged }] : [],
  } as unknown as Entity;
}

describe('Grief of the Stone: the painter over a fake host', () => {
  it('the onset flares, rings twice and thuds near the survivor', () => {
    const singer = member(2, COUNCIL_SEAM_SINGER, true);
    const f = fakeHost(1, new Map([[2, singer]]));
    const fx = new CouncilGriefFx(f.host);
    fx.onset(2);
    expect(f.puffs.length).toBeGreaterThanOrEqual(2);
    expect(f.rings.length).toBe(2);
    expect(f.shakes.length).toBe(1);
  });

  it('the halo keeps its beat on every tier; the embers thin with it', () => {
    const counts = (density: number) => {
      const g = member(1, COUNCIL_GUARDIAN, true);
      const f = fakeHost(density, new Map([[1, g]]));
      const fx = new CouncilGriefFx(f.host);
      fx.beginScan();
      fx.see(g, 'guardian');
      fx.endScan();
      f.advance(fx, 3);
      return { all: f.puffs.length, rings: f.rings.length };
    };
    const full = counts(1);
    const low = counts(0.35);
    // The halo: one a beat, the same on both tiers.
    const beats = Math.floor(3 / GRIEF_HALO_BEAT);
    expect(Math.abs(full.all - low.all - GRIEF_EMBERS * 3 * (1 - 0.35))).toBeLessThan(3);
    expect(full.all).toBeGreaterThanOrEqual(beats);
    expect(low.all).toBeGreaterThanOrEqual(beats);
    // A throb ring each GRIEF_THROB_EVERY.
    expect(full.rings).toBe(Math.floor(3 / GRIEF_THROB_EVERY));
  });

  it('a member that is not enraged burns nothing, and one that stops goes dark', () => {
    const g = member(1, COUNCIL_GUARDIAN, false);
    const f = fakeHost(1, new Map([[1, g]]));
    const fx = new CouncilGriefFx(f.host);
    fx.beginScan();
    fx.see(g, 'guardian');
    fx.endScan();
    f.advance(fx, 2);
    expect(f.puffs.length).toBe(0);
    g.auras = [{ id: COUNCIL_AURAS.enraged } as Entity['auras'][number]];
    fx.beginScan();
    fx.see(g, 'guardian');
    fx.endScan();
    f.advance(fx, 1);
    expect(f.puffs.length).toBeGreaterThan(0);
    const before = f.puffs.length;
    g.auras = [];
    fx.beginScan();
    fx.see(g, 'guardian');
    fx.endScan();
    f.advance(fx, 1);
    expect(f.puffs.length).toBe(before);
  });
});
