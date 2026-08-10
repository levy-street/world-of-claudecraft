import * as THREE from 'three';
import {
  AFFLICTION_FAMILIAR_LOCAL_X,
  AFFLICTION_FAMILIAR_LOCAL_Z,
} from './affliction_familiar_core';
import type { VfxOffsetAnchorResolver } from './vfx_anchor';

const CHANNEL_POOL_SIZE = 12;
const DRAIN_CORE = 0xc7ffd1;
const DRAIN_FLOW = 0x46f27c;
const DRAIN_SHADOW = 0x0b5c2a;
const GAZE_CORE = 0xc8ff86;
const GAZE_FLOW = 0x7d36bd;
const GAZE_SHADOW = 0x351154;
const UP = new THREE.Vector3(0, 1, 0);

export type DrainLifeParticleKind = 'extraction' | 'absorption' | 'transfer' | 'tick' | 'residue';

export type DrainLifeParticleSink = (
  kind: DrainLifeParticleKind,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  color: number,
  size: number,
  lifetime: number,
  gravity: number,
) => void;

// The offset-capable anchor resolver (src/render/vfx_anchor.ts owns the
// contract): the demonic drain and evil-eye channels anchor their source end
// on the hovering affliction familiar via its caster-local offset.
export type DrainLifeAnchor = VfxOffsetAnchorResolver;

type DrainChannelKind = 'drain' | 'demonicDrain' | 'evilEyeGaze';

interface DrainChannelSlot {
  active: boolean;
  casterId: number;
  kind: DrainChannelKind;
  sourceId: number;
  targetId: number;
  sourceHeight: number;
  targetHeight: number;
  sourceLocalX: number;
  sourceLocalZ: number;
  remaining: number;
  emitCarry: number;
  phase: number;
  group: THREE.Group;
  core: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  flow: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  veil: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
}

