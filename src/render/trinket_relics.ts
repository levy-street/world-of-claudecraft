// The Crucible raid trinket relics in the world: the Kindling Orb floating by
// its wearer's shoulder (and the bolts it looses), the Forgefather's spectral
// hammer strike, the Last Flame Lantern and its light circle, and the ember
// wisps the Temper, Molten Fletching and its ignite leave on bodies. The pure
// decisions live in trinket_relics_core.ts; this is the thin Three half.
//
// Models: one texture-free GLB (public/models/vfx/trinket_relics.glb, three
// root nodes) authored headless in Blender by
// scripts/assets/trinket_relics/build_trinket_relics.py. Its two material
// buckets are REPLACED here: Body by the shared surfaceMat (Standard or
// Lambert by tier, deduped with every other vertex-coloured prop), Glow by one
// unlit vertex-coloured basic material. A missing GLB falls back to small
// procedural stand-ins, so the lantern light (the one actionable read) never
// depends on a fetch.
//
// GPU preparation: every mesh this module will ever draw is built at
// construction into fixed pools (orbs, lanterns, hammers, bolts) that sit
// hidden in the scene, tagged renderCategory 'vfx'. That tag is the prewarm
// home: the vfx.ability-primitives boot entry and its resume units link every
// 'vfx' program in the scene (collectAbilityVfxCompileTargets), and the cast
// readiness gate waits on those same materials. So nothing here links a
// program in a live frame, and nothing is added to the scene after boot.
// Cosmetic draws wait on that gate (`ready`); the lantern light draws on every
// tier regardless, because it is information a healer acts on.
//
// Particles ride the renderer's pooled Vfx cloud (burst), so embers add no
// material, mesh or draw call.

import * as THREE from 'three';
import type { IWorld } from '../world_api';
import type { AbilityVfxSpellfxEvent } from './ability_vfx/painter';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { surfaceMat } from './gfx';
import {
  createHammerPose,
  createOrbPose,
  createRelicScan,
  drainEmission,
  HAMMER_STRIKE_SEC,
  kindlingBoltDuration,
  LANTERN_LIGHT_PROFILE,
  LANTERN_LIGHT_RADIUS,
  lanternFlicker,
  lanternLightAlpha,
  RELIC_IGNITE,
  RELIC_LANTERN,
  RELIC_ORB,
  RELIC_PIERCE,
  RELIC_TEMPER,
  relicEmberRate,
  relicPresence,
  scanRelicAuras,
  TRINKET_RELIC_CUE,
  writeHammerHeadOffset,
  writeHammerPose,
  writeKindlingBoltPoint,
  writeOrbPose,
} from './trinket_relics_core';
import type { VfxAnchorResolver } from './vfx_anchor';

const MODEL_URL = '/models/vfx/trinket_relics.glb';

let loadedRelics: THREE.Group | null = null;

if (typeof window !== 'undefined') {
  // Deferred, never eager (tests/defer_launcher_preloads.test.ts): world
  // content, awaited by assetsReady() before the renderer builds its pools.
  registerDeferredPreload(() =>
    loadGltf(MODEL_URL).then((gltf) => {
      loadedRelics = gltf.scene;
    }),
  );
}

export const trinketRelicsPreloadInternalsForTest = { modelUrl: MODEL_URL };

const ORB_SLOTS = 6;
const LANTERN_SLOTS = 4;
const HAMMER_SLOTS = 3;
const BOLT_SLOTS = 6;
const HAMMER_SCALE = 1.7;
const ORB_SCALE = 1;
const LANTERN_SCALE = 1.5;
const RING_SEGMENTS = 64;
const LIGHT_LIFT = 0.09;
const SCAN_INTERVAL_SEC = 0.1;
const ORB_EMBER = 0xff8a2a;
const TEMPER_EMBER = 0xff6a1e;
const PIERCE_SPARK = 0xffb347;
const IGNITE_FLAME = 0xff5a1a;
const LANTERN_WARM = 0xffc861;

/** The slice of the pooled particle cloud the relics use. */
export interface RelicParticles {
  burst(
    at: THREE.Vector3,
    school: string,
    count?: number,
    power?: number,
    color?: number,
    duration?: number,
  ): void;
}

export interface TrinketRelicsHost {
  scene: THREE.Object3D;
  world(): IWorld;
  views: ReadonlyMap<number, { group: THREE.Object3D }>;
  anchor: VfxAnchorResolver;
  ground(x: number, z: number): number;
  vfx: RelicParticles;
  time(): number;
  /** The cast readiness gate: true once every 'vfx' program is linked. */
  ready(): boolean;
}

