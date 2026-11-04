// The whole-body tints the renderer hands each character rig every frame
// (src/render/character_effects.ts applyCharacterBodyTints): the Thornhollow
// rune lean and the Quench's frost glaze painted on the body's own material.
import { expect, it } from 'vitest';
import { applyCharacterBodyTints } from '../src/render/character_effects';
import type { QuenchGlaze } from '../src/render/smith_heart_fx/quench_glaze_core';
import { QUENCH_AURAS } from '../src/sim/encounters/smith_heart/quench_ids';
import type { Entity } from '../src/sim/types';

const rig = () => {
  const seen: { rune: (number | null)[]; glaze: (QuenchGlaze | null)[] } = { rune: [], glaze: [] };
  return {
    seen,
    setRuneTint: (c: number | null) => seen.rune.push(c),
    setFrostGlaze: (g: QuenchGlaze | null) => seen.glaze.push(g ? { ...g } : null),
  };
};
const body = (auras: object[]) => ({ pos: { x: 0, y: 0, z: 0 }, auras }) as unknown as Entity;

it('hands every rig its rune tint and its frost glaze, null when it wears none', () => {
  const r = rig();
  applyCharacterBodyTints(r, body([]), 0);
  expect(r.seen.rune).toEqual([null]);
  expect(r.seen.glaze).toEqual([null]);
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
