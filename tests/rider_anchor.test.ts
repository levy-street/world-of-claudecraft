import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createRiderAnchor, syncRiderAnchor } from '../src/render/rider_anchor';

// The body-attached aura anchor (src/render/rider_anchor.ts). The bug it
// closes: a mounted rider's body is carried above the view group by the saddle
// lift, and every self-attached visual parented to the group at `height` stayed
// at the dismounted body. The anchor follows the rider root's local position
// (and only its position) so those visuals ride the saddle with him.

function viewRig(lift: number) {
  const group = new THREE.Group();
  group.position.set(10, 4, -6);
  const riderRoot = new THREE.Group();
  riderRoot.position.set(0, lift, 0.35);
  riderRoot.rotation.x = 0.4; // a mount jump attitude tilt
  const anchor = createRiderAnchor();
  group.add(riderRoot, anchor);
  return { group, riderRoot, anchor };
}

describe('syncRiderAnchor', () => {
  it('carries the anchor to the rider root position while mounted', () => {
    const { group, riderRoot, anchor } = viewRig(1.15);
    const crown = new THREE.Object3D();
    crown.position.y = 1.8;
    anchor.add(crown);
    syncRiderAnchor(anchor, riderRoot);
    group.updateMatrixWorld(true);
    const world = new THREE.Vector3();
    crown.getWorldPosition(world);
    expect(world.y).toBeCloseTo(4 + 1.15 + 1.8, 10);
    expect(world.z).toBeCloseTo(-6 + 0.35, 10);
    expect(world.x).toBeCloseTo(10, 10);
  });

  it('copies position only: the mount jump tilt never reaches the visuals', () => {
    const { riderRoot, anchor } = viewRig(1.15);
    syncRiderAnchor(anchor, riderRoot);
    expect(anchor.rotation.x).toBe(0);
    expect(anchor.quaternion.equals(new THREE.Quaternion())).toBe(true);
  });

  it('returns to the origin on dismount and for a view with no rig', () => {
    const { riderRoot, anchor } = viewRig(1.15);
    syncRiderAnchor(anchor, riderRoot);
    riderRoot.position.set(0, 0, 0);
    syncRiderAnchor(anchor, riderRoot);
    expect(anchor.position.toArray()).toEqual([0, 0, 0]);
    anchor.position.set(1, 2, 3);
    syncRiderAnchor(anchor, null);
    expect(anchor.position.toArray()).toEqual([0, 0, 0]);
  });

  it('is attached to every view group at build time', () => {
    const src = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    // The one line every body-attached buff hangs on: the anchor is a child of
    // the view group, added right where the anchor is minted (before the
    // character/object branch), so no view carries a detached anchor.
    expect(src).toMatch(/const riderAnchor = createRiderAnchor\(\);\s*group\.add\(riderAnchor\);/);
    expect(src.split('group.add(riderAnchor)').length).toBe(2);
  });

  it('is synced by the renderer after the mount pass places the rider', () => {
    const src = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const mountPass = src.indexOf('updateMountPresentation(v, {');
    const sync = src.indexOf('syncRiderAnchor(v.riderAnchor, v.visual.root)');
    expect(mountPass).toBeGreaterThan(0);
    expect(sync).toBeGreaterThan(mountPass);
  });

  it('parents every body-attached aura visual to the rider anchor, not the view group', () => {
    const src = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    for (const sync of [
      'syncIceBlockVisual',
      'syncTemporalHourglassVisual',
      'syncMageBarrierVisual',
      'syncPriestMarkersVisual',
      'syncPaladinAvengingWrathVisual',
      'syncPaladinSunVerdictVisual',
    ]) {
      expect(src, sync).toMatch(new RegExp(`${sync}\\(\\s*v\\.\\w+,\\s*v\\.riderAnchor,`));
    }
    // The Recklessness skull orbit sits above the head: it rides too.
    expect(src).toMatch(/recklessSkulls\.spawn\(v\.riderAnchor,/);
    // The crown rides the saddle; its ground seal stays on the ground.
    expect(src).toMatch(
      /syncPaladinAscensionVisual\(\s*v\.paladinAscensionVisual,\s*v\.group,\s*v\.riderAnchor,/,
    );
    // Ground-plane visuals keep the view group on purpose.
    for (const sync of ['syncFrostNovaRootVisual', 'syncPaladinAegisVisual']) {
      expect(src, sync).toMatch(new RegExp(`${sync}\\(\\s*v\\.\\w+,\\s*v\\.group,`));
    }
  });
});
