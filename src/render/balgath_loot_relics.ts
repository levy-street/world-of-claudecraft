// Balgath's five trinkets in the world (the sim is src/sim/combat/balgath_trinkets.ts,
// the pure decisions balgath_loot_relics_core.ts): the planted Muster Standard, the
// Guttered Eye floating ahead of its wearer while the beam burns, the grapnel's rope
// and hook hauling an ally through the air, the stone and dust of the Shape of the
// Foreman taking hold and letting go, and the Barrowstone statue.
//
// It rides the ability painter's relic hook beside the Crucible trinket relics
// (trinket_relics.ts), so the renderer coordinator carries no new call site: the painter
// offers every `trinket_*` spellfx cue here first and ticks this with itself.
//
// GPU preparation follows the relic module exactly: every mesh this module will ever
// draw is built at construction into fixed pools that sit hidden in the scene, tagged
// renderCategory 'vfx' (the vfx.ability-primitives prewarm home links them before the
// first frame), and nothing is added to the scene after boot. The beam reuses the
// Foreman's own glare materials (balgath_ranged_fx.ts, prewarmed by 'balgath-ranged'),
// recoloured on clones that keep their program. The statue's stone is a program-
// preserving clone on the rig itself (CharacterVisual.setPetrified). Particles ride the
// renderer's pooled cloud. Cosmetic pieces wait on the cast gate (`ready`).

import * as THREE from 'three';
import type { IWorld } from '../world_api';
import type { AbilityVfxSpellfxEvent } from './ability_vfx/painter';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import {
  advanceRopeAge,
  bannerSway,
  createLootScan,
  GRAPNEL_ROPE_SEC,
  glareFlicker,
  grapnelReach,
  LOOT_CUE,
  LOOT_FOREMAN,
  LOOT_GLARE,
  LOOT_STANDARD,
  LOOT_STATUE,
  metamorphSlotAsset,
  ropeSag,
  STANDARD_SINK_SEC,
  scanLootAuras,
  standardPlantOffset,
  standardSinkProgress,
} from './balgath_loot_relics_core';
import { balgathRangedMaterials } from './balgath_ranged_fx';
import { surfaceMat } from './gfx';
import type { RelicParticles } from './trinket_relics';
import type { VfxAnchorResolver } from './vfx_anchor';

const STANDARD_URL = '/models/vfx/muster_standard.glb';
const EYE_URL = '/models/vfx/guttered_eye.glb';
const GRAPNEL_URL = '/models/vfx/muster_grapnel.glb';

const loaded: {
  standard: THREE.Group | null;
  eye: THREE.Group | null;
  grapnel: THREE.Group | null;
} = { standard: null, eye: null, grapnel: null };

if (typeof window !== 'undefined') {
  // Deferred, never eager (tests/defer_launcher_preloads.test.ts): world content.
  registerDeferredPreload(() =>
    Promise.all([
      loadGltf(STANDARD_URL).then((g) => (loaded.standard = g.scene)),
      loadGltf(EYE_URL).then((g) => (loaded.eye = g.scene)),
      loadGltf(GRAPNEL_URL).then((g) => (loaded.grapnel = g.scene)),
    ]).then(() => undefined),
  );
}

export const balgathLootPreloadInternalsForTest = {
  urls: [STANDARD_URL, EYE_URL, GRAPNEL_URL],
};

const STANDARD_SLOTS = 6;
const GLARE_SLOTS = 4;
const ROPE_SLOTS = 4;
const ROPE_SEGMENTS = 10;
const GLARE_LENGTH = 30;
const EYE_FORWARD = 0.75;
const EYE_SCALE = 1.2;
const SCAN_INTERVAL_SEC = 0.08;
const TEAL = 0x5fe8d2;
const TEAL_CORE = 0xe6fffa;
const GLARE_FILL = 0x3fd6ae;
const STONE_DUST = 0x9b968a;
const MUD_DUST = 0x6d5a40;
const ROPE_HEMP = 0x8a6a3e;

/** The view fields this module reads and, for the shared form slot, writes. */
export interface LootView {
  group: THREE.Object3D;
  height: number;
  visual: LootRig | null;
  metamorphVisual: (LootRig & { assetKey: string; root: THREE.Object3D; dispose(): void }) | null;
}

