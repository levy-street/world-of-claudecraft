// The Mist Chanter's Fog Bank (plan: bastion_trash_fx_core.ts): the fog
// patch the sim lays as a ground object (BASTION_FOG_BANK_CLOUD, its scale
// the radius) drawn as a thick rolling grey-green sea fog draped on the floor
// with a clear bright beaded edge at that radius, standing until the object
// goes and then lifting; and a misty shroud on every ally wearing its ward
// (BASTION_FOG_SHROUD) while it stands in the fog.
//
// The patch and the shrouds are ACTIONABLE (drag the pack out of it), so they
// draw on EVERY tier; the fog billowing over the patch sheds with the effects
// density. The patch sits on the encounter band's floor rung, under every
// damage telegraph. Pooled, built once, no per-frame allocation.

import * as THREE from 'three';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  FOG_DISC_RINGS,
  FOG_DISC_SEGMENTS,
  FOG_FEATHER,
  FOG_LIFT,
  fogAlpha,
  stableSlots,
  TRASH_FX_SLOTS,
} from './bastion_trash_fx_core';
import {
  LOOK,
  SHELL_MODE,
  type ShellSlot,
  TRASH_NOISE_GLSL,
  type TrashBody,
  type TrashFxKit,
} from './bastion_trash_fx_kit';

const FOG_GREY = new THREE.Color(0.62, 0.7, 0.65);
const FOG_RIM = new THREE.Color(0.82, 0.96, 0.88);

const FOG_VERT = /* glsl */ `
attribute float aR;
attribute float aAng;
varying float vR;
varying float vAng;
varying vec2 vP;
void main() {
  vR = aR;
  vAng = aAng;
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The fog patch: rolling grey-green fog inside, a bright beaded edge at the
 *  radius the sim shrouds in, a soft feather past it. */
const FOG_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uSeed;
uniform vec3 uFog;
uniform vec3 uRim;
varying float vR;
varying float vAng;
varying vec2 vP;
${TRASH_NOISE_GLSL}
void main() {
  vec2 p = vP * 0.55 + uSeed;
  float roll = fbm(p + vec2(uTime * 0.12, uTime * 0.07));
  float roll2 = fbm(p * 1.7 - vec2(uTime * 0.09, -uTime * 0.06));
  float dens = 0.45 + roll * roll2 * 1.6;
  float inner = 1.0 - smoothstep(0.8, 1.0, vR);
  float rd = (vR - 0.99) / 0.03;
  float rim = exp(-rd * rd);
  float bead = 0.72 + 0.28 * sin(vAng * 28.0 - uTime * 1.6);
  float feather = (1.0 - smoothstep(1.0, 1.12, vR)) * step(1.0, vR);
  float a = inner * dens * 0.62 + rim * bead * 0.95 + feather * 0.22 * dens;
  vec3 col = mix(uFog * (0.8 + 0.35 * roll), uRim, clamp(rim * bead, 0.0, 1.0));
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uAlpha);
}
`;

