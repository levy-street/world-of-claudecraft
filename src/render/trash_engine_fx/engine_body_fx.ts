// The trash engine's marks on a player's body, all read from their auras:
//  - freeze stacks (sim/mob/trash_kit/freeze_stacks.ts, any `cone.freezeStack`
//    slow, the Rime Breath's Creeping Rime): rime crystals grow out of the
//    body from the feet up, more and bigger with every stack, a frost glow
//    pooled under them and a chill breathing off them, so the group sees who
//    is one breath from freezing;
//  - the freeze itself (its stun aura, and the spellfx 'nova' keyed on it): a
//    block of ice slams shut round the body, cracks as the stun runs out, and
//    shatters when it ends;
//  - a brand (any kit `brand.auraId`, the Goadsmith's Branding Iron): a
//    red-hot mark burning on the chest with flames licking off it until it is
//    put out; `trash_brand_quenched` hisses it out in a burst of steam;
//    `trash_brand_fizzled` (the victim hid) is the iron's sparks dying in the
//    air on the way.
//
// All cosmetic over the aura the HUD already shows (actionable state is the
// aura): the crystals, the ice and the brand draw on every tier (they are
// cheap), their particles thin on the low tier. Built once under the host's
// root before its gated attach; no light; no per-frame allocation.

import * as THREE from 'three';
import type { Entity, FreezeStackDef, SimEvent } from '../../sim/types';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { surfaceMat } from '../gfx';
import { FLAME_HEAT } from '../gravewyrm_sanctum_fx/sanctum_fx_core';
import { billboardMaterial, brandGlyphTexture } from './engine_glyphs';
import {
  brandFlicker,
  type EncaseLook,
  iceEncase,
  rimeClimb,
  rimeCrystals,
  rimeIntensity,
} from './trash_engine_fx_core';
import type { TrashEngineHost } from './trash_engine_host';

const RIME_SLOTS = 6;
const CRYSTALS = 14;
const ENCASE_SLOTS = 4;
const BRAND_SLOTS = 6;

/** One crystal's seat on the body (fixed per crystal index, deterministic). */
interface CrystalSeat {
  angle: number;
  /** Share of the full-rime climb it sits at (ascending: low ones first). */
  rise: number;
  tilt: number;
  length: number;
  out: number;
}

function crystalSeats(): CrystalSeat[] {
  const seats: CrystalSeat[] = [];
  for (let i = 0; i < CRYSTALS; i++) {
    const h = (n: number) => {
      const s = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
      return s - Math.floor(s);
    };
    seats.push({
      angle: i * 2.39996 + h(1) * 0.4,
      rise: (i + 0.5) / CRYSTALS,
      tilt: 0.35 + h(2) * 0.55,
      length: 0.55 + h(3) * 0.5,
      out: 0.32 + h(4) * 0.12,
    });
  }
  return seats;
}

const ICE_VERT = /* glsl */ `
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
/** The block of ice round a frozen body: clear in the middle so the body
 *  shows through, frosted and bright at its edges, cracks spreading as the
 *  stun runs out. */
const ICE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGrow;
uniform float uCrack;
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
  float fres = pow(max(1.0 - abs(dot(normalize(vN), normalize(vView))), 0.0), 1.8);
  float frost = vnoise(vLocal * 5.0) * 0.5 + vnoise(vLocal * 11.0) * 0.5;
  float n = vnoise(vLocal * 2.4 + 3.0);
  float crack = (1.0 - smoothstep(0.0, 0.02 + 0.05 * uCrack, abs(n - 0.5))) * uCrack;
  vec3 col = mix(vec3(0.55, 0.82, 0.97), vec3(0.95, 0.99, 1.0), fres * 0.8 + frost * 0.2);
  col += vec3(0.8, 0.95, 1.0) * crack * 1.4;
  float a = (0.2 + fres * 0.6 + frost * 0.12 + crack * 0.7) * uGrow;
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.92));
}
`;