const DRAIN_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uPhase;
  uniform float uMotion;
  varying float vLong;
  varying vec2 vDrainUv;
  void main() {
    vLong = position.y + 0.5;
    vDrainUv = uv;
    vec3 p = position;
    float wave = uMotion * (0.16 + 0.1 * sin(vLong * 9.0 + uTime * 3.0 + uPhase));
    p.x += sin(vLong * 13.0 - uTime * 2.6 + uPhase) * wave;
    p.z += cos(vLong * 11.0 - uTime * 2.2 + uPhase) * wave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const DRAIN_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uPhase;
  uniform float uOpacity;
  uniform float uMotion;
  varying float vLong;
  varying vec2 vDrainUv;
  void main() {
    float edge = sin(vDrainUv.x * 3.14159265);
    float endFade = smoothstep(0.0, 0.1, vLong) * (1.0 - smoothstep(0.9, 1.0, vLong));
    float stream = 0.68 + 0.32 * sin(vLong * 34.0 + uTime * 10.0 * uMotion + uPhase);
    float flicker = 0.82 + 0.18 * sin(vLong * 17.0 - uTime * 5.0 * uMotion + uPhase);
    float alpha = edge * endFade * stream * flicker * uOpacity;
    gl_FragColor = vec4(uColor * (1.0 + stream * 0.7), alpha);
  }
`;

function material(color: number, opacity: number, phase: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uPhase: { value: phase },
      uOpacity: { value: opacity },
      uMotion: { value: 1 },
    },
    vertexShader: DRAIN_VERTEX_SHADER,
    fragmentShader: DRAIN_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function setMaterial(
  mesh: DrainChannelSlot['core'],
  color: number,
  opacity: number,
  time: number,
  motion: number,
): void {
  mesh.material.uniforms.uColor.value.setHex(color);
  mesh.material.uniforms.uOpacity.value = opacity;
  mesh.material.uniforms.uTime.value = time;
  mesh.material.uniforms.uMotion.value = motion;
}

/**
 * Fixed-pool presentation for Drain Life and the two Eye tethers. Gameplay
 * owns duration and cancellation; this class only mirrors that authoritative
 * state into a target-to-caster life stream.
 */
export class DrainLifeVfx {
  private readonly geometry = new THREE.CylinderGeometry(1, 1, 1, 12, 12, true);
  private readonly slots: DrainChannelSlot[] = [];
  private readonly direction = new THREE.Vector3();
  private readonly sourcePosition = new THREE.Vector3();
  private readonly targetPosition = new THREE.Vector3();
  private time = 0;
  private quality = 1;
  private reducedMotion = false;

  constructor(
    scene: THREE.Scene,
    private readonly anchor: DrainLifeAnchor,
    private readonly emit: DrainLifeParticleSink,
  ) {
    for (let i = 0; i < CHANNEL_POOL_SIZE; i++) {
      const core = new THREE.Mesh(this.geometry, material(DRAIN_CORE, 0.9, i * 0.71));
      const flow = new THREE.Mesh(this.geometry, material(DRAIN_FLOW, 0.48, i * 0.71 + 2.1));
      const veil = new THREE.Mesh(this.geometry, material(DRAIN_SHADOW, 0.24, i * 0.71 + 4.2));
      core.renderOrder = 7;
      flow.renderOrder = 6;
      veil.renderOrder = 5;
      const group = new THREE.Group();
      group.name = 'drain-life-vfx-slot';
      group.userData.renderCategory = 'vfx';
      group.userData.flowDirection = 'target-to-caster';
      group.add(veil, flow, core);
      group.visible = false;
      scene.add(group);
      this.slots.push({
        active: false,
        casterId: 0,
        kind: 'drain',
        sourceId: 0,
        targetId: 0,
        sourceHeight: 0.62,
        targetHeight: 0.52,
        sourceLocalX: 0,
        sourceLocalZ: 0,
        remaining: 0,
        emitCarry: 0,
        phase: i * 0.71,
        group,
        core,
        flow,
        veil,
      });
    }
  }

  setQuality(level: number): void {
    this.quality = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 1));
  }

  drain(sourceId: number, targetId: number, duration: number): void {
    this.setChannel(sourceId, 'drain', sourceId, targetId, 0.62, 0.52, 0, 0, duration);
  }

  demonicDrain(casterId: number, targetId: number, duration: number): void {
    this.setChannel(
      casterId,
      'demonicDrain',
      casterId,
      targetId,
      0.78,
      0.52,
      AFFLICTION_FAMILIAR_LOCAL_X,
      AFFLICTION_FAMILIAR_LOCAL_Z,
      duration,
    );
  }

  evilEyeGaze(casterId: number, targetId: number, duration = 0.28): void {
    this.setChannel(
      casterId,
      'evilEyeGaze',
      casterId,
      targetId,
      0.78,
      0.52,
      AFFLICTION_FAMILIAR_LOCAL_X,
      AFFLICTION_FAMILIAR_LOCAL_Z,
      duration,
    );
  }

  tick(casterId: number): void {
    for (const slot of this.slots) {
      if (
        slot.active &&
        slot.casterId === casterId &&
        (slot.kind === 'drain' || slot.kind === 'demonicDrain')
      ) {
        this.emitTick(slot);
      }
    }
  }

  clear(): void {
    for (const slot of this.slots) this.release(slot, false);
  }

  update(dt: number, reducedMotion = false): void {
    this.time += dt;
    this.reducedMotion = reducedMotion;
    const motion = reducedMotion ? 0.25 : 1;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.remaining -= dt;
      const from = this.anchor(
        slot.sourceId,
        slot.sourceHeight,
        slot.sourceLocalX,
        slot.sourceLocalZ,
        this.sourcePosition,
      );
      const to = this.anchor(slot.targetId, slot.targetHeight, 0, 0, this.targetPosition);
      if (slot.remaining <= 0) {
        this.release(slot, true);
        continue;
      }
      if (!from || !to) {
        slot.group.visible = false;
        continue;
      }
      slot.group.visible = true;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dz = to.z - from.z;
      const len = Math.hypot(dx, dy, dz);
      if (len <= 0.001) continue;
      slot.group.position.set(from.x + dx * 0.5, from.y + dy * 0.5, from.z + dz * 0.5);
      this.direction.set(dx / len, dy / len, dz / len);
      slot.group.quaternion.setFromUnitVectors(UP, this.direction);

      const gaze = slot.kind === 'evilEyeGaze';
      const pulse = reducedMotion ? 1 : 1 + Math.sin(this.time * 8 + slot.phase) * 0.08;
      const coreRadius = gaze ? 0.026 : 0.045;
      const flowRadius = gaze ? 0.07 : 0.095;
      const veilRadius = gaze ? 0.12 : 0.18;
      slot.core.scale.set(coreRadius, len, coreRadius);
      slot.flow.scale.set(flowRadius * pulse, len * 1.002, flowRadius * pulse);
      slot.veil.scale.set(veilRadius * pulse, len * 1.004, veilRadius * pulse);
      slot.flow.visible = this.quality > 0.12;
      slot.veil.visible = this.quality > 0.38 && !reducedMotion;

      const coreColor = gaze ? GAZE_CORE : DRAIN_CORE;
      const flowColor = gaze ? GAZE_FLOW : DRAIN_FLOW;
      const shadowColor = gaze ? GAZE_SHADOW : DRAIN_SHADOW;
      const flowTime = gaze ? -this.time : this.time;
      setMaterial(slot.core, coreColor, gaze ? 0.9 : 0.86, flowTime, motion);
      setMaterial(slot.flow, flowColor, gaze ? 0.46 : 0.42, flowTime, motion);
      setMaterial(slot.veil, shadowColor, gaze ? 0.28 : 0.22, flowTime, motion);

      const rate = (gaze ? 24 : 34) * (0.35 + this.quality * 0.65) * (reducedMotion ? 0.35 : 1);
      slot.emitCarry = Math.min(8, slot.emitCarry + rate * dt);
      let count = Math.floor(slot.emitCarry);
      slot.emitCarry -= count;
      while (count-- > 0) this.emitTransfer(slot, from, to, len, gaze, reducedMotion);
    }
  }

  private setChannel(
    casterId: number,
    kind: DrainChannelKind,
    sourceId: number,
    targetId: number,
    sourceHeight: number,
    targetHeight: number,
    sourceLocalX: number,
    sourceLocalZ: number,
    duration: number,
  ): void {
    let existing: DrainChannelSlot | undefined;
    for (const slot of this.slots) {
      if (slot.active && slot.casterId === casterId && slot.kind === kind) {
        existing = slot;
        break;
      }
    }
    if (duration <= 0) {
      if (existing) this.release(existing, true);
      return;
    }
    if (existing && existing.targetId !== targetId) {
      this.release(existing, true);
      existing = undefined;
    }
    if (existing) {
      existing.sourceId = sourceId;
      existing.targetId = targetId;
      existing.sourceHeight = sourceHeight;
      existing.targetHeight = targetHeight;
      existing.sourceLocalX = sourceLocalX;
      existing.sourceLocalZ = sourceLocalZ;
      existing.remaining = duration;
      return;
    }

    let slot = this.slots[0];
    for (const candidate of this.slots) {
      if (!candidate.active) {
        slot = candidate;
        break;
      }
    }
    if (slot.active) this.release(slot, true);
    slot.active = true;
    slot.casterId = casterId;
    slot.kind = kind;
    slot.sourceId = sourceId;
    slot.targetId = targetId;
    slot.sourceHeight = sourceHeight;
    slot.targetHeight = targetHeight;
    slot.sourceLocalX = sourceLocalX;
    slot.sourceLocalZ = sourceLocalZ;
    slot.remaining = duration;
    slot.emitCarry = 0;
    slot.group.visible = true;
    slot.group.userData.flowDirection =
      kind === 'evilEyeGaze' ? 'caster-to-target' : 'target-to-caster';
    this.emitStartup(slot);
  }

  private emitStartup(slot: DrainChannelSlot): void {
    const from = this.anchor(
      slot.sourceId,
      slot.sourceHeight,
      slot.sourceLocalX,
      slot.sourceLocalZ,
      this.sourcePosition,
    );
    const to = this.anchor(slot.targetId, slot.targetHeight, 0, 0, this.targetPosition);
    if (!from || !to) return;
    const gaze = slot.kind === 'evilEyeGaze';
    const count = Math.max(
      2,
      Math.round((gaze ? 5 : 9) * (0.45 + this.quality * 0.55) * (this.reducedMotion ? 0.45 : 1)),
    );
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + slot.phase;
      const spread = (0.45 + Math.random() * 0.4) * (this.reducedMotion ? 0.45 : 1);
      this.emit(
        'extraction',
        to.x,
        to.y,
        to.z,
        Math.cos(angle) * spread,
        0.15 + Math.random() * 0.5,
        Math.sin(angle) * spread,
        gaze ? GAZE_FLOW : DRAIN_FLOW,
        0.16 + Math.random() * 0.1,
        0.35 + Math.random() * 0.2,
        0,
      );
      this.emit(
        'absorption',
        from.x,
        from.y,
        from.z,
        -Math.cos(angle) * spread * 0.45,
        0.1 + Math.random() * 0.25,
        -Math.sin(angle) * spread * 0.45,
        gaze ? GAZE_CORE : DRAIN_CORE,
        0.12 + Math.random() * 0.08,
        0.3 + Math.random() * 0.15,
        0,
      );
    }
  }

  private emitTransfer(
    slot: DrainChannelSlot,
    from: THREE.Vector3,
    to: THREE.Vector3,
    len: number,
    gaze: boolean,
    reducedMotion: boolean,
  ): void {
    const towardCaster = slot.kind !== 'evilEyeGaze';
    const sx = towardCaster ? to.x : from.x;
    const sy = towardCaster ? to.y : from.y;
    const sz = towardCaster ? to.z : from.z;
    const ex = towardCaster ? from.x : to.x;
    const ey = towardCaster ? from.y : to.y;
    const ez = towardCaster ? from.z : to.z;
    const f = Math.random();
    const speed = (gaze ? 2.4 : 2 + Math.random() * 1.2) * (reducedMotion ? 0.45 : 1);
    const ux = (ex - sx) / len;
    const uy = (ey - sy) / len;
    const uz = (ez - sz) / len;
    const jitter = gaze ? 0.045 : 0.09;
    this.emit(
      'transfer',
      sx + (ex - sx) * f + (Math.random() - 0.5) * jitter,
      sy + (ey - sy) * f + (Math.random() - 0.5) * jitter,
      sz + (ez - sz) * f + (Math.random() - 0.5) * jitter,
      ux * speed + (Math.random() - 0.5) * 0.12,
      uy * speed + (Math.random() - 0.5) * 0.12,
      uz * speed + (Math.random() - 0.5) * 0.12,
      gaze
        ? Math.random() < 0.35
          ? GAZE_CORE
          : GAZE_FLOW
        : Math.random() < 0.3
          ? DRAIN_CORE
          : DRAIN_FLOW,
      0.11 + Math.random() * 0.09,
      0.32 + Math.random() * 0.2,
      0,
    );
  }

  private emitTick(slot: DrainChannelSlot): void {
    const from = this.anchor(
      slot.sourceId,
      slot.sourceHeight,
      slot.sourceLocalX,
      slot.sourceLocalZ,
      this.sourcePosition,
    );
    const to = this.anchor(slot.targetId, slot.targetHeight, 0, 0, this.targetPosition);
    if (!from || !to) return;
    const count = Math.max(
      2,
      Math.round(5 * (0.45 + this.quality * 0.55) * (this.reducedMotion ? 0.55 : 1)),
    );
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + slot.phase;
      this.emit(
        'tick',
        to.x,
        to.y,
        to.z,
        Math.cos(angle) * 0.75,
        0.25 + Math.random() * 0.45,
        Math.sin(angle) * 0.75,
        DRAIN_FLOW,
        0.14 + Math.random() * 0.08,
        0.28,
        0,
      );
      this.emit(
        'tick',
        from.x,
        from.y,
        from.z,
        -Math.cos(angle) * 0.3,
        0.12,
        -Math.sin(angle) * 0.3,
        DRAIN_CORE,
        0.12 + Math.random() * 0.06,
        0.24,
        0,
      );
    }
  }

  private release(slot: DrainChannelSlot, residue: boolean): void {
    if (!slot.active) {
      slot.group.visible = false;
      return;
    }
    if (residue) {
      const from = this.anchor(
        slot.sourceId,
        slot.sourceHeight,
        slot.sourceLocalX,
        slot.sourceLocalZ,
        this.sourcePosition,
      );
      const to = this.anchor(slot.targetId, slot.targetHeight, 0, 0, this.targetPosition);
      if (from) this.emitResidue(from, slot.kind === 'evilEyeGaze' ? GAZE_CORE : DRAIN_CORE);
      if (to) this.emitResidue(to, slot.kind === 'evilEyeGaze' ? GAZE_FLOW : DRAIN_FLOW);
    }
    slot.active = false;
    slot.remaining = 0;
    slot.emitCarry = 0;
    slot.group.visible = false;
  }

  private emitResidue(at: THREE.Vector3, color: number): void {
    const count = Math.max(2, Math.round(4 * (0.45 + this.quality * 0.55)));
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      this.emit(
        'residue',
        at.x,
        at.y,
        at.z,
        Math.cos(angle) * 0.35,
        0.15 + Math.random() * 0.35,
        Math.sin(angle) * 0.35,
        color,
        0.12 + Math.random() * 0.07,
        0.3 + Math.random() * 0.18,
        0,
      );
    }
  }
}
