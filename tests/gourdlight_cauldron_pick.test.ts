// The Gurglegreen Cauldron's click volume (round 11 playtest: "clicking to drink works
// only sometimes"). Its art is the toys' layer's (seasonal_toys_fx.ts); the ground object
// is a pick volume only (pick_only_objects.ts), raycast by world_picking.ts with three's
// own Raycaster, exactly as here.
//
// The cause the playtest hit: the volume was an OPEN-ENDED cylinder with a front-side
// material. From the usual third-person camera, looking down onto the pot, the ray enters
// through the open top, meets only the inner (back) faces of the far wall, which three
// culls, and leaves through the open bottom: the click on the brew, the very thing a player
// aims at, missed. Only a click on the pot's outer side, from low enough, landed. Pinned
// here: from above, from the player's usual angle and from the side, a click anywhere on
// the drawn pot (its brew, its rim, its belly) lands, and the volume wraps the drawn pot.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildPickOnlyObjectBody } from '../src/render/pick_only_objects';
import { CAULDRON_DRAWN } from '../src/render/seasonal_toys_fx_core';
import { GURGLEGREEN_CAULDRON_ID } from '../src/sim/content/gourdlight_eve';

const TEMPLATE = `ground_${GURGLEGREEN_CAULDRON_ID}`;

function placedBody(): THREE.Group {
  const { group } = buildPickOnlyObjectBody(TEMPLATE);
  const root = new THREE.Group();
  root.position.set(10, 2, -4);
  root.add(group);
  root.updateMatrixWorld(true);
  return root;
}

/** A click: a ray from `from` toward the world point `at`. */
function hits(root: THREE.Object3D, from: THREE.Vector3, at: THREE.Vector3): number {
  const ray = new THREE.Raycaster(from, at.clone().sub(from).normalize());
  return ray.intersectObject(root, true).length;
}

describe('the Gurglegreen Cauldron click volume', () => {
  const base = new THREE.Vector3(10, 2, -4);
  const rimY = CAULDRON_DRAWN.rimHeight;
  const belly = CAULDRON_DRAWN.bellyRadius;

  it('takes a click on the brew from straight above', () => {
    const root = placedBody();
    for (const [dx, dz] of [
      [0, 0],
      [0.3, 0.1],
      [-0.2, -0.35],
    ]) {
      const at = base.clone().add(new THREE.Vector3(dx, rimY, dz));
      const above = at.clone().add(new THREE.Vector3(0, 12, 0));
      expect(hits(root, above, at), `${dx},${dz}`).toBeGreaterThan(0);
    }
  });

  it('takes a click from the third-person camera angle, on the brew, the rim and the belly', () => {
    const root = placedBody();
    // a camera eight yards back and five up, looking down at the pot
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const eye = base.clone().add(new THREE.Vector3(Math.sin(a) * 8, 5, Math.cos(a) * 8));
      const targets = [
        base.clone().add(new THREE.Vector3(0, rimY * 0.98, 0)),
        base
          .clone()
          .add(new THREE.Vector3(Math.sin(a) * belly * 0.8, rimY * 0.6, Math.cos(a) * belly * 0.8)),
        base.clone().add(new THREE.Vector3(0, rimY * 0.3, 0)),
      ];
      for (const at of targets) expect(hits(root, eye, at), `angle ${k}`).toBeGreaterThan(0);
    }
  });

  it('takes a click from the side, low', () => {
    const root = placedBody();
    const at = base.clone().add(new THREE.Vector3(0, rimY * 0.5, 0));
    expect(hits(root, at.clone().add(new THREE.Vector3(6, 0, 0)), at)).toBeGreaterThan(0);
  });

  it('wraps the drawn pot: as wide as its belly and as tall as its rim', () => {
    const { group, height } = buildPickOnlyObjectBody(TEMPLATE);
    const box = new THREE.Box3().setFromObject(group, true);
    expect(height).toBeGreaterThanOrEqual(rimY);
    expect(box.max.y).toBeGreaterThanOrEqual(rimY);
    expect(box.max.x).toBeGreaterThanOrEqual(belly);
    expect(-box.min.z).toBeGreaterThanOrEqual(belly);
  });

  it('is drawn noticeably bigger than round 10 (a waist-high witch cauldron)', () => {
    // round 10: knee-high, the rim at about 0.63 yd and the belly 0.49 yd round
    expect(rimY).toBeGreaterThan(1);
    expect(belly).toBeGreaterThan(0.8);
  });
});
