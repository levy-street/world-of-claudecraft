// The Sunken Bastion trash mechanics' own visuals (plan:
// bastion_trash_fx_core.ts): the garrison fighting as soldiers. This module
// routes the kit's cues, scans the world for the auras and objects they
// leave, and draws the body-bound pieces itself; the boathook, the fog bank
// and the brine column are sibling painters on the same kit
// (bastion_trash_fx_kit.ts).
//
//  Halberd Wall (heroic): a teal sea-glass ward shimmers round every watchman
//    holding the wall, and a band of light runs between each pair of partners,
//    so "split them" reads at a glance.
//  Fall Back (Fogbound Arbalest): a push-off of dust and sea spray, a short
//    spray trail along the leap and a puff where it lands.
//  Soul Hunger (Wreckbound Sailor): every stack swells the body (drawn through
//    swellOf, held on the corpse until it bursts) with a gulp, and its
//    soul lights burn brighter, pulsing before the spirit dissolves.
//  Pack Frenzy (Bastion Warhound): the hound throws its head back and howls
//    (its Howl clip through the gesture hook), a shock ring runs out over the
//    floor, and sea light streams from its eyes and throat while it lasts.
//  Snapped Fetters (Shackled Prisoner): the irons burst in shards and a flash,
//    the drowned light streams out of its eyes and it kneels (its Kneel clip
//    through the gesture hook, then KneelLoop while the aura holds); when it
//    leaves the world a soft pale light stands where it knelt and its spirit
//    rises away in wisps.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built once and
// pooled, rides the Bastion telegraph root behind its compile gate, and
// nothing allocates per frame (per-body records are made once per body and
// dropped with it). What a player acts on (the chain and who it holds, the
// linked ward, the swell, the fog patch and its shroud, the column, the kneel)
// draws on EVERY tier; the particle flourishes shed with the effects density,
// and reduced motion drops the flying shards, sparks and streaks.

import * as THREE from 'three';
import {
  BASTION_BOATHOOK,
  BASTION_BRINE_COLUMN,
  BASTION_CARRION_GLUT,
  BASTION_FALL_BACK,
  BASTION_FETTERS_RELEASE,
  BASTION_FOG_BANK,
  BASTION_FOG_BANK_CLOUD,
  BASTION_FOG_SHROUD,
  BASTION_HALBERD_WALL,
  BASTION_SNAPPED_FETTERS,
} from '../../sim/mob/trash_kit/bastion_cast_ids';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { BastionBoathookFx } from './bastion_boathook_fx';
import { BastionBrineColumnFx } from './bastion_brine_column_fx';
import { modelPointWorld } from './bastion_creature_fx_core';
import type { DrownedParticleSink } from './bastion_drowned_fx';
import { drownedFxSpec } from './bastion_drowned_fx_core';
import { BastionFogBankFx } from './bastion_fog_bank_fx';
import {
  BASTION_FETTERS_KNEEL_GESTURE,
  BASTION_PACK_HOWL_GESTURE,
  CHANTER,
  CRAWLER,
  CRAWLER_RAW_HEIGHT,
  CRAWLER_SOUL_ANCHORS,
  FALL_TRAIL_INTERVAL,
  FRENZY_EMBER_INTERVAL,
  fallBackSeconds,
  frenzyGlow,
  glutGlow,
  glutStacks,
  glutSwell,
  HOWL_RING_RADIUS,
  HOWL_RING_SEC,
  inBastionClaim,
  PACK_FRENZY_AURA,
  PRISONER,
  PRISONER_EYES,
  PRISONER_HEART_KNEELING,
  PRISONER_IRONS,
  PRISONER_RAW_HEIGHT,
  RELEASE_SEC,
  releaseEnvelope,
  SWELL_EPSILON,
  stableSlots,
  TRASH_FX_SLOTS,
  WARHOUND,
  WARHOUND_EYES,
  WARHOUND_THROAT,
  WATCHMAN,
  wallPairs,
  wallRadius,
} from './bastion_trash_fx_core';
import {
  LOOK,
  SEA,
  SHELL_MODE,
  type ShellSlot,
  type TrashBody,
  TrashFxKit,
} from './bastion_trash_fx_kit';

const SCAN_SEC = 0.1;
const WARD_TEAL = new THREE.Color(0.32, 0.95, 0.86);
const SOUL = new THREE.Color(0.78, 0.9, 1.0);
/** The warhound GLB's measure (bastion_drowned_fx_core.ts DROWNED_FX). */
const WARHOUND_RAW = drownedFxSpec(WARHOUND)?.rawHeight ?? 4.4;
/** Where the shackles' flash bursts through the prisoner's chest. */
const PRISONER_CHEST = { side: 0, up: 2.5, fwd: 0.3 } as const;

