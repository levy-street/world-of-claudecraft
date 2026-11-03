// The Gale Bulwark and the Gale Menders' beams (encounters/smith_heart/
// breath_isles.ts), a part of BreathIslesFx (looks: breath_isles_fx_core.ts):
//
//  - the Bulwark round the guardian, a vortex of wind and stone: three bands
//    of wind wheeling round it each its own way (the foot, the waist, the
//    crown), a faint shell inside them with its cracks, a ring of wind runes
//    turning on the floor at its foot, and stones orbiting in the gale. Its
//    strength reads at a glance: the crown peels away under two thirds, the
//    waist under a third, the stones thin out and the turning slows;
//  - each Gale Mender's Mending Gale while it channels: a bright braided beam
//    from the Mender into the shell with a soft sheath, pulses racing down
//    it, motes riding it and a flare where it strikes the shell; cut (a
//    kick, a stun: the channel ends with no mend), it parts at its middle
//    with a burst of sparks and both ends whip back and fade.
// On EVERY tier (the raid acts on them); only the orbiting stones halve and
// the motes thin on the low tier. Built in the constructor under the host's
// root (its one gated attach); fixed pools; no per-frame allocation.

import * as THREE from 'three';
import { ISLE_CASTS } from '../../sim/encounters/smith_heart/breath_isle_ids';
import type { Entity } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { heartKitSlotMaterial } from '../smith_heart/heart_kit';
import type { BreathIslesHost } from './breath_isles_fx';
import {
  BULWARK_BANDS,
  BULWARK_DEBRIS,
  beamCutLook,
  bulwarkBandLife,
  bulwarkDebris,
  bulwarkDebrisCount,
  bulwarkLook,
  ISLE_COLORS as C,
  ISLE_POOLS as P,
  ISLE_RGB as RGB,
} from './breath_isles_fx_core';
import {
  BULWARK_BAND_FRAG,
  BULWARK_FRAG,
  BULWARK_VERT,
  ISLE_RUNE_FRAG,
  ISLE_UV_VERT,
  MEND_BEAM_FRAG,
} from './breath_isles_glsl';

const BEAM_STEPS = 32;
/** The beam's strip half width (yards): the sheath; the core is a third. */
const BEAM_HALF = 1.15;

interface BeamSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  pos: THREE.BufferAttribute;
  id: number;
  channel: boolean;
  flare: number;
  /** The host clock at the cut (NaN: not cut). */
  cutAt: number;
  mote: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = { x: 0, y: 0, z: 0, spin: 0, size: 0 };
const _from = { x: 0, y: 0, z: 0 };
const _to = { x: 0, y: 0, z: 0 };

