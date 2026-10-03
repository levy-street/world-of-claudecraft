// The Drowned Templeguard holds its trident prongs up and forward
// (scripts/assets/drowned_temple_creatures/choir_folk.py): the guard stance
// raises the forearm, so the trident is modelled prongs DOWN the hanging arm.
// Modelled prongs-up it stood them behind the guard and thrust butt first.
// Forward kinematics on the shipped GLB (glTF axes: +Y up, the model faces +Z).

import { describe, expect, it } from 'vitest';
import { loadGlbPoser } from './helpers/glb_pose';

const glb = loadGlbPoser('public/models/creatures/temple_templeguard.glb');
// Bind-pose model space (Blender (x, y, z) is glTF (x, z, -y)).
const PRONG_TIP: [number, number, number] = [-0.68, -1.54, 0.1];
const BUTT: [number, number, number] = [-0.68, 2.16, 0.1];

describe('the Drowned Templeguard’s trident', () => {
  it('is modelled prongs down the hanging arm (the old prongs-up tip is gone)', () => {
    expect(glb.hasVertexNear(PRONG_TIP, 0.08)).toBe(true);
    expect(glb.hasVertexNear([-0.68, 3.5, 0.1], 0.08)).toBe(false);
  });

  it('stands its prongs up and ahead of the butt at rest', () => {
    const [tip] = glb.track('Idle', 'Hand.R', PRONG_TIP);
    const [butt] = glb.track('Idle', 'Hand.R', BUTT);
    expect(tip[1]).toBeGreaterThan(butt[1] + 2);
    expect(tip[2]).toBeGreaterThan(butt[2]);
    expect(tip[1]).toBeGreaterThan(3.5);
  });

  it('thrusts prongs first: at the lunge the tip leads, far ahead of the butt', () => {
    const tips = glb.track('Attack', 'Hand.R', PRONG_TIP);
    const butts = glb.track('Attack', 'Hand.R', BUTT);
    let k = 0;
    for (let i = 1; i < tips.length; i++) if (tips[i][2] > tips[k][2]) k = i;
    expect(tips[k][2]).toBeGreaterThan(butts[k][2] + 2);
    expect(tips[k][2]).toBeGreaterThan(2.5);
  });
});