interface CrawlerState {
  stacks: number;
  gulpAt: number;
  drawn: number;
  nextGlow: number;
  diedAt: number;
}

interface LeapState {
  id: number;
  start: number;
  nextTrail: number;
  landed: boolean;
}

interface FreedState {
  x: number;
  y: number;
  z: number;
  facing: number;
  k: number;
  seen: number;
  nextMote: number;
}

interface ReleaseState {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  k: number;
  start: number;
  nextWisp: number;
  soul: ShellSlot;
}

/** Two crossed unit quads from x 0 to 1 (uv.x along, uv.y across), so a band
 *  reads from any angle. */
function crossedBand(): THREE.BufferGeometry {
  const pos = [
    0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 0, 0.5, 0, 0, 0, -0.5, 1, 0, -0.5, 1, 0, 0.5, 0, 0, 0.5,
  ];
  const uv = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
  const nrm = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return g;
}

export class BastionTrashFx {
  private readonly kit: TrashFxKit;
  private readonly hooks: BastionBoathookFx;
  private readonly fog: BastionFogBankFx;
  private readonly columns: BastionBrineColumnFx;
  private readonly wards: ShellSlot[] = [];
  private readonly bands: ShellSlot[] = [];
  private readonly releases: ReleaseState[] = [];
  private readonly crawlers = new Map<number, CrawlerState>();
  /** Frenzied hounds: entity id to when its eyes next throw light. */
  private readonly hounds = new Map<number, number>();
  private readonly freed = new Map<number, FreedState>();
  private readonly leaps: LeapState[] = [];
  /** The drawn swell of each fed crawler (entity id to scale), read by the
   *  renderer through `swellOf` (this instance's own, never module state). */
  private readonly swell = new Map<number, number>();
  /** The scan's picks (reused arrays, refilled every scan). */
  private readonly wallIds: number[] = [];
  private readonly shroudIds: number[] = [];
  /** The warded watchmen alive this frame, and the body each ward slot shows
   *  (stableSlots: a body keeps its slot, a full pool drops a newcomer). */
  private readonly wallLive: number[] = [];
  private readonly wardIds: number[] = new Array(TRASH_FX_SLOTS.wards).fill(-1);
  private readonly wallBodies: { id: number; x: number; z: number }[] = [];
  private readonly pairs: number[] = [];
  /** Whether the local player stood in a Bastion claim at the last scan. */
  private inside = false;
  private readonly wallReach = wallRadius();
  private readonly leapSec = fallBackSeconds();
  private readonly at = { x: 0, y: 0, z: 0 };
  private readonly a3 = new THREE.Vector3();
  private readonly b3 = new THREE.Vector3();
  private readonly xAxis = new THREE.Vector3(1, 0, 0);
  private scanIn = 0;

  constructor(
    root: THREE.Object3D,
    groundY: (x: number, z: number) => number,
    private readonly world: IWorld | undefined,
    glow: DrownedParticleSink,
    mist: DrownedParticleSink,
    density: number,
    reducedMotion: () => boolean,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
  ) {
    const group = new THREE.Group();
    group.name = 'sunken-bastion-trash-fx';
    root.add(group);
    const kit = new TrashFxKit(group, groundY, world, glow, mist, density, reducedMotion);
    this.kit = kit;
    // The ward: an egg of sea glass round a watchman (unit sphere, base at 0).
    const ward = new THREE.SphereGeometry(1, 36, 22);
    ward.translate(0, 1, 0);
    // An open sleeve (the shroud, the column, the soul light), base at 0.
    const sleeve = new THREE.CylinderGeometry(1, 1, 1, 36, 6, true);
    sleeve.translate(0, 0.5, 0);
    const band = crossedBand();
    kit.geometries.push(ward, sleeve, band);
    for (let i = 0; i < TRASH_FX_SLOTS.wards; i++)
      this.wards.push(kit.shellSlot(group, ward, SHELL_MODE.ward, WARD_TEAL, true));
    for (let i = 0; i < TRASH_FX_SLOTS.bands; i++)
      this.bands.push(kit.shellSlot(group, band, SHELL_MODE.band, WARD_TEAL, true));
    for (let i = 0; i < TRASH_FX_SLOTS.souls; i++) {
      const soul = kit.shellSlot(group, sleeve, SHELL_MODE.soul, SOUL, true);
      this.releases.push({ alive: false, x: 0, y: 0, z: 0, k: 1, start: 0, nextWisp: 0, soul });
    }
    this.hooks = new BastionBoathookFx(kit);
    this.fog = new BastionFogBankFx(kit, sleeve);
    this.columns = new BastionBrineColumnFx(kit, sleeve);
  }

