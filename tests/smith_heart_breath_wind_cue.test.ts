// The Breath's wind-direction cue (render/smith_heart_fx/breath_wind_cue.ts;
// look: breath_fight_fx_core.ts WIND_CUE, stormWallLook, stormWallWeight,
// turnArrowAlpha; the redesign of 2026-11-25 in place of the floor's chevron
// grid): a storm wall on the UPWIND edge of the Cornice and one big arrow at
// its middle for two seconds on each turn of the wind. Neither takes a tier:
// the wind's way is what a player acts on, so no preset may thin it.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  easeDir,
  stormWallLook,
  stormWallWeight,
  turnArrowAlpha,
  upwindHeardAt,
  WIND_CUE,
  windShowsBearing,
} from '../src/render/smith_heart_fx/breath_fight_fx_core';
import { BreathWindCue } from '../src/render/smith_heart_fx/breath_wind_cue';

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

  it('shows the turn arrow for its two seconds, faded in and out, then never', () => {
    expect(WIND_CUE.arrowSeconds).toBe(2);
    expect(turnArrowAlpha(-0.1)).toBe(0);
    expect(turnArrowAlpha(0)).toBe(0);
    expect(turnArrowAlpha(WIND_CUE.arrowIn / 2)).toBeGreaterThan(0);
    expect(turnArrowAlpha(1)).toBe(1);
    const late = turnArrowAlpha(WIND_CUE.arrowSeconds - WIND_CUE.arrowOut / 2);
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(1);
    expect(turnArrowAlpha(WIND_CUE.arrowSeconds)).toBe(0);
    expect(turnArrowAlpha(10)).toBe(0);
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

  it('builds one wall and one arrow that take no tier, shown and hidden by paint', () => {
    // The constructor takes no tier or density: every preset draws the same.
    expect(BreathWindCue.length).toBe(2);
    const root = new THREE.Group();
    const cue = new BreathWindCue(root, 60);
    expect(root.children).toHaveLength(2);
    const north = { x: 0, z: 1 };
    for (let i = 0; i < 30; i++) cue.paint(1, north, 1, north, 1 / 20, false);
    expect(cue.wall.visible).toBe(true);
    expect(cue.arrow.visible).toBe(true);
    // The arrow points the way the wind blows.
    expect(cue.arrow.rotation.y).toBeCloseTo(0, 6);
    cue.paint(1, north, 1, { x: 1, z: 0 }, 1 / 20, false);
    expect(cue.arrow.rotation.y).toBeCloseTo(Math.PI / 2, 6);
    cue.paint(1, north, 0, north, 1 / 20, false);
    expect(cue.arrow.visible).toBe(false);
    for (let i = 0; i < 60; i++) cue.paint(0, north, 0, north, 1 / 20, false);
    expect(cue.wall.visible).toBe(false);
    cue.paint(1, north, 1, north, 1 / 20, false);
    cue.hide();
    expect(cue.wall.visible).toBe(false);
    expect(cue.arrow.visible).toBe(false);
    cue.dispose();
    expect(root.children).toHaveLength(0);
  });
});
