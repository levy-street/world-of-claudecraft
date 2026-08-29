// kit_window_panes_core.ts: window-assembly detection plus recessed-glass
// pane extraction for the Eastbrook kit buildings. Synthetic cases pin each
// classification rule and the plane-cluster selection on hand-built box
// assemblies (a frame box with a recessed pane box sharing one exact corner
// vertex); the real-GLB case pins the exact pane set the shipped hexb_home_a
// model yields through the same raw quantized attributes the renderer feeds
// at runtime.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import { kitWindowPanes } from '../src/render/kit_window_panes_core';

function panesOf(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  return kitWindowPanes(
    position.array as ArrayLike<number>,
    position.count,
    (geometry.getIndex()?.array as ArrayLike<number> | undefined) ?? null,
  );
}

// The validated window-assembly recipe: a frame box and a recessed pane box
// sharing one exact corner vertex (their max corner, (0.8, 1.5, 2.0)), so the
// exact-position vertex merge connects them into ONE component. The pane box
// sits 0.02 inside the frame's outer face (z 1.98..2.0) and clear of the
// frame's sill (y 1.2..1.5 against the frame's 0.9..1.5).
function frameBox(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(0.4, 0.6, 0.08).translate(0.6, 1.2, 1.96);
}

function paneBox(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(0.2, 0.3, 0.02).translate(0.7, 1.35, 1.99);
}

// A building shell with the frame-plus-recessed-pane window assembly on its
// +z face, the same shape the render-suite kit fixtures embed in their first
// mesh geometry. The shell shares no vertices with the assembly.
function shellWithWindow(): THREE.BufferGeometry {
  const merged = mergeGeometries([new THREE.BoxGeometry(2, 3, 4), frameBox(), paneBox()], false);
  if (!merged) throw new Error('failed to merge the window fixture');
  return merged;
}

// The pane box's back face (its min-z plane) as a flat triangle soup in the
// box's own triangle order: the exact positions the pane contract emits.
function backFaceSoup(box: THREE.BufferGeometry): number[] {
  const position = box.getAttribute('position') as THREE.BufferAttribute;
  const index = box.getIndex();
  if (!index) throw new Error('expected an indexed box');
  box.computeBoundingBox();
  const minZ = box.boundingBox?.min.z;
  if (minZ === undefined) throw new Error('expected a bounding box');
  const soup: number[] = [];
  for (let triangle = 0; triangle < index.count / 3; triangle++) {
    const corners = [0, 1, 2].map((corner) => index.getX(triangle * 3 + corner));
    if (!corners.every((vertex) => position.getZ(vertex) === minZ)) continue;
    for (const vertex of corners) {
      soup.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
    }
  }
  return soup;
}

// Pinned against the shipped public/models/biome/hexb_home_a.glb bytes: of
// the seven detected window assemblies, five carry a qualifying recessed
// glass plane; the other two go dark by design.
const REAL_GLB_PANE_COUNT = 5;