  // -------------------------------------------------------------- events

  /** Claims the trash kit's cues; true when it drew one (the generic
   *  projectile or nova is then not drawn too). */
  handleEvent(ev: SimEvent, now: number): boolean {
    this.kit.now = now;
    if (ev.type !== 'spellfx' || !this.world) return false;
    switch (ev.ability) {
      case BASTION_BOATHOOK:
        if (ev.fx !== 'heavyBolt') return false;
        this.hooks.throw(ev.sourceId, ev.targetId);
        return true;
      case BASTION_FALL_BACK:
        this.pushOff(ev.sourceId, ev.targetId);
        return true;
      case BASTION_CARRION_GLUT:
        this.gulp(ev.sourceId);
        return true;
      case BASTION_FOG_BANK:
        this.chantFog(ev.sourceId);
        return true;
      case BASTION_BRINE_COLUMN:
        this.columns.landed(ev.targetId);
        return true;
      case BASTION_SNAPPED_FETTERS:
        this.snapFetters(ev.sourceId);
        return true;
      case BASTION_FETTERS_RELEASE:
        this.release(ev.sourceId);
        return true;
      default:
        break;
    }
    // Pack Frenzy's cue is the sim's generic frenzy nova (no ability id).
    if (ev.fx === 'nova' && !ev.ability) {
      const hound = this.world.entities.get(ev.sourceId);
      if (hound?.kind === 'mob' && hound.templateId === WARHOUND) {
        this.howl(hound);
        return true;
      }
    }
    return false;
  }

  private pushOff(arbalestId: number, fromId: number): void {
    const kit = this.kit;
    const a = this.world?.entities.get(arbalestId);
    if (!a) return;
    const from = this.world?.entities.get(fromId);
    let dx = from ? a.pos.x - from.pos.x : -Math.sin(a.facing);
    let dz = from ? a.pos.z - from.pos.z : -Math.cos(a.facing);
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const floor = kit.groundY(a.pos.x, a.pos.z);
    // The kick off: spray thrown toward the foe it leaps from, dust rolling
    // off the flags, a ring where its boots left.
    const n = kit.reducedMotion() ? 4 : kit.count(26);
    for (let i = 0; i < n; i++) {
      const sp = 3 + kit.rand() * 5;
      const j = (kit.rand() - 0.5) * 1.6;
      const x = a.pos.x + (kit.rand() - 0.5) * 0.8;
      const z = a.pos.z + (kit.rand() - 0.5) * 0.8;
      const vx = (-dx + j * dz) * sp;
      const vy = (0.5 + kit.rand() * 0.9) * sp * 0.6;
      const vz = (-dz - j * dx) * sp;
      kit.emit(kit.glow, LOOK.drop, x, floor + 0.15, z, vx, vy, vz, 0.45 + kit.rand() * 0.3);
    }
    const dust = kit.count(9);
    for (let i = 0; i < dust; i++) {
      const ang = kit.rand() * Math.PI * 2;
      const ox = Math.cos(ang);
      const oz = Math.sin(ang);
      const vx = ox * 2.2 - dx * 1.5;
      const vz = oz * 2.2 - dz * 1.5;
      const x = a.pos.x + ox * 0.6;
      const z = a.pos.z + oz * 0.6;
      kit.emit(kit.mist, LOOK.dust, x, floor + 0.3, z, vx, 0.5 + kit.rand() * 0.6, vz, 1.2);
    }
    kit.ring(a.pos.x, a.pos.z, 0xbfe8dc, 0.6, 3.2, 0.45, 0.7);
    const leap = this.leaps.find((l) => l.id === arbalestId);
    if (leap) {
      leap.start = kit.now;
      leap.nextTrail = kit.now;
      leap.landed = false;
    } else {
      this.leaps.push({ id: arbalestId, start: kit.now, nextTrail: kit.now, landed: false });
    }
  }

