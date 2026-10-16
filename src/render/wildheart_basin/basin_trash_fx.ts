// The Wildheart Basin trash's hunt (plan: basin_trash_fx_core.ts), composed
// and driven by WildheartFx (basin_fx.ts), which lends it its fx root (so
// every mesh here rides the same compile-gated attach), its telegraph kit,
// its particle pools and its shock rings:
//  - Pack Frenzy: a fallen Basin Raptor's pack snarls (a red burst) and
//    burns red while the frenzy holds, red streaks tearing off it as it runs;
//  - Quarry Mark: an orange sight filling under the chosen quarry, the bone
//    spear thrown in an arc, then the bone-and-claw sigil over the quarry's
//    head and the claw rakes at their feet, the raptors running it down
//    streaking orange;
//  - War Roar: the kick glyph and the roar's 15 yd reach filling (gold: kick
//    it), the shockwave out to that reach, the blood-red frenzy pooled under
//    and steaming off every roused ravager for the rest of the pull;
//  - Toad Hex: the kick glyph, a violet hex ring under the victim, a green-
//    gold bolt, and a puff of hex smoke as the toad comes and as it breaks
//    (the toad itself is the polymorph form slot, characters/);
//  - Rattling Dread: the red-painted skull burning over every Dread Totem,
//    its 8 yd reach filling with the bar, the skull-and-rattle burst;
//  - Snaring Tongue: the lane locked at the bar's start, the tongue shooting
//    down it from the toad's mouth and holding each reeled player until they
//    are in (or the reel lets go);
//  - Snarlbark: thorn splinters off a melee attacker the bark pricks.
//
// Rules (src/render/CLAUDE.md): every mesh and material is built here once,
// in the constructor, under the host's root before WildheartFx's gated
// attach; the hot paths reuse their options. The telegraphs, the quarry
// sigil, the dread skull and the tongue are ACTIONABLE and draw on every
// tier; the glows, streaks, smoke and splinters are cosmetic and thin with
// the host's density. All state comes from IWorld entities and events, so
// offline and online look the same. No light here.

