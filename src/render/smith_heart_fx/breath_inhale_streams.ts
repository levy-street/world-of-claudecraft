// The indrawn breath's streams (the Guardian of the Breath, a part of
// BreathFightFx): while its Indrawn Breath bar runs, long ribbons of air
// rush in from all round the Cornice and pour into its maw, bending as they
// come, faster and brighter as the bar fills; the Summit Roar that follows
// is breath_fx.ts's blast. On EVERY tier (the pull is a hazard the raid
// reads): the ribbon count stays; only the motes thin.
//
// Built in the constructor under the host's root (its one gated attach);
// fixed pools; the ribbons' points are rewritten in place each frame.

import * as THREE from 'three';
import { BREATH_CASTS } from '../../sim/encounters/smith_heart/breath_ids';
import type { Entity } from '../../sim/types';
import { fxAnchor } from '../attached_fx_anchor';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import { ISLE_RGB } from './breath_isles_fx_core';
import { ISLE_RIBBON_FRAG, ISLE_UV_VERT } from './breath_isles_glsl';

export interface InhaleHost {
  readonly root: THREE.Group;
  readonly particles: EngineParticles;
  readonly uTime: { value: number };
  readonly density: number;
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: THREE.Material[];
}

const STREAMS = 14;
const STEPS = 22;
/** How far out the streams begin (yards from the maw). */
const REACH = 34;

export class BreathInhaleStreams {
  private readonly meshes: THREE.Mesh[] = [];
  private readonly attrs: THREE.BufferAttribute[] = [];
  private readonly mat: THREE.ShaderMaterial;
  private strength = 0;
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
    this.mat.uniforms.uGlow.value = this.strength;
    this.mat.uniforms.uFlow.value = 1.4 + 2.2 * fill;
    const t = this.h.uTime.value;
    const a = fxAnchor(g);
    const s = Math.max(1, g.scale ?? 1);
    // The maw: before the body, at its chest.
    const mx = a.x + Math.sin(g.facing) * 1.2 * s;
    const mz = a.z + Math.cos(g.facing) * 1.2 * s;
    const my = g.pos.y + 2.2 * s;
    for (let k = 0; k < STREAMS; k++) {
      const ang = (k / STREAMS) * Math.PI * 2 + Math.sin(t * 0.4 + k) * 0.12;
      const sx = mx + Math.sin(ang) * REACH;
      const sz = mz + Math.cos(ang) * REACH;
      const sy = g.pos.y + 0.6 + (k % 3) * 1.4;
      // Each bends round on its way in (a swirl toward the maw).
      const bend = 7 * (k % 2 === 0 ? 1 : -1);
      const attr = this.attrs[k];
      for (let i = 0; i <= STEPS; i++) {
        const u = i / STEPS;
        const e = u * u;
        const side = Math.sin(u * Math.PI) * bend;
        const x = sx + (mx - sx) * e + Math.cos(ang) * side;
        const z = sz + (mz - sz) * e - Math.sin(ang) * side;
        const y = sy + (my - sy) * e + Math.sin(u * Math.PI) * 1.5;
        const w = 0.55 * (1 - 0.7 * u) * (0.6 + 0.4 * this.strength);
        // Flat to the floor (seen from the camera's height), a little
        // raised on its inner edge.
        const px = Math.cos(ang) * w;
        const pz = -Math.sin(ang) * w;
        attr.setXYZ(i * 2, x - px, y - w * 0.3, z - pz);
        attr.setXYZ(i * 2 + 1, x + px, y + w * 0.3, z + pz);
      }
      attr.needsUpdate = true;
    }
    // Dust and leaves dragged in along the floor (cosmetic).
    if (this.rand() < dt * 30 * this.h.density * this.strength) {
      const ang = this.rand() * Math.PI * 2;
      const r = 8 + this.rand() * 20;
      this.h.particles.puff(mx + Math.sin(ang) * r, g.pos.y + 0.4, mz + Math.cos(ang) * r, 1, {
        speed: 4 + r * 0.4,
        life: 0.8,
        size: [0.6, 0.2],
        color: ISLE_RGB.dust,
        alpha: 0.6,
        dir: [-Math.sin(ang), 0.15, -Math.cos(ang)],
        spread: 0.1,
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
