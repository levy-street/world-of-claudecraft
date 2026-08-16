// The Rallycart's steering lock, measured against the SHIPPED mesh.
//
// `vehicle_steering_core.test.ts` proves the measurement is correct on
// geometry built to have a known answer. This one runs it on the real car and
// says what the real car allows, which is the thing that actually keeps the
// tire out of the fender.
//
// It is also the guard for a re-rip. The model is likely to be regenerated from
// Tripo, and the whole point of measuring rather than picking a number is that
// a new mesh with tighter arches quietly gets a smaller lock. If a re-rip
// leaves the wheels with no room to turn at all, that is a modelling problem
// worth failing a test over rather than discovering in game.
//
// The GLB is read by hand rather than through GLTFLoader: its textures are
// KTX2 and would need a transcoder that has no business running in a unit test,
// while positions are plain float32. HONOR byteStride when reading them. These
// buffers are interleaved at stride 32, and ignoring it silently hands back
// normals instead of positions, which measure as a wheel about one unit across
// sitting at the origin.

import * as fs from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildBodyBands,
  measureSteerLimits,
  wheelSilhouette,
} from '../src/render/vehicle_steering_core';

const MODEL = 'public/models/mounts/rallycart_rxt.glb';

interface Gltf {
  nodes: {
    name?: string;
    mesh?: number;
    children?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  meshes: { primitives: { attributes: { POSITION: number }; indices?: number }[] }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; componentType: number }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
}

function readGlb(path: string): { json: Gltf; bin: Buffer } {
  const buf = fs.readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as Gltf;
  // Skip the JSON chunk header (12 byte GLB header + 8 byte chunk header) and
  // the BIN chunk's own 8 byte header.
  const binStart = 20 + jsonLen + 8;
  return { json, bin: buf.subarray(binStart) };
}

/** Vec3 accessor as a flat list, byteStride respected. */
function readVec3(g: Gltf, bin: Buffer, index: number): number[] {
  const acc = g.accessors[index];
  const view = g.bufferViews[acc.bufferView];
  const stride = view.byteStride ?? 12;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out: number[] = [];
  for (let i = 0; i < acc.count; i++) {
    const at = base + i * stride;
    out.push(bin.readFloatLE(at), bin.readFloatLE(at + 4), bin.readFloatLE(at + 8));
  }
  return out;
}

function readIndices(g: Gltf, bin: Buffer, index: number): number[] {
  const acc = g.accessors[index];
  const view = g.bufferViews[acc.bufferView];
  const width = acc.componentType === 5125 ? 4 : acc.componentType === 5123 ? 2 : 1;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out: number[] = [];
  for (let i = 0; i < acc.count; i++) {
    const at = base + i * (view.byteStride ?? width);
    out.push(width === 4 ? bin.readUInt32LE(at) : width === 2 ? bin.readUInt16LE(at) : bin[at]);
  }
  return out;
}

/** Every node's matrix relative to the file root, plus its parent chain. */
function worldMatrices(g: Gltf): Map<number, THREE.Matrix4> {
  const out = new Map<number, THREE.Matrix4>();
  const walk = (i: number, parent: THREE.Matrix4) => {
    const n = g.nodes[i];
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...(n.translation ?? [0, 0, 0])),
      new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
      new THREE.Vector3(...(n.scale ?? [1, 1, 1])),
    );
    const world = new THREE.Matrix4().multiplyMatrices(parent, local);
    out.set(i, world);
    for (const c of n.children ?? []) walk(c, world);
  };
  const child = new Set<number>();
  for (const n of g.nodes) for (const c of n.children ?? []) child.add(c);
  for (let i = 0; i < g.nodes.length; i++) {
    if (!child.has(i)) walk(i, new THREE.Matrix4());
  }
  return out;
}

const nodeIndex = (g: Gltf, name: string) => g.nodes.findIndex((n) => n.name === name);

/** A mesh node's vertices, transformed into `frame`'s space. */
function vertsIn(
  g: Gltf,
  bin: Buffer,
  mats: Map<number, THREE.Matrix4>,
  node: number,
  frame: number,
): number[] {
  const m = new THREE.Matrix4()
    .copy(mats.get(frame) as THREE.Matrix4)
    .invert()
    .multiply(mats.get(node) as THREE.Matrix4);
  const v = new THREE.Vector3();
  const out: number[] = [];
  for (const prim of g.meshes[g.nodes[node].mesh as number].primitives) {
    const pos = readVec3(g, bin, prim.attributes.POSITION);
    for (let i = 0; i + 2 < pos.length; i += 3) {
      v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(m);
      out.push(v.x, v.y, v.z);
    }
  }
  return out;
}

