// The lightning of the Guardian of the Breath's entrance (plan:
// breath_entrance_core.ts), a part of breath_entrance_fx.ts: every bolt as a
// camera-facing strip on a spine the CPU writes into one fixed buffer (the
// strikes from the eye onto the floor with their forks, the bolt down the
// funnel's heart as it touches, the arcs crawling over the funnel, the great
// bolt onto the guardian), and the glow where each one lands. One draw for
// the bolts, one for the glows; built once in the host's constructor, never
// allocating per frame. No light.

import * as THREE from 'three';
import { BOLT_POINTS, boltPoint } from './breath_entrance_core';
import { BOLT_FRAG, BOLT_VERT } from './breath_entrance_glsl';
import { GLOW_FRAG, GLOW_VERT } from './council_entrance_glsl';

/** Bolt strips the buffer holds (a strike and its two forks are three). */
export const BOLT_SLOTS = 22;
/** Glows where the bolts land. */
export const GLOW_SLOTS = 8;

/** What the part reads off its host. */
export interface BreathEntranceBoltsHost {
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: THREE.Material[];
}

const _a = { x: 0, y: 0, z: 0 };
const _b = { x: 0, y: 0, z: 0 };
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
/** One spine's points (reused; a strike's forks read it back). */
const spine = new Float32Array(BOLT_POINTS * 3);

export class BreathEntranceBolts {
  readonly mesh: THREE.Mesh;
  readonly glows: THREE.InstancedMesh;
  private readonly pos: THREE.BufferAttribute;
  private readonly dir: THREE.BufferAttribute;
  private readonly bolt: THREE.BufferAttribute;
  private used = 0;
  private glowsUsed = 0;
  private glowsDirty = false;

