// Pure plan for the Wildheart Basin trash's hunt (basin_trash_fx.ts): the
// trash mechanics pass (src/sim/mob/trash_kit/wildheart_hunt.ts) drawn from
// the sim's own templates, so every edge, reach and span on screen is the one
// the sim tests.
//  - Pack Frenzy (Basin Raptor): the survivors' red battle glow and streaks;
//  - Quarry Mark (Vineclaw Stalker): the sight under the chosen quarry while
//    the bar runs, the thrown marking spear, the bone-and-claw sigil over the
//    quarry's head and the rakes at their feet while the raptors run it down;
//  - War Roar (Bloodmane Ravager): the kick glyph, the roar's reach (every
//    ravager inside it frenzies), the shockwave and the blood-red frenzy;
//  - Toad Hex (Sunbone Hexcaller): the kick glyph, the hex ring under the
//    victim, the bolt and the green-gold smoke as the toad comes and goes;
//  - Rattling Dread (Sunbone Dread Totem): the fear's reach filling with the
//    bar, the skull over the totem, the skull-and-rattle burst;
//  - Snaring Tongue (Spore Toad): the locked lane, the tongue shooting down it
//    and holding the reeled player to the toad's mouth;
//  - Snarlbark (Snarlvine Lasher): the splinters on a melee attacker.
//
// The pools the painter holds are sized here too (TRASH_FX_POOLS), off the
// basin's own spawn table, so a full pull never runs a telegraph out of slots.
//
// Three-free, DOM-free, deterministic.

