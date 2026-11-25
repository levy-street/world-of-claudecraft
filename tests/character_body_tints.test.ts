// The whole-body tints the renderer hands each character rig every frame
// (src/render/character_effects.ts applyCharacterBodyTints): the Thornhollow
// rune lean and the Quench's frost glaze painted on the body's own material.
import { expect, it } from 'vitest';
import { applyCharacterBodyTints } from '../src/render/character_effects';
import { easeSink, treadsWater } from '../src/render/characters/water_sink_core';
import type { QuenchGlaze } from '../src/render/smith_heart_fx/quench_glaze_core';
import { QUENCH_TRAPPED_SINK } from '../src/render/smith_heart_fx/quench_glaze_core';
import { QUENCH_AURAS } from '../src/sim/encounters/smith_heart/quench_ids';
import type { Entity } from '../src/sim/types';

const rig = () => {
  const seen: { rune: (number | null)[]; glaze: (QuenchGlaze | null)[]; sink: number[] } = {
    rune: [],
    glaze: [],
    sink: [],
  };
  return {
    seen,
    setRuneTint: (c: number | null) => seen.rune.push(c),
    setFrostGlaze: (g: QuenchGlaze | null) => seen.glaze.push(g ? { ...g } : null),
    setWaterSink: (d: number) => seen.sink.push(d),
  };
};
const body = (auras: object[]) => ({ pos: { x: 0, y: 0, z: 0 }, auras }) as unknown as Entity;

it('hands every rig its rune tint and its frost glaze, null when it wears none', () => {
  const r = rig();
  applyCharacterBodyTints(r, body([]), 0);
  expect(r.seen.rune).toEqual([null]);
  expect(r.seen.glaze).toEqual([null]);
  expect(r.seen.sink).toEqual([0]);
});

it('a cold body wears the glaze climbing with its bar; leaving the cold releases it', () => {
  const r = rig();
  applyCharacterBodyTints(r, body([{ id: QUENCH_AURAS.cold, value: 30 }]), 0);
  applyCharacterBodyTints(r, body([{ id: QUENCH_AURAS.cold, value: 80 }]), 0);
  applyCharacterBodyTints(r, body([]), 0);
  const [a, b, c] = r.seen.glaze;
  expect(a?.alpha).toBeGreaterThan(0);
  expect(b?.height).toBeGreaterThan(a?.height ?? 1);
  expect(c).toBeNull();
});

it('a body fallen through the ice is drawn treading the water chest deep, and climbs back out', () => {
  const r = rig();
  applyCharacterBodyTints(r, body([{ id: QUENCH_AURAS.cold, value: 40 }]), 0);
  applyCharacterBodyTints(r, body([{ id: QUENCH_AURAS.trapped, kind: 'root' }]), 0);
  applyCharacterBodyTints(r, body([]), 0);
  expect(r.seen.sink).toEqual([0, QUENCH_TRAPPED_SINK, 0]);
  // A deep-water swimmer's depth (feet 0.75 under the line), the body
  // treading it (the tread's own sink on top: chest deep), never a body
  // left standing sunk to the hips (the team's playtest of 2026-11-25).
  expect(QUENCH_TRAPPED_SINK).toBeGreaterThan(0.6);
  expect(QUENCH_TRAPPED_SINK).toBeLessThan(1);
  expect(treadsWater(QUENCH_TRAPPED_SINK)).toBe(true);
  expect(treadsWater(0)).toBe(false);
  // The drawn sink eases in quickly, out more slowly, and settles exactly.
  let d = 0;
  for (let i = 0; i < 6; i++) d = easeSink(d, QUENCH_TRAPPED_SINK, 1 / 20);
  expect(d).toBeGreaterThan(QUENCH_TRAPPED_SINK * 0.8);
  let up = QUENCH_TRAPPED_SINK;
  for (let i = 0; i < 6; i++) up = easeSink(up, 0, 1 / 20);
  expect(up).toBeGreaterThan(QUENCH_TRAPPED_SINK - d);
  for (let i = 0; i < 200; i++) up = easeSink(up, 0, 1 / 20);
  expect(up).toBe(0);
});
