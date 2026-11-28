// The Basalt Fist's sculpted rock (src/render/smith_heart_fx/heat_fx_core.ts
// HEAT_FIST_SCULPT, audit point 17): the Heart kit's colossus fist and forearm
// replace the bundle of square columns, as one limb.
import { expect, it } from 'vitest';
import { SMITH_HEART_HEART_KIT_PIECES } from '../scripts/assets/smith_heart_heart_kit/build.mjs';
import { HEAT_FIST_SCULPT } from '../src/render/smith_heart_fx/heat_fx_core';

it('builds the fist from the Heart kit pieces the kit ships', () => {
  for (const part of [HEAT_FIST_SCULPT.fist, HEAT_FIST_SCULPT.arm])
    expect(SMITH_HEART_HEART_KIT_PIECES).toContain(part.node.replace(/^Kit_/, ''));
});

it('sets the forearm deep into the fist: one limb, never a block floating over it', () => {
  // The shipped pieces' heights (Blender build log, unscaled yards): the fist about
  // 3.8 tall round its middle, the forearm about 6.7 long round its middle.
  const fistTop = HEAT_FIST_SCULPT.fist.at[1] + (3.8 / 2) * HEAT_FIST_SCULPT.fist.scale;
  const armFoot = HEAT_FIST_SCULPT.arm.at[1] - (6.7 / 2) * HEAT_FIST_SCULPT.arm.scale[1];
  expect(armFoot).toBeLessThan(fistTop - 0.5);
  // ...and the fist's knuckles stay on the floor's side of it.
  expect(HEAT_FIST_SCULPT.fist.at[1]).toBeLessThan(HEAT_FIST_SCULPT.arm.at[1]);
});
