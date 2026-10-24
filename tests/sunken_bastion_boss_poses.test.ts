// What the Sunken Bastion bosses' clips DO, read from the shipped GLBs (Reuben 2026-10-11): each
// carries his weapon the same way standing and walking (Ossick's Idle once hung the cudgel
// head-down while his walk and guard shouldered it, so it flipped every time he stopped), and
// each death ends lying on the floor with the weapon dropped flat beside him, not kneeling in a
// heap with the weapon standing up.

import { describe, expect, it } from 'vitest';
import { clipLength, posedNodes } from './helpers/posed_glb';

const BOSSES = [
  {
    name: 'Knight-Commander Olen',
    glb: 'public/models/creatures/woc_bastion_olen.glb',
    prop: 'sword',
  },
  { name: 'Gaoler Ossick', glb: 'public/models/creatures/woc_bastion_ossick.glb', prop: 'cudgel' },
  {
    name: 'Vael the Fogbinder',
    glb: 'public/models/creatures/woc_bastion_vael.glb',
    prop: 'scythe',
  },
] as const;

const angle = (a: number[], b: number[]) =>
  (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;

describe('the Sunken Bastion bosses hold their weapons one way', () => {
  for (const b of BOSSES) {
    it(`${b.name} carries the ${b.prop} the same way up standing and walking`, async () => {
      const idle = (await posedNodes(b.glb, 'Idle', 0, [b.prop]))[b.prop];
      const walk = (await posedNodes(b.glb, 'Walk', 0, [b.prop]))[b.prop];
      expect(idle.up[1], 'Idle: the weapon points up').toBeGreaterThan(0.3);
      expect(walk.up[1], 'Walk: the weapon points up').toBeGreaterThan(0.3);
      expect(angle(idle.up, walk.up)).toBeLessThan(40);
    });
  }
});

describe('the Sunken Bastion bosses die lying on the floor', () => {
  for (const b of BOSSES) {
    it(`${b.name} ends his Death lying down, the ${b.prop} dropped flat`, async () => {
      const names = ['hips', 'chest', 'head', b.prop];
      const stand = await posedNodes(b.glb, 'Idle', 0, names);
      const end = await clipLength(b.glb, 'Death');
      const dead = await posedNodes(b.glb, 'Death', end, names);
      const tall = stand.head.pos[1];
      // down at floor level (a prone or supine body's joints sit mid-body, a hand or so up)
      for (const n of ['hips', 'chest', 'head'] as const)
        expect(dead[n].pos[1], `${n} at rest`).toBeLessThan(0.25 * tall);
      // the body lies along the floor: hips to chest is near level
      const run = [0, 1, 2].map((i) => dead.chest.pos[i] - dead.hips.pos[i]);
      const len = Math.hypot(run[0], run[1], run[2]);
      expect(Math.abs(run[1]) / len, 'the torso lies flat').toBeLessThan(0.35);
      // the weapon lies flat on the floor, not standing up out of a heap
      expect(Math.abs(dead[b.prop].up[1]), `the ${b.prop} lies flat`).toBeLessThan(0.3);
      expect(dead[b.prop].pos[1], `the ${b.prop} is on the floor`).toBeLessThan(0.12 * tall);
    });
  }
});
