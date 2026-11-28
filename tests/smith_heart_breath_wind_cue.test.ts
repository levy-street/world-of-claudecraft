// The Breath's wind-direction cue (render/smith_heart_fx/breath_wind_cue.ts;
// look: breath_fight_fx_core.ts WIND_CUE, stormWallLook, stormWallWeight,
// turnArrowAlpha; the redesign of 2026-11-25 in place of the floor's chevron
// grid): a storm wall on the UPWIND edge of the Cornice and, on each turn of
// the wind, a few small arrows down its two sides lit one after another for
// about two seconds (Jose's look of 2026-11-25: the one big centre arrow was
// too big; nothing in the middle where the raid fights). Neither takes a tier:
// the wind's way is what a player acts on, so no preset may thin it.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  easeDir,
  stormWallLook,
  stormWallWeight,
  turnArrowAlpha,
  turnArrowAlphaAt,
  turnArrowSpots,
  upwindHeardAt,
  WIND_CUE,
  windShowsBearing,
} from '../src/render/smith_heart_fx/breath_fight_fx_core';
import { BreathWindCue } from '../src/render/smith_heart_fx/breath_wind_cue';
import { BREATH } from '../src/sim/content/smith_heart_layout';
import { inBreathArena } from '../src/sim/encounters/smith_heart/breath_geometry';

