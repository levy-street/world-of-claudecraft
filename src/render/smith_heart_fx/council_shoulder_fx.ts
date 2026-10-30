// The Hammer Council's Shouldered Stone (encounters/smith_heart/council_shoulder.ts),
// a part of CouncilFx: while the Slabwright has company, a shell of granite plates
// with gold cracks closes round it and an ochre thread of light runs to each member
// within reach; pulled away, the shell bursts into rock. It says who is protected
// and why, so every tier draws it. Built in the constructor under the host's root
// (one gated attach), fixed pieces, no light, no per-frame allocation; the members
// are found at the host's scan pace.

import * as THREE from 'three';
import { SMITH_HEART_VEIN_COLORS } from '../../sim/content/smith_heart_layout';
import {
  COUNCIL_AURAS,
  councilRoleOf,
  COUNCIL_TUNING as T,
} from '../../sim/encounters/smith_heart/council_ids';
import type { Entity } from '../../sim/types';
import { COUNCIL_BODY_HEIGHTS } from './council_bodies_core';
import { shoulderShellScale } from './council_fx_core';
import type { CouncilFxHost } from './council_pillars_fx';
import { KIT_UV_VERT, SHELL_FRAG } from './final_kit_glsl';
import { shellStone } from './final_kit_shapes';

const THREAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** The thread: light running along it from the Slabwright to its kin. */
const THREAD_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float run = 0.55 + 0.45 * sin(vUv.y * 18.0 - uTime * 7.0);
  gl_FragColor = vec4(uColor * (0.9 + 0.8 * run), 0.5 + 0.45 * run);
  #include <colorspace_fragment>
}
`;

/** Height of the thread above the floor (yards, about a body's chest). */
const THREAD_Y = 2.6;
const THREAD_R = 0.13;
const BURST_PIECES = 14;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class CouncilShoulderFx {
  private readonly shell: THREE.Mesh;
  private readonly threads: THREE.Mesh[] = [];
  private slabId = -1;
  private readonly kin: number[] = [];
  private scanSlab = -1;
  private readonly scanKin: number[] = [];
  private hardened = false;
  private hardenedFor = 0;

  constructor(private readonly h: CouncilFxHost) {
    const shellGeo = shellStone();
    const threadGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true)
      .translate(0, 0.5, 0)
      .rotateX(Math.PI / 2);
    h.geometries.push(shellGeo, threadGeo);
    const shellMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilShoulderShell',
      uniforms: {
        uTime: h.uTime,
        uStone: { value: new THREE.Color(0x5a5048) },
        uGold: { value: new THREE.Color(1.0, 0.78, 0.36) },
      },
      vertexShader: KIT_UV_VERT,
      fragmentShader: SHELL_FRAG,
      transparent: true,
      depthWrite: false,
    });
    const threadMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilShoulderThread',
      uniforms: {
        uTime: h.uTime,
        uColor: { value: new THREE.Color(SMITH_HEART_VEIN_COLORS.hammer) },
      },
      vertexShader: THREAD_VERT,
      fragmentShader: THREAD_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    h.materials.push(shellMat, threadMat);
    this.shell = new THREE.Mesh(shellGeo, shellMat);
    this.shell.name = 'smithHeartCouncilShoulderShell';
    this.shell.visible = false;
    this.shell.frustumCulled = false;
    h.root.add(this.shell);
    for (let i = 0; i < 2; i++) {
      const thread = new THREE.Mesh(threadGeo, threadMat);
      thread.name = 'smithHeartCouncilShoulderThread';
      thread.visible = false;
      thread.frustumCulled = false;
      h.root.add(thread);
      this.threads.push(thread);
    }
  }

  beginScan(): void {
    this.scanSlab = -1;
    this.scanKin.length = 0;
  }

  /** A living council member the host's scan found. */
  see(e: Entity): void {
    if (councilRoleOf(e.templateId) === 'slabwright') this.scanSlab = e.id;
    else this.scanKin.push(e.id);
  }

  endScan(): void {
    this.slabId = this.scanSlab;
    this.kin.length = 0;
    for (const id of this.scanKin) this.kin.push(id);
  }

  update(dt: number): void {
    const slab = this.slabId >= 0 ? this.h.entity(this.slabId) : undefined;
    const on = !!slab && !slab.dead && slab.auras.some((a) => a.id === COUNCIL_AURAS.shouldered);
    if (!on || !slab) {
      if (this.hardened) this.shatter();
      return;
    }
    if (!this.hardened) {
      this.hardened = true;
      this.hardenedFor = 0;
    }
    this.hardenedFor += dt;
    const { x, z } = slab.pos;
    const y = this.h.groundY(x, z);
    this.shell.position.set(x, y, z);
    this.shell.scale.setScalar(
      shoulderShellScale(this.hardenedFor, COUNCIL_BODY_HEIGHTS.slabwright),
    );
    this.shell.visible = true;
    let used = 0;
    for (const id of this.kin) {
      const k = this.h.entity(id);
      if (!k || k.dead || used >= this.threads.length) continue;
      if (Math.hypot(k.pos.x - x, k.pos.z - z) > T.shoulderReach) continue;
      const thread = this.threads[used++];
      _a.set(x, y + THREAD_Y, z);
      _b.set(k.pos.x, this.h.groundY(k.pos.x, k.pos.z) + THREAD_Y, k.pos.z);
      thread.position.copy(_a);
      thread.lookAt(_b);
      thread.scale.set(THREAD_R, THREAD_R, _a.distanceTo(_b));
      thread.visible = true;
    }
    for (let i = used; i < this.threads.length; i++) this.threads[i].visible = false;
  }

  /** Pulled away (or fallen): the shell bursts into rock and the threads go. */
  private shatter(): void {
    this.hardened = false;
    const { x, y, z } = this.shell.position;
    this.shell.visible = false;
    for (const t of this.threads) t.visible = false;
    const n = Math.ceil(BURST_PIECES * this.h.density);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = 3 + this.h.rand() * 5;
      this.h.debris.throw(
        x + Math.sin(a) * 1.5,
        y + 1.5 + this.h.rand() * 2,
        z + Math.cos(a) * 1.5,
        Math.sin(a) * sp,
        3 + this.h.rand() * 6,
        Math.cos(a) * sp,
        0.3 + this.h.rand() * 0.6,
      );
    }
  }
}
