// The tail lamp lenses, checked against the SHIPPED mesh.
//
// The lens is deliberately NOT fitted to the mesh: its outline is an imposed
// rounded rectangle, because the painted lamp it covers is artifacted and
// tracing it is what defeated every earlier attempt. But it still has to LAND
// on the car, and it is positioned by constants measured off one render. A
// re-rip that moves the rear end would leave two red rectangles floating in
// space with nothing to say so.
//
// So this casts the same rays the runtime casts and asserts that every one of
// them actually hits bodywork, at a plausible distance, on both lamps.

import * as fs from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { attachVehicleTaillights, RALLYCART_TAILLIGHTS } from '../src/render/vehicle_taillights';

const MODEL = 'public/models/mounts/rallycart_rxt.glb';

interface Gltf {
  nodes: { name?: string; mesh?: number; translation?: number[] }[];
  meshes: { primitives: { attributes: { POSITION: number }; indices?: number }[] }[];
  accessors: {
    bufferView: number;
    byteOffset?: number;
    count: number;
    componentType: number;
  }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
}

function load(): { json: Gltf; bin: Buffer } {
  const buf = fs.readFileSync(MODEL);
  const len = buf.readUInt32LE(12);
  return {
    json: JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as Gltf,
    bin: buf.subarray(20 + len + 8),
  };
}

/** HONOURS byteStride: this model interleaves at 32. */
function readVec3(json: Gltf, bin: Buffer, accessor: number): number[][] {
  const acc = json.accessors[accessor];
  const view = json.bufferViews[acc.bufferView];
  const stride = view.byteStride ?? 12;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out: number[][] = [];
  for (let i = 0; i < acc.count; i++) {
    const at = base + i * stride;
    out.push([bin.readFloatLE(at), bin.readFloatLE(at + 4), bin.readFloatLE(at + 8)]);
  }
  return out;
}

function readIndices(json: Gltf, bin: Buffer, accessor: number): number[] {
  const acc = json.accessors[accessor];
  const view = json.bufferViews[acc.bufferView];
  const width = acc.componentType === 5125 ? 4 : 2;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out: number[] = [];
  for (let i = 0; i < acc.count; i++) {
    const at = base + i * width;
    out.push(width === 4 ? bin.readUInt32LE(at) : bin.readUInt16LE(at));
  }
  return out;
}

