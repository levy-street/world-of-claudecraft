// Pure geometry/material assertions for the procedural quest ground objects
// (src/render/quest_objects.ts), covering the royal_seal ("Ancient Diary")
// book that has no GLB and previously fell through to the generic
// supply_crate fallback. No renderer/WebGL context is needed: THREE.Group/
// Mesh/Geometry/Material construction runs fine under plain Node.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { linkPiecesOf } from '../src/render/compile_gate_pieces';
import {
  buildGroundQuestObject,
  noItemPickMaterialForTest,
  questObjectCacheInternalsForTest,
} from '../src/render/quest_objects';
import { disposeUnsharedMeshResources, isSharedMaterial } from '../src/render/shared_resource';

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

describe('the no-item pick proxy (the placed feast entity view) and the compile gate', () => {
  // The MEASUREMENT behind the shared material (Masterwrought phase 18, item
  // feast-click-proxy-compile-unit): the entity view gate enumerates the proxy
  // as one material group of its root (linkPiecesOf), so a feast view costs
  // one compile-gate unit either way. What a fresh MeshBasicMaterial per view
  // added was a LINK inside that unit: removeView disposed the only material
  // holding the plain-MeshBasicMaterial program, so the next feast's unit
  // linked it cold again. Shared and dispose-exempt, the unit is a
  // program-cache hit after the first feast of a session.
  const proxyOf = (group: THREE.Group): THREE.Mesh => {
    const meshes: THREE.Mesh[] = [];
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    expect(meshes).toHaveLength(1);
    return meshes[0];
  };

  it('every feast view wears the ONE shared proxy material, tagged dispose-exempt', () => {
    const a = proxyOf(buildGroundQuestObject('', 501).group);
    const b = proxyOf(buildGroundQuestObject('', 502).group);
    expect(a.material).toBe(b.material);
    expect(a.material).toBe(noItemPickMaterialForTest());
    expect(isSharedMaterial(a.material as THREE.Material)).toBe(true);
    expect((a.material as THREE.Material).type).toBe('MeshBasicMaterial');
    // Still the invisible, non-casting click body at the feast contract bounds.
    expect(a.visible).toBe(false);
    expect(a.castShadow).toBe(false);
    // Geometry stays per view: the raycast box is the view's own.
    expect(a.geometry).not.toBe(b.geometry);
  });

  it("removeView's per-view teardown frees the box and leaves the shared material resident", () => {
    const { group } = buildGroundQuestObject('', 503);
    const proxy = proxyOf(group);
    const materialDispose = vi.spyOn(proxy.material as THREE.Material, 'dispose');
    const geometryDispose = vi.spyOn(proxy.geometry, 'dispose');
    // The renderer's non-pooled object teardown (removeView).
    const counts = disposeUnsharedMeshResources(group, { geometries: true, materials: true });
    expect(counts).toEqual({ geometries: 1, materials: 0 });
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).not.toHaveBeenCalled();
    materialDispose.mockRestore();
    geometryDispose.mockRestore();
  });

  it('a feast view is exactly one compile-gate piece, keyed on the shared material', () => {
    // One material group per gated root: the unit exists (the gate must still
    // enumerate the proxy, since a root with no piece would settle nothing),
    // and two views key their piece on the SAME material, which is what makes
    // the second one a cache hit rather than a link.
    const first = buildGroundQuestObject('', 504).group;
    const second = buildGroundQuestObject('', 505).group;
    const firstPieces = linkPiecesOf(first);
    const secondPieces = linkPiecesOf(second);
    expect(firstPieces).toHaveLength(1);
    expect(secondPieces).toHaveLength(1);
    expect((firstPieces[0][0] as THREE.Mesh).material).toBe(
      (secondPieces[0][0] as THREE.Mesh).material,
    );
  });

  it('is never cloned: a clone would inherit the shared tag and leak (source pin)', () => {
    // shared_resource.ts: Material.copy deep-copies userData, so a clone of a
    // tagged material is dispose-exempt forever. The proxy has one consumer
    // and it hands the material straight to the mesh.
    const src = readFileSync(new URL('../src/render/quest_objects.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).toContain(
      'const NO_ITEM_PICK_MATERIAL = markSharedMaterial(new THREE.MeshBasicMaterial());',
    );
    expect(src).not.toContain('NO_ITEM_PICK_MATERIAL.clone(');
    expect(src.split('NO_ITEM_PICK_MATERIAL').length - 1).toBe(3);
    expect(src).not.toMatch(/new THREE\.MeshBasicMaterial\(\),\n\s*\);/);
  });
});