/** The fog disc's radial grid (positions written per lay, draped on the floor). */
function fogDisc(): THREE.BufferGeometry {
  const rings = FOG_DISC_RINGS;
  const segs = FOG_DISC_SEGMENTS;
  const n = 1 + rings * (segs + 1);
  const r = new Float32Array(n);
  const ang = new Float32Array(n);
  const idx: number[] = [];
  for (let k = 1; k <= rings; k++) {
    for (let i = 0; i <= segs; i++) {
      const v = 1 + (k - 1) * (segs + 1) + i;
      r[v] = (k / rings) * FOG_FEATHER;
      ang[v] = (i / segs) * Math.PI * 2;
    }
  }
  for (let i = 0; i < segs; i++) idx.push(0, 1 + i + 1, 1 + i);
  for (let k = 1; k < rings; k++) {
    for (let i = 0; i < segs; i++) {
      const a = 1 + (k - 1) * (segs + 1) + i;
      const b = a + segs + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
  g.setAttribute('position', pos.setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aR', new THREE.BufferAttribute(r, 1));
  g.setAttribute('aAng', new THREE.BufferAttribute(ang, 1));
  g.setIndex(idx);
  return g;
}

interface FogSlot {
  mesh: THREE.Mesh;
  alpha: { value: number };
  objectId: number;
  x: number;
  z: number;
  radius: number;
  born: number;
  lifting: number;
  nextPuff: number;
}

export class BastionFogBankFx {
  private readonly fogs: FogSlot[] = [];
  private readonly shrouds: ShellSlot[] = [];
  /** The live shrouded bodies this frame, and the body each shroud slot shows
   *  (stableSlots: a body keeps its slot, a full pool drops a newcomer). */
  private readonly live: number[] = [];
  private readonly seats: number[] = new Array(TRASH_FX_SLOTS.shrouds).fill(-1);

  constructor(
    private readonly kit: TrashFxKit,
    sleeve: THREE.BufferGeometry,
  ) {
    for (let i = 0; i < TRASH_FX_SLOTS.fogs; i++) {
      const geo = fogDisc();
      kit.geometries.push(geo);
      const alpha = { value: 0 };
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: kit.uTime,
          uAlpha: alpha,
          uSeed: { value: kit.rand() * 20 },
          uFog: { value: FOG_GREY.clone() },
          uRim: { value: FOG_RIM.clone() },
        },
        vertexShader: FOG_VERT,
        fragmentShader: FOG_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      kit.materials.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      // An ally-ward zone, not damage: under every damage telegraph's fill.
      mesh.renderOrder = floorVfxRenderOrder('encounter', 10);
      mesh.frustumCulled = false;
      mesh.visible = false;
      kit.root.add(mesh);
      this.fogs.push({
        mesh,
        alpha,
        objectId: -1,
        x: 0,
        z: 0,
        radius: 1,
        born: 0,
        lifting: -1,
        nextPuff: 0,
      });
    }
    for (let i = 0; i < TRASH_FX_SLOTS.shrouds; i++)
      this.shrouds.push(kit.shellSlot(kit.root, sleeve, SHELL_MODE.shroud, FOG_GREY, false));
  }

  /** A fog object the scan found: lay a patch for it (once). */
  claim(obj: TrashBody): void {
    const kit = this.kit;
    if (this.fogs.some((f) => f.objectId === obj.id)) return;
    // A free slot, else one only lifting (its object is gone): a standing
    // patch is never taken; a full pool leaves the newcomer to the next scan.
    const slot = this.fogs.find((f) => f.objectId < 0) ?? this.fogs.find((f) => f.lifting >= 0);
    if (!slot) return;
    slot.objectId = obj.id;
    slot.x = obj.pos.x;
    slot.z = obj.pos.z;
    slot.radius = obj.scale > 0 ? obj.scale : 4;
    slot.born = kit.now;
    slot.lifting = -1;
    slot.nextPuff = kit.now;
    // Drape the disc on the floor once (the patch never moves).
    const geo = slot.mesh.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const rAttr = geo.getAttribute('aR') as THREE.BufferAttribute;
    const angAttr = geo.getAttribute('aAng') as THREE.BufferAttribute;
    const cy = kit.groundY(slot.x, slot.z);
    for (let i = 0; i < pos.count; i++) {
      const r = rAttr.getX(i) * slot.radius;
      const a = angAttr.getX(i);
      const x = slot.x + Math.cos(a) * r;
      const z = slot.z + Math.sin(a) * r;
      pos.setXYZ(i, x, (i === 0 ? cy : kit.groundY(x, z)) + 0.08, z);
    }
    pos.needsUpdate = true;
    slot.mesh.visible = true;
    // It settles: fog rolling out from the middle, a ring running to its edge.
    kit.ring(slot.x, slot.z, FOG_RIM, slot.radius * 0.3, slot.radius * 1.05, 0.6, 0.6);
    const n = kit.count(16);
    const out = slot.radius * 0.9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const ox = Math.cos(a);
      const oz = Math.sin(a);
      kit.emit(kit.mist, LOOK.fog, slot.x, cy + 0.4, slot.z, ox * out, 0.2, oz * out, 1.6, 1, 1.4);
    }
  }

  update(world: IWorld, shroudIds: readonly number[], dt: number): void {
    this.updateFogs(world);
    this.updateShrouds(world, shroudIds, dt);
  }

  private updateFogs(world: IWorld): void {
    const kit = this.kit;
    for (const slot of this.fogs) {
      if (slot.objectId < 0) continue;
      if (slot.lifting < 0 && !world.entities.has(slot.objectId)) slot.lifting = kit.now;
      const lifting = slot.lifting < 0 ? -1 : kit.now - slot.lifting;
      if (lifting >= FOG_LIFT) {
        slot.objectId = -1;
        slot.mesh.visible = false;
        continue;
      }
      const a = fogAlpha(kit.now - slot.born, lifting);
      slot.alpha.value = a;
      // The fog rolling over the patch (a flourish: the disc carries the read).
      if (kit.now < slot.nextPuff || !kit.near(slot.x, slot.z)) continue;
      slot.nextPuff = kit.now + kit.every(0.12);
      const ang = kit.rand() * Math.PI * 2;
      const rr = Math.sqrt(kit.rand()) * slot.radius * 0.82;
      const x = slot.x + Math.cos(ang) * rr;
      const z = slot.z + Math.sin(ang) * rr;
      const swirl = 0.5 + kit.rand() * 0.6;
      const y = kit.groundY(x, z) + 0.35 + kit.rand() * 0.5;
      const life = 2.4 + kit.rand() * 0.8;
      const vx = -Math.sin(ang) * swirl;
      const vz = Math.cos(ang) * swirl;
      kit.emit(kit.mist, LOOK.fog, x, y, z, vx, 0.12 + kit.rand() * 0.15, vz, life, 1, a);
    }
  }

  private updateShrouds(world: IWorld, ids: readonly number[], dt: number): void {
    const kit = this.kit;
    this.live.length = 0;
    for (const id of ids) {
      const e = world.entities.get(id);
      if (e && !e.dead) this.live.push(id);
    }
    stableSlots(this.seats, this.live, this.live.length);
    for (let i = 0; i < this.shrouds.length; i++) {
      const slot = this.shrouds[i];
      const id = this.seats[i];
      const e = id >= 0 ? world.entities.get(id) : undefined;
      if (!e) {
        slot.alpha = Math.max(0, slot.alpha - dt * 3);
        slot.u.uAlpha.value = slot.alpha;
        if (slot.alpha <= 0) {
          slot.mesh.visible = false;
          slot.id = -1;
        }
        continue;
      }
      if (slot.id !== e.id) {
        slot.id = e.id;
        slot.alpha = 0;
      }
      slot.alpha = Math.min(1, slot.alpha + dt * 3);
      const h = kit.heightOf(e);
      const r = Math.max(1.1, h * 0.26);
      slot.mesh.position.set(e.pos.x, e.pos.y, e.pos.z);
      slot.mesh.scale.set(r, h * 1.05, r);
      slot.u.uAlpha.value = slot.alpha * 0.95;
      slot.mesh.visible = true;
    }
  }
}
