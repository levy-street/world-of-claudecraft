// The trash engine's walker orbs (G5, sim/mob/trash_kit/kit_walker.ts),
// drawn from the orb objects the sim mirrors (template id = the walker, pos
// stepped toward its ally each tick, facing = its heading):
//  - the orb: a floating mote of its school's fire (a churning plasma core in
//    a soft halo) gliding over its 20 Hz spots, trailing sparks and flame, a
//    glow pooled on the floor under it and a run of chevrons ahead of it on
//    the floor along its heading, so a player sees the lane to step into;
//  - the launch bar (`launch: 'cast'`): motes drawn into the caster;
//  - the launch (spellfx: the walker's castId, mob -> orb): a flare off the
//    caster;
//  - `trash_walker_empower` (orb -> ally): the orb streaks into the ally and
//    bursts, and the ally burns with the empower for as long as it carries
//    the aura (a floor glow, rising motes, a mote circling its head);
//  - `trash_walker_intercept` (orb -> player): it pops on the body that took it;
//  - `trash_walker_fade` (a world-point burst): it gutters out.
//
// The orb's position, the floor glow and the heading chevrons are
// ACTIONABLE (body-blocking it is the counterplay): every tier. The trail, the
// halo's shimmer and the bursts are cosmetic and thin on the low tier. Built
// once under the host's root before its gated attach; no light; no per-frame
// allocation.

import * as THREE from 'three';
import type { Entity, KitWalkerDef, SimEvent } from '../../sim/types';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { FLAME_HEAT } from '../gravewyrm_sanctum_fx/sanctum_fx_core';
import {
  empowerPulse,
  ORB_HOVER,
  orbFollow,
  orbHover,
  rgbOf,
  SCHOOL_TINT,
  walkerHover,
  walkerSize,
  walkerTint,
} from './trash_engine_fx_core';
import type { TrashEngineHost } from './trash_engine_host';

const ORB_SLOTS = 6;
const EMPOWER_SLOTS = 8;
const CHEVRON_LENGTH = 4.5;

const CORE_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
/** A churning plasma core: hot white heart, the school's colour at the
 *  limb, flowing noise so it reads alive. */
const CORE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uAlpha;
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
float h31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h31(i), h31(i + vec3(1, 0, 0)), u.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), u.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), u.x), u.y),
    u.z);
}
void main() {
  float facing = abs(dot(normalize(vN), normalize(vView)));
  float n = vnoise(vLocal * 4.0 + vec3(0.0, -uTime * 3.0, uTime * 1.3));
  float m = vnoise(vLocal * 9.0 - vec3(uTime * 2.0));
  float heart = pow(max(facing, 0.0), 1.6);
  vec3 col = mix(uColor * 1.4, vec3(1.0, 0.97, 0.9) * 1.8, heart * (0.55 + 0.45 * n));
  col += uColor * pow(max(1.0 - facing, 0.0), 2.0) * 1.2;
  float a = (0.55 + 0.45 * heart) * (0.75 + 0.35 * m) * uAlpha;
  gl_FragColor = vec4(col * a, 1.0);
}
`;

const CHEVRON_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** Chevrons running ahead along the orb's heading, fading with distance. */
const CHEVRON_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float along = vUv.y;
  float across = abs(vUv.x - 0.5) * 2.0;
  float v = fract(along * 4.0 - across * 0.6 - uTime * 1.8);
  float chev = smoothstep(0.0, 0.12, v) * (1.0 - smoothstep(0.28, 0.42, v));
  float fade = (1.0 - along) * smoothstep(0.0, 0.12, along) * (1.0 - smoothstep(0.75, 1.0, across));
  gl_FragColor = vec4(uColor * 1.4, chev * fade * uAlpha);
}
`;

