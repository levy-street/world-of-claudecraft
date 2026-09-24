// The forge gates of the Emberforge Tyrant's ring of fire, drawn: two posts and a
// marked way through for every door of every live ring. Composed by
// hoard_forge_hammer.ts, which owns the rings; WHAT a gate is and where it stands
// is hoard_forge_gate_core.ts beside this file.
//
// Performance contract (the hammer's own): everything is built once in the
// constructor under the hammer's root, so it compiles with the hammer and nothing
// compiles mid-fight. Every gate of every ring shares THREE draw calls (the posts'
// iron, their molten caps, and one floor mesh), nothing is allocated per frame,
// there are no lights, and an idle frame writes nothing. NOTHING here is shed on
// the low tier: a player crosses by these marks, so posts, corridor, threshold
// and chevrons draw on every tier. Only the chevrons' travelling pulse is cosmetic.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FORGE_HAMMER } from '../sim/rift/hoard_forge_hammer_core';
import { surfaceMat } from './gfx';
import {
  FORGE_GATE_LOOK,
  FORGE_GATE_VERTICES,
  type ForgeGateFrame,
  forgeGateFrame,
  forgeGateRadius,
} from './hoard_forge_gate_core';

const LOOK = FORGE_GATE_LOOK;
const GAPS = FORGE_HAMMER.gaps;
const ARC = LOOK.thresholdSegments;

function box(w: number, h: number, d: number, y: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(0, y + h / 2, 0).toNonIndexed();
}

/** A compact forge post: a foot, a six-sided shaft and an anvil-like head in iron;
 *  a hot collar under the head and a ridge along its top in molten metal. */
function postGeometries(): { iron: THREE.BufferGeometry; molten: THREE.BufferGeometry } {
  const shaft = new THREE.CylinderGeometry(0.26, 0.34, 1.35, 6).translate(0, 1.0, 0).toNonIndexed();
  const ironParts = [box(0.95, 0.32, 0.95, 0), shaft, box(1.05, 0.34, 0.7, 1.95)];
  const moltenParts = [box(0.62, 0.3, 0.62, 1.66), box(0.8, 0.12, 0.3, 2.29)];
  const iron = mergeGeometries(ironParts, false);
  const molten = mergeGeometries(moltenParts, false);
  for (const part of [...ironParts, ...moltenParts]) part.dispose();
  if (!iron || !molten) throw new Error('forge gate post failed to merge');
  return { iron, molten };
}

export class HoardForgeGate {
  private readonly iron: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  private readonly molten: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly floor: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly position: THREE.BufferAttribute;
  private readonly color: THREE.BufferAttribute;
  private readonly shown: boolean[];
  private readonly frame: ForgeGateFrame = {
    middle: 0,
    radialX: 0,
    radialZ: 1,
    postA: 0,
    postB: 0,
    edgeA: 0,
    edgeB: 0,
    halfWidth: 1,
  };
  private readonly matrix = new THREE.Matrix4();
  private readonly postScale = new THREE.Vector3().setScalar(LOOK.postScale);
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly edge = new THREE.Color(LOOK.stripEdge);
  private readonly core = new THREE.Color(LOOK.stripCore);
  private readonly chevron = new THREE.Color(LOOK.chevron);
  private postsDirty = false;
  private floorDirty = false;
  private live = 0;

  constructor(
    root: THREE.Group,
    rings: number,
    private readonly animate: boolean,
  ) {
    const posts = postGeometries();
    const count = rings * GAPS * 2;
    const ironMaterial = surfaceMat({
      color: LOOK.iron,
      roughness: 0.55,
      metalness: 0.7,
      emissive: LOOK.ironEmissive,
      emissiveIntensity: 0.6,
      flatShading: true,
    });
    this.iron = new THREE.InstancedMesh(posts.iron, ironMaterial, count);
    this.molten = new THREE.InstancedMesh(
      posts.molten,
      new THREE.MeshBasicMaterial({ color: LOOK.molten, toneMapped: false }),
      count,
    );
    for (const mesh of [this.iron, this.molten]) {
      mesh.name = mesh === this.iron ? 'ForgeGatePost' : 'ForgeGatePostMolten';
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < count; i++) mesh.setMatrixAt(i, this.hidden);
      mesh.frustumCulled = false;
      mesh.visible = false;
      root.add(mesh);
    }

