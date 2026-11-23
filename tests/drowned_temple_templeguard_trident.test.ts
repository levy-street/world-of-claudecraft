// The Nacre Templeguard (the seahorse knight, scripts/assets/
// drowned_temple_creatures/templeguard_seahorse/) holds its coral trident
// upright at its post, thrusts it prongs first, and on Skewering Trident
// (the Hurl clip) throws a twin of it straight down the lane while the held
// one leaves the fist. The trident is rigid on the never-keyed Weapon bone,
// the thrown twin on the Thrown bone (scaled to nothing outside the throw).
// Forward kinematics on the shipped, meshopt-compressed GLB (glTF axes: +Y up,
// the model faces +Z).

import { beforeAll, describe, expect, it } from 'vitest';
import { type GlbPoser, loadShippedGlbPoser } from './helpers/glb_pose';

// The haft's two ends in the dequantized bind mesh (the optimizer's
// quantized space; the skin's inverse binds carry them to world yards).
const PRONG_TIP: [number, number, number] = [-0.422, -0.132, 0.95];
const BUTT: [number, number, number] = [-0.443, -0.188, -0.95];

let glb: GlbPoser;
beforeAll(async () => {
  glb = await loadShippedGlbPoser('public/models/creatures/temple_templeguard.glb');
});

const gap = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('the Nacre Templeguard’s trident', () => {
  it('ships the clips the manifest maps, the throw included', () => {
    for (const clip of ['Idle', 'CombatIdle', 'Attack', 'Hurl', 'TridentSweep'])
      expect(glb.clips).toContain(clip);
  });

  it('is modelled with the prongs at one end of the haft and the shell butt at the other', () => {
    expect(glb.hasVertexNear(PRONG_TIP, 0.02)).toBe(true);
    expect(glb.hasVertexNear(BUTT, 0.02)).toBe(true);
  });

  it('stands its prongs up and ahead of the butt at rest', () => {
    const [tip] = glb.track('Idle', 'Weapon', PRONG_TIP);
    const [butt] = glb.track('Idle', 'Weapon', BUTT);
    expect(tip[1]).toBeGreaterThan(butt[1] + 2);
    expect(tip[2]).toBeGreaterThan(butt[2]);
    expect(tip[1]).toBeGreaterThan(3.5);
  });

  it('thrusts prongs first: at the lunge the tip leads, far ahead of the butt', () => {
    const tips = glb.track('Attack', 'Weapon', PRONG_TIP);
    const butts = glb.track('Attack', 'Weapon', BUTT);
    let k = 0;
    for (let i = 1; i < tips.length; i++) if (tips[i][2] > tips[k][2]) k = i;
    expect(tips[k][2]).toBeGreaterThan(butts[k][2] + 2);
    expect(tips[k][2]).toBeGreaterThan(2.5);
  });

  it('keeps the thrown twin hidden outside the throw', () => {
    for (const clip of ['Idle', 'CombatIdle', 'Attack']) {
      const tips = glb.track(clip, 'Thrown', PRONG_TIP);
      const butts = glb.track(clip, 'Thrown', BUTT);
      for (let i = 0; i < tips.length; i++) expect(gap(tips[i], butts[i])).toBeLessThan(0.05);
    }
  });

  it('throws prongs first down the lane, level, while the held trident leaves the fist', () => {
    const tips = glb.track('Hurl', 'Thrown', PRONG_TIP);
    const butts = glb.track('Hurl', 'Thrown', BUTT);
    const held = glb.track('Hurl', 'Weapon', PRONG_TIP);
    const heldButt = glb.track('Hurl', 'Weapon', BUTT);
    let k = 0;
    for (let i = 1; i < tips.length; i++) if (tips[i][2] > tips[k][2]) k = i;
    // far down the lane, point first, flying level
    expect(tips[k][2]).toBeGreaterThan(10);
    expect(tips[k][2]).toBeGreaterThan(butts[k][2] + 3);
    expect(Math.abs(tips[k][1] - butts[k][1])).toBeLessThan(1);
    // the fist is empty while its twin flies
    expect(gap(held[k], heldButt[k])).toBeLessThan(0.05);
    // and the trident is back in the fist when the clip ends
    const last = held.length - 1;
    expect(gap(held[last], heldButt[last])).toBeGreaterThan(3);
  });
});