interface OrbSlot {
  orbId: number;
  def: KitWalkerDef | null;
  /** The drawn spot (it glides after the 20 Hz one). */
  x: number;
  y: number;
  z: number;
  heading: number;
  seed: number;
  trail: number;
  group: THREE.Group;
  coreMat: THREE.ShaderMaterial;
  halo: THREE.Sprite;
  haloMat: THREE.SpriteMaterial;
  floor: THREE.Mesh;
  floorMat: THREE.MeshBasicMaterial;
  chevron: THREE.Mesh;
  chevronMat: THREE.ShaderMaterial;
}

interface EmpowerSlot {
  entityId: number;
  auraId: string;
  color: number;
  emit: number;
  glow: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  mote: THREE.Mesh;
  moteMat: THREE.ShaderMaterial;
}

export class EngineWalkers {
  private readonly orbs: OrbSlot[] = [];
  private readonly empowers: EmpowerSlot[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(private readonly host: TrashEngineHost) {
    const coreGeo = new THREE.IcosahedronGeometry(0.42, 3);
    const moteGeo = new THREE.IcosahedronGeometry(0.16, 2);
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    // The chevron strip runs from its origin along local +z.
    const strip = new THREE.PlaneGeometry(1.3, CHEVRON_LENGTH)
      .rotateX(-Math.PI / 2)
      .translate(0, 0, CHEVRON_LENGTH / 2 + 0.6);
    // Flip v so it reads 0 at the orb, 1 at the far end.
    const uv = strip.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    this.geometries.push(coreGeo, moteGeo, plane, strip);
    const coreMat = (name: string) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: {
          uTime: host.uTime,
          uColor: { value: new THREE.Color() },
          uAlpha: { value: 1 },
        },
        vertexShader: CORE_VERT,
        fragmentShader: CORE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(m);
      return m;
    };
    const glowMat = (name: string) => {
      const m = new THREE.MeshBasicMaterial({
        map: host.glowTex,
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        name,
      });
      this.materials.push(m);
      return m;
    };
    for (let i = 0; i < ORB_SLOTS; i++) {
      const group = new THREE.Group();
      group.visible = false;
      const cm = coreMat('trashEngineOrbCore');
      const core = new THREE.Mesh(coreGeo, cm);
      core.renderOrder = floorVfxRenderOrder('encounter', 27);
      group.add(core);
      // The halo faces the camera on its own (a sprite).
      const haloMat = new THREE.SpriteMaterial({
        map: host.glowTex,
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        name: 'trashEngineOrbHalo',
      });
      this.materials.push(haloMat);
      const halo = new THREE.Sprite(haloMat);
      halo.renderOrder = floorVfxRenderOrder('encounter', 26);
      group.add(halo);
      host.root.add(group);
      const floorMat = glowMat('trashEngineOrbFloor');
      const floor = new THREE.Mesh(plane, floorMat);
      floor.visible = false;
      floor.renderOrder = floorVfxRenderOrder('encounter', 3);
      host.root.add(floor);
      const chevronMat = new THREE.ShaderMaterial({
        name: 'trashEngineOrbChevrons',
        uniforms: {
          uTime: host.uTime,
          uColor: { value: new THREE.Color() },
          uAlpha: { value: 0.8 },
        },
        vertexShader: CHEVRON_VERT,
        fragmentShader: CHEVRON_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.materials.push(chevronMat);
      const chevron = new THREE.Mesh(strip, chevronMat);
      chevron.visible = false;
      chevron.frustumCulled = false;
      chevron.renderOrder = floorVfxRenderOrder('encounter', 12);
      host.root.add(chevron);
      this.orbs.push({
        orbId: -1,
        def: null,
        x: 0,
        y: 0,
        z: 0,
        heading: 0,
        seed: i * 1.7,
        trail: 0,
        group,
        coreMat: cm,
        halo,
        haloMat,
        floor,
        floorMat,
        chevron,
        chevronMat,
      });
    }
    for (let i = 0; i < EMPOWER_SLOTS; i++) {
      const gm = glowMat('trashEngineEmpowerGlow');
      const glow = new THREE.Mesh(plane, gm);
      glow.visible = false;
      glow.renderOrder = floorVfxRenderOrder('encounter', 2);
      host.root.add(glow);
      const mm = coreMat('trashEngineEmpowerMote');
      const mote = new THREE.Mesh(moteGeo, mm);
      mote.visible = false;
      mote.renderOrder = floorVfxRenderOrder('encounter', 27);
      host.root.add(mote);
      this.empowers.push({
        entityId: -1,
        auraId: '',
        color: 0xffffff,
        emit: 0,
        glow,
        glowMat: gm,
        mote,
        moteMat: mm,
      });
    }
  }

  // ------------------------------------------------------------------- scans

  /** An orb object seen by the scan. */
  scanOrb(e: Entity): void {
    const def = this.host.catalog.walkers.get(e.templateId);
    if (!def || this.orbs.some((o) => o.orbId === e.id)) return;
    this.claimOrb(
      e,
      def,
      e.pos.x,
      this.host.groundY(e.pos.x, e.pos.z) + orbHover(0, 0, walkerHover(def)),
      e.pos.z,
    );
  }

  /** Any body seen by the scan: a walker's empower glows on it. */
  scanBody(e: Entity): void {
    if (e.dead || e.auras.length === 0) return;
    for (const a of e.auras) {
      const def = this.host.catalog.empowerAuras.get(a.id);
      if (!def) continue;
      if (this.empowers.some((s) => s.entityId === e.id)) return;
      const slot = this.empowers.find((s) => s.entityId < 0);
      if (!slot) return;
      slot.entityId = e.id;
      slot.auraId = a.id;
      slot.color = walkerTint(def);
      slot.glowMat.color.setHex(slot.color);
      (slot.moteMat.uniforms.uColor.value as THREE.Color).setHex(slot.color);
      slot.glow.visible = true;
      slot.mote.visible = true;
      return;
    }
  }

  private claimOrb(e: Entity, def: KitWalkerDef, x: number, y: number, z: number): OrbSlot | null {
    const slot = this.orbs.find((o) => o.orbId < 0);
    if (!slot) return null;
    const color = walkerTint(def);
    slot.orbId = e.id;
    slot.def = def;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.heading = e.facing;
    slot.trail = 0;
    (slot.coreMat.uniforms.uColor.value as THREE.Color).setHex(color);
    slot.haloMat.color.setHex(color);
    slot.floorMat.color.setHex(color);
    (slot.chevronMat.uniforms.uColor.value as THREE.Color).setHex(color);
    slot.group.visible = true;
    slot.floor.visible = true;
    slot.chevron.visible = true;
    return slot;
  }

  // ------------------------------------------------------------------ events

  /** A walker beat. True when drawn here. */
  handleEvent(ev: SimEvent): boolean {
    const c = this.host.catalog;
    if (ev.type === 'spellfxAt') {
      if (ev.ability !== 'trash_walker_fade') return false;
      this.fade(ev.x, ev.z);
      return true;
    }
    if (ev.type !== 'spellfx' || !ev.ability) return false;
    const launch = c.walkerCasts.get(ev.ability);
    if (launch) {
      this.launch(ev.sourceId, ev.targetId, launch);
      return true;
    }
    if (ev.ability === 'trash_walker_empower') {
      this.empower(ev.sourceId, ev.targetId);
      return true;
    }
    if (ev.ability === 'trash_walker_intercept') {
      this.intercept(ev.sourceId, ev.targetId);
      return true;
    }
    if (ev.ability === 'trash_walker_fade') {
      const slot = this.orbs.find((o) => o.orbId === ev.sourceId);
      if (slot) this.fade(slot.x, slot.z);
      return true;
    }
    return false;
  }

  private launch(mobId: number, orbId: number, def: KitWalkerDef): void {
    const world = this.host.world;
    const mob = world.entities.get(mobId);
    const orb = world.entities.get(orbId);
    const h = this.host;
    const color = walkerTint(def);
    const from = mob ?? orb;
    if (!from) return;
    const gy = h.groundY(from.pos.x, from.pos.z);
    const chest = mob ? gy + h.bodyHeight(mob) * 0.6 : gy + orbHover(0, 0);
    if (orb && !this.orbs.some((o) => o.orbId === orb.id))
      this.claimOrb(orb, def, from.pos.x, chest, from.pos.z);
    h.shockRing(from.pos.x, from.pos.z, color, 3.2, 0.4);
    h.puff(from.pos.x, chest, from.pos.z, 20, {
      speed: 3.2,
      up: 0.6,
      life: 0.55,
      size: [0.3, 0.06],
      color: rgbOf(color),
      alpha: 1,
      pool: 'glow',
      radius: 0.3,
    });
    h.puff(from.pos.x, chest, from.pos.z, 3, {
      speed: 0.3,
      life: 0.3,
      size: [2.6, 0.8],
      color: rgbOf(color),
      alpha: 1,
      pool: 'glow',
    });
  }

  private empower(orbId: number, allyId: number): void {
    const h = this.host;
    const slot = this.orbs.find((o) => o.orbId === orbId);
    const ally = h.world.entities.get(allyId);
    const color = slot?.def ? walkerTint(slot.def) : SCHOOL_TINT.fire;
    if (ally) {
      const gy = h.groundY(ally.pos.x, ally.pos.z);
      const bh = h.bodyHeight(ally);
      const cy = gy + bh * 0.55;
      // The orb streaks the last stretch into the body.
      if (slot) {
        const dx = ally.pos.x - slot.x;
        const dy = cy - slot.y;
        const dz = ally.pos.z - slot.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        h.puff(slot.x, slot.y, slot.z, 14, {
          speed: d * 3,
          life: 0.3,
          size: [0.35, 0.1],
          color: rgbOf(color),
          alpha: 1,
          pool: 'glow',
          dir: [dx / d, dy / d, dz / d],
          spread: 0.08,
          drag: 0.5,
        });
      }
      h.shockRing(ally.pos.x, ally.pos.z, color, Math.max(3, bh), 0.5);
      h.puff(ally.pos.x, cy, ally.pos.z, 30, {
        speed: 4,
        up: 1.5,
        life: 0.7,
        size: [0.32, 0.07],
        color: rgbOf(color),
        alpha: 1,
        pool: 'glow',
        radius: bh * 0.15,
      });
      h.puff(ally.pos.x, cy, ally.pos.z, 4, {
        speed: 0.3,
        life: 0.35,
        size: [bh * 1.2, bh * 0.4],
        color: rgbOf(color),
        alpha: 1,
        pool: 'glow',
      });
      if (slot?.def?.school === 'fire')
        h.puff(ally.pos.x, gy + bh * 0.2, ally.pos.z, 16, {
          speed: 1.2,
          up: 2.6,
          life: 0.8,
          size: [1.6, 0.5],
          color: FLAME_HEAT,
          alpha: 1,
          pool: 'pyre',
          radius: bh * 0.2,
        });
    }
    if (slot) this.releaseOrb(slot);
  }

  private intercept(orbId: number, playerId: number): void {
    const h = this.host;
    const slot = this.orbs.find((o) => o.orbId === orbId);
    const p = h.world.entities.get(playerId);
    const color = slot?.def ? walkerTint(slot.def) : SCHOOL_TINT.fire;
    const x = p?.pos.x ?? slot?.x;
    const z = p?.pos.z ?? slot?.z;
    if (x === undefined || z === undefined) return;
    const gy = h.groundY(x, z);
    const y = p ? gy + h.bodyHeight(p) * 0.55 : (slot?.y ?? gy + 1.4);
    // It breaks on the body that stood in its way: a hard pop, a ring out.
    h.shockRing(x, z, color, 3.6, 0.45);
    h.shockRing(x, z, 0xffffff, 1.8, 0.25);
    h.puff(x, y, z, 36, {
      speed: 6,
      up: 1,
      life: 0.6,
      size: [0.3, 0.06],
      color: rgbOf(color),
      alpha: 1,
      pool: 'glow',
      drag: 2,
    });
    h.puff(x, y, z, 5, {
      speed: 0.2,
      life: 0.25,
      size: [3.2, 1],
      color: [1, 0.96, 0.9],
      alpha: 1,
      pool: 'glow',
    });
    h.puff(x, y, z, 12, {
      speed: 1.6,
      up: 0.8,
      life: 1.2,
      size: [0.8, 2.2],
      color: [0.45, 0.4, 0.38],
      alpha: 0.35,
    });
    if (slot) this.releaseOrb(slot);
  }

  private fade(x: number, z: number): void {
    let slot: OrbSlot | undefined;
    let best = Infinity;
    for (const o of this.orbs) {
      if (o.orbId < 0) continue;
      const d = Math.hypot(o.x - x, o.z - z);
      if (d < best) {
        best = d;
        slot = o;
      }
    }
    const h = this.host;
    const y = slot ? slot.y : h.groundY(x, z) + orbHover(0, 0, ORB_HOVER);
    const color = slot?.def ? walkerTint(slot.def) : SCHOOL_TINT.fire;
    h.puff(x, y, z, 14, {
      speed: 1.2,
      up: 1,
      life: 0.9,
      size: [0.22, 0.04],
      color: rgbOf(color),
      alpha: 0.9,
      pool: 'glow',
    });
    h.puff(x, y, z, 8, {
      speed: 0.6,
      up: 1.2,
      life: 1.6,
      size: [0.6, 1.8],
      color: [0.4, 0.38, 0.4],
      alpha: 0.3,
    });
    if (slot && best < 3) this.releaseOrb(slot);
  }

  private releaseOrb(slot: OrbSlot): void {
    slot.orbId = -1;
    slot.def = null;
    slot.group.visible = false;
    slot.floor.visible = false;
    slot.chevron.visible = false;
  }

  // ------------------------------------------------------------------- frame

  update(dt: number, clock: number): void {
    const world = this.host.world;
    const k = orbFollow(dt);
    for (const slot of this.orbs) {
      if (slot.orbId < 0) continue;
      const e = world.entities.get(slot.orbId);
      if (!e) {
        this.releaseOrb(slot);
        continue;
      }
      const h = this.host;
      const gyT = h.groundY(e.pos.x, e.pos.z);
      const ty = gyT + orbHover(clock, slot.seed, walkerHover(slot.def));
      slot.x += (e.pos.x - slot.x) * k;
      slot.y += (ty - slot.y) * k;
      slot.z += (e.pos.z - slot.z) * k;
      // The heading eases round with the sim's facing (toward its ally).
      let dh = e.facing - slot.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      slot.heading += dh * k;
      slot.group.position.set(slot.x, slot.y, slot.z);
      const size = walkerSize(slot.def);
      const pulse = 0.92 + 0.12 * Math.sin(clock * 9 + slot.seed);
      slot.group.scale.setScalar(pulse * size);
      slot.halo.scale.setScalar(2.6 + 0.3 * Math.sin(clock * 5 + slot.seed));
      const gy = h.groundY(slot.x, slot.z);
      slot.floor.position.set(slot.x, gy + 0.1, slot.z);
      slot.floor.scale.set(2.2 * size, 1, 2.2 * size);
      slot.floorMat.opacity = 0.55;
      slot.chevron.position.set(slot.x, gy + 0.09, slot.z);
      slot.chevron.rotation.y = slot.heading;
      // The trail: sparks shed behind it, and flame for a fire orb.
      slot.trail += dt * 40 * h.density;
      const def = slot.def;
      const color = def ? walkerTint(def) : SCHOOL_TINT.fire;
      while (slot.trail >= 1) {
        slot.trail -= 1;
        h.puff(slot.x, slot.y, slot.z, 1, {
          speed: 0.5,
          up: 0.4,
          life: 0.7,
          size: [0.28, 0.04],
          color: rgbOf(color),
          alpha: 1,
          pool: 'glow',
          radius: 0.25,
          gravity: 1.2,
        });
        if (def?.school === 'fire' && h.rand() < 0.5)
          h.puff(slot.x, slot.y - 0.1, slot.z, 1, {
            speed: 0.2,
            up: 0.8,
            life: 0.45,
            size: [0.9, 0.3],
            color: FLAME_HEAT,
            alpha: 1,
            pool: 'pyre',
            radius: 0.15,
          });
      }
    }
    this.updateEmpowers(dt, clock);
  }

  private updateEmpowers(dt: number, clock: number): void {
    const world = this.host.world;
    const h = this.host;
    for (const slot of this.empowers) {
      if (slot.entityId < 0) continue;
      const e = world.entities.get(slot.entityId);
      if (!e || e.dead || !e.auras.some((a) => a.id === slot.auraId)) {
        slot.entityId = -1;
        slot.glow.visible = false;
        slot.mote.visible = false;
        continue;
      }
      const bh = h.bodyHeight(e);
      const gy = h.groundY(e.pos.x, e.pos.z);
      const k = empowerPulse(clock);
      slot.glow.position.set(e.pos.x, gy + 0.16, e.pos.z);
      slot.glow.scale.set(bh * 1.25 * k, 1, bh * 1.25 * k);
      slot.glowMat.opacity = 0.62;
      // A mote of the orb circling its head.
      const a = clock * 3.4 + e.id;
      const r = Math.max(0.6, bh * 0.28);
      slot.mote.position.set(
        e.pos.x + Math.cos(a) * r,
        gy + bh * 0.92 + Math.sin(clock * 5) * 0.12,
        e.pos.z + Math.sin(a) * r,
      );
      slot.emit += dt * 16 * h.density;
      while (slot.emit >= 1) {
        slot.emit -= 1;
        h.puff(e.pos.x, gy + bh * 0.3, e.pos.z, 1, {
          speed: 0.5,
          up: 2.2,
          life: 1,
          size: [0.26, 0.06],
          color: rgbOf(slot.color),
          alpha: 1,
          pool: 'glow',
          radius: bh * 0.22,
        });
        if (h.rand() < 0.3)
          h.puff(e.pos.x, gy + 0.1, e.pos.z, 1, {
            speed: 0.3,
            up: 1.4,
            life: 0.7,
            size: [1.2, 0.4],
            color: FLAME_HEAT,
            alpha: 0.8,
            pool: 'pyre',
            radius: bh * 0.25,
          });
      }
    }
  }

  /** A walker's launch bar: motes drawn into the caster's hands. */
  gather(e: Entity, dt: number): void {
    const def = this.host.catalog.walkerCasts.get(e.castingAbility ?? '');
    if (!def) return;
    const h = this.host;
    const color = walkerTint(def);
    const gy = h.groundY(e.pos.x, e.pos.z);
    const cy = gy + h.bodyHeight(e) * 0.6;
    const want = dt * 30 * h.density;
    const n = Math.min(6, Math.floor(want) + (h.rand() < want % 1 ? 1 : 0));
    for (let i = 0; i < n; i++) {
      const a = h.rand() * Math.PI * 2;
      const el = (h.rand() - 0.3) * 1.2;
      const r = 1.8;
      const ox = Math.cos(a) * Math.cos(el) * r;
      const oy = Math.sin(el) * r;
      const oz = Math.sin(a) * Math.cos(el) * r;
      h.puff(e.pos.x + ox, cy + oy, e.pos.z + oz, 1, {
        speed: r * 2.2,
        life: 0.45,
        size: [0.08, 0.3],
        color: rgbOf(color),
        alpha: 1,
        pool: 'glow',
        dir: [-ox / r, -oy / r, -oz / r],
        spread: 0.05,
        drag: 0.3,
      });
    }
  }

  hideAll(): void {
    for (const s of this.orbs) this.releaseOrb(s);
    for (const s of this.empowers) {
      s.entityId = -1;
      s.glow.visible = false;
      s.mote.visible = false;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