import { WILDHEART_BASIN_SPAWNS } from '../../sim/content/wildheart';
import { MOBS } from '../../sim/data';
import {
  BASIN_RAPTOR_ID,
  HEXCALLER_ID,
  RAVAGER_ID,
  SPORE_TOAD_ID,
  STALKER_ID,
  SUNBONE_DREAD_TOTEM_ID,
  SUNBONE_TOTEM_ID,
  TOTEM_BINDER_ID,
  VINE_LASHER_ID,
} from '../../sim/encounters/wildheart_basin/ids';
import { inLane } from '../../sim/mob/trash_kit/lane';
import {
  WILDHEART_ANCESTRAL_SAP,
  WILDHEART_KIT_CAST_SCHOOLS,
  WILDHEART_PLANT_TOTEM,
  WILDHEART_QUARRY_MARK,
  WILDHEART_RATTLING_DREAD,
  WILDHEART_SNARING_TONGUE,
  WILDHEART_TOAD_HEX,
  WILDHEART_WAR_ROAR,
} from '../../sim/mob/trash_kit/wildheart_cast_ids';
import type { WildheartKitDef } from '../../sim/mob/trash_kit/wildheart_kit_types';
import { PARTY_MAX } from '../../sim/social/party';
import { TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';
import { shockRingLook } from './basin_boss_fx_core';
import { basinTelegraphSpecs } from './basin_fx_core';
import {
  DREAD_TOTEM_MODEL,
  RAPTOR_MODEL,
  RAPTOR_SIM_SCALE,
  SUN_TOTEM_MODEL,
  TOAD_CLIP,
  TOAD_MODEL,
  TOAD_SIM_SCALE,
  TOTEM_SIM_SCALE,
  trashLookHeight,
} from './basin_trash_model_core';

/** The hunt's own element accents (motes, fill fronts, glows; never a rim). */
export const TRASH_ACCENTS = {
  /** The frenzy's blood red (Pack Frenzy, the War Roar). */
  blood: 0xff3a24,
  /** The hunter's quarry: a war-paint orange. */
  quarry: 0xff8a2a,
  /** The toad hex: green-gold swamp smoke. */
  hex: 0xc8e85a,
  /** The dread totem's red-painted skull. */
  dread: 0xff3048,
  /** The toad's tongue. */
  flesh: 0xff8aa0,
} as const;

/** The Basin keys of a trash template (its trashKit.wildheart block). */
function hunt(templateId: string): WildheartKitDef | undefined {
  return MOBS[templateId]?.trashKit?.wildheart;
}

/** The sim's hunt keys this renderer reads (the content's own numbers). */
export const HUNT_TUNING = {
  mark: hunt(STALKER_ID)?.mark,
  roar: hunt(RAVAGER_ID)?.roar,
  hex: hunt(HEXCALLER_ID)?.hex,
  dread: hunt(SUNBONE_DREAD_TOTEM_ID)?.dread,
  tongue: hunt(SPORE_TOAD_ID)?.tongue,
  totems: hunt(TOTEM_BINDER_ID)?.totems,
  packFrenzy: MOBS[BASIN_RAPTOR_ID]?.packFrenzy,
  snarlbark: MOBS[VINE_LASHER_ID]?.thorns,
} as const;

/** The aura a fallen Basin Raptor leaves on its pack (mob/lifecycle.ts
 *  frenzyPackmates; a refreshable buff_haste). */
export const RAPTOR_PACK_FRENZY_AURA = 'pack_frenzy';

/** The gesture a raptor flying into its Pack Frenzy plays (its Screech clip;
 *  a key of its look's attackByAbility, never a sim ability id). */
export const RAPTOR_FRENZY_GESTURE = 'wildheart_raptor_frenzy';

/** The gesture a freshly planted Sunbone totem rises out of the ground with
 *  (its Rise clip, the look's entranceGesture), offered for this many seconds
 *  after the totem is first seen so a view built a little late still rises. */
export const TOTEM_RISE_GESTURE = 'wildheart_totem_rise';
export const TOTEM_RISE_WINDOW = 0.5;

/** Is this template one of the Totem-Binder's totems? */
export function isSunboneTotem(templateId: string): boolean {
  return templateId === SUNBONE_TOTEM_ID || templateId === SUNBONE_DREAD_TOTEM_ID;
}

/** The name the Snarlvine Lasher's thorns carry on their damage event. */
export const SNARLBARK_ABILITY = HUNT_TUNING.snarlbark?.name ?? 'Snarlbark';

// ---- the casts -----------------------------------------------------------------------

export interface TrashCastSpec {
  shape: 'ring' | 'lane';
  /** Yards: a ring's radius, a lane's length. */
  range: number;
  /** A lane's half width (yards). */
  halfWidth: number;
  /** Where the ring stands: round the caster or under its cast target. */
  anchor: 'caster' | 'target';
  /** The threat colour (TELEGRAPH_THREAT_COLORS). */
  color: number;
  accent: number;
  /** A kick glyph turns under the caster too (the sim's interrupt table). */
  kick: boolean;
}

/** The ring a single-target cast paints under its victim (yards): the quarry
 *  about to be marked, the player about to be hexed. */
export const TARGET_RING_RADIUS = 1.7;

/** The kick glyph's radius: the Ancestral Sap's own, so every kick in the
 *  basin reads alike. */
export const KICK_GLYPH_RADIUS = basinTelegraphSpecs()[WILDHEART_ANCESTRAL_SAP]?.range ?? 1.8;

/** Can a player kick this cast (the sim's own interrupt table)? */
export function trashCastKickable(castId: string): boolean {
  return Object.hasOwn(WILDHEART_KIT_CAST_SCHOOLS, castId);
}

/** Every hunt cast that paints the floor while its bar runs. */
export function trashCastSpecs(): Readonly<Record<string, TrashCastSpec>> {
  const t = HUNT_TUNING;
  return {
    // The marking spear: the quarry's spot, orange (the raptors are coming).
    [WILDHEART_QUARRY_MARK]: {
      shape: 'ring',
      range: TARGET_RING_RADIUS,
      halfWidth: 0,
      anchor: 'target',
      color: TELEGRAPH_THREAT_COLORS.danger,
      accent: TRASH_ACCENTS.quarry,
      kick: trashCastKickable(WILDHEART_QUARRY_MARK),
    },
    // The roar's reach: every ravager inside it frenzies. Kick it (gold).
    [WILDHEART_WAR_ROAR]: {
      shape: 'ring',
      range: t.roar?.radius ?? 0,
      halfWidth: 0,
      anchor: 'caster',
      color: TELEGRAPH_THREAT_COLORS.interrupt,
      accent: TRASH_ACCENTS.blood,
      kick: trashCastKickable(WILDHEART_WAR_ROAR),
    },
    // The hex lands on one player: a toad (control), kick it.
    [WILDHEART_TOAD_HEX]: {
      shape: 'ring',
      range: TARGET_RING_RADIUS,
      halfWidth: 0,
      anchor: 'target',
      color: TELEGRAPH_THREAT_COLORS.control,
      accent: TRASH_ACCENTS.hex,
      kick: trashCastKickable(WILDHEART_TOAD_HEX),
    },
    // The dread's reach: everyone inside it flees (control).
    [WILDHEART_RATTLING_DREAD]: {
      shape: 'ring',
      range: t.dread?.radius ?? 0,
      halfWidth: 0,
      anchor: 'caster',
      color: TELEGRAPH_THREAT_COLORS.control,
      accent: TRASH_ACCENTS.dread,
      kick: trashCastKickable(WILDHEART_RATTLING_DREAD),
    },
    // The tongue's lane, locked at the bar's start: reeled in (control).
    [WILDHEART_SNARING_TONGUE]: {
      shape: 'lane',
      range: t.tongue?.length ?? 0,
      halfWidth: t.tongue?.halfWidth ?? 1,
      anchor: 'caster',
      color: TELEGRAPH_THREAT_COLORS.control,
      accent: TRASH_ACCENTS.flesh,
      kick: trashCastKickable(WILDHEART_SNARING_TONGUE),
    },
  };
}

// ---- the creatures' clips (existing clips only) ---------------------------------------

export interface TrashCastClip {
  /** The rig's existing clip the bar plays. */
  clip: string;
  /** Its authored length (seconds, read off the shipped GLB). */
  clipSeconds: number;
  /** Fit one play of the clip to the bar (else it loops at its own pace). */
  fitToBar: boolean;
}

/** Each hunt cast's clip on its caster's rig: the stalker's spear swing over
 *  the Quarry Mark's bar, the ravager's and the hexer's Cast, the toad's
 *  crouch (it swells) under the Snaring Tongue. */
export const TRASH_CAST_CLIPS: Readonly<Record<string, TrashCastClip>> = {
  [WILDHEART_QUARRY_MARK]: { clip: 'Attack', clipSeconds: 2, fitToBar: true },
  [WILDHEART_WAR_ROAR]: { clip: 'Cast', clipSeconds: 5.38, fitToBar: false },
  [WILDHEART_TOAD_HEX]: { clip: 'Cast', clipSeconds: 5.38, fitToBar: false },
  // The Spore Toad's own Tongue clip: its jaws fly open on the bar's end.
  [WILDHEART_SNARING_TONGUE]: { clip: 'Tongue', clipSeconds: TOAD_CLIP.tongueFire, fitToBar: true },
};

/** The bar (seconds) of a hunt cast, from its template. */
export function trashCastSeconds(castId: string): number {
  const t = HUNT_TUNING;
  if (castId === WILDHEART_QUARRY_MARK) return t.mark?.castTime ?? 0;
  if (castId === WILDHEART_WAR_ROAR) return t.roar?.castTime ?? 0;
  if (castId === WILDHEART_TOAD_HEX) return t.hex?.castTime ?? 0;
  if (castId === WILDHEART_RATTLING_DREAD) return t.dread?.castTime ?? 0;
  if (castId === WILDHEART_SNARING_TONGUE) return t.tongue?.castTime ?? 0;
  if (castId === WILDHEART_PLANT_TOTEM) return t.totems?.castTime ?? 0;
  return 0;
}

/** The rate that plays a fitted clip once over its bar (1 when it loops). */
export function trashCastClipRate(castId: string): number {
  const c = TRASH_CAST_CLIPS[castId];
  const bar = trashCastSeconds(castId);
  if (!c?.fitToBar || bar <= 0) return 1;
  return c.clipSeconds / bar;
}

// ---- the bodies -----------------------------------------------------------------------

/** Drawn height per unit of sim scale (characters/manifest.ts and
 *  wildheart_creature_looks.ts: each rig's height times its grow; pinned
 *  against VISUALS in the test). */
export const TRASH_BODY_HEIGHT: Readonly<Record<string, number>> = {
  // Its Blender body at its authored size (basin_trash_model_core.ts).
  [BASIN_RAPTOR_ID]: trashLookHeight(RAPTOR_MODEL, RAPTOR_SIM_SCALE),
  [STALKER_ID]: 2.5,
  [RAVAGER_ID]: 2.7,
  [HEXCALLER_ID]: 2.5,
  [SPORE_TOAD_ID]: trashLookHeight(TOAD_MODEL, TOAD_SIM_SCALE),
  [SUNBONE_DREAD_TOTEM_ID]: trashLookHeight(DREAD_TOTEM_MODEL, TOTEM_SIM_SCALE),
  [SUNBONE_TOTEM_ID]: trashLookHeight(SUN_TOTEM_MODEL, TOTEM_SIM_SCALE),
};
/** A player's drawn height (yards at scale 1). */
const PLAYER_HEIGHT = 2.6;

/** A body's drawn height (yards). */
export function trashBodyHeight(templateId: string, scale: number): number {
  return (TRASH_BODY_HEIGHT[templateId] ?? PLAYER_HEIGHT) * (scale > 0 ? scale : 1);
}

/** The Spore Toad's mouth on its Blender body at the tongue's release, as
 *  shares of its drawn height (basin_trash_model_core.ts TOAD_MODEL). */
export const TOAD_MOUTH = {
  up: TOAD_MODEL.mouth.up / (TOAD_MODEL.idleTop - TOAD_MODEL.idleMin),
  forward: TOAD_MODEL.mouth.forward / (TOAD_MODEL.idleTop - TOAD_MODEL.idleMin),
} as const;

/** Where the tongue leaves the toad's mouth, written into `out`. */
export function toadMouthInto(
  out: { x: number; y: number; z: number },
  pos: { x: number; y: number; z: number },
  facing: number,
  scale: number,
): { x: number; y: number; z: number } {
  const h = trashBodyHeight(SPORE_TOAD_ID, scale);
  out.x = pos.x + Math.sin(facing) * h * TOAD_MOUTH.forward;
  out.y = pos.y + h * TOAD_MOUTH.up;
  out.z = pos.z + Math.cos(facing) * h * TOAD_MOUTH.forward;
  return out;
}

/** Where a thrown spear or a hex leaves its caster's hand (share of height). */
export const THROW_HAND = { up: 0.72, forward: 0.22 } as const;

// ---- the projectiles ----------------------------------------------------------------

/** Yards a second: the marking spear flies hard, the hex snaps across. */
export const SPEAR_SPEED = 46;
export const HEX_BOLT_SPEED = 60;

/** Seconds a projectile takes over `distance` (a floor so it still reads). */
export function projectileFlight(distance: number, speed: number): number {
  if (!Number.isFinite(distance) || speed <= 0) return 0.12;
  return Math.min(0.9, Math.max(0.12, distance / speed));
}

/** The spear's arc apex over a throw of `distance` yards. */
export function spearApex(distance: number): number {
  return Math.min(3, Math.max(0.4, distance * 0.08));
}

// ---- the marks and glows ------------------------------------------------------------

/** The quarry sigil's look: written into a caller-owned record each frame. */
export interface QuarryMarkLook {
  alpha: number;
  size: number;
}

/** The quarry sigil's look with `remaining` of its `duration` seconds left,
 *  written into `out` (allocation-free). */
export function quarryMarkLookInto(
  out: QuarryMarkLook,
  remaining: number,
  duration: number,
  t: number,
): QuarryMarkLook {
  const beat = 0.5 + 0.5 * Math.sin(t * 8);
  // Pops in at full size, fades over its last half-second.
  const span = duration > 0 ? duration : 1;
  const age = span - Math.max(0, remaining);
  const pop = Math.min(1, age / 0.18);
  const fade = Math.min(1, Math.max(0, remaining) / 0.5);
  out.alpha = (0.82 + 0.18 * beat) * fade;
  out.size = (1.6 + 0.18 * beat) * (0.6 + 0.4 * pop);
  return out;
}

/** A frenzy's breathing (0..1) at clock `t`: the pack's a quick pant, the
 *  roused ravagers' a slower heave. */
export function frenzyGlow(kind: 'pack' | 'roar' | 'hunt', t: number): number {
  if (kind === 'pack') return 0.62 + 0.38 * Math.sin(t * 11) ** 2;
  if (kind === 'roar') return 0.7 + 0.3 * Math.sin(t * 5.2) ** 2;
  return 0.55 + 0.25 * Math.sin(t * 7) ** 2;
}

/** The dread skull's look: written into a caller-owned record each frame. */
export interface DreadSkullLook {
  alpha: number;
  eyes: number;
  size: number;
}

/** The dread skull's look while its totem stands, written into `out`
 *  (allocation-free); `fill` is the dread bar (0 when idle): its eyes burn
 *  hotter and it swells as the bar runs. */
export function dreadSkullLookInto(out: DreadSkullLook, fill: number, t: number): DreadSkullLook {
  const f = Math.min(1, Math.max(0, fill));
  const beat = 0.5 + 0.5 * Math.sin(t * (2.4 + 9 * f));
  out.alpha = 0.85 + 0.15 * beat;
  out.eyes = 0.45 + 0.35 * beat + 0.6 * f;
  out.size = 1.5 + 0.5 * f;
  return out;
}

// ---- the shocks ---------------------------------------------------------------------

/** One landing's shock ring (the host's pooled rings: shockRingLook). */
export interface TrashShock {
  /** Yards the ring races out to. */
  radius: number;
  seconds: number;
  color: number;
}

/** Every landing that throws a shock ring: the roar and the dread out to the
 *  sim's own reach (who frenzied, who fled), the pack's snarl and the hex's
 *  pop kept tight round their bearer (cosmetic). */
export const TRASH_SHOCKS = {
  roar: { radius: HUNT_TUNING.roar?.radius ?? 0, seconds: 0.85, color: TRASH_ACCENTS.blood },
  dread: { radius: HUNT_TUNING.dread?.radius ?? 0, seconds: 0.6, color: TRASH_ACCENTS.dread },
  snarl: { radius: 3.2, seconds: 0.5, color: TRASH_ACCENTS.blood },
  hex: { radius: 2.2, seconds: 0.5, color: TRASH_ACCENTS.hex },
} as const satisfies Record<string, TrashShock>;

/** A shock's ring `elapsed` seconds after it lands. */
export function trashShockLook(
  shock: TrashShock,
  elapsed: number,
): { radius: number; alpha: number } {
  return shockRingLook(elapsed, shock.radius, shock.seconds);
}

// ---- the tongue ---------------------------------------------------------------------

/** Seconds the tongue takes to shoot down its lane, and to snap back. */
export const TONGUE_SHOOT_SECONDS = 0.14;
export const TONGUE_RETRACT_SECONDS = 0.18;

/** How far down its reach the tongue is `elapsed` after it fires (0..1). */
export function tongueShot(elapsed: number): number {
  const t = Math.min(1, Math.max(0, elapsed / TONGUE_SHOOT_SECONDS));
  return 1 - (1 - t) ** 3;
}

/** The longest a reel can take (its whole lane at the reel's pace), plus a
 *  grace: past it the tongue lets go whatever the client saw. */
export function tongueHoldLimit(): number {
  const tongue = HUNT_TUNING.tongue;
  if (!tongue || tongue.reel <= 0) return 0;
  return (tongue.length - tongue.stop) / tongue.reel + 0.6;
}

/** Is a reeled player in at the toad's mouth (the sim stops them short)? */
export function tongueReeledIn(distance: number): boolean {
  return distance <= (HUNT_TUNING.tongue?.stop ?? 0) + 0.4;
}

/** The players the tongue catches down its lane (the sim's own inLane on the
 *  locked yaw), with `slack` yards of grace for a mirrored position a tick
 *  behind. Allocation-free: fills `out` with ids and returns it. */
export function tongueCatchInto(
  out: number[],
  origin: { x: number; z: number },
  yaw: number,
  players: Iterable<{ id: number; dead: boolean; kind: string; pos: { x: number; z: number } }>,
  slack = 0.5,
): number[] {
  out.length = 0;
  const tongue = HUNT_TUNING.tongue;
  if (!tongue) return out;
  for (const p of players) {
    if (p.kind !== 'player' || p.dead) continue;
    if (
      inLane(
        origin.x,
        origin.z,
        yaw,
        tongue.length + slack,
        tongue.halfWidth + slack,
        p.pos.x,
        p.pos.z,
      )
    )
      out.push(p.id);
  }
  return out;
}

// ---- the pools ------------------------------------------------------------------------

/** Who wears a hunt mark at once at most: a whole party (sim/social/party.ts). */
export const TRASH_PARTY_SIZE = PARTY_MAX;

/** What one pull can put on the floor at once, counted off its members. */
export interface TrashPullCensus {
  /** Ringed casts (the Quarry Mark, the War Roar, the Toad Hex, the Rattling
   *  Dread): one ring per caster, since a caster runs one bar at a time. */
  rings: number;
  /** Kick glyphs: the casters of a cast the sim lets a player kick. */
  kicks: number;
  /** Snaring Tongue lanes: one per Spore Toad. */
  lanes: number;
  /** Dread skulls: one per Sunbone Dread Totem standing. */
  skulls: number;
  /** Marking spears in flight: one per Vineclaw Stalker. */
  spears: number;
  /** Hex bolts in flight: one per Sunbone Hexcaller. */
  hexes: number;
}

/** The hunt key of each template block a cast can sit under. */
const HUNT_CAST_KEYS = ['mark', 'roar', 'hex', 'dread', 'tongue'] as const;

function emptyCensus(): TrashPullCensus {
  return { rings: 0, kicks: 0, lanes: 0, skulls: 0, spears: 0, hexes: 0 };
}

/** Add `n` bodies of `templateId` (its own hunt casts) to the census. */
function countHunter(c: TrashPullCensus, templateId: string, n: number): void {
  const def = hunt(templateId);
  if (!def || n <= 0) return;
  const specs = trashCastSpecs();
  for (const key of HUNT_CAST_KEYS) {
    const castId = def[key]?.castId;
    const spec = castId ? specs[castId] : undefined;
    if (!castId || !spec) continue;
    if (spec.shape === 'lane') c.lanes += n;
    else c.rings += n;
    if (spec.kick) c.kicks += n;
    if (castId === WILDHEART_RATTLING_DREAD) c.skulls += n;
    if (castId === WILDHEART_QUARRY_MARK) c.spears += n;
    if (castId === WILDHEART_TOAD_HEX) c.hexes += n;
  }
}

/** The census of one pull (its members' template ids). A totem planter counts
 *  its `maxAlive` of EVERY summon that casts: the cycle can leave two of the
 *  same kind standing once the other kind is broken, so the worst case is all
 *  of them. */
export function trashPullCensus(members: readonly string[]): TrashPullCensus {
  const c = emptyCensus();
  for (const id of members) {
    countHunter(c, id, 1);
    const totems = hunt(id)?.totems;
    if (totems) for (const s of totems.summons) countHunter(c, s, totems.maxAlive);
  }
  return c;
}

/** Every pull of a spawn table (a pack id, the patrols included), with its census. */
export function trashPullCensuses(
  spawns: readonly { mobId: string; packId?: string }[],
): Map<string, TrashPullCensus> {
  const members = new Map<string, string[]>();
  for (const s of spawns) {
    if (!s.packId) continue;
    let list = members.get(s.packId);
    if (!list) {
      list = [];
      members.set(s.packId, list);
    }
    list.push(s.mobId);
  }
  const out = new Map<string, TrashPullCensus>();
  for (const [pack, list] of members) out.set(pack, trashPullCensus(list));
  return out;
}

/** Slots per pool of the trash fx. Every telegraph pool holds the worst pull
 *  of the basin PLUS the next worst one chained into it (a patrol walking in,
 *  a neighbouring pack body-pulled), each field taken on its own, so an
 *  actionable mark is never dropped for want of a slot. The tongues hold every
 *  lane's whole party; the quarry marks a whole party. */
export interface TrashFxPools extends TrashPullCensus {
  tongues: number;
  marks: number;
}

/** The two largest values summed (the worst pull plus the next worst). */
function worstTwo(values: readonly number[]): number {
  let a = 0;
  let b = 0;
  for (const v of values) {
    if (v > a) {
      b = a;
      a = v;
    } else if (v > b) b = v;
  }
  return a + b;
}

/** The pool sizes a spawn table needs (see TrashFxPools). */
export function trashFxPools(spawns: readonly { mobId: string; packId?: string }[]): TrashFxPools {
  const pulls = [...trashPullCensuses(spawns).values()];
  const field = (k: keyof TrashPullCensus) => worstTwo(pulls.map((p) => p[k]));
  const lanes = field('lanes');
  return {
    rings: field('rings'),
    kicks: field('kicks'),
    lanes,
    skulls: field('skulls'),
    spears: field('spears'),
    hexes: field('hexes'),
    tongues: lanes * TRASH_PARTY_SIZE,
    marks: TRASH_PARTY_SIZE,
  };
}

/** The Wildheart Basin's own pools, off its spawn table. */
export const TRASH_FX_POOLS: Readonly<TrashFxPools> = trashFxPools(WILDHEART_BASIN_SPAWNS);