describe('kit window pane core', () => {
  it('rejects a big wall slab component', () => {
    // One component spanning the whole model: its normalized height is 1,
    // far above the window ceiling, so nothing is emitted.
    expect(panesOf(new THREE.BoxGeometry(2, 3, 4))).toEqual([]);
  });

  it('emits exactly the recessed pane back face for a frame-plus-pane assembly', () => {
    const panes = panesOf(shellWithWindow());
    expect(panes).toHaveLength(1);
    const positions = panes[0].positions;
    // Two triangles of the pane box's back face at z 1.98: the outer face
    // clusters (frame front plus pane front, both at z 2.0) are skipped as
    // the assembly's outer extreme, and the frame's own back face (z 1.92)
    // starts at the sill (y 0.9) so it fails the sill clearance.
    expect(positions).toHaveLength(18);
    for (let vertex = 0; vertex < 6; vertex++) {
      expect(positions[vertex * 3]).toBeGreaterThanOrEqual(0.6 - 1e-6);
      expect(positions[vertex * 3]).toBeLessThanOrEqual(0.8 + 1e-6);
      expect(positions[vertex * 3 + 1]).toBeGreaterThanOrEqual(1.2 - 1e-6);
      expect(positions[vertex * 3 + 1]).toBeLessThanOrEqual(1.5 + 1e-6);
      expect(positions[vertex * 3 + 2]).toBeCloseTo(1.98, 6);
    }
    expect(positions).toEqual(backFaceSoup(paneBox()));
  });

  it('emits the recessed plane across the thin x axis for a side-wall assembly', () => {
    // The recipe rotated onto the +x face: thin across x, so the plane
    // clusters form along x and the pane is the pane box's min-x face.
    const merged = mergeGeometries(
      [
        new THREE.BoxGeometry(2, 3, 4),
        new THREE.BoxGeometry(0.08, 0.6, 0.4).translate(0.96, 1.2, 0.6),
        new THREE.BoxGeometry(0.02, 0.3, 0.2).translate(0.99, 1.35, 0.7),
      ],
      false,
    );
    if (!merged) throw new Error('failed to merge the side-window fixture');
    const panes = panesOf(merged);
    expect(panes).toHaveLength(1);
    const positions = panes[0].positions;
    expect(positions).toHaveLength(18);
    for (let vertex = 0; vertex < 6; vertex++) {
      expect(positions[vertex * 3]).toBeCloseTo(0.98, 6);
      expect(positions[vertex * 3 + 1]).toBeGreaterThanOrEqual(1.2 - 1e-6);
      expect(positions[vertex * 3 + 1]).toBeLessThanOrEqual(1.5 + 1e-6);
      expect(positions[vertex * 3 + 2]).toBeGreaterThanOrEqual(0.6 - 1e-6);
      expect(positions[vertex * 3 + 2]).toBeLessThanOrEqual(0.8 + 1e-6);
    }
  });

  it('emits nothing for a bare frame assembly with no recessed pane', () => {
    // Only the frame box: its outer faces are the component extreme and its
    // back face starts at the sill, so no cluster qualifies. Doors, shuttered
    // windows, and solid dormer faces go dark by design.
    const merged = mergeGeometries([new THREE.BoxGeometry(2, 3, 4), frameBox()], false);
    if (!merged) throw new Error('failed to merge the bare-frame fixture');
    expect(panesOf(merged)).toEqual([]);
  });

  it('rejects a tall low door-like component but keeps the same shape higher up', () => {
    // Same tall 0.4 x 0.9 x 0.08 frame with a recessed pane both times,
    // translated as one assembly so the shared corner stays exact; only the
    // height off the ground changes. In the door band with height 2.25x its
    // width it is a door and emits nothing despite its recessed pane; the
    // raised copy clears the door band and emits the pane's back face.
    const tallAssembly = (dy: number): THREE.BufferGeometry[] => [
      new THREE.BoxGeometry(0.4, 0.9, 0.08).translate(0.6, 1.05, 1.96).translate(0, dy, 0),
      new THREE.BoxGeometry(0.2, 0.45, 0.02).translate(0.7, 1.275, 1.99).translate(0, dy, 0),
    ];
    const door = mergeGeometries([new THREE.BoxGeometry(2, 8, 4), ...tallAssembly(-3.6)], false);
    const raised = mergeGeometries([new THREE.BoxGeometry(2, 8, 4), ...tallAssembly(0)], false);
    if (!door || !raised) throw new Error('failed to merge the door fixtures');
    expect(panesOf(door)).toEqual([]);
    const panes = panesOf(raised);
    expect(panes).toHaveLength(1);
    const positions = panes[0].positions;
    expect(positions).toHaveLength(18);
    for (let vertex = 0; vertex < 6; vertex++) {
      expect(positions[vertex * 3 + 1]).toBeGreaterThanOrEqual(1.05 - 1e-6);
      expect(positions[vertex * 3 + 1]).toBeLessThanOrEqual(1.5 + 1e-6);
      expect(positions[vertex * 3 + 2]).toBeCloseTo(1.98, 6);
    }
  });

  it('prefers the deepest qualifying plane over a wider frame surround plate', () => {
    // The owner-caught round-5 bug: hexb ground-floor windows layer a
    // frame-wide surround plate in front of the true glass, and area-first
    // selection lit the whole arch. Deepest qualifying plane must win.
    const frame = frameBox();
    const plate = new THREE.BoxGeometry(0.36, 0.4, 0.06).translate(0.62, 1.3, 1.95);
    const pane = new THREE.BoxGeometry(0.2, 0.3, 0.02).translate(0.7, 1.35, 1.93);
    const merged = mergeGeometries([new THREE.BoxGeometry(2, 3, 4), frame, plate, pane], false);
    if (!merged) throw new Error('failed to merge the surround fixture');
    const panes = panesOf(merged);
    expect(panes).toHaveLength(1);
    const soup = panes[0].positions;
    expect(soup.length).toBe(18);
    for (let index = 2; index < soup.length; index += 3) {
      expect(soup[index]).toBeCloseTo(1.94, 6);
    }
    const xs = soup.filter((_, index) => index % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(0.6, 6);
    expect(Math.max(...xs)).toBeCloseTo(0.8, 6);
  });

  it('merges split vertices so duplicated positions still form one component', () => {
    // Non-indexed geometry duplicates every shared corner; exact-position
    // merging must reconnect them into the same components as the indexed
    // original and emit the identical single pane soup.
    const split = shellWithWindow().toNonIndexed();
    expect(split.getIndex()).toBeNull();
    const panes = panesOf(split);
    expect(panes).toEqual(panesOf(shellWithWindow()));
    expect(panes).toHaveLength(1);
    expect(panes[0].positions).toEqual(backFaceSoup(paneBox()));
  });

  it('pins the exact pane set of the shipped hexb_home_a kit model', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const document = await io.readBinary(
      readFileSync(path.join(__dirname, '..', 'public/models/biome/hexb_home_a.glb')),
    );
    const primitive = document.getRoot().listMeshes()[0].listPrimitives()[0];
    const position = primitive.getAttribute('POSITION');
    if (!position) throw new Error('hexb_home_a has no POSITION');
    const positions = position.getArray();
    if (!positions) throw new Error('hexb_home_a POSITION has no array');
    const indices = primitive.getIndices()?.getArray() ?? null;

    const panes = kitWindowPanes(positions, position.getCount(), indices);
    expect(panes).toHaveLength(REAL_GLB_PANE_COUNT);

    for (const pane of panes) {
      // A pane is a nonempty triangle soup whose every triangle lies in a
      // plane facing along a horizontal axis (the assembly's thin axis).
      expect(pane.positions.length).toBeGreaterThan(0);
      expect(pane.positions.length % 9).toBe(0);
      for (let triangle = 0; triangle < pane.positions.length / 9; triangle++) {
        const base = triangle * 9;
        const abx = pane.positions[base + 3] - pane.positions[base];
        const aby = pane.positions[base + 4] - pane.positions[base + 1];
        const abz = pane.positions[base + 5] - pane.positions[base + 2];
        const acx = pane.positions[base + 6] - pane.positions[base];
        const acy = pane.positions[base + 7] - pane.positions[base + 1];
        const acz = pane.positions[base + 8] - pane.positions[base + 2];
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        const length = Math.hypot(nx, ny, nz);
        expect(length).toBeGreaterThan(0);
        expect(Math.max(Math.abs(nx), Math.abs(nz)) / length).toBeGreaterThan(0.9);
      }
    }
  });
});