  private gulp(crawlerId: number): void {
    const kit = this.kit;
    const c = this.world?.entities.get(crawlerId);
    if (!c) return;
    const st = this.crawlerState(crawlerId);
    st.gulpAt = kit.now;
    st.stacks = Math.max(st.stacks, glutStacks(c.auras, BASTION_CARRION_GLUT));
    // Soul Hunger: the chest flares and spirits rise through the coat.
    const k = kit.scaleOf(c, CRAWLER_RAW_HEIGHT) * st.drawn;
    for (const anchor of CRAWLER_SOUL_ANCHORS) {
      const p = kit.point(c, k, anchor, this.at);
      kit.emit(kit.glow, LOOK.bloom, p.x, p.y, p.z, 0, 0.4, 0, 0.45, 1.3 * k);
      kit.emit(kit.glow, LOOK.wisp, p.x, p.y, p.z, 0, 1.5, 0, 0.8, 1.2 * k);
    }
  }

  private chantFog(chanterId: number): void {
    // The chant lands: a breath of sea mist off the chanter (the patch itself
    // rolls in where the sim laid it, from the scan).
    const kit = this.kit;
    const c = this.world?.entities.get(chanterId);
    const spec = drownedFxSpec(CHANTER);
    if (!c || !spec) return;
    const eyes = kit.point(c, kit.scaleOf(c, spec.rawHeight), spec.eyes, this.at);
    const fx = Math.sin(c.facing) * 2.5;
    const fz = Math.cos(c.facing) * 2.5;
    const n = kit.count(8);
    for (let i = 0; i < n; i++) {
      const a = kit.rand() * Math.PI * 2;
      const vx = Math.cos(a) * 2 + fx;
      const vy = -0.4 + kit.rand() * 0.6;
      const vz = Math.sin(a) * 2 + fz;
      kit.emit(kit.mist, LOOK.fog, eyes.x, eyes.y, eyes.z, vx, vy, vz, 1.4 + kit.rand() * 0.5, 0.7);
    }
  }

  private snapFetters(prisonerId: number): void {
    const kit = this.kit;
    const e = this.world?.entities.get(prisonerId);
    if (!e) return;
    this.playGesture?.(prisonerId, BASTION_FETTERS_KNEEL_GESTURE);
    this.trackFreed(e);
    const k = kit.scaleOf(e, PRISONER_RAW_HEIGHT);
    const still = kit.reducedMotion();
    // The irons burst: a hot white flash at each, rusted shards and sparks.
    for (const iron of PRISONER_IRONS) {
      const p = kit.point(e, k, iron, this.at);
      const px = p.x;
      const py = p.y;
      const pz = p.z;
      kit.emit(kit.glow, LOOK.flash, px, py, pz, 0, 0, 0, 0.28, 0.9 * k);
      const shards = still ? 0 : kit.count(10);
      for (let i = 0; i < shards; i++) {
        const a = kit.rand() * Math.PI * 2;
        const sp = 4 + kit.rand() * 6;
        const vy = (0.3 + kit.rand()) * sp * 0.7;
        const life = 0.5 + kit.rand() * 0.4;
        kit.emit(kit.glow, LOOK.shard, px, py, pz, Math.cos(a) * sp, vy, Math.sin(a) * sp, life);
      }
      const sparks = still ? 0 : kit.count(6);
      for (let i = 0; i < sparks; i++) {
        const a = kit.rand() * Math.PI * 2;
        const sp = 5 + kit.rand() * 6;
        const vy = (0.4 + kit.rand()) * sp * 0.6;
        const life = 0.3 + kit.rand() * 0.2;
        kit.emit(kit.glow, LOOK.spark, px, py, pz, Math.cos(a) * sp, vy, Math.sin(a) * sp, life);
      }
    }
    // The flash through his chest, and a ring of pale light on the flags.
    const chest = kit.point(e, k, PRISONER_CHEST, this.at);
    kit.emit(kit.glow, LOOK.bloom, chest.x, chest.y, chest.z, 0, 0.2, 0, 0.5, 2.4 * k);
    kit.ring(e.pos.x, e.pos.z, 0xe8fff6, 0.5, 4.5, 0.7, 0.9);
    // The drowned light leaves his eyes: sea-green motes streaming up and away.
    const eyes = kit.point(e, k, PRISONER_EYES, this.at);
    const ex = eyes.x;
    const ey = eyes.y;
    const ez = eyes.z;
    const motes = kit.count(18);
    for (let i = 0; i < motes; i++) {
      const x = ex + (kit.rand() - 0.5) * 0.3;
      const y = ey + (kit.rand() - 0.5) * 0.2;
      const z = ez + (kit.rand() - 0.5) * 0.3;
      const vx = (kit.rand() - 0.5) * 1.4;
      const vy = 1.5 + kit.rand() * 1.8;
      const vz = (kit.rand() - 0.5) * 1.4;
      kit.emit(kit.glow, LOOK.mote, x, y, z, vx, vy, vz, 1.2 + kit.rand() * 0.9);
    }
  }