export class BreathBulwarkFx {
  private readonly group = new THREE.Group();
  private readonly shell: THREE.Mesh;
  private readonly shellMat: THREE.ShaderMaterial;
  private readonly bands: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }[] = [];
  private readonly runes: THREE.Mesh;
  private readonly runeMat: THREE.ShaderMaterial;
  private readonly stones: THREE.InstancedMesh;
  private readonly beams: BeamSlot[] = [];
  private flash = 0;
  private clock = 0;
  private seed = 0x51d3;
  /** The shell's radius and foot, last frame (the beams aim at it). */
  private R = 3.2;
  private readonly at = { x: 0, y: 0, z: 0 };
  private shown = false;

  constructor(private readonly h: BreathIslesHost) {
    this.group.name = 'smithHeartBreathBulwark';
    this.group.visible = false;
    h.root.add(this.group);
    // The faint shell inside the bands (its cracks open as it thins).
    this.shellMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathBulwark',
      uniforms: {
        uTime: h.uTime,
        uColor: { value: new THREE.Color(C.bulwark) },
        uEdge: { value: new THREE.Color(C.bulwarkEdge) },
        uSolid: { value: 1 },
        uCrack: { value: 0 },
        uSpin: { value: 1 },
        uFlash: { value: 0 },
      },
      vertexShader: BULWARK_VERT,
      fragmentShader: BULWARK_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    h.materials.push(this.shellMat);
    const sphere = new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.62);
    h.geometries.push(sphere);
    this.shell = new THREE.Mesh(sphere, this.shellMat);
    this.shell.frustumCulled = false;
    this.group.add(this.shell);
    // The three bands of wind (unit lathes: the shell's radius scales them).
    for (const b of BULWARK_BANDS) {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const bulge = Math.sin(t * Math.PI) * 0.06;
        pts.push(new THREE.Vector2(b.r0 + (b.r1 - b.r0) * t + bulge, b.y0 + (b.y1 - b.y0) * t));
      }
      const geo = new THREE.LatheGeometry(pts, 48);
      h.geometries.push(geo);
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartBreathBulwarkBand',
        uniforms: {
          uTime: h.uTime,
          uColor: { value: new THREE.Color(C.bulwark) },
          uEdge: { value: new THREE.Color(C.bulwarkEdge) },
          uLive: { value: 1 },
          uSpin: { value: b.spin },
          uSlant: { value: b.slant },
          uFlash: { value: 0 },
        },
        vertexShader: ISLE_UV_VERT,
        fragmentShader: BULWARK_BAND_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      h.materials.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.bands.push({ mesh, mat });
    }
    // The ring of wind runes turning on the floor at its foot.
    const ring = new THREE.RingGeometry(1.15, 1.55, 72, 1);
    const pos = ring.getAttribute('position');
    const uv = ring.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      const y = pos.getY(k);
      uv.setXY(k, (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1, (Math.hypot(x, y) - 1.15) / 0.4);
    }
    ring.rotateX(-Math.PI / 2);
    h.geometries.push(ring);
    this.runeMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathBulwarkRunes',
      uniforms: {
        uTime: h.uTime,
        uColor: { value: new THREE.Color(C.bulwark) },
        uWake: { value: 1 },
      },
      vertexShader: ISLE_UV_VERT,
      fragmentShader: ISLE_RUNE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    h.materials.push(this.runeMat);
    this.runes = new THREE.Mesh(ring, this.runeMat);
    this.runes.renderOrder = floorVfxRenderOrder('encounter', 5);
    this.runes.frustumCulled = false;
    this.group.add(this.runes);
    // The stones in the gale: the kits' shared stone (its program linked
    // with the interior), a pale granite in the vertex paint.
    const stone = new THREE.DodecahedronGeometry(1, 0);
    const n = stone.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const v = 0.42 + 0.12 * ((k * 7) % 5) * 0.25;
      col[k * 3] = v;
      col[k * 3 + 1] = v * 1.01;
      col[k * 3 + 2] = v * 1.04;
    }
    stone.setAttribute('color', new THREE.BufferAttribute(col, 3));
    h.geometries.push(stone);
    this.stones = new THREE.InstancedMesh(stone, heartKitSlotMaterial('stone'), BULWARK_DEBRIS);
    this.stones.name = 'smithHeartBreathBulwarkStones';
    this.stones.frustumCulled = false;
    this.stones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.stones);
    // The Menders' beams (a strip each, rewritten in place).
    for (let k = 0; k < P.streams; k++) {
      const posArr = new Float32Array((BEAM_STEPS + 1) * 4 * 3);
      const uvs: number[] = [];
      const idx: number[] = [];
      for (let strip = 0; strip < 2; strip++) {
        const o = strip * (BEAM_STEPS + 1) * 2;
        for (let i = 0; i <= BEAM_STEPS; i++) {
          uvs.push(i / BEAM_STEPS, 0, i / BEAM_STEPS, 1);
          if (i < BEAM_STEPS) {
            const b = o + i * 2;
            idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      const attr = new THREE.BufferAttribute(posArr, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', attr);
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(idx);
      h.geometries.push(geo);
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartBreathMendBeam',
        uniforms: {
          uTime: h.uTime,
          uColor: { value: new THREE.Color(C.mend) },
          uCore: { value: new THREE.Color(0xffffff) },
          uGlow: { value: 1 },
          uCut: { value: 0 },
          uSheath: { value: 1 },
        },
        vertexShader: ISLE_UV_VERT,
        fragmentShader: MEND_BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      h.materials.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'smithHeartBreathMendBeam';
      mesh.frustumCulled = false;
      mesh.visible = false;
      h.root.add(mesh);
      this.beams.push({
        mesh,
        mat,
        pos: attr,
        id: -1,
        channel: false,
        flare: 0,
        cutAt: Number.NaN,
        mote: 0,
      });
    }
  }

  /** The scan's Menders (their ids, in a stable order). */
  setMenders(menders: readonly number[]): void {
    this.beams.forEach((b, k) => {
      const id = k < menders.length ? menders[k] : -1;
      if (id === b.id) return;
      // A Mender gone mid-channel (killed): its beam is cut where it was.
      if (b.id >= 0 && b.channel && id < 0) this.cut(b);
      else if (id >= 0) {
        b.id = id;
        b.channel = false;
        b.cutAt = Number.NaN;
      }
    });
  }

  /** The Bulwark took a Mending Gale (the cue): that beam's flare, the
   *  shell's flash. */
  mended(menderId: number): void {
    const b = this.beams.find((q) => q.id === menderId);
    if (b) b.flare = 1;
    this.flash = Math.max(this.flash, 0.9);
  }

  /** The shell's flash (it rose, it was struck). */
  flashShell(k: number): void {
    this.flash = Math.max(this.flash, k);
  }

  update(world: IWorld, g: Entity | undefined, left: number, whole: number, dt: number): void {
    this.clock += dt;
    const t = this.h.uTime.value;
    this.flash = Math.max(0, this.flash - dt * 2.2);
    const up = !!g && !g.dead && left > 0;
    if (up && g) {
      const look = bulwarkLook(left, whole, t);
      const k = whole > 0 ? Math.max(0, Math.min(1, left / whole)) : 0;
      const a = fxAnchor(g);
      this.R = 3.4 * Math.max(1, g.scale ?? 1);
      this.at.x = a.x;
      this.at.y = g.pos.y;
      this.at.z = a.z;
      this.group.visible = true;
      this.shown = true;
      this.group.position.set(a.x, g.pos.y, a.z);
      this.group.scale.setScalar(this.R * look.pulse);
      const su = this.shellMat.uniforms;
      this.shell.scale.set(1, 1.15, 1);
      su.uSolid.value = 0.1 + 0.22 * k;
      su.uCrack.value = look.crack;
      su.uSpin.value = look.spin;
      su.uFlash.value = this.flash;
      BULWARK_BANDS.forEach((b, i) => {
        const life = bulwarkBandLife(k, b.over);
        const band = this.bands[i];
        band.mesh.visible = life > 0.01;
        band.mat.uniforms.uLive.value = life;
        band.mat.uniforms.uSpin.value = b.spin * (0.5 + 0.5 * k);
        band.mat.uniforms.uFlash.value = this.flash;
      });
      this.runes.rotation.y = t * (0.35 + 0.65 * k);
      this.runeMat.uniforms.uWake.value = 0.4 + 0.6 * k + this.flash;
      const live = bulwarkDebrisCount(k, this.h.density);
      for (let j = 0; j < BULWARK_DEBRIS; j++) {
        if (j >= live) {
          this.stones.setMatrixAt(j, _m.makeScale(0, 0, 0));
          continue;
        }
        const s = bulwarkDebris(j, t, k, _d);
        _e.set(s.spin, s.spin * 0.7, s.spin * 0.4);
        _q.setFromEuler(_e);
        _m.compose(_p.set(s.x, s.y, s.z), _q, _s.set(s.size, s.size * 0.8, s.size));
        this.stones.setMatrixAt(j, _m);
      }
      this.stones.instanceMatrix.needsUpdate = true;
      // Grit torn off the vortex (cosmetic).
      if (this.rand() < dt * 14 * this.h.density * (0.3 + k)) {
        const ang = this.rand() * Math.PI * 2;
        const r = this.R * 1.25;
        this.h.particles.puff(
          a.x + Math.sin(ang) * r,
          g.pos.y + 0.4 + this.rand() * this.R * 1.4,
          a.z + Math.cos(ang) * r,
          1,
          {
            speed: 6,
            life: 0.7,
            size: [0.5, 0.15],
            color: RGB.bulwarkEdge,
            alpha: 0.7,
            pool: 'glow',
            dir: [Math.cos(ang), 0.2, -Math.sin(ang)],
            spread: 0.2,
            drag: 1.2,
          },
        );
      }
    } else if (this.shown) {
      this.group.visible = false;
      this.shown = false;
    }
    for (const b of this.beams) this.updateBeam(world, b, up ? g : undefined, dt);
  }

  private updateBeam(world: IWorld, b: BeamSlot, g: Entity | undefined, dt: number): void {
    b.flare = Math.max(0, b.flare - dt * 1.6);
    const m = b.id >= 0 ? world.entities.get(b.id) : undefined;
    const channel = !!m && !m.dead && !!g && m.castingAbility === ISLE_CASTS.mending;
    if (b.channel && !channel) {
      // The channel ended: a mend (the cue's flare is on it) or a cut.
      if (b.flare < 0.5) this.cut(b);
      b.channel = false;
    }
    if (channel && !b.channel) {
      b.channel = true;
      b.cutAt = Number.NaN;
    }
    const cut = !Number.isNaN(b.cutAt);
    if (!channel && !cut && b.flare <= 0) {
      b.mesh.visible = false;
      return;
    }
    if (cut) {
      const look = beamCutLook(this.clock - b.cutAt);
      if (look.glow <= 0) {
        b.cutAt = Number.NaN;
        b.mesh.visible = false;
        return;
      }
      b.mesh.visible = true;
      b.mat.uniforms.uCut.value = look.cut;
      b.mat.uniforms.uGlow.value = 1.6 * look.glow;
      return;
    }
    if (!m || !g) {
      b.mesh.visible = false;
      return;
    }
    b.mesh.visible = true;
    const t = this.h.uTime.value;
    b.mat.uniforms.uCut.value = 0;
    b.mat.uniforms.uGlow.value = (channel ? 1.5 + 0.35 * Math.sin(t * 11) : 0) + b.flare * 2;
    const ma = fxAnchor(m);
    _from.x = ma.x;
    _from.y = m.pos.y + 2.2;
    _from.z = ma.z;
    // Into the shell's face toward the Mender, a body's height over the floor.
    const dx = ma.x - this.at.x;
    const dz = ma.z - this.at.z;
    const dl = Math.hypot(dx, dz) || 1;
    _to.x = this.at.x + (dx / dl) * this.R * 1.05;
    _to.y = this.at.y + this.R * 0.9;
    _to.z = this.at.z + (dz / dl) * this.R * 1.05;
    this.writeBeam(b, t);
    // Motes riding the beam into the shell, a flare where it strikes.
    b.mote += dt * 22 * (0.5 + 0.5 * this.h.density);
    while (b.mote >= 1) {
      b.mote -= 1;
      const k = this.rand();
      const p = this.beamPoint(k, t);
      this.h.particles.puff(p.x, p.y, p.z, 1, {
        speed: 1,
        life: 0.5,
        size: [0.45, 0.1],
        color: RGB.mendCore,
        alpha: 0.95,
        pool: 'glow',
      });
    }
    if (this.rand() < dt * 18)
      this.h.particles.puff(_to.x, _to.y, _to.z, 2, {
        speed: 3,
        life: 0.35,
        size: [1.2, 0.3],
        color: RGB.mendCore,
        alpha: 0.9,
        pool: 'glow',
      });
  }

  /** A point on the beam's arc at `k` (0 the Mender, 1 the shell). */
  private beamPoint(k: number, t: number): { x: number; y: number; z: number } {
    const d = Math.hypot(_to.x - _from.x, _to.z - _from.z);
    const lift = Math.sin(k * Math.PI) * Math.min(12, d * 0.22);
    const wob = Math.sin(k * 9 - t * 6) * 0.35 * Math.sin(k * Math.PI);
    const ax = -(_to.z - _from.z) / (d || 1);
    const az = (_to.x - _from.x) / (d || 1);
    _p.set(
      _from.x + (_to.x - _from.x) * k + ax * wob,
      _from.y + (_to.y - _from.y) * k + lift,
      _from.z + (_to.z - _from.z) * k + az * wob,
    );
    return _p;
  }

  private writeBeam(b: BeamSlot, t: number): void {
    const d = Math.hypot(_to.x - _from.x, _to.z - _from.z) || 1;
    const ax = -(_to.z - _from.z) / d;
    const az = (_to.x - _from.x) / d;
    const n = BEAM_STEPS + 1;
    for (let i = 0; i <= BEAM_STEPS; i++) {
      const p = this.beamPoint(i / BEAM_STEPS, t);
      const w = BEAM_HALF * (1 - 0.3 * (i / BEAM_STEPS));
      // Two crossed strips: one upright, one flat (it reads from any side).
      b.pos.setXYZ(i * 2, p.x, p.y - w, p.z);
      b.pos.setXYZ(i * 2 + 1, p.x, p.y + w, p.z);
      b.pos.setXYZ(n * 2 + i * 2, p.x - ax * w, p.y, p.z - az * w);
      b.pos.setXYZ(n * 2 + i * 2 + 1, p.x + ax * w, p.y, p.z + az * w);
    }
    b.pos.needsUpdate = true;
  }

  /** Cut a beam: it parts at its middle with a burst of sparks. */
  private cut(b: BeamSlot): void {
    if (!Number.isNaN(b.cutAt) || !b.mesh.visible) {
      b.channel = false;
      return;
    }
    b.cutAt = this.clock;
    b.channel = false;
    const p = this.beamPoint(0.5, this.h.uTime.value);
    const n = Math.round(26 * (0.5 + 0.5 * this.h.density));
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const up = this.rand() * 1.2 - 0.4;
      this.h.particles.puff(p.x, p.y, p.z, 1, {
        speed: 8 + this.rand() * 8,
        life: 0.6,
        size: [0.5, 0.1],
        color: RGB.mendCore,
        alpha: 1,
        pool: 'glow',
        dir: [Math.sin(a), up, Math.cos(a)],
        spread: 0.3,
        drag: 1.4,
        gravity: 6,
      });
    }
    // A white snap at the break.
    this.h.particles.puff(p.x, p.y, p.z, 4, {
      speed: 2,
      life: 0.3,
      size: [2.6, 0.6],
      color: [1, 1, 1],
      alpha: 1,
      pool: 'glow',
    });
  }

  leave(): void {
    this.group.visible = false;
    this.shown = false;
    for (const b of this.beams) {
      b.mesh.visible = false;
      b.id = -1;
      b.channel = false;
      b.cutAt = Number.NaN;
    }
  }

  dispose(): void {
    this.stones.dispose();
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }
}
