// Pure plan for the trash engine's visuals (trash_engine_fx.ts and its
// layers): which encounter objects the engine draws (hazard pools, combat
// walls, walker orbs) and how each looks, every number read back from the sim's
// own kit records (MOBS[t].trashKit, the dev demo kit, COMBAT_WALL_SHAPES,
// DungeonDef.quenchZones), so the edge a player reads is the edge the sim
// tests; the line-of-sight nova's sight reach per ray (a bisection over the
// sim's own sight test, injected), its wave and fill; the usable body's hint;
// the freeze stacks' rime and the ice encase timeline; the brand's flicker;
// the quench pools' world placement; the walker orb's display smoothing.
//
// Three-free, DOM-free, deterministic.

import { DUNGEONS, instanceOrigin, MOBS } from '../../sim/data';
import { BOUND_SOUL_WALKER } from '../../sim/encounters/hollow_crypt/morthen_gravecall';
import { MORTHEN_SOUL_TEMPLATE } from '../../sim/encounters/hollow_crypt/morthen_ids';
import { COMBAT_WALL_SHAPES } from '../../sim/instances/combat_wall_state';
import { BASTION_THROATLIGHT_ORB } from '../../sim/mob/trash_kit/bastion_cast_ids';
import { TRASH_ENGINE_DEMO_KIT } from '../../sim/mob/trash_kit/engine_demo';
import {
  SANCTUM_BOILING_MELTWATER,
  SANCTUM_SPILLED_SOULFIRE,
} from '../../sim/mob/trash_kit/sanctum_cast_ids';
import { TEMPLE_HEARTPEARL_ORB } from '../../sim/mob/trash_kit/temple_cast_ids';
import type {
  Aura,
  FreezeStackDef,
  KitHazardDef,
  KitUseDef,
  KitWalkerDef,
  TrashKitDef,
} from '../../sim/types';
import { TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';
import { BOUND_SOUL_LOOK } from '../hollow_crypt/morthen_rite_fx_core';

export type KitSchool = Aura['school'];
export type KitNovaDef = NonNullable<TrashKitDef['nova']>;

// ---- the catalog ---------------------------------------------------------------

/** Every engine record the renderer keys on, swept from the kits. */
export interface EngineCatalog {
  /** Hazard pools by their object template. */
  hazards: ReadonlyMap<string, KitHazardDef>;
  /** Walker orbs by their object template, and by their launch cast id. */
  walkers: ReadonlyMap<string, KitWalkerDef>;
  walkerCasts: ReadonlyMap<string, KitWalkerDef>;
  /** Walker empower auras (the ally, or the player who took the orb). */
  empowerAuras: ReadonlyMap<string, KitWalkerDef>;
  /** Novas by cast id (both the kickable and the unstoppable ids). */
  novas: ReadonlyMap<string, KitNovaDef>;
  /** Freeze stacks by their slow aura id, and by their freeze (stun) id. */
  freezeStacks: ReadonlyMap<string, FreezeStackDef>;
  freezeAuras: ReadonlyMap<string, FreezeStackDef>;
  /** Brand dot aura ids. */
  brandAuras: ReadonlySet<string>;
  /** Usable bodies' uses by their cast id. */
  uses: ReadonlyMap<string, KitUseDef>;
  /** Seconds a combat wall template stands (its leavesWall record). */
  wallSeconds: ReadonlyMap<string, number>;
}

/** Sweep a set of kits into the catalog (later kits never override earlier). */
export function buildEngineCatalog(
  kits: Iterable<TrashKitDef>,
  encounterWalkers: Iterable<KitWalkerDef> = [],
): EngineCatalog {
  const hazards = new Map<string, KitHazardDef>();
  const walkers = new Map<string, KitWalkerDef>();
  const walkerCasts = new Map<string, KitWalkerDef>();
  const empowerAuras = new Map<string, KitWalkerDef>();
  const novas = new Map<string, KitNovaDef>();
  const freezeStacks = new Map<string, FreezeStackDef>();
  const freezeAuras = new Map<string, FreezeStackDef>();
  const brandAuras = new Set<string>();
  const uses = new Map<string, KitUseDef>();
  const wallSeconds = new Map<string, number>();
  const put = <V>(m: Map<string, V>, k: string, v: V) => {
    if (!m.has(k)) m.set(k, v);
  };
  for (const kit of kits) {
    if (kit.breathPool) put(hazards, kit.breathPool.hazard.objectTemplate, kit.breathPool.hazard);
    // A topple's beats and spill are this layer's; a relight (the Hollow
    // Crypt's Remembrance Candles) is drawn by its dungeon's own painter.
    if (kit.usable?.effect.kind === 'topple') {
      put(uses, kit.usable.castId, kit.usable);
      put(hazards, kit.usable.effect.hazard.objectTemplate, kit.usable.effect.hazard);
    }
    if (kit.walker) {
      const w = kit.walker;
      put(walkers, w.objectTemplate, w);
      put(walkerCasts, w.castId, w);
      // Whatever the orb leaves behind glows: an arming (either difficulty's),
      // an ally's shield, and the group's gift for taking it.
      const e = w.empower;
      if (e.damagePct > 0 || (e.heroicDamagePct ?? 0) > 0 || (e.shieldPct ?? 0) > 0)
        put(empowerAuras, e.auraId, w);
      if (w.intercept.groupShield) put(empowerAuras, w.intercept.groupShield.auraId, w);
    }
    if (kit.nova) {
      put(novas, kit.nova.castId, kit.nova);
      if (kit.nova.unstoppableCastId) put(novas, kit.nova.unstoppableCastId, kit.nova);
    }
    const fs = kit.cone?.freezeStack;
    if (fs) {
      put(freezeStacks, fs.auraId, fs);
      put(freezeAuras, fs.freezeAuraId, fs);
    }
    if (kit.brand) brandAuras.add(kit.brand.auraId);
    const wall = kit.toss?.leavesWall;
    if (wall) put(wallSeconds, wall.objectTemplate, wall.seconds);
  }
  // An encounter's own walkers draw as orbs (ENCOUNTER_WALKERS below).
  for (const w of encounterWalkers) put(walkers, w.objectTemplate, w);
  return {
    hazards,
    walkers,
    walkerCasts,
    empowerAuras,
    novas,
    freezeStacks,
    freezeAuras,
    brandAuras,
    uses,
    wallSeconds,
  };
}

let catalog: EngineCatalog | null = null;

/** Walkers an ENCOUNTER launches itself (an 'event' launch from a spot, never
 *  a mob's bar), so no template's kit carries them: Morthen's Bound Soul
 *  (encounters/hollow_crypt/morthen_gravecall.ts). The engine draws their
 *  orbs and beats; their launch and the boss's own surge are the encounter
 *  painter's (render/hollow_crypt/morthen_soul_fx.ts). They join `walkers`
 *  only: no launch bar to gather on, and no lingering empower glow (Gorged on
 *  the Dead lasts the fight; his own soul fire deepens with it instead). */
export const ENCOUNTER_WALKERS: readonly KitWalkerDef[] = [BOUND_SOUL_WALKER];

/** The shipped catalog: every template's kit, then the dev demo kit, then the
 *  encounters' own walkers. */
export function engineCatalog(): EngineCatalog {
  if (catalog) return catalog;
  const kits: TrashKitDef[] = [];
  for (const t of Object.values(MOBS)) if (t.trashKit) kits.push(t.trashKit);
  kits.push(TRASH_ENGINE_DEMO_KIT);
  catalog = buildEngineCatalog(kits, ENCOUNTER_WALKERS);
  return catalog;
}

/** Is `templateId` an engine encounter object (a pool, a wall, an orb)? Its
 *  view is then an empty anchor: the engine draws it from the world. */
export function isTrashEngineObject(templateId: string): boolean {
  const c = engineCatalog();
  return (
    c.hazards.has(templateId) ||
    c.walkers.has(templateId) ||
    Object.hasOwn(COMBAT_WALL_SHAPES, templateId)
  );
}

/** The kit a body fights with: a dev demo kit lent to it stands in for its
 *  template's, exactly as the sim resolves it (mob/trash_kit/kit_of.ts). */
export function kitOf(e: {
  templateId: string;
  devTrashKit?: TrashKitDef;
}): TrashKitDef | undefined {
  return e.devTrashKit ?? MOBS[e.templateId]?.trashKit;
}

// ---- colours ---------------------------------------------------------------------

/** One hue per school for the cosmetic glows (motes, orb cores, trails). The
 *  telegraph RIMS never use these: they carry the threat palette. */
export const SCHOOL_TINT: Readonly<Record<KitSchool, number>> = {
  physical: 0xf2e6cc,
  fire: 0xff8a2e,
  frost: 0x9fe4ff,
  arcane: 0xf08cff,
  shadow: 0xa98cff,
  holy: 0xffe89a,
  nature: 0x8fffa0,
};

/** A colour as 0..1 floats (the particle pools take rgb floats). */
export function rgbOf(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

// ---- hazard pools ----------------------------------------------------------------

export type HazardStyle = 'meltwater' | 'soulfire' | 'generic';

export interface HazardLook {
  style: HazardStyle;
  /** It burns the players: the danger rim on the floor ladder (else it is the
   *  group's weapon and carries no threat rim). */
  danger: boolean;
  /** The threat rim colour (danger) or the friendly edge's tint. */
  rim: number;
  /** The surface's main tint and its hot / bright accent. */
  tint: number;
  accent: number;
  /** Seconds it stands (its def). */
  seconds: number;
}

/** The surface look of a hazard template (a known pool, else a school disc). */
export function hazardLook(templateId: string, def: KitHazardDef): HazardLook {
  const danger = def.hits === 'players';
  const rim = danger ? TELEGRAPH_THREAT_COLORS.danger : 0x9dffcf;
  if (templateId === SANCTUM_BOILING_MELTWATER)
    return {
      style: 'meltwater',
      danger,
      rim,
      tint: 0xcfefff,
      accent: 0xff7a2a,
      seconds: def.seconds,
    };
  if (templateId === SANCTUM_SPILLED_SOULFIRE)
    return {
      style: 'soulfire',
      danger,
      rim,
      tint: 0x7a58b8,
      accent: 0x8fd6a0,
      seconds: def.seconds,
    };
  const tint = SCHOOL_TINT[def.school] ?? SCHOOL_TINT.physical;
  return { style: 'generic', danger, rim, tint, accent: tint, seconds: def.seconds };
}

/** A pool's presence over its life: a fast spread as it spills, steady while
 *  it burns, guttering over its last stretch (never to nothing before the sim
 *  lifts it, so its edge stays readable to the end). */
export function hazardPresence(age: number, seconds: number): number {
  const rise = Math.min(1, Math.max(0, age / 0.3));
  const left = seconds - age;
  const fall = seconds > 0 ? Math.min(1, Math.max(0.3, left / 0.8)) : 1;
  return rise * fall;
}

/** The pool's drawn radius while it spills (it spreads to its full radius in
 *  a quarter second: the sim's radius from then on). */
export function hazardSpread(age: number, radius: number): number {
  const t = Math.min(1, Math.max(0, age / 0.25));
  return radius * (0.35 + 0.65 * (1 - (1 - t) * (1 - t)));
}

// ---- combat walls ----------------------------------------------------------------

export interface WallBox {
  /** Half extents along the wall's local x and z (yards), and its height. */
  hw: number;
  hd: number;
  height: number;
}

/** The box a wall stands as: its collider shape times its scale (the sim's
 *  combatWallCollider footprint exactly), or null for an unknown template. */
export function wallBox(templateId: string, scale: number): WallBox | null {
  const shape = COMBAT_WALL_SHAPES[templateId];
  if (!shape) return null;
  const s = scale > 0 ? scale : 1;
  return { hw: shape.hw * s, hd: shape.hd * s, height: shape.height * s };
}

/** Seconds a wall's crash-down takes. */
export const WALL_DROP_SECONDS = 0.2;
/** Seconds before its shatter the cracks start to glow. */
export const WALL_STRAIN_SECONDS = 3;

export interface WallLife {
  /** Height over its resting spot (yards) and its vertical squash (1 at rest). */
  drop: number;
  squash: number;
  /** 0..1: the cracks glowing up as its time runs out. */
  strain: number;
}

/** A wall `age` seconds after it crashed down, standing `seconds` in all. */
export function wallLife(age: number, seconds: number, height: number, out: WallLife): WallLife {
  const t = Math.min(1, Math.max(0, age / WALL_DROP_SECONDS));
  out.drop = (1 - t * t) * height * 0.9;
  // A short squash on impact, settling back.
  const after = age - WALL_DROP_SECONDS;
  out.squash = after > 0 && after < 0.25 ? 1 - 0.08 * Math.sin((after / 0.25) * Math.PI) : 1;
  const left = seconds - age;
  out.strain = seconds > 0 ? Math.min(1, Math.max(0, 1 - left / WALL_STRAIN_SECONDS)) ** 1.5 : 0;
  return out;
}

// ---- the line-of-sight nova --------------------------------------------------------

/** Rays the sight field is cast along. */
export const NOVA_RAYS = 64;
/** Bisection steps per ray (about 20 / 2^5 = 0.6 yd at the demo's radius). */
export const NOVA_BISECT = 5;

/**
 * The reach of one ray: how far out from the caster the sim's sight test
 * still sees (`clear(d)` asks "can a body d yards out along the ray see the
 * caster?"). The whole radius when it is clear end to end; else the first
 * distance KNOWN blocked, bisected: conservative, so the drawn shadow never
 * starts on a spot the nova can still see (it may start up to
 * radius / 2^steps past the true edge). Everything past a block stays
 * blocked (the sight line only grows), which is what makes the bisection
 * sound.
 */
export function sightReach(
  clear: (d: number) => boolean,
  radius: number,
  steps: number = NOVA_BISECT,
): number {
  if (radius <= 0) return 0;
  if (clear(radius)) return radius;
  let lo = 0;
  let hi = radius;
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    if (clear(mid)) lo = mid;
    else hi = mid;
  }
  return hi;
}

export interface NovaCastLook {
  def: KitNovaDef;
  /** The kickable bar (a kick glyph under the caster) or the unstoppable one
   *  (no glyph, harsher). */
  kickable: boolean;
  radius: number;
  /** The threat rim: danger for the kickable bar, lethal for the unstoppable. */
  color: number;
  accent: number;
}

/** The look of a nova bar, or null when `castId` is no nova of the kit. */
export function novaCastLook(
  kit: TrashKitDef | undefined,
  castId: string | null,
): NovaCastLook | null {
  const def = kit?.nova;
  if (!def || !castId) return null;
  const kickable = castId === def.castId;
  if (!kickable && castId !== def.unstoppableCastId) return null;
  return {
    def,
    kickable,
    radius: def.radius,
    color: kickable ? TELEGRAPH_THREAT_COLORS.danger : TELEGRAPH_THREAT_COLORS.lethal,
    accent: SCHOOL_TINT[def.school] ?? SCHOOL_TINT.frost,
  };
}

/** Seconds the landing wave takes to race out to the radius. */
export const NOVA_WAVE_SECONDS = 0.5;
/** Seconds the wave lingers as frost on the lit floor after it passes. */
export const NOVA_WAVE_LINGER = 0.9;

/** The wave `elapsed` seconds after the nova landed: its front (yards out)
 *  and its brightness. */
export function novaWave(elapsed: number, radius: number): { front: number; alpha: number } {
  const t = Math.min(1, Math.max(0, elapsed / NOVA_WAVE_SECONDS));
  const ease = 1 - (1 - t) ** 2.4;
  const after = Math.max(0, elapsed - NOVA_WAVE_SECONDS);
  const alpha = elapsed < NOVA_WAVE_SECONDS ? 1 : Math.max(0, 1 - after / NOVA_WAVE_LINGER);
  return { front: radius * ease, alpha };
}

// ---- usable bodies -----------------------------------------------------------------

/** How near the local player must be for a usable body's hint to show. */
export const USE_HINT_RANGE = 12;

export interface UseHint {
  /** 0..1: the floating glyph's and the reach ring's presence. */
  glyph: number;
  ring: number;
  /** The player stands inside the use's reach (the ring lights up). */
  inReach: boolean;
}

/** The hint a usable body shows a player `distance` yards away (`range` its
 *  use's reach). The glyph shows a little further out than the ring, both fade
 *  in over the last two yards of the hint range. */
export function useHint(distance: number, range: number, out: UseHint): UseHint {
  const near = Math.min(1, Math.max(0, (USE_HINT_RANGE - distance) / 2));
  out.glyph = near;
  out.ring = near;
  out.inReach = distance <= range;
  return out;
}

// ---- freeze stacks and the ice encase -----------------------------------------------

/** 0..1 rime on a body at `stacks` of a freeze that triggers at `maxStacks`
 *  (one short of the cap is full rime: the next one freezes). */
export function rimeIntensity(stacks: number, maxStacks: number): number {
  const top = Math.max(1, maxStacks - 1);
  return Math.min(1, Math.max(0, stacks / top));
}

/** Crystals grown on the body at that intensity (out of `max`), at least one
 *  from the first stack so the first breath already shows. */
export function rimeCrystals(intensity: number, max: number): number {
  if (intensity <= 0) return 0;
  return Math.max(1, Math.min(max, Math.round(intensity * max)));
}

/** How high up the body the rime has crept (share of its height). */
export function rimeClimb(intensity: number): number {
  return 0.18 + 0.62 * intensity;
}

export interface EncaseLook {
  /** 0..1 the block's growth around the body (it slams shut fast). */
  grow: number;
  /** 0..1 the cracks spreading as it is about to break. */
  crack: number;
}

/** Seconds the ice takes to close round the body. */
export const ENCASE_GROW_SECONDS = 0.16;
/** Seconds before the stun ends that the cracks start. */
export const ENCASE_CRACK_SECONDS = 0.6;

/** The encase `elapsed` seconds in with `remaining` seconds of stun left. */
export function iceEncase(elapsed: number, remaining: number, out: EncaseLook): EncaseLook {
  const g = Math.min(1, Math.max(0, elapsed / ENCASE_GROW_SECONDS));
  out.grow = 1 - (1 - g) ** 3;
  out.crack = Math.min(1, Math.max(0, 1 - remaining / ENCASE_CRACK_SECONDS));
  return out;
}

// ---- the brand ------------------------------------------------------------------------

/** The brand's glow: a hot, uneven flicker (0.7..1.15). */
export function brandFlicker(clock: number, seed: number): number {
  return 0.92 + 0.12 * Math.sin(clock * 13 + seed) + 0.11 * Math.sin(clock * 29.7 + seed * 3.1);
}

// ---- quench pools ---------------------------------------------------------------------

export interface QuenchPool {
  x: number;
  z: number;
  r: number;
}

/** The quench pools of a dungeon's slot in world coordinates. */
export function quenchPoolsAt(dungeonId: string, slot: number): QuenchPool[] {
  const def = DUNGEONS[dungeonId];
  const zones = def?.quenchZones;
  if (!def || !zones) return [];
  const o = instanceOrigin(def.index, slot);
  return zones.map((q) => ({ x: o.x + q.x, z: o.z + q.z, r: q.r }));
}

// ---- walker orbs -------------------------------------------------------------------------

/** Share of the way a drawn orb closes on its mirrored spot this frame (it
 *  rides 20 Hz positions; smoothing keeps it gliding at any frame rate). */
export function orbFollow(dt: number): number {
  return 1 - Math.exp(-dt * 14);
}

/** How high an orb floats by default (yards over the floor). */
export const ORB_HOVER = 1.45;

/** A dungeon walker's own look beyond its school tint: the Bastion
 *  Revenant's drowned sea-light floats at chest height in the green of its
 *  eyes; the Moonmantle Ray's Heartpearl is a nacre pearl rolling low over
 *  the floor (so it reads as something to step on, not to dodge). */
export const WALKER_LOOKS: Readonly<
  Record<string, { tint: number; hover: number; size?: number }>
> = {
  [BASTION_THROATLIGHT_ORB]: { tint: 0x52f0b8, hover: 1.5 },
  [TEMPLE_HEARTPEARL_ORB]: { tint: 0xe4f0ff, hover: 0.42 },
  // Morthen's Bound Soul: a big soul-green spirit at a tall man's head height
  // (its ghost-fire body and wake are morthen_soul_fx.ts's).
  [MORTHEN_SOUL_TEMPLATE]: BOUND_SOUL_LOOK,
};

/** The tint an orb (and its empower glow) draws in. */
export function walkerTint(def: KitWalkerDef): number {
  return WALKER_LOOKS[def.objectTemplate]?.tint ?? SCHOOL_TINT[def.school] ?? SCHOOL_TINT.fire;
}

/** How big an orb is drawn (1: the engine's own mote). */
export function walkerSize(def: KitWalkerDef | null | undefined): number {
  return (def && WALKER_LOOKS[def.objectTemplate]?.size) || 1;
}

/** The float an orb rests at (yards over the floor). */
export function walkerHover(def: KitWalkerDef | null | undefined): number {
  return (def && WALKER_LOOKS[def.objectTemplate]?.hover) || ORB_HOVER;
}

/** The orb's float over the floor (yards), bobbing in proportion to it. */
export function orbHover(clock: number, seed: number, base = ORB_HOVER): number {
  return base + base * 0.124 * Math.sin(clock * 3.3 + seed);
}

/** An empowered body's glow pulse (0.75..1.1). */
export function empowerPulse(clock: number): number {
  return 0.92 + 0.18 * Math.sin(clock * 6.4);
}