  private release(prisonerId: number): void {
    const kit = this.kit;
    // The body is usually already gone from the world: use where it knelt.
    const e = this.world?.entities.get(prisonerId);
    if (e) this.trackFreed(e);
    const at = this.freed.get(prisonerId);
    if (!at) return;
    this.freed.delete(prisonerId);
    // A full pool drops the newcomer: a fading release is never cut short.
    const slot = this.releases.find((r) => !r.alive);
    if (!slot) return;
    slot.alive = true;
    slot.x = at.x;
    slot.y = at.y;
    slot.z = at.z;
    slot.k = at.k;
    slot.start = kit.now;
    slot.nextWisp = kit.now;
    // A pale light standing where he knelt, his shape going out of it.
    slot.soul.mesh.visible = true;
    slot.soul.mesh.position.set(at.x, at.y, at.z);
    slot.soul.mesh.scale.set(0.95 * at.k, 2.9 * at.k, 0.95 * at.k);
    const h = modelPointWorld(at.x, at.y, at.z, at.facing, at.k, PRISONER_HEART_KNEELING, this.at);
    kit.emit(kit.glow, LOOK.bloom, h.x, h.y, h.z, 0, 0.3, 0, 1.1, 2.4);
    kit.ring(at.x, at.z, SOUL, 0.8, 3.4, 1.6, 0.7);
  }

