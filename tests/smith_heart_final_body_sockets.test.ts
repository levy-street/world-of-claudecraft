// The Masterless Strength's live sockets (final_body_sockets.ts): its heart and its eyes ride
// the rig's own bones while a view of it is drawn, so the effects follow every clip. This
// drives the real module over a small rig: a socket follows its bone, a view still loading
// is hung later, and a view hidden or retired reads as none (the anchors then stand in).

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { FINAL_BODY_SOCKETS } from '../src/render/smith_heart_fx/final_body_core';
import {
  attachFinalBodySockets,
  clearFinalBodySockets,
  finalSocketPoint,
} from '../src/render/smith_heart_fx/final_body_sockets';
import { FINAL_BOSS } from '../src/render/smith_heart_fx/final_fx_core';
import { attachTemplateModelVfx } from '../src/render/template_model_vfx';

/** A view's root with the two bones the sockets ride, under a scene. */
function rig(opts: { skinned?: boolean } = {}) {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.position.set(100, 0, -50);
  root.scale.setScalar(2);
  const chest = new THREE.Bone();
  chest.name = 'Chest';
  chest.position.set(0, 1, 0);
  const head = new THREE.Bone();
  head.name = 'Head';
  head.position.set(0, 0.5, 0);
  chest.add(head);
  root.add(chest);
  const addMesh = () => {
    const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    root.add(mesh);
  };
  if (opts.skinned !== false) addMesh();
  scene.add(root);
  return { scene, root, chest, head, addMesh };
}

const local = (id: 'heart' | 'head') => {
  const s = FINAL_BODY_SOCKETS.find((x) => x.id === id);
  if (!s) throw new Error(`no ${id} socket`);
  return s.local;
};

afterEach(() => clearFinalBodySockets());

describe("the Masterless Strength's live sockets", () => {
  it('reads none until a view of the boss is attached', () => {
    expect(finalSocketPoint('heart', new THREE.Vector3())).toBeNull();
    expect(finalSocketPoint('head', new THREE.Vector3())).toBeNull();
  });

  it('hangs through the template seam for the final boss alone', () => {
    const other = rig();
    attachTemplateModelVfx('heart_guardian_of_nothing', other.root, () => false);
    expect(finalSocketPoint('heart', new THREE.Vector3())).toBeNull();
    const r = rig();
    attachTemplateModelVfx(FINAL_BOSS, r.root, () => false);
    expect(finalSocketPoint('heart', new THREE.Vector3())).not.toBeNull();
  });

  it('rides its bone: at the offset on the rig, following it as the clip moves it', () => {
    const r = rig();
    attachFinalBodySockets(r.root);
    const out = new THREE.Vector3();
    const [hx, hy, hz] = local('heart');
    // root at (100, 0, -50), scaled 2; the chest 1 up.
    expect(finalSocketPoint('heart', out)).toBe(out);
    expect(out.x).toBeCloseTo(100 + 2 * hx, 6);
    expect(out.y).toBeCloseTo(2 * (1 + hy), 6);
    expect(out.z).toBeCloseTo(-50 + 2 * hz, 6);
    // The chest drops and folds forward: the heart goes with it, the head too.
    const [ex, ey, ez] = local('head');
    r.chest.position.set(0, 0.4, 0.3);
    finalSocketPoint('heart', out);
    expect(out.y).toBeCloseTo(2 * (0.4 + hy), 6);
    expect(out.z).toBeCloseTo(-50 + 2 * (0.3 + hz), 6);
    finalSocketPoint('head', out);
    expect(out.x).toBeCloseTo(100 + 2 * ex, 6);
    expect(out.y).toBeCloseTo(2 * (0.4 + 0.5 + ey), 6);
    expect(out.z).toBeCloseTo(-50 + 2 * (0.3 + ez), 6);
    // A turned bone carries its socket round with it.
    r.chest.rotation.x = Math.PI / 2;
    finalSocketPoint('heart', out);
    expect(out.y).toBeCloseTo(2 * (0.4 - hz), 5);
    expect(out.z).toBeCloseTo(-50 + 2 * (0.3 + hy), 5);
  });

  it('attaches once per view: a second attach adds no second socket', () => {
    const r = rig();
    attachFinalBodySockets(r.root);
    attachFinalBodySockets(r.root);
    expect(
      r.chest.children.filter((c) => c.name.startsWith('smithHeartFinalSocket_')),
    ).toHaveLength(1);
    expect(r.head.children.filter((c) => c.name.startsWith('smithHeartFinalSocket_'))).toHaveLength(
      1,
    );
  });

  it('hangs a view whose model was still loading once its mesh has arrived', () => {
    const r = rig({ skinned: false });
    attachFinalBodySockets(r.root);
    const out = new THREE.Vector3();
    expect(finalSocketPoint('heart', out)).toBeNull();
    r.addMesh();
    // Retried on a later read (never every frame), then live.
    let live: THREE.Vector3 | null = null;
    for (let i = 0; i < 40 && !live; i++) live = finalSocketPoint('heart', out);
    expect(live).not.toBeNull();
  });

  it('reads none for a hidden or retired view, and takes the next view attached', () => {
    const r = rig();
    attachFinalBodySockets(r.root);
    const out = new THREE.Vector3();
    r.root.visible = false;
    expect(finalSocketPoint('heart', out)).toBeNull();
    r.root.visible = true;
    expect(finalSocketPoint('heart', out)).not.toBeNull();
    r.scene.remove(r.root);
    expect(finalSocketPoint('heart', out)).toBeNull();
    // Back in the scene it stays let go until the renderer attaches it again.
    r.scene.add(r.root);
    expect(finalSocketPoint('heart', out)).toBeNull();
    attachFinalBodySockets(r.root);
    expect(finalSocketPoint('heart', out)).not.toBeNull();
    const next = rig();
    next.root.position.set(7, 0, 7);
    attachFinalBodySockets(next.root);
    finalSocketPoint('heart', out);
    expect(out.x).toBeCloseTo(7 + 2 * local('heart')[0], 6);
  });
});