/** A mesh node's triangles, transformed into `frame`'s space. */
function trisIn(
  g: Gltf,
  bin: Buffer,
  mats: Map<number, THREE.Matrix4>,
  node: number,
  frame: number,
): number[] {
  const m = new THREE.Matrix4()
    .copy(mats.get(frame) as THREE.Matrix4)
    .invert()
    .multiply(mats.get(node) as THREE.Matrix4);
  const v = new THREE.Vector3();
  const out: number[] = [];
  for (const prim of g.meshes[g.nodes[node].mesh as number].primitives) {
    const pos = readVec3(g, bin, prim.attributes.POSITION);
    const idx =
      prim.indices === undefined
        ? Array.from({ length: pos.length / 3 }, (_, i) => i)
        : readIndices(g, bin, prim.indices);
    for (const i of idx) {
      v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(m);
      out.push(v.x, v.y, v.z);
    }
  }
  return out;
}

const deg = (rad: number) => (rad * 180) / Math.PI;

describe('rallycart steering lock', () => {
  const { json, bin } = readGlb(MODEL);
  const mats = worldMatrices(json);

  /** Measured lock for one front corner, in radians, before the safety margin. */
  const lockFor = (side: 'FL' | 'FR', grow = 1) => {
    const steer = nodeIndex(json, `Steer_${side}`);
    const wheel = nodeIndex(json, `Wheel_${side}`);
    const chassis = nodeIndex(json, 'Chassis');
    expect(steer, `Steer_${side} missing: the rig contract changed`).toBeGreaterThanOrEqual(0);

    const verts = vertsIn(json, bin, mats, wheel, steer);
    let reach = 0;
    let halfX = 0;
    let halfZ = 0;
    for (let i = 0; i + 2 < verts.length; i += 3) {
      reach = Math.max(reach, Math.hypot(verts[i], verts[i + 2]));
      halfX = Math.max(halfX, Math.abs(verts[i]));
      halfZ = Math.max(halfZ, Math.abs(verts[i + 2]));
    }
    const axleIsX = halfX < halfZ;
    let radius = 0;
    for (let i = 0; i + 2 < verts.length; i += 3) {
      radius = Math.max(radius, Math.hypot(verts[i + 1], axleIsX ? verts[i + 2] : verts[i]));
    }
    const cell = reach / 12;
    // The suspension's own measured envelope for this model: bump runs 15 to
    // 24% of wheel radius per corner, droop 32 to 34%. Taking the widest of
    // each is the worst case the wheel can be in while steering.
    return {
      reach,
      radius,
      limits: measureSteerLimits(
        wheelSilhouette(verts, cell),
        buildBodyBands(trisIn(json, bin, mats, chassis, steer), cell),
        -0.34 * radius,
        0.24 * radius,
        0.7,
        { radius: radius * grow, halfWidth: axleIsX ? halfX : halfZ, axleIsX },
      ),
    };
  };

  it('leaves the front wheels real room to turn, both ways', () => {
    // Both front wheels turn together, so the pair is limited by whichever runs
    // out of room first. This is the number the runtime clamps to.
    let pos = Number.POSITIVE_INFINITY;
    let neg = Number.POSITIVE_INFINITY;
    for (const side of ['FL', 'FR'] as const) {
      const { limits, radius } = lockFor(side);
      console.log(
        `${side}: radius ${radius.toFixed(4)} ` +
          `lock +${deg(limits.pos).toFixed(1)} / -${deg(limits.neg).toFixed(1)} deg`,
      );
      pos = Math.min(pos, limits.pos);
      neg = Math.min(neg, limits.neg);
    }
    console.log(`pair: +${deg(pos).toFixed(1)} / -${deg(neg).toFixed(1)} deg`);

    // A car whose wheels can barely move does not read as steering at all. If a
    // re-rip lands here, its arches are tighter or its wheels are sunk into the
    // bodywork, and that is a modelling fix rather than a tuning one. The point
    // of failing here is that the alternative is finding out in game.
    expect(deg(pos)).toBeGreaterThan(12);
    expect(deg(neg)).toBeGreaterThan(12);
    // And nothing should be reading the 0.7 rad cap, which would mean the
    // measurement found no bodywork at all and is not measuring anything.
    expect(deg(pos)).toBeLessThan(40);
  });
});
