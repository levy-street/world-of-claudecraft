// Gesture mesh toggles on a BONE (src/render/characters/gesture_mesh_toggles.ts):
// Olen's held shield rides its own Shield bone, so hiding it scales the bone to
// nothing and holds it there after every mixer pass (a clip that does not key
// the bone restores it), and showing it brings it back to rest.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BONE_HIDDEN_SCALE,
  GestureMeshToggles,
} from '../src/render/characters/gesture_mesh_toggles';

describe('gesture mesh toggles on a bone', () => {
  it('hides by scale, holds it through the mixer, and shows at rest', () => {
    const model = new THREE.Group();
    const hand = new THREE.Bone();
    hand.name = 'L_Hand';
    const shield = new THREE.Bone();
    shield.name = 'Shield';
    hand.add(shield);
    model.add(hand);
    const toggles = new GestureMeshToggles(model, [
      { nodes: ['Shield'], hideNow: 'away', showNow: 'home' },
    ]);
    expect(toggles.handle('away')).toBe(true);
    expect(shield.scale.x).toBe(BONE_HIDDEN_SCALE);
    expect(shield.visible).toBe(true);
    // The mixer restores the unkeyed bone: the toggle holds it hidden again.
    shield.scale.setScalar(1);
    toggles.update(1 / 60, 'Idle');
    expect(shield.scale.y).toBe(BONE_HIDDEN_SCALE);
    expect(toggles.hidden()).toBe('partial');
    expect(toggles.handle('home')).toBe(true);
    expect(shield.scale.z).toBe(1);
    toggles.update(1 / 60, 'Idle');
    expect(shield.scale.x).toBe(1);
    expect(toggles.hidden()).toBe('none');
  });
});