/** The chassis as a raycastable mesh, in model space. */
function chassisMesh(): THREE.Mesh {
  const { json, bin } = load();
  const node = json.nodes.find((n) => n.name === 'Chassis');
  const meshIndex = node?.mesh;
  expect(meshIndex, 'Chassis missing: the rig contract changed').toBeDefined();
  if (meshIndex === undefined) throw new Error('Chassis has no mesh');
  const position: number[] = [];
  for (const prim of json.meshes[meshIndex].primitives) {
    const verts = readVec3(json, bin, prim.attributes.POSITION);
    const idx =
      prim.indices === undefined ? verts.map((_, i) => i) : readIndices(json, bin, prim.indices);
    for (const i of idx) position.push(verts[i][0], verts[i][1], verts[i][2]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  return new THREE.Mesh(geometry);
}

const SEG_U = 24;
const SEG_V = 12;
const ROUND = 6;
const CAST_FROM = 0.4;

describe('rallycart tail lamp lenses', () => {
  const mesh = chassisMesh();
  mesh.updateMatrixWorld(true);

  /** Cast the runtime's own ray grid for one lamp and report the hits. */
  const cast = (site: (typeof RALLYCART_TAILLIGHTS)[number]) => {
    const raycaster = new THREE.Raycaster();
    const depths: number[] = [];
    let missed = 0;
    for (let iv = 0; iv <= SEG_V; iv++) {
      const t = (iv / SEG_V) * 2 - 1;
      const half = (1 - Math.abs(t) ** ROUND) ** (1 / ROUND);
      if (!(half > 0)) continue;
      const y = (site.y0 + site.y1) / 2 + t * ((site.y1 - site.y0) / 2);
      for (let iu = 0; iu <= SEG_U; iu++) {
        const s = ((iu / SEG_U) * 2 - 1) * half;
        const angle = (site.angle0 + site.angle1) / 2 + s * ((site.angle1 - site.angle0) / 2);
        const dir = new THREE.Vector3(Math.sin(angle), 0, -Math.cos(angle));
        const origin = new THREE.Vector3(site.axisX, y, site.axisZ).addScaledVector(dir, CAST_FROM);
        raycaster.set(origin, dir.clone().negate());
        const hit = raycaster.intersectObject(mesh, true)[0];
        if (!hit) {
          missed++;
          continue;
        }
        depths.push(CAST_FROM - hit.distance);
      }
    }
    return { depths, missed };
  };

  it('lands every ray on bodywork, both lamps', () => {
    for (const site of RALLYCART_TAILLIGHTS) {
      const { depths, missed } = cast(site);
      expect(depths.length).toBeGreaterThan(200);
      // A miss means the lamp reaches past the car and the lens would hang in
      // space. This is the assertion a re-rip trips.
      expect(
        missed,
        `${missed} of the lens rays hit nothing: the rear end moved, re-measure ` +
          'RALLYCART_TAILLIGHTS against a fresh render.',
      ).toBe(0);
    }
  });

  it('finds a surface at a sane depth, so the lens is not inside the car', () => {
    for (const site of RALLYCART_TAILLIGHTS) {
      const { depths } = cast(site);
      const min = Math.min(...depths);
      const max = Math.max(...depths);
      // The sweep axis sits inboard of the corner, so the bodywork should be
      // roughly 0.10 to 0.20 out from it the whole way around.
      expect(min).toBeGreaterThan(0.05);
      expect(max).toBeLessThan(0.25);
    }
  });

  it('actually wraps the corner rather than sitting flat on the panel', () => {
    // The whole reason for sweeping about an axis. If the angular span ever
    // collapses, the lamp stops turning the corner and this catches it.
    for (const site of RALLYCART_TAILLIGHTS) {
      expect(Math.abs(site.angle1 - site.angle0)).toBeGreaterThan(0.9);
    }
  });

  // The tests above cast the runtime's rays but do their own arithmetic, so
  // they check the CONSTANTS, not the code. This one runs the real attach and
  // is the one that catches a units bug in the measurement itself.
  //
  // A summoned mount is SCALED, about 6x, and the first version of this code
  // subtracted a world-space hit distance from a model-space cast origin. That
  // came out strongly negative, the lens flipped to the far side of its sweep
  // axis, and two huge sheets appeared in front of the car. Building the lens
  // at two different parent scales and demanding the same local geometry pins
  // that down: a mixed-unit measurement cannot survive it.
  const buildAt = (scale: number): number[] => {
    const chassis = chassisMesh();
    const parent = new THREE.Group();
    parent.scale.setScalar(scale);
    parent.add(chassis);
    parent.updateMatrixWorld(true);
    attachVehicleTaillights(chassis, RALLYCART_TAILLIGHTS);
    const out: number[] = [];
    for (const child of chassis.children) {
      const attr = (child as THREE.Mesh).geometry.getAttribute('position');
      for (let i = 0; i < attr.count; i++) out.push(attr.getX(i), attr.getY(i), attr.getZ(i));
    }
    return out;
  };

  it('builds the same lens whatever the mount is scaled to', () => {
    const unit = buildAt(1);
    const summoned = buildAt(6.046);
    expect(unit.length).toBeGreaterThan(0);
    expect(summoned.length).toBe(unit.length);
    for (let i = 0; i < unit.length; i++) expect(summoned[i]).toBeCloseTo(unit[i], 5);
  });

  it('puts every lens vertex on the back of the car, not out in front of it', () => {
    const verts = buildAt(6.046);
    for (let i = 0; i < verts.length; i += 3) {
      const [x, y, z] = [verts[i], verts[i + 1], verts[i + 2]];
      // The rear end: behind the middle of the car, and inside its width and
      // the traced lamp height. A sign error on the depth lands far outside.
      expect(Math.abs(x)).toBeLessThan(0.34);
      expect(z).toBeLessThan(-0.2);
      expect(z).toBeGreaterThan(-0.56);
      expect(y).toBeGreaterThan(0.2);
      expect(y).toBeLessThan(0.31);
    }
  });

  it('keeps the two lamps mirrored', () => {
    const [right, left] = RALLYCART_TAILLIGHTS;
    expect(right.axisX).toBeCloseTo(-left.axisX, 6);
    expect(right.axisZ).toBeCloseTo(left.axisZ, 6);
    expect(right.angle0).toBeCloseTo(-left.angle0, 6);
    expect(right.angle1).toBeCloseTo(-left.angle1, 6);
    expect(right.y0).toBeCloseTo(left.y0, 6);
    expect(right.y1).toBeCloseTo(left.y1, 6);
  });
});
