// Pure geometry/material assertions for the procedural quest ground objects
// (src/render/quest_objects.ts), covering the royal_seal ("Ancient Diary")
// book that has no GLB and previously fell through to the generic
// supply_crate fallback. No renderer/WebGL context is needed: THREE.Group/
// Mesh/Geometry/Material construction runs fine under plain Node.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildGroundQuestObject,
  questObjectCacheInternalsForTest,
} from '../src/render/quest_objects';

describe('buildGroundQuestObject royal_seal', () => {
  it('returns a populated group, not the generic supply_crate fallback', () => {
    const { group, height } = buildGroundQuestObject('royal_seal', 1);
    let meshCount = 0;
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) meshCount++;
    });
    expect(meshCount).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it('is deterministic: two independent builds produce identical mesh counts and bounds', () => {
    const a = buildGroundQuestObject('royal_seal', 2);
    // Force a second, independent run of the builder rather than a clone of
    // the cached template, so this would actually fail on a non-deterministic
    // (e.g. Math.random-driven) builder.
    questObjectCacheInternalsForTest.resetProceduralCaches();
    const b = buildGroundQuestObject('royal_seal', 2);
    let countA = 0;
    let countB = 0;
    a.group.traverse((o) => {
      if (o instanceof THREE.Mesh) countA++;
    });
    b.group.traverse((o) => {
      if (o instanceof THREE.Mesh) countB++;
    });
    expect(countA).toBe(countB);
    expect(countA).toBeGreaterThan(0);

    a.group.updateMatrixWorld(true);
    b.group.updateMatrixWorld(true);
    const boxA = new THREE.Box3().setFromObject(a.group);
    const boxB = new THREE.Box3().setFromObject(b.group);
    expect(boxA.min.toArray()).toEqual(boxB.min.toArray());
    expect(boxA.max.toArray()).toEqual(boxB.max.toArray());
  });

  it('rotates each instance deterministically by entity id like other ground objects', () => {
    const a = buildGroundQuestObject('royal_seal', 3);
    const b = buildGroundQuestObject('royal_seal', 3);
    expect(a.group.rotation.y).toBeCloseTo(b.group.rotation.y);
    expect(a.group.rotation.y).toBeCloseTo((3 % 7) * 0.45);
  });

  it('sizes the book shorter than the tall wardstone pillar props', () => {
    const { height } = buildGroundQuestObject('royal_seal', 4);
    expect(height).toBeLessThan(2);
    expect(height).toBeGreaterThan(0.3);
  });

  it("anchors the returned height to the group's own measured bounds", () => {
    // The book is wider than it is tall, so normalizeRoot's max(x, y, z) scale
    // target is the width, not the height (the same trap RITUAL_CIRCLE_FOOTPRINT
    // documents): the returned height, used as the nameplate/VFX anchor, must
    // track the model's actual measured top, not a stale scale-target constant.
    const { group, height } = buildGroundQuestObject('royal_seal', 4);
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    expect(height).toBeCloseTo(box.max.y, 5);
  });

  it('closes the book with covers bracketing the page block above and below', () => {
    // Regression guard for the "open crate" bug: the covers used to be vertical
    // front/back walls (full height, thin in depth) with nothing spanning the
    // top face, so the cream page block was the visible topmost surface. A
    // closed tome instead needs two thin, full-footprint slabs (top and
    // bottom covers) that bracket the taller, full-footprint page block.
    const { group } = buildGroundQuestObject('royal_seal', 4);
    group.updateMatrixWorld(true);
    const coverBoxes: THREE.Box3[] = [];
    let pagesBox: THREE.Box3 | null = null;
    group.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const geo = obj.geometry as THREE.BoxGeometry;
      if (!(geo instanceof THREE.BoxGeometry)) return;
      const params = geo.parameters as { width: number; height: number; depth: number };
      if (params.width < 0.8 || params.depth < 0.6) return;
      const box = new THREE.Box3().setFromObject(obj);
      if (params.height < 0.1) coverBoxes.push(box);
      else pagesBox = box;
    });
    expect(coverBoxes.length).toBe(2);
    expect(pagesBox).not.toBeNull();
    const pages = pagesBox as unknown as THREE.Box3;
    const coverTop = Math.max(...coverBoxes.map((b) => b.max.y));
    const coverBottom = Math.min(...coverBoxes.map((b) => b.min.y));
    expect(coverTop).toBeGreaterThanOrEqual(pages.max.y - 1e-4);
    expect(coverBottom).toBeLessThanOrEqual(pages.min.y + 1e-4);
  });

  it('the cover palette reads gold/orange-dominant, matching the icon', () => {
    const { group } = buildGroundQuestObject('royal_seal', 5);
    let coverMat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | null = null;
    let widestX = 0;
    group.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const geo = obj.geometry as THREE.BoxGeometry;
      if (!(geo instanceof THREE.BoxGeometry)) return;
      const params = geo.parameters as { width: number; height: number; depth: number };
      // The top/bottom covers are the two widest, shallow-height boxes.
      if (params.width > widestX && params.height < params.width * 0.2) {
        widestX = params.width;
        coverMat = obj.material as THREE.MeshStandardMaterial;
      }
    });
    expect(coverMat).not.toBeNull();
    const color = (coverMat as unknown as THREE.MeshStandardMaterial).color;
    expect(color.r).toBeGreaterThan(color.b);
    expect(color.r).toBeGreaterThan(0.5);
    expect(color.g).toBeGreaterThan(color.b);
  });
});