    // One floor mesh for every gate: a fixed block of vertices per gate, indexed
    // once; a hidden gate is a block of zero-area triangles.
    const gates = rings * GAPS;
    const geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(gates * FORGE_GATE_VERTICES * 3), 3);
    this.color = new THREE.BufferAttribute(new Float32Array(gates * FORGE_GATE_VERTICES * 4), 4);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.color.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('color', this.color);
    const index: number[] = [];
    for (let gate = 0; gate < gates; gate++) {
      const base = gate * FORGE_GATE_VERTICES;
      for (let s = 0; s < ARC; s++) index.push(...quad(base + s * 2, base + s * 2 + 1, 2));
      const strip = base + (ARC + 1) * 2;
      for (let q = 0; q < 2 + LOOK.chevrons * 2; q++) index.push(...quad(strip + q * 4, 0, 4));
    }
    geometry.setIndex(index);
    this.floor = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    this.floor.name = 'ForgeGateFloor';
    this.floor.frustumCulled = false;
    this.floor.renderOrder = 20;
    this.floor.visible = false;
    root.add(this.floor);
    this.shown = new Array<boolean>(rings).fill(false);
  }

  /** Draw ring `slot`'s gates. `strength` is the pose's door strength (0..1). */
  write(
    slot: number,
    cueId: number,
    x: number,
    z: number,
    ground: number,
    ringRadius: number,
    strength: number,
    time: number,
  ): void {
    if (strength <= 0.01) {
      this.hide(slot);
      return;
    }
    if (!this.shown[slot]) {
      this.shown[slot] = true;
      this.live++;
    }
    const radius = forgeGateRadius(ringRadius);
    for (let gap = 0; gap < GAPS; gap++) {
      const frame = forgeGateFrame(cueId, gap, radius, this.frame);
      const gate = slot * GAPS + gap;
      this.writePost(gate * 2, frame.postA, x, z, ground, radius);
      this.writePost(gate * 2 + 1, frame.postB, x, z, ground, radius);
      this.writeFloor(gate, frame, x, z, ground, radius, strength, time);
    }
    this.postsDirty = true;
    this.floorDirty = true;
  }

  hide(slot: number): void {
    if (!this.shown[slot]) return;
    this.shown[slot] = false;
    this.live--;
    for (let gap = 0; gap < GAPS; gap++) {
      const gate = slot * GAPS + gap;
      for (let post = 0; post < 2; post++) {
        this.iron.setMatrixAt(gate * 2 + post, this.hidden);
        this.molten.setMatrixAt(gate * 2 + post, this.hidden);
      }
      const base = gate * FORGE_GATE_VERTICES;
      for (let v = 0; v < FORGE_GATE_VERTICES; v++) {
        this.position.setXYZ(base + v, 0, 0, 0);
        this.color.setW(base + v, 0);
      }
    }
    this.postsDirty = true;
    this.floorDirty = true;
  }

  /** Once per frame, after every ring has written or hidden its gates. */
  commit(): void {
    const any = this.live > 0;
    this.iron.visible = any;
    this.molten.visible = any;
    this.floor.visible = any;
    if (this.postsDirty) {
      this.iron.instanceMatrix.needsUpdate = true;
      this.molten.instanceMatrix.needsUpdate = true;
      this.postsDirty = false;
    }
    if (this.floorDirty) {
      this.position.needsUpdate = true;
      this.color.needsUpdate = true;
      this.floorDirty = false;
    }
  }

  private writePost(
    index: number,
    bearing: number,
    x: number,
    z: number,
    ground: number,
    radius: number,
  ): void {
    // Its long head lies along the ring, like a lintel's stump.
    this.matrix.makeRotationY(bearing + Math.PI / 2);
    this.matrix.scale(this.postScale);
    this.matrix.setPosition(x + Math.sin(bearing) * radius, ground, z + Math.cos(bearing) * radius);
    this.iron.setMatrixAt(index, this.matrix);
    this.molten.setMatrixAt(index, this.matrix);
  }

  private writeFloor(
    gate: number,
    frame: ForgeGateFrame,
    x: number,
    z: number,
    ground: number,
    radius: number,
    strength: number,
    time: number,
  ): void {
    let v = gate * FORGE_GATE_VERTICES;
    // ---- the threshold: a gold band from post to post along the ring itself
    const inner = radius - LOOK.thresholdWidth / 2;
    const outer = radius + LOOK.thresholdWidth / 2;
    for (let s = 0; s <= ARC; s++) {
      const bearing = frame.edgeA + ((frame.edgeB - frame.edgeA) * s) / ARC;
      const sx = Math.sin(bearing);
      const sz = Math.cos(bearing);
      this.put(v++, x + sx * inner, ground + 0.12, z + sz * inner, this.edge, 0.9 * strength);
      this.put(v++, x + sx * outer, ground + 0.12, z + sz * outer, this.edge, 0.9 * strength);
    }
    // ---- the corridor through the wall: a border, and a brighter core on it
    const rx = frame.radialX;
    const rz = frame.radialZ;
    const tx = rz;
    const tz = -rx;
    const cx = x + rx * radius;
    const cz = z + rz * radius;
    const half = frame.halfWidth;
    v = this.quadAt(
      v,
      cx,
      cz,
      rx,
      rz,
      tx,
      tz,
      -half,
      half,
      -LOOK.stripBehind,
      LOOK.stripAhead,
      ground + 0.1,
      this.edge,
      0.78 * strength,
    );
    const rim = Math.min(0.35, half * 0.25);
    v = this.quadAt(
      v,
      cx,
      cz,
      rx,
      rz,
      tx,
      tz,
      -half + rim,
      half - rim,
      -LOOK.stripBehind + rim,
      LOOK.stripAhead - rim,
      ground + 0.13,
      this.core,
      0.8 * strength,
    );
    // ---- chevrons pointing THROUGH the wall, the way a player crosses it: in
    const arm = Math.min(1.1, half * 0.62);
    const thick = 0.34;
    for (let c = 0; c < LOOK.chevrons; c++) {
      const tip = LOOK.stripAhead - 1.05 - c * LOOK.chevronSpacing;
      const pulse = this.animate ? 0.78 + 0.22 * Math.sin(time * 6 + c * 1.3) : 1;
      const alpha = strength * pulse;
      for (let side = -1; side <= 1; side += 2) {
        // One arm: from the tip (inward, on the axis) out and back to the side.
        const y = ground + 0.16;
        this.putLocal(v++, cx, cz, rx, rz, tx, tz, 0, tip - 0.62, y, alpha);
        this.putLocal(v++, cx, cz, rx, rz, tx, tz, 0, tip - 0.62 + thick * 1.3, y, alpha);
        this.putLocal(v++, cx, cz, rx, rz, tx, tz, side * arm, tip + 0.3 + thick, y, alpha);
        this.putLocal(v++, cx, cz, rx, rz, tx, tz, side * arm, tip + 0.3, y, alpha);
      }
    }
  }

  private quadAt(
    v: number,
    cx: number,
    cz: number,
    rx: number,
    rz: number,
    tx: number,
    tz: number,
    u0: number,
    u1: number,
    r0: number,
    r1: number,
    y: number,
    color: THREE.Color,
    alpha: number,
  ): number {
    this.put(v++, cx + tx * u0 + rx * r0, y, cz + tz * u0 + rz * r0, color, alpha);
    this.put(v++, cx + tx * u1 + rx * r0, y, cz + tz * u1 + rz * r0, color, alpha);
    this.put(v++, cx + tx * u1 + rx * r1, y, cz + tz * u1 + rz * r1, color, alpha);
    this.put(v++, cx + tx * u0 + rx * r1, y, cz + tz * u0 + rz * r1, color, alpha);
    return v;
  }

  private putLocal(
    v: number,
    cx: number,
    cz: number,
    rx: number,
    rz: number,
    tx: number,
    tz: number,
    u: number,
    r: number,
    y: number,
    alpha: number,
  ): void {
    this.put(v, cx + tx * u + rx * r, y, cz + tz * u + rz * r, this.chevron, alpha);
  }

  private put(v: number, x: number, y: number, z: number, color: THREE.Color, alpha: number): void {
    this.position.setXYZ(v, x, y, z);
    this.color.setXYZW(v, color.r, color.g, color.b, alpha);
  }

  dispose(): void {
    this.iron.geometry.dispose();
    this.molten.geometry.dispose();
    this.molten.material.dispose();
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    this.iron.removeFromParent();
    this.molten.removeFromParent();
    this.floor.removeFromParent();
  }
}

/** Two triangles of a quad. With `stride` 2 the quad is a ribbon cell (a, b and
 *  the pair after them); with 4 it is four consecutive vertices from `a`. */
function quad(a: number, b: number, stride: 2 | 4): number[] {
  if (stride === 2) return [a, b, a + 2, b, b + 2, a + 2];
  return [a, a + 1, a + 2, a, a + 2, a + 3];
}