  private howl(hound: TrashBody): void {
    const kit = this.kit;
    this.playGesture?.(hound.id, BASTION_PACK_HOWL_GESTURE);
    const k = kit.scaleOf(hound, WARHOUND_RAW);
    const hx = hound.pos.x;
    const hz = hound.pos.z;
    kit.ring(hx, hz, SEA, 1, HOWL_RING_RADIUS, HOWL_RING_SEC, 1);
    kit.ring(hx, hz, 0xffffff, 0.6, HOWL_RING_RADIUS * 0.6, HOWL_RING_SEC * 0.7, 0.5);
    const t = kit.point(hound, k, WARHOUND_THROAT, this.at);
    const tx = t.x;
    const ty = t.y;
    const tz = t.z;
    kit.emit(kit.glow, LOOK.bloom, tx, ty, tz, 0, 0.3, 0, 0.4, 1.6 * k);
    // The howl's shock: streaks thrown out round the head.
    const rays = kit.reducedMotion() ? 0 : kit.count(18);
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + kit.rand() * 0.2;
      const sp = 7 + kit.rand() * 4;
      const vy = (kit.rand() - 0.2) * 3;
      kit.emit(kit.glow, LOOK.shock, tx, ty, tz, Math.cos(a) * sp, vy, Math.sin(a) * sp, 0.4);
    }
    this.hounds.set(hound.id, kit.now);
  }

  // -------------------------------------------------------------- per body

  private crawlerState(id: number): CrawlerState {
    let st = this.crawlers.get(id);
    if (!st) {
      st = { stacks: 0, gulpAt: -10, drawn: 1, nextGlow: 0, diedAt: -1 };
      this.crawlers.set(id, st);
    }
    return st;
  }

  private trackFreed(e: TrashBody): void {
    let st = this.freed.get(e.id);
    if (!st) {
      st = { x: 0, y: 0, z: 0, facing: 0, k: 1, seen: 0, nextMote: this.kit.now + 0.4 };
      this.freed.set(e.id, st);
    }
    st.x = e.pos.x;
    st.y = e.pos.y;
    st.z = e.pos.z;
    st.facing = e.facing;
    st.k = this.kit.scaleOf(e, PRISONER_RAW_HEIGHT);
    st.seen = this.kit.now;
  }

  // -------------------------------------------------------------- scan

  private scanWorld(world: IWorld): void {
    const now = this.kit.now;
    this.wallIds.length = 0;
    this.shroudIds.length = 0;
    for (const e of world.entities.values()) {
      if (e.kind === 'player') {
        if (e.dead) continue;
        for (const a of e.auras) {
          if (a.id === BASTION_BRINE_COLUMN && a.kind === 'root') this.columns.claim(e, a.sourceId);
        }
        continue;
      }
      if (e.kind !== 'mob') {
        if (e.templateId === BASTION_FOG_BANK_CLOUD) this.fog.claim(e);
        continue;
      }
      if (e.dead) continue;
      for (const a of e.auras) {
        if (a.id === BASTION_FOG_SHROUD) {
          if (!this.shroudIds.includes(e.id)) this.shroudIds.push(e.id);
        } else if (a.id === BASTION_HALBERD_WALL && e.templateId === WATCHMAN) {
          this.wallIds.push(e.id);
        }
      }
      if (e.templateId === CRAWLER) {
        const stacks = glutStacks(e.auras, BASTION_CARRION_GLUT);
        if (stacks > 0 || this.crawlers.has(e.id)) this.crawlerState(e.id).stacks = stacks;
      } else if (e.templateId === WARHOUND) {
        if (!this.hounds.has(e.id) && e.auras.some((a) => a.id === PACK_FRENZY_AURA))
          this.hounds.set(e.id, now);
      } else if (e.templateId === PRISONER) {
        if (e.auras.some((a) => a.id === BASTION_SNAPPED_FETTERS)) this.trackFreed(e);
      }
    }
    this.columns.scan(world);
    // Forget what left the world (a freed prisoner is kept a breath for its
    // release cue, which names a body already gone).
    for (const [id, st] of this.freed) if (now - st.seen > 2) this.freed.delete(id);
    for (const id of this.crawlers.keys()) {
      if (world.entities.has(id)) continue;
      this.crawlers.delete(id);
      this.swell.delete(id);
    }
  }

  /** Leaving the Bastion: forget its bodies so every ward, shroud, swell and
   *  glow fades or drops (the parts still in flight finish on their own). */
  private leftClaim(): void {
    this.wallIds.length = 0;
    this.shroudIds.length = 0;
    this.crawlers.clear();
    this.swell.clear();
    this.hounds.clear();
    this.freed.clear();
  }

  /** The drawn scale multiplier of a body: 1 for every body that is not a fed
   *  Barnacle Crawler. O(1), allocation-free; the renderer asks it per body. */
  swellOf(id: number): number {
    if (this.swell.size === 0) return 1;
    return this.swell.get(id) ?? 1;
  }

  // -------------------------------------------------------------- frame

  update(now: number, dt: number): void {
    const kit = this.kit;
    kit.now = now;
    kit.uTime.value = now;
    const world = this.world;
    if (!world) return;
    this.scanIn -= dt;
    if (this.scanIn <= 0) {
      this.scanIn = SCAN_SEC;
      // The roster scan (and its aura walks) runs only inside a Bastion claim.
      const inside = inBastionClaim(world.player.pos.x);
      if (inside) this.scanWorld(world);
      else if (this.inside) this.leftClaim();
      else this.columns.scan(world);
      this.inside = inside;
    }
    this.hooks.update(world);
    this.fog.update(world, this.shroudIds, dt);
    this.columns.update(world);
    this.updateWalls(world);
    this.updateLeaps(world);
    this.updateCrawlers(world, dt);
    this.updateHounds(world);
    this.updateFreed(world);
    this.updateReleases();
    kit.updateRings();
  }

  private updateWalls(world: IWorld): void {
    const kit = this.kit;
    // The warded watchmen this scan saw and still alive, each kept on its
    // ward slot (a newcomer takes a free one; a full pool drops it).
    this.wallLive.length = 0;
    for (const id of this.wallIds) {
      const e = world.entities.get(id);
      if (e && !e.dead) this.wallLive.push(id);
    }
    stableSlots(this.wardIds, this.wallLive, this.wallLive.length);
    let count = 0;
    for (let i = 0; i < this.wards.length; i++) {
      const slot = this.wards[i];
      const id = this.wardIds[i];
      const e = id >= 0 ? world.entities.get(id) : undefined;
      if (e) {
        // The seated bodies the partner links run between.
        let body = this.wallBodies[count];
        if (!body) {
          body = { id: 0, x: 0, z: 0 };
          this.wallBodies[count] = body;
        }
        body.id = e.id;
        body.x = e.pos.x;
        body.z = e.pos.z;
        count++;
      }
      if (!e) {
        slot.alpha = Math.max(0, slot.alpha - 0.08);
        slot.u.uAlpha.value = slot.alpha;
        if (slot.alpha <= 0) slot.mesh.visible = false;
        continue;
      }
      if (slot.id !== e.id) {
        slot.id = e.id;
        slot.alpha = 0;
      }
      slot.alpha = Math.min(1, slot.alpha + 0.08);
      const h = kit.heightOf(e);
      const r = Math.max(1.3, h * 0.3);
      slot.mesh.position.set(e.pos.x, e.pos.y, e.pos.z);
      slot.mesh.scale.set(r, h * 0.55, r);
      slot.u.uAlpha.value = slot.alpha * (0.8 + 0.2 * Math.sin(kit.now * 4 + i));
      slot.mesh.visible = true;
    }
    const pairs = wallPairs(this.wallBodies, count, this.wallReach, this.pairs, this.bands.length);
    for (let i = 0; i < this.bands.length; i++) {
      const band = this.bands[i];
      const ia = this.pairs[i * 2];
      const ib = this.pairs[i * 2 + 1];
      const a = i < pairs ? world.entities.get(this.wallBodies[ia].id) : undefined;
      const b = i < pairs ? world.entities.get(this.wallBodies[ib].id) : undefined;
      if (!a || !b) {
        band.mesh.visible = false;
        continue;
      }
      this.a3.set(a.pos.x, a.pos.y + kit.heightOf(a) * 0.55, a.pos.z);
      this.b3.set(b.pos.x, b.pos.y + kit.heightOf(b) * 0.55, b.pos.z);
      this.b3.sub(this.a3);
      const len = this.b3.length();
      if (len < 1e-3) {
        band.mesh.visible = false;
        continue;
      }
      band.mesh.position.copy(this.a3);
      band.mesh.quaternion.setFromUnitVectors(this.xAxis, this.b3.divideScalar(len));
      band.mesh.scale.set(len, 0.8, 0.8);
      band.u.uAlpha.value = 0.95;
      band.mesh.visible = true;
    }
  }

  private updateLeaps(world: IWorld): void {
    const kit = this.kit;
    for (let i = this.leaps.length - 1; i >= 0; i--) {
      const leap = this.leaps[i];
      const e = world.entities.get(leap.id);
      const t = kit.now - leap.start;
      if (!e || t > this.leapSec + 0.3) {
        this.leaps.splice(i, 1);
        continue;
      }
      if (t >= this.leapSec) {
        if (leap.landed) continue;
        leap.landed = true;
        // The landing: a puff of dust and spray round its boots.
        const floor = kit.groundY(e.pos.x, e.pos.z);
        kit.splash(e.pos.x, floor + 0.15, e.pos.z, 12, 3, 5);
        kit.ring(e.pos.x, e.pos.z, 0xbfe8dc, 0.5, 2.8, 0.4, 0.7);
        continue;
      }
      if (kit.now < leap.nextTrail || kit.reducedMotion()) continue;
      leap.nextTrail = kit.now + kit.every(FALL_TRAIL_INTERVAL);
      // The spray trail: brine flung off the mantle along the arc.
      for (let j = 0; j < 2; j++) {
        const x = e.pos.x + (kit.rand() - 0.5) * 0.7;
        const y = e.pos.y + 1 + kit.rand() * 2;
        const z = e.pos.z + (kit.rand() - 0.5) * 0.7;
        const vx = (kit.rand() - 0.5) * 2;
        const vz = (kit.rand() - 0.5) * 2;
        kit.emit(kit.glow, LOOK.drop, x, y, z, vx, -0.5 - kit.rand(), vz, 0.45, 0.8);
      }
      kit.emit(kit.mist, LOOK.mist, e.pos.x, e.pos.y + 1.4, e.pos.z, 0, 0.2, 0, 0.7, 0.8, 0.6);
    }
  }

  private updateCrawlers(world: IWorld, dt: number): void {
    const kit = this.kit;
    for (const [id, st] of this.crawlers) {
      const e = world.entities.get(id);
      if (!e) continue;
      if (e.dead && st.diedAt < 0) st.diedAt = kit.now;
      else if (!e.dead) st.diedAt = -1;
      // A corpse keeps the swell it died with (the sim strips its auras).
      const target = glutSwell(st.stacks, kit.now - st.gulpAt);
      st.drawn += (target - st.drawn) * Math.min(1, dt * 12);
      if (st.drawn <= SWELL_EPSILON) this.swell.delete(id);
      else this.swell.set(id, st.drawn);
      // The authored body starts dissolving at 1.1s. Its moving soul ribbons
      // then take over; fixed chest glows must not outlive the vanished body.
      if (
        st.stacks <= 0 ||
        (st.diedAt >= 0 && kit.now - st.diedAt >= 1.1) ||
        kit.now < st.nextGlow ||
        !kit.near(e.pos.x, e.pos.z)
      )
        continue;
      const glow = glutGlow(st.stacks);
      // A fed corpse pulses hard before it bursts.
      const fuse = e.dead ? 0.5 + 0.5 * Math.sin(kit.now * 18) : 0;
      st.nextGlow = kit.now + kit.every(e.dead ? 0.05 : 0.09);
      const k = kit.scaleOf(e, CRAWLER_RAW_HEIGHT) * st.drawn;
      const size = (0.55 + 0.45 * glow + 0.4 * fuse) * k * 0.6;
      const alpha = 0.35 + 0.4 * glow + 0.3 * fuse;
      for (const anchor of CRAWLER_SOUL_ANCHORS) {
        const p = kit.point(e, k, anchor, this.at);
        kit.emit(kit.glow, LOOK.bloom, p.x, p.y, p.z, 0, 0.1, 0, 0.16, size, alpha);
      }
    }
  }

  private updateHounds(world: IWorld): void {
    const kit = this.kit;
    for (const [id, nextEmber] of this.hounds) {
      const e = world.entities.get(id);
      const aura = e?.auras.find((a) => a.id === PACK_FRENZY_AURA);
      if (!e || e.dead || !aura) {
        this.hounds.delete(id);
        continue;
      }
      if (kit.now < nextEmber || !kit.near(e.pos.x, e.pos.z)) continue;
      this.hounds.set(id, kit.now + kit.every(FRENZY_EMBER_INTERVAL));
      // Sea light streaming from its eyes and throat, trailing as it runs.
      const glow = frenzyGlow(aura.remaining, aura.duration);
      const k = kit.scaleOf(e, WARHOUND_RAW);
      const bx = -Math.sin(e.facing) * 1.6;
      const bz = -Math.cos(e.facing) * 1.6;
      for (const eye of WARHOUND_EYES) {
        const p = kit.point(e, k, eye, this.at);
        kit.emit(kit.glow, LOOK.mote, p.x, p.y, p.z, bx, 0.3, bz, 0.32, 1.2 * k, glow);
      }
      const t = kit.point(e, k, WARHOUND_THROAT, this.at);
      kit.emit(kit.glow, LOOK.mote, t.x, t.y, t.z, bx, 0.2, bz, 0.26, 1.8 * k, 0.55 * glow);
    }
  }

  private updateFreed(world: IWorld): void {
    const kit = this.kit;
    // A freed prisoner on his knees: the last of the sea light seeping out of
    // him in a slow drift of pale motes while the grace lasts.
    for (const [id, st] of this.freed) {
      const e = world.entities.get(id);
      if (!e) continue;
      st.x = e.pos.x;
      st.y = e.pos.y;
      st.z = e.pos.z;
      st.facing = e.facing;
      if (kit.now < st.nextMote || !kit.near(st.x, st.z)) continue;
      st.nextMote = kit.now + kit.every(0.16);
      const h = modelPointWorld(
        st.x,
        st.y,
        st.z,
        st.facing,
        st.k,
        PRISONER_HEART_KNEELING,
        this.at,
      );
      const x = h.x + (kit.rand() - 0.5) * 0.8;
      const y = h.y + (kit.rand() - 0.5) * 0.6;
      const z = h.z + (kit.rand() - 0.5) * 0.8;
      kit.emit(kit.glow, LOOK.wisp, x, y, z, 0, 0.6 + kit.rand() * 0.5, 0, 1.4, 0.55, 0.9);
    }
  }

  private updateReleases(): void {
    const kit = this.kit;
    for (const r of this.releases) {
      if (!r.alive) continue;
      const t = kit.now - r.start;
      if (t > RELEASE_SEC) {
        r.alive = false;
        r.soul.mesh.visible = false;
        continue;
      }
      const env = releaseEnvelope(t);
      // The pale light where he knelt fades as he goes.
      r.soul.u.uAlpha.value = env * Math.max(0, 1 - t / 1.4);
      if (kit.now < r.nextWisp) continue;
      r.nextWisp = kit.now + kit.every(0.05);
      // His spirit rising away in wisps.
      const a = kit.rand() * Math.PI * 2;
      const ox = Math.cos(a);
      const oz = Math.sin(a);
      const rr = kit.rand() * 0.8 * r.k;
      const y = r.y + 0.4 + kit.rand() * 1.8 * r.k;
      const vy = 1.2 + kit.rand() * 1.2;
      const life = 1.6 + kit.rand() * 0.8;
      kit.emit(
        kit.glow,
        LOOK.wisp,
        r.x + ox * rr,
        y,
        r.z + oz * rr,
        ox * 0.3,
        vy,
        oz * 0.3,
        life,
        1,
        env,
      );
    }
  }

  dispose(): void {
    this.swell.clear();
    this.hooks.dispose();
    this.kit.dispose();
  }
}
