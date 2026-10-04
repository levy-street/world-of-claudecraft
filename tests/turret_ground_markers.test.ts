import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { floorVfxLayerOf, floorVfxRenderOrder } from '../src/render/floor_vfx_layer';
import {
  TURRET_MARKER_LIFT,
  TURRET_MARKER_MATRIX_FLOATS,
  TurretMarkerGround,
  turretMarkerRadius,
} from '../src/render/turret_ground_marker_core';
import {
  TURRET_MARKER_NAME,
  TURRET_MARKER_ORDER,
  TurretGroundMarkers,
  turretMarkerGeometry,
} from '../src/render/turret_ground_markers';
import { drawsUnder, threeProgramKeys } from './helpers/three_program_keys';

const flat = { ground: () => 0 };
const living = { state: 'march' as const, hp: 10 };
const at = (x: number, z: number) => ({ x, y: 0, z, windup: -1 });

function meshOf(markers: TurretGroundMarkers): THREE.InstancedMesh {
  const mesh = markers.root.children[0];
  if (!(mesh instanceof THREE.InstancedMesh)) throw new Error('marker pool expected');
  return mesh;
}

describe('Fire and Fly ground markers, drawn', () => {
  it('faces every triangle of the disc up, a soft fill inside a crisp bright ring and a dark rim', () => {
    const geometry = turretMarkerGeometry();
    const position = geometry.getAttribute('position');
    const color = geometry.getAttribute('color');
    expect(color.itemSize).toBe(4);
    const index = geometry.getIndex();
    if (!index) throw new Error('indexed disc expected');
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    let fillAlpha = 0;
    let ringAlpha = 0;
    let ringTint = 0;
    let rimTint = Number.POSITIVE_INFINITY;
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(position, index.getX(i));
      b.fromBufferAttribute(position, index.getX(i + 1));
      c.fromBufferAttribute(position, index.getX(i + 2));
      expect(a.y === 0 && b.y === 0 && c.y === 0).toBe(true);
      const up = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      expect(up.y, `triangle ${i / 3}`).toBeGreaterThan(0);
    }
    let ringRadius = 0;
    const fillTint = color.getX(0);
    for (let v = 0; v < position.count; v++) {
      const r = Math.hypot(position.getX(v), position.getZ(v));
      expect(r).toBeLessThanOrEqual(1 + 1e-6);
      if (v > 0 && color.getX(v) === fillTint) fillAlpha = Math.max(fillAlpha, color.getW(v));
      if (color.getW(v) > ringAlpha) {
        ringAlpha = color.getW(v);
        ringTint = color.getX(v);
        ringRadius = r;
      }
      if (r > 0.999) rimTint = Math.min(rimTint, color.getX(v));
    }
    // The fill deepens toward its edge and stays see-through; the ring is brighter and near opaque.
    expect(color.getW(0)).toBeLessThan(fillAlpha);
    expect(fillAlpha).toBeLessThanOrEqual(0.5);
    expect(ringAlpha).toBeGreaterThan(0.9);
    expect(ringTint).toBeGreaterThan(fillTint);
    expect(ringTint).toBeGreaterThanOrEqual(1);
    expect(ringRadius).toBeGreaterThan(0.6);
    expect(ringRadius).toBeLessThan(0.97);
    expect(rimTint).toBeLessThan(0.3);
    geometry.dispose();
  });

  it('builds nothing until the commitment, then one instanced draw behind the compile gate', async () => {
    let settle: () => void = () => {};
    const gate = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));
    const markers = new TurretGroundMarkers(flat, gate);
    expect(markers.root.children).toHaveLength(0);
    markers.begin();
    markers.push(living, at(3, 4), 0.6, new TurretMarkerGround());
    markers.end();
    expect(markers.drawn).toBe(0);
    const parent = new THREE.Group();
    markers.prepare(parent, 12);
    expect(markers.root.parent).toBe(parent);
    expect(gate).toHaveBeenCalledWith(markers.root);
    expect(markers.root.visible).toBe(false);
    const mesh = meshOf(markers);
    expect(markers.root.children).toHaveLength(1);
    expect(mesh.instanceMatrix.count).toBe(12);
    settle();
    await Promise.resolve();
    await Promise.resolve();
    expect(markers.root.visible).toBe(true);
    markers.prepare(parent, 12);
    expect(gate).toHaveBeenCalledTimes(1);
    markers.dispose();
  });

  it('draws on its own named, unlit, fogless material, never culled, over the dust and under the encounter band', () => {
    const markers = new TurretGroundMarkers(flat);
    markers.prepare(new THREE.Group(), 4);
    const mesh = meshOf(markers);
    const material = mesh.material as THREE.MeshBasicMaterial;
    expect(material.name).toBe(TURRET_MARKER_NAME);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.fog).toBe(false);
    expect(material.toneMapped).toBe(false);
    expect(material.vertexColors).toBe(true);
    expect(material.side).toBe(THREE.FrontSide);
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.renderOrder).toBe(TURRET_MARKER_ORDER);
    expect(floorVfxLayerOf(TURRET_MARKER_ORDER)).toBe('player');
    // The cannon's puff draw sits on the player band's rung 4.
    expect(TURRET_MARKER_ORDER).toBeGreaterThan(floorVfxRenderOrder('player', 4));
    expect(TURRET_MARKER_ORDER).toBeLessThan(floorVfxRenderOrder('encounter'));
    // One program: instanced, vertex RGBA, one pass.
    const draws = drawsUnder(markers.root);
    expect(draws).toHaveLength(1);
    const keys = threeProgramKeys(draws[0].material, draws[0].object).split('\n');
    expect(keys).toHaveLength(1);
    markers.dispose();
  });

  it('reads no graphics tier: the markers are the same on every preset', () => {
    const source = readFileSync(
      new URL('../src/render/turret_ground_markers.ts', import.meta.url),
      'utf8',
    );
    for (const tierSource of ['./gfx', 'ui_effects_profile', 'render_budget', 'crowd_lod']) {
      expect(source).not.toContain(tierSource);
    }
  });

  it('writes one matrix per shown marker, at the ground, sized by radius, and uploads only those', () => {
    const markers = new TurretGroundMarkers(flat);
    markers.prepare(new THREE.Group(), 6);
    const mesh = meshOf(markers);
    markers.begin();
    markers.push(living, at(3, 4), 0.6, new TurretMarkerGround());
    markers.push({ state: 'dead', hp: 0 }, at(9, 9), 0.6, new TurretMarkerGround());
    markers.push({ state: 'fly', hp: 4 }, at(-68, 12), 1.2, new TurretMarkerGround());
    markers.push(
      { state: 'windup', hp: 4 },
      { x: 1, y: 0, z: 1, windup: 0.3 },
      0.6,
      new TurretMarkerGround(),
    );
    markers.end();
    expect(markers.drawn).toBe(2);
    expect(mesh.count).toBe(2);
    expect(mesh.visible).toBe(true);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    mesh.getMatrixAt(0, m);
    m.decompose(p, q, s);
    expect(p.x).toBeCloseTo(3, 5);
    expect(p.y).toBeCloseTo(TURRET_MARKER_LIFT, 5);
    expect(p.z).toBeCloseTo(4, 5);
    expect(s.x).toBeCloseTo(turretMarkerRadius(0.6), 5);
    // Far across the clearing, still drawn.
    mesh.getMatrixAt(1, m);
    m.decompose(p, q, s);
    expect(p.x).toBeCloseTo(-68, 5);
    expect(s.x).toBeCloseTo(turretMarkerRadius(1.2), 5);
    const ranges = mesh.instanceMatrix.updateRanges;
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({ start: 0, count: 2 * TURRET_MARKER_MATRIX_FLOATS });
    expect(mesh.instanceMatrix.version).toBeGreaterThan(0);
    // A frame with nothing to show draws nothing.
    markers.begin();
    markers.push({ state: 'gone', hp: 0 }, at(0, 0), 0.6, new TurretMarkerGround());
    markers.end();
    expect(markers.drawn).toBe(0);
    expect(mesh.visible).toBe(false);
    markers.dispose();
  });

  it('never writes past its pool, and reuses the same buffer and upload range every frame', () => {
    const markers = new TurretGroundMarkers(flat);
    markers.prepare(new THREE.Group(), 2);
    const mesh = meshOf(markers);
    const array = mesh.instanceMatrix.array;
    let range: unknown = null;
    for (let frame = 0; frame < 3; frame++) {
      markers.begin();
      for (let i = 0; i < 5; i++) markers.push(living, at(i, frame), 0.5, new TurretMarkerGround());
      markers.end();
      expect(markers.drawn).toBe(2);
      expect(mesh.instanceMatrix.array).toBe(array);
      const [only] = mesh.instanceMatrix.updateRanges;
      if (range === null) range = only;
      expect(only).toBe(range);
      // three clears the ranges once it uploads.
      mesh.instanceMatrix.clearUpdateRanges();
    }
    markers.dispose();
  });

  it('swaps in a larger pool on the same material and geometry when a plan fields more bodies', () => {
    const gate = vi.fn(() => Promise.resolve());
    const markers = new TurretGroundMarkers(flat, gate);
    const parent = new THREE.Group();
    markers.prepare(parent, 3);
    const first = meshOf(markers);
    const disposed = vi.spyOn(first, 'dispose');
    markers.prepare(parent, 8);
    const second = meshOf(markers);
    expect(second).not.toBe(first);
    expect(markers.root.children).toEqual([second]);
    expect(second.material).toBe(first.material);
    expect(second.geometry).toBe(first.geometry);
    expect(second.instanceMatrix.count).toBe(8);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledTimes(1);
    markers.begin();
    for (let i = 0; i < 8; i++) markers.push(living, at(i, 0), 0.5, new TurretMarkerGround());
    markers.end();
    expect(markers.drawn).toBe(8);
    markers.dispose();
  });

  it('releases its pool, geometry and material on dispose, and builds nothing after', () => {
    const parent = new THREE.Group();
    const markers = new TurretGroundMarkers(flat);
    markers.prepare(parent, 4);
    const mesh = meshOf(markers);
    const spies = [
      vi.spyOn(mesh, 'dispose'),
      vi.spyOn(mesh.geometry, 'dispose'),
      vi.spyOn(mesh.material as THREE.Material, 'dispose'),
    ];
    markers.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(markers.root.parent).toBeNull();
    markers.prepare(parent, 4);
    expect(markers.capacity).toBe(0);
    markers.begin();
    markers.push(living, at(0, 0), 0.5, new TurretMarkerGround());
    markers.end();
    expect(markers.drawn).toBe(0);
  });
});