interface RimeSlot {
  entityId: number;
  auraId: string;
  def: FreezeStackDef | null;
  /** The intensity drawn (eases after the stacks). */
  shown: number;
  emit: number;
  glow: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
}

interface EncaseSlot {
  entityId: number;
  auraId: string;
  since: number;
  x: number;
  y: number;
  z: number;
  h: number;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

interface BrandSlot {
  entityId: number;
  auraId: string;
  emit: number;
  glyph: THREE.Mesh;
  glyphMat: THREE.ShaderMaterial;
}

export class EngineBodyFx {
  private readonly rimes: RimeSlot[] = [];
  private readonly encases: EncaseSlot[] = [];
  private readonly brands: BrandSlot[] = [];
  private readonly crystals: THREE.InstancedMesh;
  private readonly seats = crystalSeats();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly brandTex: THREE.Texture | null;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly encase: EncaseLook = { grow: 0, crack: 0 };
  private clock = 0;

  constructor(private readonly host: TrashEngineHost) {
    // The rime crystals: long faceted points, one instanced draw for all.
    const crystalGeo = new THREE.OctahedronGeometry(0.5, 0)
      .scale(0.28, 1, 0.22)
      .translate(0, 0.5, 0);
    crystalGeo.computeVertexNormals();
    this.geometries.push(crystalGeo);
    this.crystals = new THREE.InstancedMesh(
      crystalGeo,
      surfaceMat({
        color: 0xe4f7ff,
        roughness: 0.12,
        metalness: 0.05,
        emissive: 0x3c86b8,
        flatShading: true,
      }),
      RIME_SLOTS * CRYSTALS,
    );
    this.crystals.name = 'trashEngineRimeCrystals';
    this.crystals.frustumCulled = false;
    for (let i = 0; i < RIME_SLOTS * CRYSTALS; i++) this.crystals.setMatrixAt(i, this.zero);
    this.crystals.visible = false;
    host.root.add(this.crystals);
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.geometries.push(plane);
    for (let i = 0; i < RIME_SLOTS; i++) {
      const glowMat = new THREE.MeshBasicMaterial({
        map: host.glowTex,
        color: 0x8fdcff,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        name: 'trashEngineRimeGlow',
      });
      this.materials.push(glowMat);
      const glow = new THREE.Mesh(plane, glowMat);
      glow.visible = false;
      glow.renderOrder = floorVfxRenderOrder('encounter', 2);
      host.root.add(glow);
      this.rimes.push({ entityId: -1, auraId: '', def: null, shown: 0, emit: 0, glow, glowMat });
    }
    // The ice block: a faceted, slightly irregular prism round the body.
    const iceGeo = new THREE.IcosahedronGeometry(1, 1);
    const ip = iceGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < ip.count; i++) {
      const x = ip.getX(i);
      const y = ip.getY(i);
      const z = ip.getZ(i);
      const k = Math.sin(
        Math.round(x * 50) * 1.3 + Math.round(y * 50) * 2.1 + Math.round(z * 50) * 0.7,
      );
      const j = 1 + k * 0.08;
      ip.setXYZ(i, x * 0.62 * j, (y * 0.5 + 0.5) * j, z * 0.58 * j);
    }
    iceGeo.computeVertexNormals();
    const iceFlat = iceGeo.toNonIndexed();
    iceGeo.dispose();
    iceFlat.computeVertexNormals();
    this.geometries.push(iceFlat);
    for (let i = 0; i < ENCASE_SLOTS; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'trashEngineIceEncase',
        uniforms: { uTime: host.uTime, uGrow: { value: 0 }, uCrack: { value: 0 } },
        vertexShader: ICE_VERT,
        fragmentShader: ICE_FRAG,
        transparent: true,
        depthWrite: false,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(iceFlat, mat);
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 28);
      host.root.add(mesh);
      this.encases.push({
        entityId: -1,
        auraId: '',
        since: 0,
        x: 0,
        y: 0,
        z: 0,
        h: 2.6,
        mesh,
        mat,
      });
    }
    // The brand on the chest.
    this.brandTex = brandGlyphTexture();
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometries.push(quad);
    for (let i = 0; i < BRAND_SLOTS; i++) {
      const glyphMat = billboardMaterial('trashEngineBrand', this.brandTex, 0.6, true);
      this.materials.push(glyphMat);
      const glyph = new THREE.Mesh(quad, glyphMat);
      glyph.frustumCulled = false;
      glyph.visible = false;
      glyph.renderOrder = floorVfxRenderOrder('encounter', 28);
      host.root.add(glyph);
      this.brands.push({ entityId: -1, auraId: '', emit: 0, glyph, glyphMat });
    }
  }

  // ------------------------------------------------------------------- scans

  /** A player (or any body) seen by the scan: claim its rime, ice, brand. */
  scan(e: Entity): void {
    if (e.dead || e.auras.length === 0) return;
    const c = this.host.catalog;
    for (const a of e.auras) {
      const fs = c.freezeStacks.get(a.id);
      if (fs && !this.rimes.some((s) => s.entityId === e.id)) {
        const slot = this.rimes.find((s) => s.entityId < 0);
        if (slot) {
          slot.entityId = e.id;
          slot.auraId = a.id;
          slot.def = fs;
          slot.shown = 0;
          slot.emit = 0;
          slot.glow.visible = true;
          this.crystals.visible = true;
        }
      }
      if (c.freezeAuras.has(a.id) && !this.encases.some((s) => s.entityId === e.id))
        this.freeze(e, a.id, false);
      if (c.brandAuras.has(a.id) && !this.brands.some((s) => s.entityId === e.id)) {
        const slot = this.brands.find((s) => s.entityId < 0);
        if (slot) {
          slot.entityId = e.id;
          slot.auraId = a.id;
          slot.emit = 0;
          slot.glyph.visible = true;
        }
      }
    }
  }

  // ------------------------------------------------------------------ events

  handleEvent(ev: SimEvent): boolean {
    if (ev.type !== 'spellfx' || !ev.ability) return false;
    const c = this.host.catalog;
    const fs = c.freezeAuras.get(ev.ability);
    if (fs) {
      const victim = this.host.world.entities.get(ev.targetId);
      if (victim) this.freeze(victim, fs.freezeAuraId, true);
      return true;
    }
    if (ev.ability === 'trash_brand_quenched') {
      this.quenched(ev.targetId);
      return true;
    }
    if (ev.ability === 'trash_brand_fizzled') {
      this.fizzled(ev.sourceId, ev.targetId);
      return true;
    }
    return false;
  }

  private freeze(e: Entity, auraId: string, slam: boolean): void {
    let slot = this.encases.find((s) => s.entityId === e.id);
    if (!slot) slot = this.encases.find((s) => s.entityId < 0);
    if (!slot) return;
    const h = this.host;
    const fresh = slot.entityId !== e.id;
    slot.entityId = e.id;
    slot.auraId = auraId;
    if (fresh) slot.since = slam ? this.clock : this.clock - 1;
    slot.x = e.pos.x;
    slot.z = e.pos.z;
    slot.y = h.groundY(e.pos.x, e.pos.z);
    slot.h = h.bodyHeight(e);
    slot.mesh.visible = true;
    // The rime gives way to the ice: its stacks are cleared.
    const rime = this.rimes.find((r) => r.entityId === e.id);
    if (rime) this.releaseRime(rime);
    if (!slam || !fresh) return;
    h.shockRing(slot.x, slot.z, 0xbff0ff, 3.2, 0.4);
    h.puff(slot.x, slot.y + slot.h * 0.5, slot.z, 24, {
      speed: 3,
      up: 0.6,
      life: 0.9,
      size: [0.9, 2.4],
      color: [0.9, 0.96, 1],
      alpha: 0.45,
      radius: 0.5,
      drag: 2.6,
    });
    h.shards.burst(slot.x, slot.y + slot.h * 0.4, slot.z, 14, {
      speed: 3.5,
      up: 4,
      size: [0.2, 0.6],
      radius: 0.6,
      iron: 0,
    });
  }

  private shatterIce(slot: EncaseSlot): void {
    const h = this.host;
    h.shards.burst(slot.x, slot.y + slot.h * 0.55, slot.z, 34, {
      speed: 5,
      up: 4,
      size: [0.25, 0.85],
      radius: 0.7,
      iron: 0,
    });
    h.puff(slot.x, slot.y + slot.h * 0.5, slot.z, 18, {
      speed: 2.6,
      up: 1,
      life: 1.1,
      size: [0.8, 2.2],
      color: [0.9, 0.96, 1],
      alpha: 0.4,
      radius: 0.5,
      drag: 2.4,
    });
    h.puff(slot.x, slot.y + slot.h * 0.5, slot.z, 16, {
      speed: 3.5,
      up: 1.5,
      life: 0.6,
      size: [0.18, 0.05],
      color: [0.8, 0.95, 1],
      alpha: 1,
      pool: 'glow',
      gravity: 6,
    });
    slot.entityId = -1;
    slot.mesh.visible = false;
  }

  private quenched(playerId: number): void {
    const h = this.host;
    const p = h.world.entities.get(playerId);
    const slot = this.brands.find((s) => s.entityId === playerId);
    if (slot) {
      slot.entityId = -1;
      slot.glyph.visible = false;
    }
    if (!p) return;
    const gy = h.groundY(p.pos.x, p.pos.z);
    const bh = h.bodyHeight(p);
    // The hiss: a gout of steam off the brand and the water round the feet.
    h.puff(p.pos.x, gy + bh * 0.6, p.pos.z, 30, {
      speed: 2.4,
      up: 2.6,
      life: 1.8,
      size: [0.8, 3],
      color: [0.94, 0.96, 0.98],
      alpha: 0.5,
      radius: 0.4,
      drag: 1.8,
    });
    h.puff(p.pos.x, gy + 0.2, p.pos.z, 20, {
      speed: 2,
      up: 1.2,
      life: 1.4,
      size: [0.9, 2.6],
      color: [0.9, 0.95, 1],
      alpha: 0.4,
      radius: 0.8,
      drag: 2,
    });
    h.puff(p.pos.x, gy + bh * 0.6, p.pos.z, 16, {
      speed: 3,
      up: 2.5,
      life: 0.6,
      size: [0.14, 0.04],
      color: [0.7, 0.92, 1],
      alpha: 1,
      pool: 'glow',
      gravity: 8,
    });
    h.shockRing(p.pos.x, p.pos.z, 0x9fe8ff, 2.6, 0.45);
  }

  private fizzled(mobId: number, playerId: number): void {
    const h = this.host;
    const mob = h.world.entities.get(mobId);
    const p = h.world.entities.get(playerId);
    if (!mob || !p) return;
    const fy = h.groundY(mob.pos.x, mob.pos.z) + h.bodyHeight(mob) * 0.5;
    const ty = h.groundY(p.pos.x, p.pos.z) + h.bodyHeight(p) * 0.55;
    const dx = p.pos.x - mob.pos.x;
    const dy = ty - fy;
    const dz = p.pos.z - mob.pos.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    // The iron's sparks fly out, lose their heat and fall short of the body.
    for (let k = 0; k < 6; k++) {
      const t = 0.15 + k * 0.12;
      h.puff(mob.pos.x + dx * t, fy + dy * t, mob.pos.z + dz * t, 3, {
        speed: 1.2,
        up: 0.4,
        life: 0.7 - k * 0.06,
        size: [0.2, 0.03],
        color: k < 3 ? [1, 0.5, 0.15] : [0.55, 0.4, 0.35],
        alpha: 1 - k * 0.12,
        pool: 'glow',
        dir: [dx / d, dy / d, dz / d],
        spread: 0.6,
        gravity: 7,
      });
    }
    h.puff(mob.pos.x + dx * 0.8, fy + dy * 0.8, mob.pos.z + dz * 0.8, 6, {
      speed: 0.5,
      up: 0.8,
      life: 1.2,
      size: [0.4, 1.3],
      color: [0.4, 0.38, 0.38],
      alpha: 0.3,
    });
  }

  // ------------------------------------------------------------------- frame

  update(dt: number, clock: number): void {
    this.clock = clock;
    this.updateRimes(dt);
    this.updateEncases(clock);
    this.updateBrands(dt, clock);
  }

  private updateRimes(dt: number): void {
    const world = this.host.world;
    const h = this.host;
    let any = false;
    for (let si = 0; si < this.rimes.length; si++) {
      const slot = this.rimes[si];
      const base = si * CRYSTALS;
      const e = slot.entityId >= 0 ? world.entities.get(slot.entityId) : undefined;
      const aura = e && !e.dead ? e.auras.find((a) => a.id === slot.auraId) : undefined;
      if (!e || !aura || !slot.def) {
        if (slot.entityId >= 0) this.releaseRime(slot);
        continue;
      }
      any = true;
      const target = rimeIntensity(aura.stacks ?? 1, slot.def.maxStacks);
      // Crystals grow in quickly, recede slowly.
      const rate = target > slot.shown ? 6 : 1.5;
      slot.shown += (target - slot.shown) * Math.min(1, dt * rate);
      const bh = h.bodyHeight(e);
      const gy = h.groundY(e.pos.x, e.pos.z);
      const count = rimeCrystals(slot.shown, CRYSTALS);
      const climb = rimeClimb(slot.shown);
      for (let k = 0; k < CRYSTALS; k++) {
        if (k >= count) {
          this.crystals.setMatrixAt(base + k, this.zero);
          continue;
        }
        const seat = this.seats[k];
        const y = gy + bh * climb * seat.rise;
        const r = bh * seat.out * (0.75 + 0.25 * (1 - seat.rise));
        this.p.set(e.pos.x + Math.sin(seat.angle) * r, y, e.pos.z + Math.cos(seat.angle) * r);
        // Points lean out from the body, up and away.
        this.e.set(Math.cos(seat.angle) * seat.tilt, 0, -Math.sin(seat.angle) * seat.tilt);
        this.q.setFromEuler(this.e);
        const len = bh * 0.2 * seat.length * (0.55 + 0.6 * slot.shown);
        this.s.set(len, len, len);
        this.m.compose(this.p, this.q, this.s);
        this.crystals.setMatrixAt(base + k, this.m);
      }
      slot.glow.position.set(e.pos.x, gy + 0.14, e.pos.z);
      const g = bh * (0.7 + 0.5 * slot.shown);
      slot.glow.scale.set(g, 1, g);
      slot.glowMat.opacity = 0.25 + 0.45 * slot.shown;
      // The chill breathing off it, thicker as it deepens.
      slot.emit += dt * (4 + 14 * slot.shown) * h.density;
      while (slot.emit >= 1) {
        slot.emit -= 1;
        h.puff(e.pos.x, gy + bh * climb * h.rand(), e.pos.z, 1, {
          speed: 0.3,
          up: -0.2,
          life: 1.4,
          size: [0.4, 1.3],
          color: [0.88, 0.95, 1],
          alpha: 0.28,
          radius: bh * 0.3,
          drag: 1.4,
        });
        if (h.rand() < 0.4)
          h.puff(e.pos.x, gy + bh * climb * h.rand(), e.pos.z, 1, {
            speed: 0.2,
            up: 0.5,
            life: 0.9,
            size: [0.1, 0.03],
            color: [0.8, 0.95, 1],
            alpha: 1,
            pool: 'glow',
            radius: bh * 0.3,
          });
      }
    }
    if (any) this.crystals.instanceMatrix.needsUpdate = true;
    else if (this.crystals.visible) this.crystals.visible = false;
  }

  private releaseRime(slot: RimeSlot): void {
    const si = this.rimes.indexOf(slot);
    for (let k = 0; k < CRYSTALS; k++) this.crystals.setMatrixAt(si * CRYSTALS + k, this.zero);
    this.crystals.instanceMatrix.needsUpdate = true;
    slot.entityId = -1;
    slot.def = null;
    slot.glow.visible = false;
  }

  private updateEncases(clock: number): void {
    const world = this.host.world;
    for (const slot of this.encases) {
      if (slot.entityId < 0) continue;
      const e = world.entities.get(slot.entityId);
      const aura = e && !e.dead ? e.auras.find((a) => a.id === slot.auraId) : undefined;
      if (!e || !aura) {
        this.shatterIce(slot);
        continue;
      }
      const look = iceEncase(clock - slot.since, aura.remaining, this.encase);
      slot.x = e.pos.x;
      slot.z = e.pos.z;
      slot.y = this.host.groundY(e.pos.x, e.pos.z);
      slot.mesh.position.set(slot.x, slot.y - 0.15, slot.z);
      const w = slot.h * 0.62 * (0.6 + 0.4 * look.grow);
      slot.mesh.scale.set(w, slot.h * 1.12 * look.grow, w);
      slot.mat.uniforms.uGrow.value = look.grow;
      slot.mat.uniforms.uCrack.value = look.crack;
    }
  }

  private updateBrands(dt: number, clock: number): void {
    const world = this.host.world;
    const h = this.host;
    for (const slot of this.brands) {
      if (slot.entityId < 0) continue;
      const e = world.entities.get(slot.entityId);
      if (!e || e.dead || !e.auras.some((a) => a.id === slot.auraId)) {
        slot.entityId = -1;
        slot.glyph.visible = false;
        continue;
      }
      const bh = h.bodyHeight(e);
      const gy = h.groundY(e.pos.x, e.pos.z);
      const cy = gy + bh * 0.62;
      const k = brandFlicker(clock, e.id);
      slot.glyph.position.set(e.pos.x, cy, e.pos.z);
      const u = slot.glyphMat.uniforms;
      u.uSize.value = bh * 0.34 * (0.96 + 0.04 * k);
      u.uAlpha.value = Math.min(1, 0.8 * k);
      (u.uTint.value as THREE.Color).setRGB(1.4 * k, 1.05 * k, 0.9 * k);
      // Flames licking up off the brand, embers, a wisp of scorched smoke.
      slot.emit += dt * 22 * h.density;
      while (slot.emit >= 1) {
        slot.emit -= 1;
        h.puff(e.pos.x, cy - 0.1, e.pos.z, 1, {
          speed: 0.2,
          up: 1.3,
          life: 0.45,
          size: [0.65, 0.2],
          color: FLAME_HEAT,
          alpha: 1,
          pool: 'pyre',
          radius: bh * 0.12,
        });
        if (h.rand() < 0.45)
          h.puff(e.pos.x, cy, e.pos.z, 1, {
            speed: 0.6,
            up: 1.8,
            life: 0.8,
            size: [0.12, 0.03],
            color: [1, 0.55, 0.2],
            alpha: 1,
            pool: 'glow',
            radius: bh * 0.15,
          });
        if (h.rand() < 0.15)
          h.puff(e.pos.x, cy + 0.4, e.pos.z, 1, {
            speed: 0.3,
            up: 1.2,
            life: 1.4,
            size: [0.3, 1],
            color: [0.3, 0.26, 0.24],
            alpha: 0.3,
          });
      }
    }
  }

  hideAll(): void {
    for (const s of this.rimes) if (s.entityId >= 0) this.releaseRime(s);
    this.crystals.visible = false;
    for (const s of this.encases) {
      s.entityId = -1;
      s.mesh.visible = false;
    }
    for (const s of this.brands) {
      s.entityId = -1;
      s.glyph.visible = false;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.crystals.dispose();
    this.brandTex?.dispose();
  }
}