describe('the Breath wind cue', () => {
  it('stands the storm wall on the side the wind blows FROM, never the side it blows to', () => {
    // The wind blows north (+z): the wall stands on the south rim.
    expect(stormWallWeight(0, -1, 0, 1)).toBe(1);
    expect(stormWallWeight(0, 1, 0, 1)).toBe(0);
    // Abeam: gone (the wall is one side's, never a ring).
    expect(stormWallWeight(1, 0, 0, 1)).toBe(0);
    // Easing between: a quarter off upwind still stands most of it.
    const q = stormWallWeight(-Math.SQRT1_2, -Math.SQRT1_2, 0, 1);
    expect(q).toBeGreaterThan(0.5);
    expect(q).toBeLessThan(1);
  });

  it('reads the phase: whole in the blow, rising in the turn, gone at rest and in the breath', () => {
    expect(stormWallLook('blow', 0.5)).toBe(1);
    expect(stormWallLook('gust', 0.1)).toBe(1);
    const g0 = stormWallLook('gather', 0);
    const g1 = stormWallLook('gather', 1);
    expect(g0).toBeGreaterThan(0.3);
    expect(g1).toBeGreaterThan(g0);
    for (const p of ['calm', 'still', 'storm', 'inhale', 'exhale', null] as const) {
      expect(stormWallLook(p, 0.5)).toBe(0);
      expect(windShowsBearing(p)).toBe(false);
    }
    for (const p of ['gather', 'gustgather', 'blow', 'gust'] as const)
      expect(windShowsBearing(p)).toBe(true);
  });

  it('lights each side arrow in turn down the flow, translucent, all gone in about two seconds', () => {
    const A = WIND_CUE;
    expect(turnArrowAlpha(-0.1)).toBe(0);
    expect(turnArrowAlpha(0)).toBe(0);
    expect(turnArrowAlpha(A.arrowIn / 2)).toBeGreaterThan(0);
    expect(turnArrowAlpha(0.8)).toBe(1);
    expect(turnArrowAlpha(A.arrowSeconds)).toBe(0);
    // Slightly translucent at their fullest.
    expect(turnArrowAlphaAt(0.8, 0)).toBeCloseTo(A.arrowOpacity, 6);
    expect(A.arrowOpacity).toBeLessThan(0.85);
    expect(A.arrowOpacity).toBeGreaterThan(0.5);
    // The one downwind lights after the one upwind of it.
    expect(turnArrowAlphaAt(A.arrowIn / 2, 0)).toBeGreaterThan(0);
    expect(turnArrowAlphaAt(A.arrowIn / 2, 2)).toBe(0);
    // Every arrow gone by about two seconds.
    const end = A.arrowSeconds + (A.arrowPerSide - 1) * A.arrowStagger;
    expect(end).toBeGreaterThan(1.7);
    expect(end).toBeLessThanOrEqual(2.1);
    for (let k = 0; k < A.arrowPerSide; k++) expect(turnArrowAlphaAt(end, k)).toBe(0);
  });

  it('lays the small arrows down both sides, on the floor, never in the middle', () => {
    const C = BREATH.cornice;
    for (let deg = 0; deg < 360; deg += 15) {
      const a = (deg * Math.PI) / 180;
      const dir = { x: Math.sin(a), z: Math.cos(a) };
      const spots = turnArrowSpots(dir);
      // Three a side (a wind channel's notch may cost a row one).
      expect(spots.length, `bearing ${deg}`).toBeGreaterThanOrEqual(WIND_CUE.arrowPerSide * 2 - 2);
      expect(spots.length).toBeLessThanOrEqual(WIND_CUE.arrowPerSide * 2);
      let left = 0;
      let right = 0;
      for (const p of spots) {
        expect(inBreathArena(p.x, p.z)).toBe(true);
        const dx = p.x - C.x;
        const dz = p.z - C.z;
        // Off to the side of the wind's line through the middle, well clear of it.
        const across = dx * dir.z - dz * dir.x;
        const r = 1 / Math.hypot(dir.z / C.rx, dir.x / C.rz);
        expect(Math.abs(across), `bearing ${deg}`).toBeGreaterThan(r * 0.35);
        if (across > 0) right++;
        else left++;
      }
      expect(left, `bearing ${deg}`).toBeGreaterThanOrEqual(WIND_CUE.arrowPerSide - 1);
      expect(right, `bearing ${deg}`).toBeGreaterThanOrEqual(WIND_CUE.arrowPerSide - 1);
    }
    // Staggered: no arrow of one row sits level with one of the other.
    const north = turnArrowSpots({ x: 0, z: 1 });
    const zs = (sideSign: number) =>
      north.filter((p) => Math.sign(p.x - C.x) === sideSign).map((p) => p.z);
    for (const a of zs(1)) for (const b of zs(-1)) expect(Math.abs(a - b)).toBeGreaterThan(1.5);
    // Each smaller than a quarter of the old 13 by 20 yd arrow's area.
    expect(WIND_CUE.arrowWidth * WIND_CUE.arrowLength).toBeLessThanOrEqual((13 * 20) / 4 + 1e-9);
  });

  it('swings the wall round to a new bearing, never through nothing', () => {
    const cur = { x: 0, z: 1 };
    // Straight about: every step stays a unit and it ends turned round.
    for (let i = 0; i < 200; i++) {
      easeDir(cur, { x: 0, z: -1 }, 0.08);
      expect(Math.hypot(cur.x, cur.z)).toBeCloseTo(1, 6);
    }
    expect(cur.z).toBeLessThan(-0.99);
  });

  it('hears the wind from upwind of the player', () => {
    const at = upwindHeardAt({ x: 10, y: 60, z: 10 }, { x: 0, z: 1 }, 20);
    expect(at).toEqual({ x: 10, y: 60, z: -10 });
  });

  it('builds one wall and one row of arrows that take no tier, shown and hidden by paint', () => {
    // The constructor takes no tier or density: every preset draws the same.
    expect(BreathWindCue.length).toBe(2);
    const root = new THREE.Group();
    const cue = new BreathWindCue(root, 60);
    expect(root.children).toHaveLength(2);
    const north = { x: 0, z: 1 };
    for (let i = 0; i < 30; i++) cue.paint(1, north, 0.8, north, 1 / 20, false);
    expect(cue.wall.visible).toBe(true);
    expect(cue.arrow.visible).toBe(true);
    expect(cue.arrow.count).toBe(turnArrowSpots(north).length);
    // Each arrow points the way the wind blows, at its own side spot.
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    cue.arrow.getMatrixAt(0, m);
    m.decompose(pos, q, sc);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    expect(fwd.z).toBeCloseTo(1, 6);
    expect(pos.x).toBeCloseTo(turnArrowSpots(north)[0].x, 6);
    // A new way turns the row.
    cue.paint(1, north, 0.8, { x: 1, z: 0 }, 1 / 20, false);
    cue.arrow.getMatrixAt(0, m);
    m.decompose(pos, q, sc);
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(q).x).toBeCloseTo(1, 6);
    // Past their window, and with no turn shown: gone.
    cue.paint(1, north, 5, north, 1 / 20, false);
    expect(cue.arrow.visible).toBe(false);
    cue.paint(1, north, -1, north, 1 / 20, false);
    expect(cue.arrow.visible).toBe(false);
    for (let i = 0; i < 60; i++) cue.paint(0, north, -1, north, 1 / 20, false);
    expect(cue.wall.visible).toBe(false);
    cue.paint(1, north, 0.8, north, 1 / 20, false);
    cue.hide();
    expect(cue.wall.visible).toBe(false);
    expect(cue.arrow.visible).toBe(false);
    cue.dispose();
    expect(root.children).toHaveLength(0);
  });
});
