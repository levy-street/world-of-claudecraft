// The indrawn breath's streams (the Guardian of the Breath, a part of
// BreathFightFx): while its Indrawn Breath bar runs, long ropes of air rush
// in from all round the Cornice and pour into its maw, every one curling the
// same way on the whirl's log spiral (breath_fight_fx_core.ts INHALE_SWIRL,
// the floor's dust and the air's streaks bend on it too), the whole vortex
// turning as it draws, faster and brighter as the bar fills. A third of them
// hug the floor round the raid's ankles (the pull that drags you, Jose's
// playtest of 2026-11-18), the rest climb to the maw; grit is dragged in
// along the same spiral. The Summit Roar that follows is breath_fx.ts's
// blast. On EVERY tier (the pull is a hazard the raid reads): the ribbon
// count stays; only the motes thin.
//
// Built in the constructor under the host's root (its one gated attach);
// fixed pools; the ribbons' points are rewritten in place each frame.

import * as THREE from 'three';
import { BREATH_CASTS } from '../../sim/encounters/smith_heart/breath_ids';
import type { Entity } from '../../sim/types';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import { breathSocketPoint } from './breath_body_sockets';
import { INHALE_SWIRL, inhaleSwirlAngle } from './breath_fight_fx_core';
import { ISLE_RGB } from './breath_isles_fx_core';
import { ISLE_RIBBON_FRAG, ISLE_UV_VERT } from './breath_isles_glsl';

const _maw = new THREE.Vector3();

export interface InhaleHost {
  readonly root: THREE.Group;
  readonly particles: EngineParticles;
  readonly uTime: { value: number };
  readonly density: number;
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: THREE.Material[];
}

const STREAMS = 30;
const STEPS = 26;
/** How far out the streams begin (yards from the maw). */
const REACH = 40;
/** The vortex's own turn (radians a second at full draw). */
const SPIN = 0.55;

export class BreathInhaleStreams {
  private readonly meshes: THREE.Mesh[] = [];
  private readonly attrs: THREE.BufferAttribute[] = [];
  private readonly mat: THREE.ShaderMaterial;
  private strength = 0;
  private turn = 0;
  private seed = 0x3e11;

  constructor(private readonly h: InhaleHost) {
    this.mat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathInhaleStream',
      uniforms: {
        uTime: h.uTime,
        uColor: { value: new THREE.Color(0xcfeeff) },
        uCore: { value: new THREE.Color(0xffffff) },
        uGlow: { value: 0 },
        uFlow: { value: 1.6 },
        uDash: { value: 5 },
        uFade: { value: 0.12 },
      },
      vertexShader: ISLE_UV_VERT,
      fragmentShader: ISLE_RIBBON_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    h.materials.push(this.mat);
    for (let k = 0; k < STREAMS; k++) {
      const pos = new Float32Array((STEPS + 1) * 2 * 3);
      const uv: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i <= STEPS; i++) {
        uv.push(i / STEPS, 0, i / STEPS, 1);
        if (i < STEPS) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      const geo = new THREE.BufferGeometry();
      const attr = new THREE.BufferAttribute(pos, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', attr);
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      h.geometries.push(geo);
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      h.root.add(mesh);
      this.meshes.push(mesh);
      this.attrs.push(attr);
    }
  }

  /** One frame: `g` the guardian (or none in view). */
  update(g: Entity | undefined, dt: number): void {
    const drawing = !!g && !g.dead && g.castingAbility === BREATH_CASTS.inhale;
    const fill =
      drawing && g.castTotal > 0 ? Math.max(0, Math.min(1, 1 - g.castRemaining / g.castTotal)) : 0;
    const target = drawing ? 0.55 + 0.6 * fill : 0;
    this.strength += (target - this.strength) * Math.min(1, dt * (drawing ? 6 : 3));
    const on = this.strength > 0.02 && !!g;
    for (const m of this.meshes) m.visible = on;
    if (!on || !g) return;
    this.mat.uniforms.uGlow.value = this.strength * 0.5;
    this.mat.uniforms.uFlow.value = 1.4 + 2.2 * fill;
    const t = this.h.uTime.value;
    // The maw: the war-horn mouth of its mask (its model's socket).
    const maw = breathSocketPoint(g, 'mouth', _maw);
    const mx = maw.x;
    const mz = maw.z;
    const my = maw.y;
    // The whole vortex turns as it draws (integrated, so a change of pace
    // never jumps).
    this.turn = (this.turn + dt * SPIN * this.strength) % (Math.PI * 2);
    const floorY = g.pos.y;
    for (let k = 0; k < STREAMS; k++) {
      const a0 = (k / STREAMS) * Math.PI * 2 + this.turn + Math.sin(t * 0.4 + k) * 0.08;
      // A third hug the floor (ankle high, rising only at the end), the rest
      // start higher and climb to the maw.
      const low = k % 3 === 0;
      const sy = floorY + (low ? 0.45 : 1.4 + (k % 4) * 1.3);
      const reach = REACH * (low ? 0.8 : 1) * (0.88 + 0.12 * Math.sin(k * 2.3));
      const attr = this.attrs[k];
      for (let i = 0; i <= STEPS; i++) {
        const u = i / STEPS;
        // Faster as it closes in (the radius falls with u squared).
        const r = 1 + (reach - 1) * (1 - u) * (1 - u * 0.35);
        const ang = inhaleSwirlAngle(a0, reach, r);
        const sa = Math.sin(ang);
        const ca = Math.cos(ang);
        const x = mx + sa * r;
        const z = mz + ca * r;
        const rise = low ? u * u * u * u : u * u;
        const y = sy + (my - sy) * rise + (low ? 0 : Math.sin(u * Math.PI) * 1.2);
        // Thick ropes of air at their mouth, drawn thin as they pour in.
        const w = (low ? 1.5 : 1.2) * (1 - 0.72 * u) * (0.6 + 0.4 * this.strength);
        // Its width across its heading on the spiral (inward and round),
        // flat to the floor, a little raised on its inner edge.
        let px = -ca - INHALE_SWIRL.twist * sa;
        let pz = sa - INHALE_SWIRL.twist * ca;
        const pl = Math.hypot(px, pz) || 1;
        px = (px / pl) * w;
        pz = (pz / pl) * w;
        attr.setXYZ(i * 2, x - px, y - w * 0.3, z - pz);
        attr.setXYZ(i * 2 + 1, x + px, y + w * 0.3, z + pz);
      }
      attr.needsUpdate = true;
    }
    // Dust and grit dragged in along the floor on the same spiral (cosmetic).
    if (this.rand() < dt * 45 * this.h.density * this.strength) {
      const ang = this.rand() * Math.PI * 2;
      const r = 6 + this.rand() * 24;
      const sa = Math.sin(ang);
      const ca = Math.cos(ang);
      // Inward and round, as the streams run.
      const dx = -sa + INHALE_SWIRL.twist * ca;
      const dz = -ca - INHALE_SWIRL.twist * sa;
      const dl = Math.hypot(dx, dz) || 1;
      this.h.particles.puff(mx + sa * r, floorY + 0.4, mz + ca * r, 1, {
        speed: 5 + r * 0.35,
        life: 0.9,
        size: [0.7, 0.2],
        color: ISLE_RGB.dust,
        alpha: 0.65,
        dir: [dx / dl, 0.12, dz / dl],
        spread: 0.08,
      });
    }
  }

  hide(): void {
    this.strength = 0;
    for (const m of this.meshes) m.visible = false;
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }
}
