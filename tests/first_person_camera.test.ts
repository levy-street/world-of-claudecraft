import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterVisual } from '../src/render/characters';
import { FirstPersonRig, type FirstPersonSelfView } from '../src/render/first_person_camera';

function fixture() {
  const rig = new FirstPersonRig();
  const camera = new THREE.PerspectiveCamera();
  const lookAt = new THREE.Vector3();
  const setHeadHidden = vi.fn();
  const visual = { root: new THREE.Group(), setHeadHidden } as unknown as CharacterVisual;
  const self = {
    group: new THREE.Group(),
    visual,
    height: 2.86,
    mountLift: 0,
    liveScale: 1,
    wasSwimming: false,
  };
  const place = (view: FirstPersonSelfView = self, dist = 3, blocked = false) =>
    rig.place(camera, lookAt, view, new THREE.Vector3(), 0, 0.2, dist, blocked);
  return { rig, camera, lookAt, self, setHeadHidden, place };
}

describe('first-person camera consumer', () => {
  it('restores the head when zooming out, disabling, or blocking the camera', () => {
    const f = fixture();
    for (const exit of ['zoom', 'off', 'blocked']) {
      f.rig.setMode(1);
      expect(f.place()).toBe(true);
      expect(f.setHeadHidden).toHaveBeenLastCalledWith(true);
      if (exit === 'off') f.rig.setMode(0);
      expect(f.place(f.self, exit === 'zoom' ? 4 : 3, exit === 'blocked')).toBe(false);
      expect(f.setHeadHidden).toHaveBeenLastCalledWith(false);
    }
  });

  it('keeps the underwater chase pose while swimming and re-enters on land', () => {
    const f = fixture();
    f.rig.setMode(1);
    f.place();
    // A 2.86 yd warrior with feet 1.3 yd below water is submerged. The
    // upright eye would sit 1.33 yd above water, defeating the chase ceiling.
    f.self.group.position.y = -1.3;
    f.self.wasSwimming = true;
    f.camera.position.set(0, -0.5, -3);
    expect(f.place()).toBe(false);
    expect(f.camera.position.toArray()).toEqual([0, -0.5, -3]);
    expect(f.setHeadHidden).toHaveBeenLastCalledWith(false);
    f.self.wasSwimming = false;
    expect(f.place()).toBe(true);
  });

  it('restores the base head while a separate form is drawn', () => {
    const f = fixture();
    f.rig.setMode(1);
    f.place();
    // The form-visibility consumer hides the base root when another form wins.
    f.self.visual.root.visible = false;
    expect(f.place()).toBe(false);
    expect(f.setHeadHidden).toHaveBeenLastCalledWith(false);
    f.self.visual.root.visible = true;
    expect(f.place()).toBe(true);
  });

  it('restores the old head on a visual swap and hides only the local body', () => {
    const f = fixture();
    f.rig.setMode(1);
    f.place();
    const next = fixture();
    f.place(next.self);
    expect(f.setHeadHidden).toHaveBeenLastCalledWith(false);
    expect(next.setHeadHidden).toHaveBeenLastCalledWith(true);
    f.rig.setMode(2);
    f.place(next.self);
    expect(next.setHeadHidden).toHaveBeenLastCalledWith(false);
    expect(next.self.group.visible).toBe(false);
    expect(f.self.group.visible).toBe(true);
  });
});
