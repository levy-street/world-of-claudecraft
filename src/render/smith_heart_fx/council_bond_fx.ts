// The Hammer Council's Bond of the Stone (encounters/smith_heart/council.ts,
// COUNCIL_AURAS.bond), a part of CouncilFx: while the two members stand within
// reach of each other (either one wears the bond) a bright gold thread of light
// runs between them, flaring on each raid pulse (COUNCIL_CUES.bondPulse) with a
// ring at both ends. It says why the council takes so little damage and that the
// tanks must pull them apart, so every tier draws it; only the motes thin.
// Built in the constructor under the host's root (one gated attach), fixed
// pieces, no light, no per-frame allocation; the members are found at the
// host's scan pace.

import * as THREE from 'three';
import type { Aura, Entity } from '../../sim/types';
import { fxAnchor } from '../attached_fx_anchor';
import { bondThreadLook, COUNCIL_FX_COLORS as C, COUNCIL_AURAS } from './council_fx_core';
import type { CouncilFxHost } from './council_pillars_fx';

const THREAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** The thread: light running along it from one member to the other. */
const THREAD_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float run = 0.55 + 0.45 * sin(vUv.y * 18.0 - uTime * 7.0);
  gl_FragColor = vec4(uColor * (0.9 + 0.8 * run), uAlpha * (0.5 + 0.45 * run));
  #include <colorspace_fragment>
}
`;

/** Height of the thread above the floor (yards, about a body's chest). */
const THREAD_Y = 3;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _look = { width: 0, alpha: 0 };
const _mote = {
  speed: 0.8,
  up: 0.6,
  life: 0.6,
  size: [0.5, 0.12] as const,
  color: [1, 0.86, 0.42] as const,
  alpha: 0.95,
  pool: 'glow' as const,
};

function hasAura(e: Entity, id: string): boolean {
  const auras: Aura[] = e.auras;
  for (let i = 0; i < auras.length; i++) if (auras[i].id === id) return true;
  return false;
}

export class CouncilBondFx {
  private readonly thread: THREE.Mesh;
  private readonly threadMat: THREE.ShaderMaterial;
  private readonly members: number[] = [];
  private readonly scanMembers: number[] = [];
  /** When the bond last pulsed (the host clock), or far in the past. */
  private pulsedAt = -99;
  private moteAcc = 0;

  constructor(private readonly h: CouncilFxHost) {
    const threadGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true)
      .translate(0, 0.5, 0)
      .rotateX(Math.PI / 2);
    h.geometries.push(threadGeo);
    this.threadMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilBondThread',
      uniforms: {
        uTime: h.uTime,
        uAlpha: { value: 0 },
        uColor: { value: new THREE.Color(C.bond) },
      },
      vertexShader: THREAD_VERT,
      fragmentShader: THREAD_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    h.materials.push(this.threadMat);
    this.thread = new THREE.Mesh(threadGeo, this.threadMat);
    this.thread.name = 'smithHeartCouncilBondThread';
    this.thread.visible = false;
    this.thread.frustumCulled = false;
    h.root.add(this.thread);
  }

  beginScan(): void {
    this.scanMembers.length = 0;
  }

  /** A living council member the host's scan found. */
  see(e: Entity): void {
    if (this.scanMembers.length < 2) this.scanMembers.push(e.id);
  }

  endScan(): void {
    this.members.length = 0;
    for (const id of this.scanMembers) this.members.push(id);
  }

  /** `heart_bond_of_the_stone_pulse`: the thread flares, a ring at each end. */
  pulse(sourceId: number, targetId: number): void {
    this.pulsedAt = this.h.now();
    for (const id of [sourceId, targetId]) {
      const e = this.h.entity(id);
      if (!e) continue;
      const at = fxAnchor(e);
      this.h.particles.shockRing(at.x, at.z, C.bond, 5, 0.5);
    }
  }

  update(dt: number): void {
    const a = this.members.length === 2 ? this.h.entity(this.members[0]) : undefined;
    const b = this.members.length === 2 ? this.h.entity(this.members[1]) : undefined;
    const on =
      !!a &&
      !!b &&
      !a.dead &&
      !b.dead &&
      (hasAura(a, COUNCIL_AURAS.bond) || hasAura(b, COUNCIL_AURAS.bond));
    if (!on || !a || !b) {
      this.thread.visible = false;
      return;
    }
    const now = this.h.now();
    const look = bondThreadLook(now - this.pulsedAt, now, _look);
    const pa = fxAnchor(a);
    _a.set(pa.x, this.h.groundY(pa.x, pa.z) + THREAD_Y, pa.z);
    const pb = fxAnchor(b);
    _b.set(pb.x, this.h.groundY(pb.x, pb.z) + THREAD_Y, pb.z);
    const len = _a.distanceTo(_b);
    this.thread.position.copy(_a);
    this.thread.lookAt(_b);
    this.thread.scale.set(look.width, look.width, len);
    this.threadMat.uniforms.uAlpha.value = look.alpha;
    this.thread.visible = true;
    // Gold motes running along it (cosmetic: thin on the low tier).
    this.moteAcc += dt * 10 * this.h.density;
    while (this.moteAcc >= 1) {
      this.moteAcc -= 1;
      const t = this.h.rand();
      this.h.particles.puff(
        _a.x + (_b.x - _a.x) * t,
        _a.y + (_b.y - _a.y) * t,
        _a.z + (_b.z - _a.z) * t,
        1,
        _mote,
      );
    }
  }
}