interface OrbSlot {
  root: THREE.Group;
  ownerId: number;
  seen: boolean;
  remaining: number;
  duration: number;
  kick: number;
  ember: { value: number };
}

interface LanternSlot {
  root: THREE.Group;
  body: THREE.Object3D;
  flame: THREE.Object3D | null;
  light: THREE.Mesh;
  lightMat: THREE.MeshBasicMaterial;
  ownerId: number;
  seen: boolean;
  x: number;
  z: number;
  remaining: number;
  duration: number;
}

interface HammerSlot {
  pivot: THREE.Group;
  ownerId: number;
  age: number;
  struck: boolean;
}

interface BoltSlot {
  mesh: THREE.Mesh;
  targetId: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  age: number;
  life: number;
  trail: { value: number };
}

interface WispState {
  flags: number;
  ember: { value: number };
}

function tagVfx(root: THREE.Object3D): void {
  root.traverse((child) => {
    child.userData.renderCategory = 'vfx';
    child.frustumCulled = false;
  });
}

function colouredIcosahedron(radius: number, detail: number, hex: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, detail);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color(hex);
  for (let i = 0; i < count; i++) c.toArray(colors, i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** A terrain-draped disc whose vertex alpha carries LANTERN_LIGHT_PROFILE. */
function lightDiscGeometry(): THREE.BufferGeometry {
  const rings = LANTERN_LIGHT_PROFILE.length;
  const positions = new Float32Array((1 + (rings - 1) * RING_SEGMENTS) * 3);
  const colors = new Float32Array((1 + (rings - 1) * RING_SEGMENTS) * 4);
  const warm = new THREE.Color(LANTERN_WARM);
  const writeColor = (i: number, alpha: number) => {
    colors[i * 4] = warm.r;
    colors[i * 4 + 1] = warm.g;
    colors[i * 4 + 2] = warm.b;
    colors[i * 4 + 3] = alpha;
  };
  writeColor(0, LANTERN_LIGHT_PROFILE[0][1]);
  let v = 1;
  for (let r = 1; r < rings; r++) {
    const [frac, alpha] = LANTERN_LIGHT_PROFILE[r];
    for (let s = 0; s < RING_SEGMENTS; s++) {
      const a = (s / RING_SEGMENTS) * Math.PI * 2;
      positions[v * 3] = Math.cos(a) * frac * LANTERN_LIGHT_RADIUS;
      positions[v * 3 + 2] = Math.sin(a) * frac * LANTERN_LIGHT_RADIUS;
      writeColor(v, alpha);
      v++;
    }
  }
  const index: number[] = [];
  for (let s = 0; s < RING_SEGMENTS; s++) {
    const n = (s + 1) % RING_SEGMENTS;
    index.push(0, 1 + n, 1 + s);
  }
  for (let r = 1; r < rings - 1; r++) {
    const inner = 1 + (r - 1) * RING_SEGMENTS;
    const outer = inner + RING_SEGMENTS;
    for (let s = 0; s < RING_SEGMENTS; s++) {
      const n = (s + 1) % RING_SEGMENTS;
      index.push(inner + s, inner + n, outer + s, outer + s, inner + n, outer + n);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  geometry.setIndex(index);
  return geometry;
}

export class TrinketRelics {
  private readonly root = new THREE.Group();
  private readonly bodyMat: THREE.Material;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly orbs: OrbSlot[] = [];
  private readonly lanterns: LanternSlot[] = [];
  private readonly hammers: HammerSlot[] = [];
  private readonly bolts: BoltSlot[] = [];
  private readonly wisps = new Map<number, WispState>();
  private readonly scan = createRelicScan();
  private readonly orbPose = createOrbPose();
  private readonly hammerPose = createHammerPose();
  private readonly headOffset = { forward: 0, up: 0 };
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly point = { x: 0, y: 0, z: 0 };
  private quality = 1;
  private scanClock = SCAN_INTERVAL_SEC;

  constructor(private readonly host: TrinketRelicsHost) {
    this.root.name = 'trinket-relics';
    this.bodyMat = surfaceMat({ vertexColors: true, flatShading: true, roughness: 0.8 });
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff });
    this.glowMat.color.multiplyScalar(1.35);
    const orbTemplate = this.template('KindlingOrb');
    const lanternTemplate = this.template('LastFlameLantern');
    const hammerTemplate = this.template('TemperHammer');
    const discGeometry = lightDiscGeometry();
    const boltGeometry = colouredIcosahedron(0.13, 1, 0xffa040);
    for (let i = 0; i < ORB_SLOTS; i++) {
      const root = new THREE.Group();
      root.add(orbTemplate ? orbTemplate.clone(true) : this.fallbackOrb());
      this.orbs.push(
        this.pooled(root, {
          ownerId: -1,
          seen: false,
          remaining: 0,
          duration: 0,
          kick: 0,
          ember: { value: 0 },
        }),
      );
    }
    for (let i = 0; i < LANTERN_SLOTS; i++) {
      const root = new THREE.Group();
      const body = lanternTemplate ? lanternTemplate.clone(true) : this.fallbackLantern();
      body.scale.setScalar(LANTERN_SCALE);
      root.add(body);
      const lightMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const light = new THREE.Mesh(discGeometry.clone(), lightMat);
      light.name = 'lantern-light';
      // A worn trinket's ground glow rides the bottom of the player band
      // (docs/design/vfx-floor-layering.md): above the world's own marks, under
      // every encounter telegraph.
      light.renderOrder = floorVfxRenderOrder('player', 0);
      this.root.add(light);
      tagVfx(light);
      light.visible = false;
      let flame: THREE.Object3D | null = null;
      body.traverse((child) => {
        if ((child as THREE.Mesh).material === this.glowMat) flame = child;
      });
      this.lanterns.push({
        ...this.pooled(root, {}),
        body,
        flame,
        light,
        lightMat,
        ownerId: -1,
        seen: false,
        x: 0,
        z: 0,
        remaining: 0,
        duration: 0,
      });
    }
    for (let i = 0; i < HAMMER_SLOTS; i++) {
      const pivot = new THREE.Group();
      if (hammerTemplate) {
        const model = hammerTemplate.clone(true);
        // The model's hot face points at -X; turn it onto the swing's +Z.
        model.rotation.y = Math.PI / 2;
        model.scale.setScalar(HAMMER_SCALE);
        pivot.add(model);
      }
      this.hammers.push({ ...this.pooledPivot(pivot), ownerId: -1, age: 0, struck: false });
    }
    for (let i = 0; i < BOLT_SLOTS; i++) {
      const mesh = new THREE.Mesh(boltGeometry, this.glowMat);
      mesh.name = 'kindling-bolt';
      this.root.add(mesh);
      tagVfx(mesh);
      mesh.visible = false;
      this.bolts.push({
        mesh,
        targetId: -1,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        age: 0,
        life: 0,
        trail: { value: 0 },
      });
    }
    host.scene.add(this.root);
  }

  /** A cloned root node of the relic GLB with its buckets swapped for this
   *  module's materials, or null when the GLB did not load. */
  private template(name: string): THREE.Object3D | null {
    const node = loadedRelics?.getObjectByName(name);
    if (!node) return null;
    // The loader cache is immutable: clone the graph, then repoint materials
    // on the clone only (geometry stays shared with the cache).
    // The node's own translation and scale dequantize the meshopt-quantized
    // positions (KHR_mesh_quantization), so the clone keeps them and sits
    // inside a wrapper the painter is free to move and scale.
    const copy = node.clone(true);
    copy.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      mesh.material = source?.name === 'Glow' ? this.glowMat : this.bodyMat;
    });
    const wrapper = new THREE.Group();
    wrapper.name = name;
    wrapper.add(copy);
    return wrapper;
  }

  private fallbackOrb(): THREE.Object3D {
    return new THREE.Mesh(colouredIcosahedron(0.2, 1, 0xff7a1e), this.glowMat);
  }

  private fallbackLantern(): THREE.Object3D {
    const flame = new THREE.Mesh(colouredIcosahedron(0.07, 0, 0xffd36a), this.glowMat);
    flame.position.y = 0.24;
    const group = new THREE.Group();
    group.add(flame);
    return group;
  }

  private pooled<T extends object>(root: THREE.Group, rest: T): T & { root: THREE.Group } {
    this.root.add(root);
    tagVfx(root);
    root.visible = false;
    return { ...rest, root };
  }

  private pooledPivot(pivot: THREE.Group): { pivot: THREE.Group } {
    this.root.add(pivot);
    tagVfx(pivot);
    pivot.visible = false;
    return { pivot };
  }

  setQuality(q: number): void {
    this.quality = Math.min(1, Math.max(0, Number.isFinite(q) ? q : 1));
  }

  /** Claims the relic cues this module draws itself. Returns true only when
   *  the event is fully drawn here (the Kindling bolt leaving a live orb); the
   *  hammer strike returns false so the authored ceremony still plays. */
  handleSpellfx(ev: AbilityVfxSpellfxEvent, admitted: boolean): boolean {
    if (!admitted) return false;
    if (ev.ability === TRINKET_RELIC_CUE.kindlingBolt)
      return this.launchBolt(ev.sourceId, ev.targetId);
    if (ev.ability === TRINKET_RELIC_CUE.temper && ev.fx === 'selfCast')
      this.startHammer(ev.sourceId);
    return false;
  }

  private launchBolt(sourceId: number, targetId: number): boolean {
    const orb = this.orbs.find((slot) => slot.ownerId === sourceId && slot.root.visible);
    if (!orb) return false;
    const target = this.host.anchor(targetId, 0.6, this.tmp);
    if (!target) return false;
    let slot = this.bolts.find((b) => !b.mesh.visible);
    if (!slot) slot = this.bolts.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b));
    slot.from.copy(orb.root.position);
    slot.to.copy(target);
    slot.targetId = targetId;
    slot.age = 0;
    slot.life = kindlingBoltDuration(slot.from.distanceTo(slot.to));
    slot.trail.value = 0;
    slot.mesh.position.copy(slot.from);
    slot.mesh.visible = true;
    orb.kick = 1;
    return true;
  }

  private startHammer(ownerId: number): void {
    let slot = this.hammers.find((h) => h.ownerId === -1);
    if (!slot) slot = this.hammers.reduce((a, b) => (a.age > b.age ? a : b));
    slot.ownerId = ownerId;
    slot.age = 0;
    slot.struck = false;
  }

  update(dt: number, reducedMotion = false): void {
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.25)) : 0;
    const ready = this.host.ready();
    this.scanClock += step;
    if (this.scanClock >= SCAN_INTERVAL_SEC) {
      this.scanClock = 0;
      this.scanWorld();
    } else {
      // between scans the tracked timers simply run down
      for (const orb of this.orbs) if (orb.ownerId !== -1) orb.remaining -= step;
      for (const lantern of this.lanterns) if (lantern.ownerId !== -1) lantern.remaining -= step;
    }
    const t = this.host.time();
    this.updateOrbs(step, t, ready, reducedMotion);
    this.updateLanterns(t, ready, reducedMotion);
    this.updateHammers(step, ready, reducedMotion);
    this.updateBolts(step);
    this.updateWisps(step, ready);
  }

  /** One pass over the viewed entities: which relic states each one shows.
   *  Throttled (SCAN_INTERVAL_SEC); the tracked slots animate every frame. */
  private scanWorld(): void {
    const world = this.host.world();
    for (const orb of this.orbs) orb.seen = false;
    for (const lantern of this.lanterns) lantern.seen = false;
    for (const [id] of this.host.views) {
      const entity = world.entities.get(id);
      if (!entity || entity.dead || entity.auras.length === 0) {
        this.wisps.delete(id);
        continue;
      }
      const scan = scanRelicAuras(entity.auras, this.scan);
      const wispFlags = scan.flags & (RELIC_TEMPER | RELIC_PIERCE | RELIC_IGNITE);
      if (wispFlags) {
        const wisp = this.wisps.get(id);
        if (wisp) wisp.flags = wispFlags;
        else this.wisps.set(id, { flags: wispFlags, ember: { value: 0 } });
      } else {
        this.wisps.delete(id);
      }
      if (scan.flags & RELIC_ORB) {
        const slot =
          this.orbs.find((o) => o.ownerId === id) ?? this.orbs.find((o) => o.ownerId === -1);
        if (slot) {
          slot.ownerId = id;
          slot.seen = true;
          slot.remaining = scan.orbRemaining;
          slot.duration = scan.orbDuration;
        }
      }
      if (scan.flags & RELIC_LANTERN) {
        const slot =
          this.lanterns.find((l) => l.ownerId === id) ??
          this.lanterns.find((l) => l.ownerId === -1);
        if (slot) {
          const moved = slot.ownerId !== id || slot.x !== scan.lanternX || slot.z !== scan.lanternZ;
          slot.ownerId = id;
          slot.seen = true;
          slot.remaining = scan.lanternRemaining;
          slot.duration = scan.lanternDuration;
          if (moved) this.placeLantern(slot, scan.lanternX, scan.lanternZ);
        }
      }
    }
    for (const [id] of this.wisps) if (!this.host.views.has(id)) this.wisps.delete(id);
    for (const orb of this.orbs) {
      if (orb.ownerId !== -1 && !orb.seen) {
        orb.ownerId = -1;
        orb.root.visible = false;
      }
    }
    for (const lantern of this.lanterns) {
      if (lantern.ownerId !== -1 && !lantern.seen) {
        lantern.ownerId = -1;
        lantern.root.visible = false;
        lantern.light.visible = false;
      }
    }
  }

  /** Seats a lantern and drapes its light over the ground once: a lantern
   *  never moves, so the drape is paid at placement, never per frame. */
  private placeLantern(slot: LanternSlot, x: number, z: number): void {
    slot.x = x;
    slot.z = z;
    const gy = this.host.ground(x, z);
    slot.root.position.set(x, gy, z);
    slot.light.position.set(x, 0, z);
    const pos = slot.light.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.host.ground(x + pos.getX(i), z + pos.getZ(i)) + LIGHT_LIFT);
    }
    pos.needsUpdate = true;
    slot.light.geometry.computeBoundingSphere();
  }

  private updateOrbs(dt: number, t: number, ready: boolean, reducedMotion: boolean): void {
    for (const orb of this.orbs) {
      if (orb.ownerId === -1) continue;
      const view = this.host.views.get(orb.ownerId);
      const shoulder = view ? this.host.anchor(orb.ownerId, 0.82, this.tmp) : null;
      const presence = relicPresence(orb.remaining, orb.duration);
      if (!view || !shoulder || presence <= 0 || !ready) {
        orb.root.visible = false;
        continue;
      }
      const pose = writeOrbPose(
        this.orbPose,
        shoulder.x,
        shoulder.y,
        shoulder.z,
        view.group.rotation.y,
        t,
        orb.ownerId,
        reducedMotion,
      );
      orb.kick = Math.max(0, orb.kick - dt * 5);
      orb.root.position.set(pose.x, pose.y, pose.z);
      orb.root.rotation.set(pose.tumble, pose.spin, 0);
      orb.root.scale.setScalar(presence * ORB_SCALE * (1 + orb.kick * 0.3));
      orb.root.visible = true;
      const n = drainEmission(orb.ember, relicEmberRate('orb', this.quality), dt);
      for (let i = 0; i < n; i++)
        this.host.vfx.burst(orb.root.position, 'fire', 1, 0.14, ORB_EMBER, 0.55);
    }
  }

  private updateLanterns(t: number, ready: boolean, reducedMotion: boolean): void {
    for (const lantern of this.lanterns) {
      if (lantern.ownerId === -1) continue;
      // The light is the actionable read: drawn on every tier and never held
      // behind the cosmetic gate.
      const alpha = lanternLightAlpha(lantern.remaining, lantern.duration);
      lantern.lightMat.opacity = alpha;
      lantern.light.visible = alpha > 0;
      const presence = relicPresence(lantern.remaining, lantern.duration);
      lantern.root.visible = ready && presence > 0;
      if (!lantern.root.visible) continue;
      lantern.body.scale.setScalar(LANTERN_SCALE * presence);
      if (lantern.flame) {
        const k = lanternFlicker(t, lantern.ownerId, reducedMotion);
        lantern.flame.scale.set(1, k, 1);
      }
    }
  }

  private updateHammers(dt: number, ready: boolean, reducedMotion: boolean): void {
    for (const hammer of this.hammers) {
      if (hammer.ownerId === -1) continue;
      hammer.age += dt;
      const view = this.host.views.get(hammer.ownerId);
      const grip = view ? this.host.anchor(hammer.ownerId, 0.9, this.tmp) : null;
      const alive = writeHammerPose(this.hammerPose, hammer.age, reducedMotion);
      if (!alive || !view || !grip) {
        hammer.ownerId = -1;
        hammer.pivot.visible = false;
        continue;
      }
      const yaw = view.group.rotation.y;
      // the grip hangs a little in front of the chest
      grip.x += Math.sin(yaw) * 0.45;
      grip.z += Math.cos(yaw) * 0.45;
      hammer.pivot.position.copy(grip);
      hammer.pivot.rotation.set(this.hammerPose.swing, yaw, 0, 'YXZ');
      hammer.pivot.scale.setScalar(this.hammerPose.scale);
      hammer.pivot.visible = ready && hammer.pivot.children.length > 0 && !reducedMotion;
      if (!hammer.struck && hammer.age >= HAMMER_STRIKE_SEC) {
        hammer.struck = true;
        writeHammerHeadOffset(this.headOffset, this.hammerPose.swing, HAMMER_SCALE);
        this.tmp2.set(
          grip.x + Math.sin(yaw) * this.headOffset.forward,
          grip.y + this.headOffset.up,
          grip.z + Math.cos(yaw) * this.headOffset.forward,
        );
        const count = Math.round(8 + 10 * this.quality);
        this.host.vfx.burst(this.tmp2, 'fire', count, 0.7, TEMPER_EMBER);
      }
    }
  }

  private updateBolts(dt: number): void {
    for (const bolt of this.bolts) {
      if (!bolt.mesh.visible) continue;
      bolt.age += dt;
      // home on the target while it lives, so a mover never dodges the read
      const live = this.host.anchor(bolt.targetId, 0.6, this.tmp);
      if (live) bolt.to.copy(live);
      const k = bolt.life > 0 ? bolt.age / bolt.life : 1;
      if (k >= 1) {
        bolt.mesh.visible = false;
        this.host.vfx.burst(bolt.to, 'fire', Math.round(6 + 6 * this.quality), 0.5, ORB_EMBER);
        continue;
      }
      writeKindlingBoltPoint(this.point, bolt.from, bolt.to, k);
      bolt.mesh.position.set(this.point.x, this.point.y, this.point.z);
      bolt.mesh.rotation.y += dt * 9;
      const n = drainEmission(bolt.trail, 40 * (0.4 + 0.6 * this.quality), dt);
      for (let i = 0; i < n; i++)
        this.host.vfx.burst(bolt.mesh.position, 'fire', 1, 0.08, ORB_EMBER, 0.3);
    }
  }

  private updateWisps(dt: number, ready: boolean): void {
    if (!ready) return;
    for (const [id, wisp] of this.wisps) {
      const view = this.host.views.get(id);
      if (!view) continue;
      let rate = 0;
      let color = TEMPER_EMBER;
      if (wisp.flags & RELIC_PIERCE) {
        rate += relicEmberRate('pierce', this.quality);
        color = PIERCE_SPARK;
      }
      if (wisp.flags & RELIC_TEMPER) rate += relicEmberRate('temper', this.quality);
      if (wisp.flags & RELIC_IGNITE) rate += relicEmberRate('ignite', this.quality);
      const n = drainEmission(wisp.ember, rate, dt);
      if (n === 0) continue;
      const handsOrBody = wisp.flags & (RELIC_TEMPER | RELIC_PIERCE);
      const at = this.host.anchor(id, handsOrBody ? 0.5 : 0.62, this.tmp);
      if (!at) continue;
      if (handsOrBody) {
        // weapon side (the wearer's right, local -X)
        const yaw = view.group.rotation.y;
        at.x -= Math.cos(yaw) * 0.38;
        at.z += Math.sin(yaw) * 0.38;
      }
      const tint = handsOrBody ? color : IGNITE_FLAME;
      for (let i = 0; i < n; i++) this.host.vfx.burst(at, 'fire', 1, 0.2, tint, 0.5);
    }
  }

  clear(): void {
    for (const orb of this.orbs) {
      orb.ownerId = -1;
      orb.root.visible = false;
    }
    for (const lantern of this.lanterns) {
      lantern.ownerId = -1;
      lantern.root.visible = false;
      lantern.light.visible = false;
    }
    for (const hammer of this.hammers) {
      hammer.ownerId = -1;
      hammer.pivot.visible = false;
    }
    for (const bolt of this.bolts) bolt.mesh.visible = false;
    this.wisps.clear();
  }

  /** Dev/test probe: how many of each relic is on screen. */
  activeCounts(): {
    orbs: number;
    lanterns: number;
    lights: number;
    hammers: number;
    bolts: number;
  } {
    return {
      orbs: this.orbs.filter((o) => o.root.visible).length,
      lanterns: this.lanterns.filter((l) => l.root.visible).length,
      lights: this.lanterns.filter((l) => l.light.visible).length,
      hammers: this.hammers.filter((h) => h.pivot.visible).length,
      bolts: this.bolts.filter((b) => b.mesh.visible).length,
    };
  }
}