interface LootRig {
  setPetrified(on: boolean): void;
}

export interface BalgathLootHost {
  scene: THREE.Object3D;
  world(): IWorld;
  views: ReadonlyMap<number, LootView>;
  anchor: VfxAnchorResolver;
  ground(x: number, z: number): number;
  vfx: RelicParticles;
  time(): number;
  /** The cast readiness gate (the relic module's). */
  ready(): boolean;
}

interface StandardSlot {
  root: THREE.Group;
  cloth: THREE.Object3D | null;
  ownerId: number;
  seen: boolean;
  x: number;
  z: number;
  age: number;
  planted: boolean;
  /** Seconds since the standard lost its aura (it sinks), or -1 while it stands. */
  falling: number;
}

interface GlareSlot {
  root: THREE.Group;
  eye: THREE.Object3D;
  outer: THREE.Mesh;
  core: THREE.Mesh;
  outerMat: THREE.MeshBasicMaterial;
  coreMat: THREE.MeshBasicMaterial;
  ownerId: number;
  seen: boolean;
  ember: number;
}

interface RopeSlot {
  root: THREE.Group;
  segments: THREE.Mesh[];
  hook: THREE.Object3D;
  sourceId: number;
  targetId: number;
  age: number;
  /** Seconds the reel has been held back while the ally was still in the air. */
  held: number;
}

interface Tracked {
  flags: number;
}

function tagVfx(root: THREE.Object3D): void {
  root.traverse((child) => {
    child.userData.renderCategory = 'vfx';
    child.frustumCulled = false;
  });
}

const UP = new THREE.Vector3(0, 1, 0);

/** Stretch a unit cylinder (height 1 along +Y, centred) between two points. */
function placeBetween(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, width: number) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.scale.set(width, Math.max(1e-3, len), width);
  if (len > 1e-6) mesh.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / len));
}

export class BalgathLootRelics {
  private readonly root = new THREE.Group();
  private readonly bodyMat: THREE.Material;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly ropeMat: THREE.Material;
  private readonly standards: StandardSlot[] = [];
  private readonly glares: GlareSlot[] = [];
  private readonly ropes: RopeSlot[] = [];
  private readonly tracked = new Map<number, Tracked>();
  private readonly scan = createLootScan();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmp3 = new THREE.Vector3();
  private readonly segA = new THREE.Vector3();
  private readonly segB = new THREE.Vector3();
  private quality = 1;
  private scanClock = SCAN_INTERVAL_SEC;

