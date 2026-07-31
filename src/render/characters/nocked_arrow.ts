// The arrow visibly nocked on the string hand while the bow cycle draws, holds,
// and arms (bow_cycle.ts). Built lazily once per rig by CharacterVisual and
// toggled by phase; on the launch frame the visual hides it and the flying
// arrow (arrow_projectiles.ts) spawns, so the hand-off reads as one arrow.
import type * as THREE from 'three';
import { buildArrowMesh } from '../arrow_mesh';

// String-hand seat, handslot-local: the nock sits in the fist and the shaft
// runs toward the bow hand. The v04 ranged clips keep the string hand at the
// cheek through draw/hold, so one authored seat reads through the cycle; the
// euler is the measured fist-to-bow-grip direction at the authored full draw
// (tmp probe against the live hold pose, 2026-07-31).
const NOCK_POSITION: [number, number, number] = [0, 0, 0];
const NOCK_EULER: [number, number, number] = [0.073, -0.032, -0.834];
const NOCK_SCALE = 0.8;

/** Attach the nocked arrow to the rig's string hand (right handslot), hidden.
 *  Returns null when the rig has no such slot (non-bow bodies). */
export function attachNockedArrow(model: THREE.Object3D): THREE.Object3D | null {
  const hand = model.getObjectByName('handslot.r') ?? model.getObjectByName('handslotr');
  if (!hand) return null;
  const arrow = buildArrowMesh();
  arrow.name = 'nocked_arrow';
  arrow.position.set(...NOCK_POSITION);
  arrow.rotation.set(...NOCK_EULER);
  arrow.scale.setScalar(NOCK_SCALE);
  arrow.visible = false;
  hand.add(arrow);
  return arrow;
}
