// Which bones the shipped boss bodies' regions ride, read from their GLBs' skins at rest
// (tests/helpers/posed_glb.ts restSkinnedVertices). Each pin is a fault a per-bone floor and
// edge-stretch audit found in a body that had already shipped:
// - the crypt dragons' wing membranes rode their hips and spine (the rig took membrane only near a
//   spar), so the wings tore from the body in every flap and stood up off the corpse;
// - the Shipwreck Captain's forearms were fused to his waist where they hang against it, so every
//   swing dragged a sheet out of his side;
// - the Great Jaguar's left forepaw rode its spine, so it sank through the floor in every crouch.

import { describe, expect, it } from 'vitest';
import { restSkinnedVertices } from './helpers/posed_glb';

const CREATURES = 'public/models/creatures';

function share(w: Map<string, number>, pick: (bone: string) => boolean): number {
  let s = 0;
  for (const [bone, x] of w) if (pick(bone)) s += x;
  return s;
}

const isWing = (b: string) => b.startsWith('wing.') || b.startsWith('finger.');
const isTorso = (b: string) => b === 'hips' || b === 'spine' || b === 'chest';
const isForearm = (b: string) => /^(lowerarm|hand|fingers)\.[lr]$/.test(b);

describe('the boss bodies ride the right bones', () => {
  for (const url of ['woc_crypt_ossuary_drake.glb', 'woc_crypt_knellwyrm.glb']) {
    it(`${url}: everything far out on a wing rides the wing`, async () => {
      // Exported at the rig's own size: about 2 tall, the wings 1.5 to 1.6 out to each side.
      const vs = await restSkinnedVertices(`${CREATURES}/${url}`);
      const far = vs.filter((v) => Math.abs(v.pos[0]) > 0.6 && v.pos[1] > 0.5);
      expect(far.length, 'the wings are there').toBeGreaterThan(1000);
      const offWing = far.filter((v) => share(v.weights, isWing) < 0.95);
      expect(offWing.length).toBe(0);
    });
  }

  it('the Shipwreck Captain: no forearm pulls on his waist below the armpits', async () => {
    // His armpits stand at 1.33 of his 1.9.
    const vs = await restSkinnedVertices(`${CREATURES}/woc_bastion_captain.glb`);
    expect(Math.max(...vs.map((v) => v.pos[1]))).toBeCloseTo(1.9, 1);
    const mixed = vs.filter(
      (v) =>
        v.pos[1] < 1.33 && share(v.weights, isForearm) >= 0.1 && share(v.weights, isTorso) >= 0.1,
    );
    expect(mixed.length).toBe(0);
  });

  it('the Great Jaguar: nothing at its soles rides its body', async () => {
    // At its in-game size (6.2 yd to the headdress): the soles' band, 0.3 yd up.
    const vs = await restSkinnedVertices(`${CREATURES}/woc_basin_jaguar.glb`);
    const soles = vs.filter((v) => v.pos[1] < 0.3);
    expect(soles.length, 'the paws are there').toBeGreaterThan(100);
    expect(soles.filter((v) => share(v.weights, isTorso) > 0.5).length).toBe(0);
  });
});