  constructor(private readonly host: BalgathLootHost) {
    this.root.name = 'balgath-loot-relics';
    this.bodyMat = surfaceMat({ vertexColors: true, flatShading: true, roughness: 0.82 });
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff });
    this.glowMat.color.multiplyScalar(1.4);
    this.ropeMat = surfaceMat({ color: ROPE_HEMP, roughness: 0.95 });
    const standard = this.template(loaded.standard, 'Muster_Standard');
    const eye = this.template(loaded.eye, 'Guttered_Eye');
    const grapnel = this.template(loaded.grapnel, 'Muster_Grapnel');
    for (let i = 0; i < STANDARD_SLOTS; i++) {
      const root = new THREE.Group();
      const body = standard ? standard.clone(true) : this.fallbackStandard();
      root.add(body);
      this.add(root);
      this.standards.push({
        root,
        cloth: body.getObjectByName('Standard_Banner') ?? null,
        ownerId: -1,
        seen: false,
        x: 0,
        z: 0,
        age: 0,
        planted: false,
        falling: -1,
      });
    }
    const m = balgathRangedMaterials();
    const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1, true);
    for (let i = 0; i < GLARE_SLOTS; i++) {
      const root = new THREE.Group();
      const outerMat = m.airGlow.clone();
      outerMat.color.setHex(GLARE_FILL);
      const coreMat = m.airGlow.clone();
      coreMat.color.setHex(TEAL_CORE);
      const outer = new THREE.Mesh(cylinder, outerMat);
      const core = new THREE.Mesh(cylinder, coreMat);
      outer.renderOrder = 6;
      core.renderOrder = 7;
      const eyeBody = eye ? eye.clone(true) : this.fallbackEye();
      eyeBody.scale.setScalar(EYE_SCALE);
      root.add(outer, core, eyeBody);
      this.add(root);
      this.glares.push({
        root,
        eye: eyeBody,
        outer,
        core,
        outerMat,
        coreMat,
        ownerId: -1,
        seen: false,
        ember: 0,
      });
    }
    const segment = new THREE.CylinderGeometry(0.035, 0.035, 1, 5, 1, true);
    for (let i = 0; i < ROPE_SLOTS; i++) {
      const root = new THREE.Group();
      const segments: THREE.Mesh[] = [];
      for (let s = 0; s < ROPE_SEGMENTS; s++) {
        const mesh = new THREE.Mesh(segment, this.ropeMat);
        segments.push(mesh);
        root.add(mesh);
      }
      const hook = grapnel ? grapnel.clone(true) : this.fallbackHook();
      root.add(hook);
      this.add(root);
      this.ropes.push({ root, segments, hook, sourceId: -1, targetId: -1, age: 0, held: 0 });
    }
    host.scene.add(this.root);
  }

  private add(root: THREE.Group): void {
    this.root.add(root);
    tagVfx(root);
    root.visible = false;
  }

  /** A cloned root node of a loaded GLB with its materials swapped for this module's
   *  (vertex-coloured body; a `*Glow*` material to the unlit glow), or null when the
   *  GLB did not load (a procedural stand-in is used instead). */
  private template(scene: THREE.Group | null, name: string): THREE.Object3D | null {
    const node = scene?.getObjectByName(name) ?? scene;
    if (!node) return null;
    const copy = node.clone(true);
    copy.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      mesh.material = /glow/i.test(source?.name ?? '') ? this.glowMat : this.bodyMat;
    });
    const wrapper = new THREE.Group();
    wrapper.name = name;
    wrapper.add(copy);
    return wrapper;
  }

  private fallbackStandard(): THREE.Object3D {
    const group = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 3.3, 6), this.bodyMat);
    pole.position.y = 1.65;
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 1.2),
      surfaceMat({ color: 0x9c2f26, side: THREE.DoubleSide }),
    );
    cloth.name = 'Standard_Banner';
    cloth.position.set(0.45, 2.6, 0);
    group.add(pole, cloth);
    return group;
  }

  private fallbackEye(): THREE.Object3D {
    return new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), this.glowMat);
  }

  private fallbackHook(): THREE.Object3D {
    return new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 4), this.bodyMat);
  }

  setQuality(q: number): void {
    this.quality = Math.min(1, Math.max(0, Number.isFinite(q) ? q : 1));
  }

  /** The grapnel's throw is drawn here in full; every other cue keeps its authored
   *  self-cast ceremony (returns false) and only adds this module's layer. */
  handleSpellfx(ev: AbilityVfxSpellfxEvent, admitted: boolean): boolean {
    if (ev.ability === LOOT_CUE.grapnel) {
      if (admitted) this.throwRope(ev.sourceId, ev.targetId);
      return true;
    }
    if (!admitted) return false;
    if (ev.ability === LOOT_CUE.statue) this.statueBurst(ev.targetId, true);
    else if (ev.ability === LOOT_CUE.statueRelease) this.statueBurst(ev.targetId, false);
    return false;
  }

  update(dt: number, reducedMotion = false): void {
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.25)) : 0;
    const ready = this.host.ready();
    this.scanClock += step;
    if (this.scanClock >= SCAN_INTERVAL_SEC) {
      this.scanClock = 0;
      this.scanWorld();
    }
    const t = this.host.time();
    this.updateStandards(step, t, ready, reducedMotion);
    this.updateGlares(step, t, ready, reducedMotion);
    this.updateRopes(step, ready);
  }

  /** One pass over the viewed entities: form swaps, statues, standards and glares. */
  private scanWorld(): void {
    const world = this.host.world();
    for (const slot of this.standards) slot.seen = false;
    for (const slot of this.glares) slot.seen = false;
    for (const [id, view] of this.host.views) {
      const entity = world.entities.get(id);
      const prev = this.tracked.get(id)?.flags ?? 0;
      if (!entity) {
        this.tracked.delete(id);
        continue;
      }
      this.keepFormSlotHonest(view, entity.auras);
      const flags = entity.dead ? 0 : scanLootAuras(entity.auras, this.scan).flags;
      if (flags !== prev) this.onFlagsChanged(id, view, prev, flags);
      if (flags === 0) this.tracked.delete(id);
      else this.tracked.set(id, { flags });
      if (flags & LOOT_STANDARD) this.claimStandard(id, this.scan.standardX, this.scan.standardZ);
      if (flags & LOOT_GLARE) this.claimGlare(id);
    }
    for (const [id] of this.tracked) if (!this.host.views.has(id)) this.tracked.delete(id);
    for (const slot of this.standards) {
      if (slot.ownerId !== -1 && !slot.seen && slot.falling < 0) slot.falling = 0;
    }
    for (const slot of this.glares) {
      if (slot.ownerId !== -1 && !slot.seen) {
        slot.ownerId = -1;
        slot.root.visible = false;
      }
    }
  }

  /**
   * The Metamorphosis slot is shared by the warlock's demon and the Shape of the Foreman
   * (characters/form_visual_selection_core.ts characterFormAssetKey). A rig built for the
   * other one is dropped here so the renderer rebuilds the right body on its next pass.
   */
  private keepFormSlotHonest(view: LootView, auras: IWorld['player']['auras']): void {
    const rig = view.metamorphVisual;
    if (!rig) return;
    const want = metamorphSlotAsset(auras);
    if (want === null || rig.assetKey === want) return;
    view.group.remove(rig.root);
    rig.dispose();
    view.metamorphVisual = null;
  }

  private onFlagsChanged(id: number, view: LootView, prev: number, flags: number): void {
    const gained = flags & ~prev;
    const lost = prev & ~flags;
    if (gained & LOOT_FOREMAN) this.shapeBurst(id, true);
    if (lost & LOOT_FOREMAN) this.shapeBurst(id, false);
    const stone = (flags & LOOT_STATUE) !== 0;
    if ((gained | lost) & LOOT_STATUE) {
      view.visual?.setPetrified(stone);
      view.metamorphVisual?.setPetrified(stone);
    }
  }

  /** The Shape of the Foreman taking hold (stone bursting off the ground, the eye
   *  kindling teal) or letting go (the granite crumbling away, the eye guttering out). */
  private shapeBurst(id: number, taking: boolean): void {
    const feet = this.host.anchor(id, 0.05, this.tmp);
    const eye = this.host.anchor(id, taking ? 0.88 : 0.7, this.tmp2);
    if (!feet) return;
    const q = 0.4 + 0.6 * this.quality;
    this.host.vfx.burst(feet, 'physical', Math.round(26 * q), taking ? 1.3 : 0.9, MUD_DUST, 1.1);
    this.host.vfx.burst(feet, 'physical', Math.round(16 * q), taking ? 1.0 : 1.4, STONE_DUST, 0.9);
    if (eye) {
      this.host.vfx.burst(eye, 'frost', Math.round((taking ? 18 : 10) * q), 0.7, TEAL, 0.8);
      if (taking) {
        const core = eye.clone();
        core.y += 0.1;
        this.host.vfx.burst(core, 'frost', Math.round(8 * q), 0.25, TEAL_CORE, 0.5);
      }
    }
    // A few chips thrown up the body as the granite forms (or falls away).
    const mid = this.host.anchor(id, 0.45, this.tmp3);
    if (mid) this.host.vfx.burst(mid, 'physical', Math.round(12 * q), 1.1, STONE_DUST, 0.7);
  }

  /** The statue forming (cracks of grey dust) or breaking (a burst of stone chips). */
  private statueBurst(id: number, forming: boolean): void {
    const body = this.host.anchor(id, 0.5, this.tmp);
    if (!body) return;
    const q = 0.4 + 0.6 * this.quality;
    this.host.vfx.burst(
      body,
      'physical',
      Math.round((forming ? 18 : 30) * q),
      forming ? 0.6 : 1.5,
      STONE_DUST,
      forming ? 0.8 : 1.1,
    );
    const feet = this.host.anchor(id, 0.05, this.tmp2);
    if (feet && !forming)
      this.host.vfx.burst(feet, 'physical', Math.round(16 * q), 1.2, MUD_DUST, 1);
  }

  // ---- the Muster Standard ------------------------------------------------------------

  private claimStandard(ownerId: number, x: number, z: number): void {
    let slot = this.standards.find((s) => s.ownerId === ownerId && s.falling < 0);
    if (slot && (slot.x !== x || slot.z !== z)) {
      // Replanted (a new use before the old one fell): the old one sinks.
      slot.falling = 0;
      slot = undefined;
    }
    if (!slot) {
      slot =
        this.standards.find((s) => s.ownerId === -1) ??
        this.standards.reduce((a, b) => (a.falling > b.falling ? a : b));
      slot.ownerId = ownerId;
      slot.x = x;
      slot.z = z;
      slot.age = 0;
      slot.planted = false;
      slot.falling = -1;
    }
    slot.seen = true;
  }

  private updateStandards(dt: number, t: number, ready: boolean, reducedMotion: boolean): void {
    for (const slot of this.standards) {
      if (slot.ownerId === -1) continue;
      slot.age += dt;
      const gy = this.host.ground(slot.x, slot.z);
      let y = gy + (reducedMotion ? 0 : standardPlantOffset(slot.age));
      if (slot.falling >= 0) {
        slot.falling += dt;
        const k = standardSinkProgress(slot.falling);
        y = gy - k * 3.4;
        if (slot.falling >= STANDARD_SINK_SEC) {
          this.dust(slot.x, gy, slot.z, 0.6);
          slot.ownerId = -1;
          slot.root.visible = false;
          continue;
        }
      }
      if (!slot.planted && (reducedMotion || standardPlantOffset(slot.age) === 0)) {
        slot.planted = true;
        this.dust(slot.x, gy, slot.z, 1);
      }
      slot.root.position.set(slot.x, y, slot.z);
      if (slot.cloth) slot.cloth.rotation.x = bannerSway(t, slot.ownerId, reducedMotion);
      slot.root.visible = ready;
    }
  }

  private dust(x: number, y: number, z: number, power: number): void {
    this.tmp.set(x, y + 0.1, z);
    const q = 0.4 + 0.6 * this.quality;
    this.host.vfx.burst(this.tmp, 'physical', Math.round(20 * q * power), 0.9 * power, MUD_DUST, 1);
  }

  // ---- the Guttered Eye's glare -----------------------------------------------------------

  private claimGlare(ownerId: number): void {
    const slot =
      this.glares.find((g) => g.ownerId === ownerId) ?? this.glares.find((g) => g.ownerId === -1);
    if (!slot) return;
    slot.ownerId = ownerId;
    slot.seen = true;
  }

  private updateGlares(dt: number, t: number, ready: boolean, reducedMotion: boolean): void {
    for (const slot of this.glares) {
      if (slot.ownerId === -1) continue;
      const view = this.host.views.get(slot.ownerId);
      const head = view ? this.host.anchor(slot.ownerId, 0.78, this.tmp) : null;
      if (!view || !head || !ready) {
        slot.root.visible = false;
        continue;
      }
      const yaw = view.group.rotation.y;
      const dx = Math.sin(yaw);
      const dz = Math.cos(yaw);
      // The eye hangs a stride ahead of the wearer's face, staring down the beam.
      const origin = this.tmp2.set(
        head.x + dx * EYE_FORWARD,
        head.y + 0.15,
        head.z + dz * EYE_FORWARD,
      );
      const end = this.tmp3.set(
        origin.x + dx * GLARE_LENGTH,
        origin.y - 0.6,
        origin.z + dz * GLARE_LENGTH,
      );
      slot.eye.position.copy(origin);
      slot.eye.rotation.set(0, yaw, 0);
      const flicker = glareFlicker(t, slot.ownerId, reducedMotion);
      placeBetween(slot.outer, origin, end, 1.05 * flicker);
      placeBetween(slot.core, origin, end, 0.36 * flicker);
      slot.outerMat.opacity = 0.62 * flicker;
      slot.coreMat.opacity = 0.95;
      slot.root.visible = true;
      // Sparks shed down the line, denser at the eye.
      slot.ember += dt * 40 * (0.4 + 0.6 * this.quality);
      while (slot.ember >= 1) {
        slot.ember -= 1;
        const k = Math.random() ** 1.6;
        const at = this.tmp.copy(origin).lerp(end, k);
        this.host.vfx.burst(at, 'frost', 1, 0.2, TEAL, 0.45);
      }
    }
  }

  // ---- the Muster Grapnel ---------------------------------------------------------------------

  private throwRope(sourceId: number, targetId: number): void {
    let slot = this.ropes.find((r) => r.sourceId === -1);
    if (!slot) slot = this.ropes.reduce((a, b) => (a.age > b.age ? a : b));
    slot.sourceId = sourceId;
    slot.targetId = targetId;
    slot.age = 0;
    slot.held = 0;
  }

  private updateRopes(dt: number, ready: boolean): void {
    for (const slot of this.ropes) {
      if (slot.sourceId === -1) continue;
      const hand = this.host.anchor(slot.sourceId, 0.62, this.tmp);
      const ally = this.host.anchor(slot.targetId, 0.55, this.tmp2);
      const next = advanceRopeAge(
        slot.age,
        slot.held,
        dt,
        hand && ally ? hand.distanceTo(ally) : 0,
      );
      slot.age = next.age;
      slot.held = next.held;
      if (slot.age >= GRAPNEL_ROPE_SEC || !hand || !ally || !ready) {
        slot.sourceId = -1;
        slot.root.visible = false;
        continue;
      }
      const reach = grapnelReach(slot.age);
      const tip = this.tmp3.copy(hand).lerp(ally, reach);
      const length = hand.distanceTo(tip);
      let prevX = hand.x;
      let prevY = hand.y;
      let prevZ = hand.z;
      const a = this.segA;
      const b = this.segB;
      for (let s = 0; s < ROPE_SEGMENTS; s++) {
        const k = (s + 1) / ROPE_SEGMENTS;
        const x = hand.x + (tip.x - hand.x) * k;
        const z = hand.z + (tip.z - hand.z) * k;
        const y = hand.y + (tip.y - hand.y) * k + ropeSag(k, reach, length);
        a.set(prevX, prevY, prevZ);
        b.set(x, y, z);
        placeBetween(slot.segments[s], a, b, 1);
        prevX = x;
        prevY = y;
        prevZ = z;
      }
      slot.hook.position.copy(tip);
      slot.hook.lookAt(hand);
      slot.root.visible = length > 0.05;
    }
  }

  clear(): void {
    for (const s of this.standards) {
      s.ownerId = -1;
      s.root.visible = false;
    }
    for (const g of this.glares) {
      g.ownerId = -1;
      g.root.visible = false;
    }
    for (const r of this.ropes) {
      r.sourceId = -1;
      r.root.visible = false;
    }
    this.tracked.clear();
  }

  /** Dev/test probe: how many of each piece is on screen. */
  activeCounts(): { standards: number; glares: number; ropes: number } {
    return {
      standards: this.standards.filter((s) => s.root.visible).length,
      glares: this.glares.filter((g) => g.root.visible).length,
      ropes: this.ropes.filter((r) => r.root.visible).length,
    };
  }
}

/** The painter's one relic hook, fanned out to both relic modules in order. */
export function composeRelicHooks(
  ...hooks: {
    handleSpellfx(ev: AbilityVfxSpellfxEvent, admitted: boolean): boolean;
    update(dt: number, reducedMotion: boolean): void;
    setQuality(q: number): void;
  }[]
): {
  handleSpellfx(ev: AbilityVfxSpellfxEvent, admitted: boolean): boolean;
  update(dt: number, reducedMotion: boolean): void;
  setQuality(q: number): void;
} {
  return {
    handleSpellfx: (ev, admitted) => hooks.some((hook) => hook.handleSpellfx(ev, admitted)),
    update: (dt, reducedMotion) => {
      for (const hook of hooks) hook.update(dt, reducedMotion);
    },
    setQuality: (q) => {
      for (const hook of hooks) hook.setQuality(q);
    },
  };
}