  constructor(stage: THREE.Group, host: BreathEntranceBoltsHost) {
    const verts = BOLT_SLOTS * BOLT_POINTS * 2;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.dir = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.bolt = new THREE.BufferAttribute(new Float32Array(verts * 2), 2);
    const side = new Float32Array(verts);
    for (let v = 0; v < verts; v++) side[v] = v % 2 === 0 ? -1 : 1;
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.dir.setUsage(THREE.DynamicDrawUsage);
    this.bolt.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('aDir', this.dir);
    geo.setAttribute('aBolt', this.bolt);
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    const index: number[] = [];
    for (let s = 0; s < BOLT_SLOTS; s++) {
      for (let i = 0; i < BOLT_POINTS - 1; i++) {
        const v = (s * BOLT_POINTS + i) * 2;
        index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    geo.setIndex(index);
    host.geometries.push(geo);
    const mat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathEntranceBolts',
      vertexShader: BOLT_VERT,
      fragmentShader: BOLT_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    host.materials.push(mat);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'smithHeartBreathEntranceBolts';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    stage.add(this.mesh);

    const card = new THREE.PlaneGeometry(1, 1);
    host.geometries.push(card);
    const glowMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathEntranceBoltGlows',
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    host.materials.push(glowMat);
    this.glows = new THREE.InstancedMesh(card, glowMat, GLOW_SLOTS);
    this.glows.name = 'smithHeartBreathEntranceBoltGlows';
    this.glows.frustumCulled = false;
    this.glows.visible = false;
    this.glows.renderOrder = 6;
    for (let i = 0; i < GLOW_SLOTS; i++) {
      this.glows.setMatrixAt(i, _zero);
      this.glows.setColorAt(i, _c.setRGB(0, 0, 0));
    }
    stage.add(this.glows);
  }

  /** Start a frame's bolts. */
  begin(): void {
    this.used = 0;
    this.glowsUsed = 0;
  }

  /** Draw one bolt from a to b (stage-local), jagged by `jag`, `width` yards
   *  across (its glow included) at `light`; false when every slot is busy.
   *  Its spine is kept for `fork`. */
  draw(
    seed: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    jag: number,
    width: number,
    light: number,
  ): boolean {
    if (this.used >= BOLT_SLOTS || light <= 0.002) return false;
    const slot = this.used++;
    for (let i = 0; i < BOLT_POINTS; i++) {
      boltPoint(seed, i, ax, ay, az, bx, by, bz, jag, _a);
      spine[i * 3] = _a.x;
      spine[i * 3 + 1] = _a.y;
      spine[i * 3 + 2] = _a.z;
    }
    const pa = this.pos.array as Float32Array;
    const da = this.dir.array as Float32Array;
    const ba = this.bolt.array as Float32Array;
    for (let i = 0; i < BOLT_POINTS; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(BOLT_POINTS - 1, i + 1);
      const dx = spine[i1 * 3] - spine[i0 * 3];
      const dy = spine[i1 * 3 + 1] - spine[i0 * 3 + 1];
      const dz = spine[i1 * 3 + 2] - spine[i0 * 3 + 2];
      // Thinning toward the far end, a touch wider where it lands.
      const k = i / (BOLT_POINTS - 1);
      const w = width * (0.65 + 0.35 * (1 - k) + (k > 0.92 ? 0.3 : 0));
      for (let s = 0; s < 2; s++) {
        const v = (slot * BOLT_POINTS + i) * 2 + s;
        pa[v * 3] = spine[i * 3];
        pa[v * 3 + 1] = spine[i * 3 + 1];
        pa[v * 3 + 2] = spine[i * 3 + 2];
        da[v * 3] = dx;
        da[v * 3 + 1] = dy;
        da[v * 3 + 2] = dz;
        ba[v * 2] = w * 0.5;
        ba[v * 2 + 1] = light;
      }
    }
    return true;
  }

  /** A fork off the last drawn bolt: from its point at share `at` out to
   *  that point plus (ox, oy, oz). */
  fork(
    seed: number,
    at: number,
    ox: number,
    oy: number,
    oz: number,
    width: number,
    light: number,
  ): void {
    const i = Math.min(BOLT_POINTS - 1, Math.max(0, Math.round(at * (BOLT_POINTS - 1))));
    _b.x = spine[i * 3];
    _b.y = spine[i * 3 + 1];
    _b.z = spine[i * 3 + 2];
    this.draw(seed, _b.x, _b.y, _b.z, _b.x + ox, _b.y + oy, _b.z + oz, 0.22, width, light);
  }

  /** A glow at (x, y, z) (stage-local), `size` yards, tinted (r, g, b). */
  glow(x: number, y: number, z: number, size: number, r: number, g: number, b: number): void {
    if (this.glowsUsed >= GLOW_SLOTS) return;
    const i = this.glowsUsed++;
    _p.set(x, y, z);
    _q.identity();
    _s.setScalar(size);
    _m.compose(_p, _q, _s);
    this.glows.setMatrixAt(i, _m);
    this.glows.setColorAt(i, _c.setRGB(r, g, b));
    this.glowsDirty = true;
  }

  /** Finish the frame: unused slots go dark. */
  end(): void {
    const ba = this.bolt.array as Float32Array;
    let changed = this.used > 0;
    for (let s = this.used; s < BOLT_SLOTS; s++) {
      const v0 = s * BOLT_POINTS * 2;
      if (ba[v0 * 2 + 1] === 0) continue;
      changed = true;
      for (let v = v0; v < v0 + BOLT_POINTS * 2; v++) ba[v * 2 + 1] = 0;
    }
    this.mesh.visible = this.used > 0;
    if (this.used > 0) {
      this.pos.needsUpdate = true;
      this.dir.needsUpdate = true;
    }
    if (changed) this.bolt.needsUpdate = true;
    for (let i = this.glowsUsed; i < GLOW_SLOTS; i++) this.glows.setMatrixAt(i, _zero);
    this.glows.visible = this.glowsUsed > 0;
    if (this.glowsDirty || this.glowsUsed > 0) {
      this.glows.instanceMatrix.needsUpdate = true;
      if (this.glows.instanceColor) this.glows.instanceColor.needsUpdate = true;
      this.glowsDirty = this.glowsUsed > 0;
    }
  }

  /** Bolts drawn this frame (the tests read it). */
  liveBolts(): number {
    return this.used;
  }

  hide(): void {
    this.used = 0;
    this.glowsUsed = 0;
    this.end();
  }
}