import * as THREE from 'three';
import {
  BASIN_RAPTOR_ID,
  RAVAGER_ID,
  SPORE_TOAD_ID,
  SUNBONE_DREAD_TOTEM_ID,
  VINE_LASHER_ID,
} from '../../sim/encounters/wildheart_basin/ids';
import {
  WILDHEART_QUARRY,
  WILDHEART_QUARRY_MARK,
  WILDHEART_RATTLING_DREAD,
  WILDHEART_ROAR_FRENZY,
  WILDHEART_SNARING_TONGUE,
  WILDHEART_TOAD_HEX,
  WILDHEART_TOADED,
  WILDHEART_WAR_ROAR,
} from '../../sim/mob/trash_kit/wildheart_cast_ids';
import type { Aura, Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import type { TelegraphFan, TelegraphLane, TelegraphPaint } from '../floor_telegraph';
import { TELEGRAPH_THREAT_COLORS } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { surfaceMat } from '../gfx';
import { radialGlowTexture } from '../textures';
import { seedArcInto } from './basin_boss_fx_core';
import { type BasinPuffOptions, basinCastFill } from './basin_fx_core';
import type { BasinFxHost } from './basin_fx_host';
import { huntRingMaterial } from './basin_mark_art';
import { dreadSkullTexture, quarrySigilTexture } from './basin_trash_art';
import {
  type DreadSkullLook,
  dreadSkullLookInto,
  frenzyGlow,
  HEX_BOLT_SPEED,
  isSunboneTotem,
  KICK_GLYPH_RADIUS,
  projectileFlight,
  type QuarryMarkLook,
  quarryMarkLookInto,
  RAPTOR_FRENZY_GESTURE,
  RAPTOR_PACK_FRENZY_AURA,
  SNARLBARK_ABILITY,
  SPEAR_SPEED,
  spearApex,
  THROW_HAND,
  TONGUE_RETRACT_SECONDS,
  TONGUE_SHOOT_SECONDS,
  TOTEM_RISE_GESTURE,
  TOTEM_RISE_WINDOW,
  TRASH_ACCENTS,
  TRASH_FX_POOLS,
  TRASH_SHOCKS,
  type TrashCastSpec,
  type TrashShock,
  toadMouthInto,
  tongueCatchInto,
  tongueHoldLimit,
  tongueReeledIn,
  tongueShot,
  trashBodyHeight,
  trashCastSpecs,
} from './basin_trash_fx_core';

// The actionable pools hold the basin's worst pull plus the next worst chained
// into it (TRASH_FX_POOLS, off the spawn table; pinned in the core test), so a
// full pull never drops a telegraph. The frenzy pool is cosmetic only.
const RING_SLOTS = TRASH_FX_POOLS.rings;
const KICK_SLOTS = TRASH_FX_POOLS.kicks;
const LANE_SLOTS = TRASH_FX_POOLS.lanes;
const SPEAR_SLOTS = TRASH_FX_POOLS.spears;
const HEX_SLOTS = TRASH_FX_POOLS.hexes;
const MARK_SLOTS = TRASH_FX_POOLS.marks;
const FRENZY_SLOTS = 14;
const SKULL_SLOTS = TRASH_FX_POOLS.skulls;
const TONGUE_SLOTS = TRASH_FX_POOLS.tongues;
/** Trail motes a second off a spear or a hex bolt in flight (full density). */
const SPEAR_TRAIL_RATE = 70;
const HEX_TRAIL_RATE = 60;
/** Seconds the dread skull flares after its burst. */
const SKULL_FLASH_SECONDS = 0.55;

type FrenzyKind = 'pack' | 'roar' | 'hunt';

interface FanSlot extends TelegraphFan {
  casterId: number;
  castId: string;
}
interface LaneSlot extends TelegraphLane {
  casterId: number;
}
interface Flight {
  alive: boolean;
  born: number;
  flight: number;
  apex: number;
  targetId: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** The trail's mote accumulator (frame-rate independent). */
  trail: number;
}
interface SpearSlot extends Flight {
  body: THREE.Group;
  glow: THREE.Sprite;
}
interface HexSlot extends Flight {
  orb: THREE.Sprite;
  core: THREE.Sprite;
}
interface MarkSlot {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.ShaderMaterial;
  entityId: number;
}
interface FrenzySlot {
  glow: THREE.Sprite;
  glowMat: THREE.SpriteMaterial;
  pool: THREE.Mesh;
  poolMat: THREE.MeshBasicMaterial;
  entityId: number;
  kind: FrenzyKind;
  emit: number;
  streak: number;
  lastX: number;
  lastZ: number;
}
interface SkullSlot {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  eyes: THREE.Sprite;
  eyesMat: THREE.SpriteMaterial;
  entityId: number;
  flashAt: number;
  emit: number;
}
interface TongueSlot {
  body: THREE.Mesh;
  tip: THREE.Mesh;
  casterId: number;
  /** The reeled player, or -1 for a tongue that caught nobody. */
  targetId: number;
  born: number;
  /** Where a tongue that caught nobody reaches (the lane's end, chest high). */
  end: THREE.Vector3;
  /** Clock time the retract began (-1 while it holds). */
  retractAt: number;
  /** The reach at the retract's start (it snaps back from there). */
  retractFrom: number;
  splatted: boolean;
  /** The reel's progress check: the gap last time, and when. */
  lastGap: number;
  checkAt: number;
}

export class BasinTrashFx {
  private readonly specs = trashCastSpecs();
  private readonly rings: FanSlot[] = [];
  private readonly kicks: FanSlot[] = [];
  private readonly lanes: LaneSlot[] = [];
  private readonly spears: SpearSlot[] = [];
  private readonly hexes: HexSlot[] = [];
  private readonly marks: MarkSlot[] = [];
  private readonly frenzies: FrenzySlot[] = [];
  private readonly skulls: SkullSlot[] = [];
  private readonly tongues: TongueSlot[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  /** Raptors running a forced target down (resolved at the scan's end). */
  private readonly chasers: number[] = [];
  /** The toaded players of the last scan and of this one (a drop breaks). */
  /** Totems just planted: their Rise is offered until `until` (fixed slots). */
  private readonly rising = Array.from({ length: 8 }, () => ({ id: -1, until: -1 }));
  private totemsSeen: number[] = [];
  private totemsNext: number[] = [];
  private toads: number[] = [];
  private toadsNext: number[] = [];
  private readonly caught: number[] = [];
  private readonly paint: TelegraphPaint = { fill: 0, clock: 0, range: 1 };
  private readonly style = { color: 0xffffff, accent: 0xffffff };
  private readonly arc = { x: 0, y: 0, z: 0 };
  private readonly mouth = { x: 0, y: 0, z: 0 };
  /** Reused per-frame looks (the quarry sigil, the dread skull). */
  private readonly markLook: QuarryMarkLook = { alpha: 0, size: 0 };
  private readonly skullLook: DreadSkullLook = { alpha: 0, eyes: 0, size: 0 };
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  /** Reused per-frame motes (the streaks, embers, steam and hex shimmer). */
  private readonly mote: BasinPuffOptions & { color: [number, number, number] } = {
    speed: 0.5,
    life: 1,
    size: [1, 1],
    color: [1, 1, 1],
    alpha: 1,
  };
  private readonly trailMote: BasinPuffOptions & {
    color: [number, number, number];
    size: [number, number];
  } = {
    speed: 0.3,
    life: 0.35,
    size: [0.6, 0.15],
    color: [1, 1, 1],
    alpha: 0.9,
    glow: true,
    drag: 2,
  };
  private clock = 0;
  private disposed = false;

  constructor(
    private readonly host: BasinFxHost,
    private readonly world: IWorld,
    /** Drives a model's own gesture clip (the raptor's frenzy screech). */
    private readonly playGesture?: (entityId: number, gesture: string) => void,
  ) {
    const { root, kit } = host;
    for (let i = 0; i < RING_SLOTS; i++) {
      const fan = kit.fan(18);
      fan.group.name = 'wildheart-trash-ring';
      this.rings.push({ ...fan, casterId: -1, castId: '' });
    }
    for (let i = 0; i < KICK_SLOTS; i++) {
      const fan = kit.fan(19);
      fan.group.name = 'wildheart-trash-kick';
      this.kicks.push({ ...fan, casterId: -1, castId: '' });
    }
    for (let i = 0; i < LANE_SLOTS; i++) {
      const lane = kit.lane(17);
      lane.group.name = 'wildheart-trash-lane';
      this.lanes.push({ ...lane, casterId: -1 });
    }
    const glowTex = radialGlowTexture();
    // Minted per call (not a shared cache): this fx owns and disposes them.
    this.textures.push(glowTex);
    const sprite = (color: number, opacity: number, name: string, map = glowTex, add = true) => {
      const mat = new THREE.SpriteMaterial({
        map,
        color,
        transparent: true,
        opacity,
        blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false,
        name,
      });
      this.materials.push(mat);
      const s = new THREE.Sprite(mat);
      s.visible = false;
      root.add(s);
      return { s, mat };
    };
    // The marking spear: a wooden shaft, a red-bound grip, a bone head.
    const shaftGeo = new THREE.CylinderGeometry(0.045, 0.055, 2.5, 6).rotateX(Math.PI / 2);
    const bandGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.22, 6)
      .rotateX(Math.PI / 2)
      .translate(0, 0, 0.62);
    const headGeo = new THREE.ConeGeometry(0.12, 0.55, 6).rotateX(Math.PI / 2).translate(0, 0, 1.5);
    this.geometries.push(shaftGeo, bandGeo, headGeo);
    const shaftMat = surfaceMat({ color: 0x6b4a2a, roughness: 0.8 });
    const bandMat = surfaceMat({ color: 0xb8301c, roughness: 0.7, emissive: 0x2a0602 });
    const headMat = surfaceMat({ color: 0xeee0c2, roughness: 0.55, emissive: 0x1c140a });
    for (let i = 0; i < SPEAR_SLOTS; i++) {
      const body = new THREE.Group();
      body.name = 'wildheart-trash-spear';
      body.visible = false;
      for (const [geo, mat] of [
        [shaftGeo, shaftMat],
        [bandGeo, bandMat],
        [headGeo, headMat],
      ] as const) {
        const m = new THREE.Mesh(geo, mat);
        m.frustumCulled = false;
        body.add(m);
      }
      root.add(body);
      const g = sprite(TRASH_ACCENTS.quarry, 0.85, 'wildheartSpearGlow');
      g.s.scale.setScalar(1.1);
      this.spears.push({ ...flight(), body, glow: g.s });
    }
    // The hex bolt: a green-gold orb round a pale core.
    for (let i = 0; i < HEX_SLOTS; i++) {
      const orb = sprite(TRASH_ACCENTS.hex, 0.9, 'wildheartHexOrb');
      orb.s.scale.setScalar(1.5);
      const core = sprite(0xf4ffd8, 1, 'wildheartHexCore');
      core.s.scale.setScalar(0.55);
      this.hexes.push({ ...flight(), orb: orb.s, core: core.s });
    }
    // The quarry sigil over the head and the claw rakes at the feet.
    const sigilTex = quarrySigilTexture();
    this.textures.push(sigilTex);
    const ringGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
    this.geometries.push(ringGeo);
    for (let i = 0; i < MARK_SLOTS; i++) {
      const s = sprite(0xffffff, 1, 'wildheartQuarrySigil', sigilTex, false);
      s.s.name = 'wildheart-quarry-sigil';
      const ringMat = huntRingMaterial(host.uTime);
      (ringMat.uniforms.uColor.value as THREE.Color).setHex(TRASH_ACCENTS.quarry);
      this.materials.push(ringMat);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.name = 'wildheart-quarry-ring';
      ring.frustumCulled = false;
      ring.visible = false;
      ring.renderOrder = floorVfxRenderOrder('encounter', 6);
      root.add(ring);
      this.marks.push({ sprite: s.s, mat: s.mat, ring, ringMat, entityId: -1 });
    }
    // The frenzies: a glow round the body and a red pool on the floor.
    const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.geometries.push(poolGeo);
    for (let i = 0; i < FRENZY_SLOTS; i++) {
      const g = sprite(TRASH_ACCENTS.blood, 0.5, 'wildheartFrenzyGlow');
      const poolMat = new THREE.MeshBasicMaterial({
        map: glowTex,
        color: TRASH_ACCENTS.blood,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        name: 'wildheartFrenzyPool',
      });
      this.materials.push(poolMat);
      const pool = new THREE.Mesh(poolGeo, poolMat);
      pool.visible = false;
      pool.renderOrder = floorVfxRenderOrder('encounter', 1);
      root.add(pool);
      this.frenzies.push({
        glow: g.s,
        glowMat: g.mat,
        pool,
        poolMat,
        entityId: -1,
        kind: 'pack',
        emit: 0,
        streak: 0,
        lastX: 0,
        lastZ: 0,
      });
    }
    // The dread skull and the red fire of its eyes behind it.
    const skullTex = dreadSkullTexture();
    this.textures.push(skullTex);
    for (let i = 0; i < SKULL_SLOTS; i++) {
      const eyes = sprite(TRASH_ACCENTS.dread, 0.6, 'wildheartDreadEyes');
      const s = sprite(0xffffff, 1, 'wildheartDreadSkull', skullTex, false);
      s.s.name = 'wildheart-dread-skull';
      this.skulls.push({
        sprite: s.s,
        mat: s.mat,
        eyes: eyes.s,
        eyesMat: eyes.mat,
        entityId: -1,
        flashAt: -1,
        emit: 0,
      });
    }
    // The tongue: thick at the mouth, tapering, a sticky pad on its tip.
    const tongueGeo = new THREE.CylinderGeometry(0.1, 0.19, 1, 10, 1, true).translate(0, 0.5, 0);
    const tipGeo = new THREE.SphereGeometry(0.3, 12, 8).scale(1, 0.8, 1);
    this.geometries.push(tongueGeo, tipGeo);
    const fleshMat = surfaceMat({ color: 0xc8566e, roughness: 0.3, emissive: 0x3a0812 });
    const padMat = surfaceMat({ color: 0xe07890, roughness: 0.25, emissive: 0x4a0c1a });
    for (let i = 0; i < TONGUE_SLOTS; i++) {
      const body = new THREE.Mesh(tongueGeo, fleshMat);
      body.name = 'wildheart-trash-tongue';
      body.frustumCulled = false;
      body.visible = false;
      const tip = new THREE.Mesh(tipGeo, padMat);
      tip.frustumCulled = false;
      tip.visible = false;
      root.add(body, tip);
      this.tongues.push({
        body,
        tip,
        casterId: -1,
        targetId: -1,
        born: 0,
        end: new THREE.Vector3(),
        retractAt: -1,
        retractFrom: 1,
        splatted: false,
        lastGap: 0,
        checkAt: 0,
      });
    }
  }

  // ------------------------------------------------------------------- events

  /** True when the event is one of the hunt's own (the renderer then skips
   *  its generic draw). Snarlbark's damage keeps its numbers (false). */
  handleEvent(ev: SimEvent): boolean {
    if (this.disposed) return false;
    if (ev.type === 'damage') {
      if (ev.ability === SNARLBARK_ABILITY && ev.kind === 'hit') this.snarlbark(ev);
      return false;
    }
    if (ev.type !== 'spellfx') return false;
    const src = this.world.entities.get(ev.sourceId);
    if (!src) return false;
    if (!ev.ability) {
      // A fallen raptor's pack snarls into its frenzy (lifecycle.ts's bare nova).
      if (ev.fx !== 'nova' || src.templateId !== BASIN_RAPTOR_ID) return false;
      this.snarl(src);
      return true;
    }
    const target = this.world.entities.get(ev.targetId);
    switch (ev.ability) {
      case WILDHEART_QUARRY_MARK:
        if (target) this.throwSpear(src, target);
        return true;
      case WILDHEART_TOAD_HEX:
        if (target) this.throwHex(src, target);
        return true;
      case WILDHEART_WAR_ROAR:
        this.roar(src);
        return true;
      case WILDHEART_RATTLING_DREAD:
        this.dread(src);
        return true;
      case WILDHEART_SNARING_TONGUE:
        this.fireTongue(src);
        return true;
      default:
        return false;
    }
  }

  private shock(x: number, z: number, s: TrashShock): void {
    this.host.shockRing(x, z, s.color, s.radius, s.seconds);
  }

  private snarl(e: Entity): void {
    // The raptor screams into its frenzy (its Screech clip).
    this.playGesture?.(e.id, RAPTOR_FRENZY_GESTURE);
    const h = trashBodyHeight(e.templateId, e.scale || 1);
    const { x, y, z } = e.pos;
    this.shock(x, z, TRASH_SHOCKS.snarl);
    this.host.puff(x, y + h * 0.7, z, 18, {
      speed: 4.5,
      up: 1.4,
      life: 0.7,
      size: [0.5, 0.12],
      color: [1, 0.3, 0.16],
      alpha: 1,
      glow: true,
      radius: h * 0.25,
    });
    this.host.puff(x, y + h * 0.55, z, 8, {
      speed: 1.6,
      up: 0.8,
      life: 1,
      size: [1.2, 2.6],
      color: [0.62, 0.12, 0.08],
      alpha: 0.4,
      radius: h * 0.3,
      drag: 2,
    });
  }

  private snarlbark(ev: Extract<SimEvent, { type: 'damage' }>): void {
    const lasher = this.world.entities.get(ev.sourceId);
    const victim = this.world.entities.get(ev.targetId);
    if (!lasher || lasher.templateId !== VINE_LASHER_ID || !victim) return;
    const { x, y, z } = victim.pos;
    const h = trashBodyHeight(victim.templateId, victim.scale || 1);
    // Bark splinters thrown off the attacker (falling), and a few green pricks.
    this.host.puff(x, y + h * 0.55, z, 10, {
      speed: 4.2,
      up: 1.6,
      life: 0.65,
      size: [0.24, 0.1],
      color: [0.42, 0.3, 0.15],
      alpha: 1,
      gravity: 9,
      drag: 0.7,
      radius: 0.35,
    });
    if (this.host.density >= 1) {
      this.host.puff(x, y + h * 0.55, z, 6, {
        speed: 3.4,
        life: 0.35,
        size: [0.2, 0.05],
        color: [0.7, 1, 0.38],
        alpha: 0.9,
        glow: true,
        radius: 0.3,
      });
    }
  }

  /** The hand a spear or a hex leaves from, written into `out`. */
  private handPoint(out: THREE.Vector3, e: Entity): THREE.Vector3 {
    const h = trashBodyHeight(e.templateId, e.scale || 1);
    return out.set(
      e.pos.x + Math.sin(e.facing) * h * THROW_HAND.forward,
      e.pos.y + h * THROW_HAND.up,
      e.pos.z + Math.cos(e.facing) * h * THROW_HAND.forward,
    );
  }

  private chestPoint(out: THREE.Vector3, e: Entity): THREE.Vector3 {
    const h = trashBodyHeight(e.templateId, e.scale || 1);
    return out.set(e.pos.x, e.pos.y + h * 0.55, e.pos.z);
  }

  private launch(slot: Flight, src: Entity, target: Entity, speed: number): void {
    this.handPoint(slot.from, src);
    this.chestPoint(slot.to, target);
    const d = slot.from.distanceTo(slot.to);
    slot.alive = true;
    slot.born = this.clock;
    slot.flight = projectileFlight(d, speed);
    slot.apex = speed === SPEAR_SPEED ? spearApex(d) : 0.3;
    slot.targetId = target.id;
    slot.trail = 0;
  }

  private throwSpear(src: Entity, target: Entity): void {
    const s = freeFlight(this.spears);
    this.launch(s, src, target, SPEAR_SPEED);
    s.body.visible = true;
    s.glow.visible = true;
  }

  private throwHex(src: Entity, target: Entity): void {
    const s = freeFlight(this.hexes);
    this.launch(s, src, target, HEX_BOLT_SPEED);
    s.orb.visible = true;
    s.core.visible = true;
    // The hex takes them at once (the aura lands with this event): the
    // smoke covers the body turning into a toad.
    this.hexSmoke(target);
  }

  /** The green-gold smoke of the toad hex (landing and breaking). */
  private hexSmoke(e: Entity): void {
    const { x, y, z } = e.pos;
    this.shock(x, z, TRASH_SHOCKS.hex);
    this.host.puff(x, y + 1, z, 26, {
      speed: 2.2,
      up: 1.3,
      life: 1.3,
      size: [1.1, 3.2],
      color: [0.56, 0.72, 0.22],
      alpha: 0.55,
      radius: 0.7,
      drag: 2.2,
    });
    this.host.puff(x, y + 1.1, z, 14, {
      speed: 3,
      up: 1.6,
      life: 0.8,
      size: [0.38, 0.1],
      color: [0.88, 1, 0.45],
      alpha: 1,
      glow: true,
      radius: 0.5,
    });
  }

  private roar(e: Entity): void {
    const h = trashBodyHeight(e.templateId, e.scale || 1);
    const { x, y, z } = e.pos;
    const gy = this.host.groundY(x, z);
    this.shock(x, z, TRASH_SHOCKS.roar);
    // The ground torn up round it, and the roar's red breath out of its maw.
    this.host.puff(x, gy + 0.3, z, 44, {
      speed: 9,
      up: 1.2,
      life: 0.95,
      size: [1.1, 3],
      color: [0.62, 0.48, 0.32],
      alpha: 0.6,
      radius: 1.6,
      drag: 2.6,
      dir: [0, 0.15, 0],
      spread: 1,
    });
    const fx = Math.sin(e.facing);
    const fz = Math.cos(e.facing);
    this.host.puff(x + fx * h * 0.25, y + h * 0.82, z + fz * h * 0.25, 22, {
      speed: 7,
      life: 0.75,
      size: [0.9, 2.6],
      color: [0.9, 0.18, 0.12],
      alpha: 0.5,
      dir: [fx, 0.15, fz],
      spread: 0.45,
      drag: 2,
    });
    this.host.puff(x, y + h * 0.75, z, 20, {
      speed: 5,
      up: 2,
      life: 0.9,
      size: [0.45, 0.1],
      color: [1, 0.36, 0.18],
      alpha: 1,
      glow: true,
      radius: h * 0.2,
    });
    if (!this.host.reducedMotion()) this.host.shake(0.22);
  }

  private dread(e: Entity): void {
    const h = trashBodyHeight(e.templateId, e.scale || 1);
    const { x, y, z } = e.pos;
    this.shock(x, z, TRASH_SHOCKS.dread);
    const top = y + h + 1;
    // The rattle: bone shards flung out and falling, dark red smoke, sparks.
    this.host.puff(x, top - 0.6, z, 26, {
      speed: 8,
      up: 2,
      life: 1,
      size: [0.28, 0.14],
      color: [0.92, 0.86, 0.7],
      alpha: 1,
      gravity: 10,
      drag: 0.6,
      radius: 0.6,
    });
    this.host.puff(x, top - 0.4, z, 18, {
      speed: 2.6,
      up: 0.8,
      life: 1.3,
      size: [1.4, 3.6],
      color: [0.32, 0.04, 0.06],
      alpha: 0.55,
      radius: 0.8,
      drag: 2,
    });
    this.host.puff(x, top, z, 16, {
      speed: 5,
      life: 0.6,
      size: [0.4, 0.1],
      color: [1, 0.22, 0.26],
      alpha: 1,
      glow: true,
      radius: 0.5,
    });
    for (const s of this.skulls) if (s.entityId === e.id) s.flashAt = this.clock;
  }

  private fireTongue(toad: Entity): void {
    // The lane the sim tested: the yaw it locked (and held) at the bar's start.
    const yaw = toad.facing;
    tongueCatchInto(this.caught, toad.pos, yaw, this.world.entities.values());
    if (this.caught.length === 0) {
      const s = this.claimTongue(toad.id, -1);
      if (!s) return;
      const len = this.specs[WILDHEART_SNARING_TONGUE]?.range ?? 0;
      const ex = toad.pos.x + Math.sin(yaw) * len;
      const ez = toad.pos.z + Math.cos(yaw) * len;
      s.end.set(ex, this.host.groundY(ex, ez) + 1.3, ez);
      return;
    }
    for (const id of this.caught) this.claimTongue(toad.id, id);
  }

  /** A tongue for (toad, player): the one already out to them if the toad
   *  fires again before it lets go, else a free one. The pool holds every
   *  toad's whole party (TRASH_FX_POOLS.tongues), so a caught player always
   *  gets theirs. */
  private claimTongue(casterId: number, targetId: number): TongueSlot | null {
    let s: TongueSlot | null = null;
    let free: TongueSlot | null = null;
    for (const t of this.tongues) {
      if (t.casterId === casterId && t.targetId === targetId) {
        s = t;
        break;
      }
      if (!free && t.casterId < 0) free = t;
    }
    s ??= free;
    if (!s) return null;
    s.casterId = casterId;
    s.targetId = targetId;
    s.born = this.clock;
    s.retractAt = -1;
    s.retractFrom = 1;
    s.splatted = false;
    s.lastGap = Number.POSITIVE_INFINITY;
    s.checkAt = this.clock + TONGUE_SHOOT_SECONDS + 0.3;
    s.body.visible = true;
    s.tip.visible = true;
    return s;
  }

  // ------------------------------------------------------------------- scan

  beginScan(): void {
    this.chasers.length = 0;
    this.toadsNext.length = 0;
    this.totemsNext.length = 0;
  }

  /** Claim what this entity needs; true when it is the hunt at work. */
  scanEntity(e: Entity): boolean {
    if (e.dead) return false;
    let hunt = false;
    const auras = e.auras;
    for (let i = 0; i < auras.length; i++) {
      const id = auras[i].id;
      if (id === WILDHEART_QUARRY) {
        this.claimMark(e);
        hunt = true;
      } else if (id === WILDHEART_ROAR_FRENZY && e.templateId === RAVAGER_ID) {
        this.claimFrenzy(e, 'roar');
        hunt = true;
      } else if (id === RAPTOR_PACK_FRENZY_AURA && e.templateId === BASIN_RAPTOR_ID) {
        this.claimFrenzy(e, 'pack');
        hunt = true;
      } else if (id === WILDHEART_TOADED && e.kind === 'player') {
        this.toadsNext.push(e.id);
        hunt = true;
      }
    }
    if (e.kind !== 'mob') return hunt;
    if (e.templateId === SUNBONE_DREAD_TOTEM_ID) {
      this.claimSkull(e);
      hunt = true;
    }
    if (isSunboneTotem(e.templateId)) {
      this.totemsNext.push(e.id);
      if (!this.totemsSeen.includes(e.id)) this.riseTotem(e.id);
    }
    if (e.templateId === BASIN_RAPTOR_ID && e.forcedTargetId !== null) this.chasers.push(e.id);
    const castId = e.castingAbility;
    const spec = castId ? this.specs[castId] : undefined;
    if (castId && spec) {
      this.claimCast(e, castId, spec);
      hunt = true;
    }
    return hunt;
  }

  endScan(): void {
    // The raptors a quarry mark sent: they streak orange while they run it down.
    for (const id of this.chasers) {
      const r = this.world.entities.get(id);
      const quarry =
        r && r.forcedTargetId !== null ? this.world.entities.get(r.forcedTargetId) : undefined;
      if (r && quarry && !quarry.dead && findAura(quarry, WILDHEART_QUARRY)) {
        this.claimFrenzy(r, 'hunt');
      }
    }
    // A toad that is no longer one: the hex broke (or ran out), smoke again.
    for (const id of this.toads) {
      if (this.toadsNext.includes(id)) continue;
      const p = this.world.entities.get(id);
      if (p && !p.dead) this.hexSmoke(p);
    }
    const prev = this.toads;
    this.toads = this.toadsNext;
    this.toadsNext = prev;
    const seen = this.totemsSeen;
    this.totemsSeen = this.totemsNext;
    this.totemsNext = seen;
    // A totem just planted rises out of the ground (offered a few times, in
    // case its view is built a beat late; the rig plays it once).
    for (const r of this.rising) {
      if (r.until < this.clock) continue;
      const e = this.world.entities.get(r.id);
      if (!e || e.dead) r.until = -1;
      else this.playGesture?.(r.id, TOTEM_RISE_GESTURE);
    }
  }

  // The 10 Hz scan's claims: plain loops (no closure per entity per scan).

  private claimCast(e: Entity, castId: string, spec: TrashCastSpec): void {
    if (spec.shape === 'lane') {
      const lane = claimable(this.lanes, e.id);
      if (lane) {
        lane.casterId = e.id;
        lane.group.visible = true;
      }
    } else {
      const r = claimableCast(this.rings, e.id, castId);
      if (r) {
        this.host.kit.layOutFan(r, 360, { color: spec.color, accent: spec.accent });
        r.casterId = e.id;
        r.castId = castId;
      }
    }
    if (!spec.kick) return;
    const k = claimableCast(this.kicks, e.id, castId);
    if (!k) return;
    this.host.kit.layOutFan(k, 360, {
      color: TELEGRAPH_THREAT_COLORS.interrupt,
      accent: spec.accent,
      sigil: true,
    });
    k.casterId = e.id;
    k.castId = castId;
    k.group.visible = true;
  }

  private claimMark(e: Entity): void {
    let m: MarkSlot | null = null;
    for (const s of this.marks) {
      if (s.entityId === e.id) return;
      if (!m && s.entityId < 0) m = s;
    }
    if (!m) return;
    m.entityId = e.id;
    // The rakes at the feet show at once (the sim marks at the landing); the
    // sigil waits for the spear (paintMarks).
    m.ring.visible = true;
    m.sprite.visible = !this.spearInFlightTo(e.id);
  }

  private claimFrenzy(e: Entity, kind: FrenzyKind): void {
    let f: FrenzySlot | null = null;
    for (const s of this.frenzies) {
      if (s.entityId === e.id && s.kind === kind) return;
      if (!f && s.entityId < 0) f = s;
    }
    if (!f) return;
    f.entityId = e.id;
    f.kind = kind;
    f.emit = 0;
    f.streak = 0;
    f.lastX = e.pos.x;
    f.lastZ = e.pos.z;
    const color = kind === 'hunt' ? TRASH_ACCENTS.quarry : TRASH_ACCENTS.blood;
    f.glowMat.color.setHex(color);
    f.poolMat.color.setHex(color);
    f.glow.visible = true;
    // The chasers keep the floor to the quarry's rakes; the frenzied pool red.
    f.pool.visible = kind !== 'hunt';
  }

  private riseTotem(id: number): void {
    const slot = this.rising.find((r) => r.until < this.clock) ?? this.rising[0];
    slot.id = id;
    slot.until = this.clock + TOTEM_RISE_WINDOW;
    this.playGesture?.(id, TOTEM_RISE_GESTURE);
  }

  private claimSkull(e: Entity): void {
    let s: SkullSlot | null = null;
    for (const x of this.skulls) {
      if (x.entityId === e.id) return;
      if (!s && x.entityId < 0) s = x;
    }
    if (!s) return;
    s.entityId = e.id;
    s.flashAt = -1;
    s.emit = 0;
    s.sprite.visible = true;
    s.eyes.visible = true;
  }

  // ------------------------------------------------------------------- frame

  update(dt: number, clock: number): void {
    if (this.disposed) return;
    this.clock = clock;
    const world = this.world;
    this.paintRings(world);
    this.paintKicks(world);
    this.paintLanes(world);
    this.paintSpears(world, dt);
    this.paintHexes(world, dt);
    this.paintMarks(world);
    this.paintFrenzies(world, dt);
    this.paintSkulls(world, dt);
    this.paintTongues(world, dt);
    this.paintToads(world, dt);
  }

  /** A projectile or a tongue is still out (keeps the basin painting). */
  busy(): boolean {
    for (const s of this.spears) if (s.alive) return true;
    for (const s of this.hexes) if (s.alive) return true;
    for (const t of this.tongues) if (t.casterId >= 0) return true;
    return false;
  }

  private castFill(caster: Entity): number {
    return basinCastFill(caster.castRemaining, caster.castTotal);
  }

  private paintRings(world: IWorld): void {
    const p = this.paint;
    for (const slot of this.rings) {
      if (slot.casterId < 0) continue;
      const caster = world.entities.get(slot.casterId);
      const spec = this.specs[slot.castId];
      if (!caster || caster.dead || caster.castingAbility !== slot.castId || !spec) {
        slot.casterId = -1;
        slot.group.visible = false;
        continue;
      }
      const at =
        spec.anchor === 'target' && caster.castTargetId !== null
          ? world.entities.get(caster.castTargetId)
          : spec.anchor === 'caster'
            ? caster
            : undefined;
      if (!at || at.dead) {
        slot.group.visible = false;
        continue;
      }
      slot.group.visible = true;
      const { x, z } = at.pos;
      this.host.kit.drapeFan(slot, this.host.groundY, x, this.host.groundY(x, z), z, 0, spec.range);
      p.fill = this.castFill(caster);
      p.clock = this.clock;
      p.range = spec.range;
      this.host.kit.paintFan(slot, p);
    }
  }

  private paintKicks(world: IWorld): void {
    const p = this.paint;
    for (const slot of this.kicks) {
      if (slot.casterId < 0) continue;
      const caster = world.entities.get(slot.casterId);
      if (!caster || caster.dead || caster.castingAbility !== slot.castId) {
        slot.casterId = -1;
        slot.group.visible = false;
        continue;
      }
      const { x, z } = caster.pos;
      this.host.kit.drapeFan(
        slot,
        this.host.groundY,
        x,
        this.host.groundY(x, z),
        z,
        this.clock * 1.4,
        KICK_GLYPH_RADIUS,
      );
      p.fill = this.castFill(caster);
      p.clock = this.clock;
      p.range = KICK_GLYPH_RADIUS;
      this.host.kit.paintFan(slot, p);
    }
  }

  private paintLanes(world: IWorld): void {
    const spec = this.specs[WILDHEART_SNARING_TONGUE];
    const p = this.paint;
    for (const slot of this.lanes) {
      if (slot.casterId < 0) continue;
      const caster = world.entities.get(slot.casterId);
      if (!caster || caster.dead || caster.castingAbility !== WILDHEART_SNARING_TONGUE || !spec) {
        slot.casterId = -1;
        slot.group.visible = false;
        continue;
      }
      // The sim locks the aim at the bar's start and holds the caster's facing
      // to it (support.ts holdLineAim): the facing IS the locked lane.
      const { x, z } = caster.pos;
      this.style.color = spec.color;
      this.style.accent = spec.accent;
      this.host.kit.drapeLane(
        slot,
        this.host.groundY,
        x,
        this.host.groundY(x, z),
        z,
        caster.facing,
        spec.range,
        spec.halfWidth,
        this.style,
      );
      p.fill = this.castFill(caster);
      p.clock = this.clock;
      p.range = spec.range;
      this.host.kit.paintLane(slot, p);
    }
  }

  /** Advance a flight: false once it has landed (the slot is then free). */
  private fly(slot: Flight, world: IWorld): boolean {
    const target = world.entities.get(slot.targetId);
    // Home on the target's live chest until it lands.
    if (target && !target.dead) this.chestPoint(slot.to, target);
    const u = (this.clock - slot.born) / Math.max(1e-3, slot.flight);
    if (u >= 1) {
      slot.alive = false;
      return false;
    }
    seedArcInto(this.arc, slot.from, slot.to, u, slot.apex);
    return true;
  }

  private paintSpears(world: IWorld, dt: number): void {
    for (const s of this.spears) {
      if (!s.alive) continue;
      if (!this.fly(s, world)) {
        s.body.visible = false;
        s.glow.visible = false;
        // The spear strikes home: splinters of bone and war-paint sparks.
        const { x, y, z } = s.to;
        this.host.puff(x, y, z, 16, {
          speed: 5,
          up: 1,
          life: 0.6,
          size: [0.4, 0.1],
          color: [1, 0.55, 0.2],
          alpha: 1,
          glow: true,
          radius: 0.3,
        });
        this.host.puff(x, y, z, 8, {
          speed: 4,
          up: 1.4,
          life: 0.7,
          size: [0.22, 0.1],
          color: [0.9, 0.84, 0.68],
          alpha: 1,
          gravity: 9,
          radius: 0.25,
        });
        continue;
      }
      const { x, y, z } = this.arc;
      s.body.position.set(x, y, z);
      // Point it down its own arc: a little further along.
      const ahead = (this.clock + 0.02 - s.born) / Math.max(1e-3, s.flight);
      seedArcInto(this.arc, s.from, s.to, Math.min(1, ahead), s.apex);
      this.tmpA.set(this.arc.x, this.arc.y, this.arc.z);
      if (this.tmpA.distanceToSquared(s.body.position) > 1e-8) s.body.lookAt(this.tmpA);
      s.glow.position.set(x, y, z);
      // A streak of hot paint dust off the shaft (cosmetic: thins with the
      // density, a steady rate whatever the frame rate).
      s.trail += dt * SPEAR_TRAIL_RATE * this.host.density;
      while (s.trail >= 1) {
        s.trail -= 1;
        const m = this.trailMote;
        m.color[0] = 1;
        m.color[1] = 0.62;
        m.color[2] = 0.28;
        m.size[0] = 0.55;
        m.size[1] = 0.12;
        this.host.puff(x, y, z, 1, m);
      }
    }
  }

  private paintHexes(world: IWorld, dt: number): void {
    for (const s of this.hexes) {
      if (!s.alive) continue;
      if (!this.fly(s, world)) {
        s.orb.visible = false;
        s.core.visible = false;
        const { x, y, z } = s.to;
        this.host.puff(x, y, z, 12, {
          speed: 4,
          life: 0.5,
          size: [0.5, 0.12],
          color: [0.88, 1, 0.5],
          alpha: 1,
          glow: true,
          radius: 0.3,
        });
        continue;
      }
      const { x, y, z } = this.arc;
      const wobble = 0.12 * Math.sin(this.clock * 40);
      s.orb.position.set(x, y + wobble, z);
      s.core.position.set(x, y + wobble, z);
      s.orb.scale.setScalar(1.3 + 0.3 * Math.sin(this.clock * 30));
      // The hex's green shimmer behind it (cosmetic, as the spear's).
      s.trail += dt * HEX_TRAIL_RATE * this.host.density;
      while (s.trail >= 1) {
        s.trail -= 1;
        const m = this.trailMote;
        m.color[0] = 0.7;
        m.color[1] = 0.95;
        m.color[2] = 0.32;
        m.size[0] = 0.7;
        m.size[1] = 0.12;
        this.host.puff(x, y, z, 1, m);
      }
    }
  }

  private paintMarks(world: IWorld): void {
    for (const m of this.marks) {
      if (m.entityId < 0) continue;
      const e = world.entities.get(m.entityId);
      const aura = e && !e.dead ? findAura(e, WILDHEART_QUARRY) : undefined;
      if (!e || !aura) {
        m.entityId = -1;
        m.sprite.visible = false;
        m.ring.visible = false;
        continue;
      }
      const look = quarryMarkLookInto(this.markLook, aura.remaining, aura.duration, this.clock);
      // The claw rakes at their feet from the moment the quarry wears the
      // mark (the sim applies it at the landing): the quarry read from any
      // angle, the raptors already on their way.
      m.ring.visible = true;
      m.ring.position.set(e.pos.x, this.host.groundY(e.pos.x, e.pos.z) + 0.08, e.pos.z);
      m.ring.scale.setScalar(1.6 + 0.3 * look.size);
      m.ringMat.uniforms.uAlpha.value = look.alpha;
      // Only the painted sigil overhead waits for the spear to strike home.
      const inFlight = this.spearInFlightTo(e.id);
      m.sprite.visible = !inFlight;
      if (inFlight) continue;
      const h = trashBodyHeight(e.templateId, e.scale || 1);
      m.sprite.position.set(e.pos.x, e.pos.y + h + 1.3, e.pos.z);
      m.sprite.scale.setScalar(look.size * 1.35);
      m.mat.opacity = look.alpha;
    }
  }

  private spearInFlightTo(id: number): boolean {
    for (const s of this.spears) if (s.alive && s.targetId === id) return true;
    return false;
  }

  private paintFrenzies(world: IWorld, dt: number): void {
    const mote = this.mote;
    for (const f of this.frenzies) {
      if (f.entityId < 0) continue;
      const e = world.entities.get(f.entityId);
      if (!e || e.dead || !frenzyHolds(world, e, f.kind)) {
        f.entityId = -1;
        f.glow.visible = false;
        f.pool.visible = false;
        continue;
      }
      const h = trashBodyHeight(e.templateId, e.scale || 1);
      const { x, y, z } = e.pos;
      const k = frenzyGlow(f.kind, this.clock);
      const big = f.kind === 'roar' ? 1.25 : 1;
      f.glow.position.set(x, y + h * 0.55, z);
      f.glow.scale.setScalar(h * 1.45 * big * (0.85 + 0.15 * k));
      f.glowMat.opacity = (f.kind === 'hunt' ? 0.28 : 0.42) * k;
      if (f.kind !== 'hunt') {
        f.pool.position.set(x, this.host.groundY(x, z) + 0.12, z);
        f.pool.rotation.y = e.facing;
        f.pool.scale.set(h * 1.4 * big * k, 1, h * 1.9 * big * k);
        f.poolMat.opacity = 0.5 * k;
      }
      // Streaks tearing off it while it runs; embers (and red steam off the
      // roused ravagers) while it holds. Cosmetic: thin with the density.
      const moved = Math.hypot(x - f.lastX, z - f.lastZ);
      f.lastX = x;
      f.lastZ = z;
      if (moved > 0.02) f.streak += dt * 38 * this.host.density;
      while (f.streak >= 1) {
        f.streak -= 1;
        const m = this.trailMote;
        const hot = f.kind === 'hunt';
        m.color[0] = 1;
        m.color[1] = hot ? 0.55 : 0.24;
        m.color[2] = hot ? 0.18 : 0.14;
        m.size[0] = 1.1;
        m.size[1] = 0.2;
        this.host.puff(x, y + h * (0.45 + 0.25 * this.host.rand()), z, 1, m);
      }
      if (f.kind === 'hunt') continue;
      f.emit += dt * (f.kind === 'roar' ? 16 : 10) * this.host.density;
      while (f.emit >= 1) {
        f.emit -= 1;
        const steam = f.kind === 'roar' && this.host.rand() < 0.4;
        mote.speed = steam ? 1 : 1.4;
        mote.up = steam ? 2.2 : 2.8;
        mote.life = steam ? 1.6 : 1.1;
        mote.size = steam ? STEAM_SIZE : EMBER_SIZE;
        mote.color[0] = steam ? 0.82 : 1;
        mote.color[1] = steam ? 0.22 : 0.38;
        mote.color[2] = steam ? 0.16 : 0.16;
        mote.alpha = steam ? 0.3 : 1;
        mote.glow = !steam;
        mote.radius = h * 0.28;
        this.host.puff(x, y + h * (0.5 + 0.35 * this.host.rand()), z, 1, mote);
      }
    }
  }

  private paintSkulls(world: IWorld, dt: number): void {
    for (const s of this.skulls) {
      if (s.entityId < 0) continue;
      const e = world.entities.get(s.entityId);
      if (!e || e.dead) {
        s.entityId = -1;
        s.sprite.visible = false;
        s.eyes.visible = false;
        continue;
      }
      const fill = e.castingAbility === WILDHEART_RATTLING_DREAD ? this.castFill(e) : 0;
      const look = dreadSkullLookInto(this.skullLook, fill, this.clock);
      const flashT = s.flashAt >= 0 ? (this.clock - s.flashAt) / SKULL_FLASH_SECONDS : 1;
      const flash = flashT < 1 ? 1 - flashT : 0;
      const h = trashBodyHeight(e.templateId, e.scale || 1);
      const y = e.pos.y + h + 1.1 + 0.15 * Math.sin(this.clock * 1.7);
      const size = look.size * (1 + 0.45 * flash);
      s.sprite.position.set(e.pos.x, y, e.pos.z);
      s.sprite.scale.setScalar(size * 1.5);
      s.mat.opacity = look.alpha;
      s.eyes.position.set(e.pos.x, y, e.pos.z);
      s.eyes.scale.setScalar(size * 1.9);
      s.eyesMat.opacity = Math.min(1, 0.5 * look.eyes + 0.6 * flash);
      // Red motes drifting off its eyes, quicker as the dread builds.
      s.emit += dt * (3 + 14 * fill) * this.host.density;
      const mote = this.mote;
      while (s.emit >= 1) {
        s.emit -= 1;
        mote.speed = 0.6;
        mote.up = 0.9;
        mote.life = 1.2;
        mote.size = EMBER_SIZE;
        mote.color[0] = 1;
        mote.color[1] = 0.2;
        mote.color[2] = 0.24;
        mote.alpha = 1;
        mote.glow = true;
        mote.radius = 0.5;
        this.host.puff(e.pos.x, y, e.pos.z, 1, mote);
      }
    }
  }

  private paintTongues(world: IWorld, dt: number): void {
    const hold = tongueHoldLimit();
    for (const t of this.tongues) {
      if (t.casterId < 0) continue;
      const toad = world.entities.get(t.casterId);
      if (!toad || toad.dead || toad.templateId !== SPORE_TOAD_ID) {
        this.releaseTongue(t);
        continue;
      }
      const mouth = toadMouthInto(this.mouth, toad.pos, toad.facing, toad.scale || 1);
      const target = t.targetId >= 0 ? world.entities.get(t.targetId) : undefined;
      const end = this.tmpB;
      if (target && !target.dead) this.chestPoint(end, target);
      else end.copy(t.end);
      const elapsed = this.clock - t.born;
      const shot = tongueShot(elapsed);
      // Hold while it reels; let go once in, stalled, lost or over its time.
      if (t.retractAt < 0 && shot >= 1) {
        const gap = Math.hypot(end.x - toad.pos.x, end.z - toad.pos.z);
        const lost = t.targetId >= 0 && (!target || target.dead);
        let letGo = lost || elapsed > hold || t.targetId < 0;
        if (!letGo && tongueReeledIn(gap)) letGo = true;
        if (!letGo && this.clock >= t.checkAt) {
          if (t.lastGap - gap < 0.4) letGo = true;
          t.lastGap = gap;
          t.checkAt = this.clock + 0.3;
        }
        if (!t.splatted) {
          t.splatted = true;
          this.host.puff(end.x, end.y, end.z, 10, {
            speed: 3,
            up: 0.8,
            life: 0.6,
            size: [0.3, 0.12],
            color: [0.92, 0.6, 0.66],
            alpha: 0.9,
            gravity: 7,
            radius: 0.3,
          });
        }
        if (letGo) {
          t.retractAt = this.clock + (t.targetId < 0 ? 0.08 : 0);
          t.retractFrom = 1;
        }
      }
      let reach = shot;
      if (t.retractAt >= 0 && this.clock >= t.retractAt) {
        const r = (this.clock - t.retractAt) / TONGUE_RETRACT_SECONDS;
        if (r >= 1) {
          this.releaseTongue(t);
          continue;
        }
        reach = t.retractFrom * (1 - r) ** 2;
      }
      const from = this.tmpA.set(mouth.x, mouth.y, mouth.z);
      end.sub(from);
      const len = end.length() * reach;
      if (len < 1e-3) {
        t.body.visible = false;
        t.tip.visible = false;
        continue;
      }
      end.normalize();
      t.body.visible = true;
      t.tip.visible = true;
      t.body.position.copy(from);
      t.body.quaternion.setFromUnitVectors(this.up, end);
      // A wet throb down its length while it hauls.
      const thick = 1 + 0.12 * Math.sin(this.clock * 26 - len);
      t.body.scale.set(thick, len, thick);
      t.tip.position.copy(from).addScaledVector(end, len);
      // A drip off it now and then (cosmetic).
      if (this.host.rand() < dt * 6 * this.host.density) {
        const k = this.host.rand();
        const m = this.mote;
        m.speed = 0.2;
        m.up = 0;
        m.life = 0.7;
        m.size = DRIP_SIZE;
        m.color[0] = 0.9;
        m.color[1] = 0.62;
        m.color[2] = 0.7;
        m.alpha = 0.85;
        m.glow = false;
        m.radius = 0;
        m.gravity = 9;
        this.host.puff(
          from.x + end.x * len * k,
          from.y + end.y * len * k,
          from.z + end.z * len * k,
          1,
          m,
        );
        m.gravity = 0;
      }
    }
  }

  private releaseTongue(t: TongueSlot): void {
    t.casterId = -1;
    t.targetId = -1;
    t.body.visible = false;
    t.tip.visible = false;
  }

  /** A faint green-gold shimmer round every toad while the hex holds. */
  private paintToads(world: IWorld, dt: number): void {
    const n = dt * 7 * this.host.density;
    for (const id of this.toads) {
      if (this.host.rand() >= n) continue;
      const p = world.entities.get(id);
      if (!p || p.dead) continue;
      const m = this.mote;
      m.speed = 0.5;
      m.up = 1;
      m.life = 1;
      m.size = EMBER_SIZE;
      m.color[0] = 0.8;
      m.color[1] = 1;
      m.color[2] = 0.42;
      m.alpha = 0.9;
      m.glow = true;
      m.radius = 0.6;
      this.host.puff(p.pos.x, p.pos.y + 0.6, p.pos.z, 1, m);
    }
  }

  /** Out of the basin: nothing stands frozen where the fight left it. */
  hideAll(): void {
    for (const s of this.rings) {
      s.casterId = -1;
      s.group.visible = false;
    }
    for (const s of this.kicks) {
      s.casterId = -1;
      s.group.visible = false;
    }
    for (const l of this.lanes) {
      l.casterId = -1;
      l.group.visible = false;
    }
    for (const s of this.spears) {
      s.alive = false;
      s.body.visible = false;
      s.glow.visible = false;
    }
    for (const s of this.hexes) {
      s.alive = false;
      s.orb.visible = false;
      s.core.visible = false;
    }
    for (const m of this.marks) {
      m.entityId = -1;
      m.sprite.visible = false;
      m.ring.visible = false;
    }
    for (const f of this.frenzies) {
      f.entityId = -1;
      f.glow.visible = false;
      f.pool.visible = false;
    }
    for (const s of this.skulls) {
      s.entityId = -1;
      s.sprite.visible = false;
      s.eyes.visible = false;
    }
    for (const t of this.tongues) this.releaseTongue(t);
    this.toads.length = 0;
  }

  /** Releases what this fx minted (its geometries, its own materials and
   *  textures; never the surfaceMat cache's surfaces, never the host kit's
   *  fans). Best effort: one throwing release never strands the rest, the
   *  failures surface together as one AggregateError. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    const attempt = (release: () => void): void => {
      try {
        release();
      } catch (e) {
        errors.push(e);
      }
    };
    for (const g of this.geometries) attempt(() => g.dispose());
    for (const m of this.materials) attempt(() => m.dispose());
    for (const t of this.textures) attempt(() => t.dispose());
    if (errors.length > 0) throw new AggregateError(errors, 'BasinTrashFx dispose');
  }
}

const EMBER_SIZE = [0.3, 0.08] as const;
const DRIP_SIZE = [0.16, 0.1] as const;
const STEAM_SIZE = [1.4, 3.6] as const;

function flight(): Flight {
  return {
    alive: false,
    born: 0,
    flight: 1,
    apex: 0,
    targetId: -1,
    from: new THREE.Vector3(),
    to: new THREE.Vector3(),
    trail: 0,
  };
}

/** A free flight slot, else the first (a new throw takes over the oldest
 *  pooled one; the pool holds the worst pull's throwers). */
function freeFlight<T extends Flight>(slots: readonly T[]): T {
  for (const s of slots) if (!s.alive) return s;
  return slots[0];
}

/** A free slot for a caster that holds none yet (null when it already holds
 *  one, or the pool is full). */
function claimable<T extends { casterId: number }>(
  slots: readonly T[],
  casterId: number,
): T | null {
  let free: T | null = null;
  for (const s of slots) {
    if (s.casterId === casterId) return null;
    if (!free && s.casterId < 0) free = s;
  }
  return free;
}

/** As claimable, keyed on the caster and its cast. */
function claimableCast<T extends { casterId: number; castId: string }>(
  slots: readonly T[],
  casterId: number,
  castId: string,
): T | null {
  let free: T | null = null;
  for (const s of slots) {
    if (s.casterId === casterId && s.castId === castId) return null;
    if (!free && s.casterId < 0) free = s;
  }
  return free;
}

/** The aura on the entity (a loop: no per-frame closure). */
function findAura(e: { auras?: readonly Aura[] }, id: string): Aura | undefined {
  const auras = e.auras;
  if (!auras) return undefined;
  for (let i = 0; i < auras.length; i++) if (auras[i].id === id) return auras[i];
  return undefined;
}

/** Does the frenzy a slot dresses still hold on its bearer? */
function frenzyHolds(world: IWorld, e: Entity, kind: FrenzyKind): boolean {
  if (kind === 'pack') return !!findAura(e, RAPTOR_PACK_FRENZY_AURA);
  if (kind === 'roar') return !!findAura(e, WILDHEART_ROAR_FRENZY);
  const quarry = e.forcedTargetId !== null ? world.entities.get(e.forcedTargetId) : undefined;
  return !!quarry && !quarry.dead && !!findAura(quarry, WILDHEART_QUARRY);
}
