// Pure plan of the Hammer Council's effects (council_fx.ts paints them;
// docs/design/raid/smith_heart.md sections 5.18 and 7.1): how a pillar shows
// its integrity (its cracks, its lean, the pips round its foot), how it bursts
// out of the floor and how it falls, the marks' footprints (Wake the Stone,
// the heir's rising stone, the Falling Rock's soak, Resonance, Hammer's
// Weight) and their colours, the rock's fall, the heroic pulse, the
// inheritance's stream of light, the Wrath holder's gathering energy. The
// sim's numbers are read here, never tuned.
//
// Three-free, DOM-free, deterministic (a hash, never rng).

import { SMITH_HEART_VEIN_COLORS } from '../../sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_CUES,
  COUNCIL_RISE_SPOT,
  COUNCIL_RUBBLE,
  type CouncilRole,
  councilPillarFull,
  councilPillarOf,
  councilRiseSpotSeconds,
  councilRoleOf,
  councilSoulOf,
  endlessSongMult,
  COUNCIL_TUNING as T,
} from '../../sim/encounters/smith_heart/council_ids';
import { TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';
import { fxHash } from './hammer_fx_core';

export {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_CUES,
  COUNCIL_RISE_SPOT,
  COUNCIL_RUBBLE,
  councilPillarOf,
  councilRiseSpotSeconds,
  councilRoleOf,
  councilSoulOf,
};

/** The palette. Every footprint's RIM is a threat colour (the floor
 *  telegraph's rule); the vein's ochre rides the accents and the glows only. */
export const COUNCIL_FX_COLORS = {
  /** The Hammer vein's ochre: seams, threads, the integrity pips. */
  ochre: SMITH_HEART_VEIN_COLORS.hammer,
  /** The cracks' hot core and their dark lip (linear 0..1). */
  crackCore: [1.0, 0.82, 0.48] as const,
  crackEdge: [0.92, 0.42, 0.1] as const,
  crackDark: [0.06, 0.04, 0.03] as const,
  dust: [0.74, 0.64, 0.5] as const,
  dustDark: [0.42, 0.35, 0.27] as const,
  flash: [1.0, 0.8, 0.46] as const,
  /** The soak: a gold to gather in (the Chorus mark's precedent). */
  soak: 0xffc94a,
  /** Wake the Stone: a knockback, the control colour. */
  wake: TELEGRAPH_THREAT_COLORS.control,
  /** The rubble, the heroic pulse, the heir's rising stone: damage. */
  danger: TELEGRAPH_THREAT_COLORS.danger,
  /** Resonance's ring: the vein's hum (an accent, never a damage rim). */
  resonance: 0xf0c070,
  /** Hammer's Weight: the tank's mark, lethal if not swapped. */
  weight: TELEGRAPH_THREAT_COLORS.lethal,
  /** The pips: lit and spent. */
  pipLit: 0xffc66a,
  pipSpent: 0x2a2018,
} as const;

/** The pools the painter keeps (fixed: no allocation in a fight). */
/** Is this spot inside one of the Smith's Heart claims (the council's
 *  painters walk the world only there)? */
export function inSmithHeartClaim(x: number, z: number): boolean {
  const def = DUNGEONS.smith_heart;
  if (!def) return false;
  const o = instanceOrigin(def.index, instanceSlotForZ(z));
  return Math.abs(x - o.x) < 300 && Math.abs(z - o.z) < 260;
}

export const COUNCIL_FX_POOLS = {
  /** Every standing pillar plus as many still falling (a Wrath can break all). */
  pillars: T.pillarCap * 2,
  fallen: 4,
  /** Rubble lies 8 s: room for every pillar breaking inside that window. */
  rubble: T.pillarCap + 2,
  marks: 8,
  spots: 4,
  rocks: 2,
  rings: 6,
  weights: 2,
  bolts: 6,
  streams: 4,
  debris: 120,
  /** Mythic: soul pillars standing at once (two is the punishment) and
   *  one more bursting. */
  souls: 3,
  /** The Echo's shelter wedges: one per other pillar that can stand. */
  wedges: T.pillarCap,
} as const;

// ---- the pillars ----------------------------------------------------------------------

/** What a pillar's integrity looks like: the crack network's reach (0 none,
 *  1 all of it), its lean (radians, away from its hashed side), how hot its
 *  seams burn, how often grit trickles off it (a second), and whether its
 *  crown is split loose. */
export interface PillarLook {
  readonly crack: number;
  readonly lean: number;
  readonly heat: number;
  readonly grit: number;
  readonly crownLoose: boolean;
}

const LOOK_WHOLE: PillarLook = Object.freeze({
  crack: 0,
  lean: 0,
  heat: 0,
  grit: 0,
  crownLoose: false,
});
const LOOK_FAILING: PillarLook = Object.freeze({
  crack: 1,
  lean: 0.085,
  heat: 1,
  grit: 5,
  crownLoose: true,
});

/** One of two shared frozen looks (read every frame, never allocated): whole
 *  at its full integrity (a fresh risen pillar is whole at 1), cracked open
 *  and leaning once it has taken a blow (a carved column's last piece). */
export function pillarLook(integrity: number, risen = false): PillarLook {
  return integrity >= councilPillarFull(risen) ? LOOK_WHOLE : LOOK_FAILING;
}

/** The side a pillar leans toward (sim yaw), fixed per entity. */
export function pillarLeanYaw(id: number): number {
  return fxHash(id, 17) * Math.PI * 2;
}

/** Seconds a pillar takes to burst out of the floor. */
export const PILLAR_RISE_SECONDS = 0.75;

/** A rising pillar `age` seconds in: how far it still stands below its rest
 *  (a share of its height, 1 sunk to 0 risen, overshooting a breath), and its
 *  shudder (yards of jitter). */
export function pillarRise(
  age: number,
  out: { sunk: number; shudder: number } = { sunk: 0, shudder: 0 },
): { sunk: number; shudder: number } {
  if (age <= 0) {
    out.sunk = 1;
    out.shudder = 0.12;
    return out;
  }
  const t = Math.min(1, age / PILLAR_RISE_SECONDS);
  // Fast out of the floor, a breath of overshoot, settle.
  const ease = 1 - (1 - t) ** 3;
  const over = t < 1 ? Math.sin(t * Math.PI) * 0.04 : 0;
  out.sunk = Math.max(-0.03, 1 - ease - over);
  out.shudder = (1 - t) * 0.12;
  return out;
}

/** Seconds a fallen pillar takes to tip and break, and the crumble after. */
export const PILLAR_FALL_SECONDS = 1.1;
export const PILLAR_CRUMBLE_SECONDS = 0.8;

/** A falling pillar `age` seconds in: how far it has tipped (radians), how
 *  far it has sunk (a share of its height) and how visible it still is. */
export function pillarFall(age: number): { tip: number; sunk: number; alpha: number } {
  const t = Math.min(1, Math.max(0, age / PILLAR_FALL_SECONDS));
  // The tip accelerates like a felled column.
  const tip = (Math.PI / 2.4) * t * t;
  const c = Math.max(0, age - PILLAR_FALL_SECONDS) / PILLAR_CRUMBLE_SECONDS;
  return { tip, sunk: Math.min(1, t * 0.25 + c * 0.75), alpha: Math.max(0, 1 - c) };
}

/** Seconds a risen pillar takes to sink back at the council's fall. */
export const PILLAR_SETTLE_SECONDS = 1.6;

/** How many of a pillar's three pips burn. */
export function pillarPips(integrity: number, risen = false): number {
  return Math.max(0, Math.min(councilPillarFull(risen), integrity));
}

/** How many arcs ring a pillar's foot: one per piece it starts with. */
export function pillarPipSlots(risen: boolean): number {
  return councilPillarFull(risen);
}

/** A crack's flash after it lost a piece (0 to 1 over its seconds). */
export function crackFlash(age: number): number {
  if (age < 0 || age > 0.9) return 0;
  return age < 0.08 ? age / 0.08 : Math.max(0, 1 - (age - 0.08) / 0.82);
}

/** How hard a pillar shakes while a Resonance is cracking it (`share` of
 *  the 3 s stood, 0 to 1): yards of jitter and the seams' extra heat. */
export function resonanceShake(
  share: number,
  clock: number,
  out: { jitter: number; heat: number } = { jitter: 0, heat: 0 },
): { jitter: number; heat: number } {
  const s = Math.max(0, Math.min(1, share));
  if (s <= 0) {
    out.jitter = 0;
    out.heat = 0;
    return out;
  }
  const hum = 0.5 + 0.5 * Math.sin(clock * (18 + s * 22));
  out.jitter = 0.02 + s * 0.06 * hum;
  out.heat = 0.35 + s * 0.65 * hum;
  return out;
}

// ---- the marks ---------------------------------------------------------------------------

/** A player mark (an aura on them): the footprint it draws round them. */
export interface CouncilMarkSpec {
  radius: number;
  color: number;
  accent: number;
  /** The motes stream in (gather here) or out (keep clear). */
  gather: boolean;
}

export const COUNCIL_MARK_SPECS: Readonly<Record<string, CouncilMarkSpec>> = {
  [COUNCIL_AURAS.wakeMark]: {
    radius: T.riseKnockRadius,
    color: COUNCIL_FX_COLORS.wake,
    accent: COUNCIL_FX_COLORS.ochre,
    gather: false,
  },
  [COUNCIL_AURAS.rockMark]: {
    radius: T.rockRadius,
    color: COUNCIL_FX_COLORS.soak,
    accent: 0xfff0c0,
    gather: true,
  },
};

/** The heir's rising stone: a locked spot, the knockback's radius, its
 *  warning's seconds. */
export const RISE_SPOT_SPEC = {
  radius: T.riseKnockRadius,
  seconds: T.heirRiseWarn,
  color: COUNCIL_FX_COLORS.danger,
  accent: COUNCIL_FX_COLORS.ochre,
} as const;

/** Fill of a timed mark: 0 as it begins, 1 as it lands. */
export function markFill(remaining: number, duration: number): number {
  if (duration <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - remaining / duration));
}

/** The ghost of the pillar a Wake mark will raise, by the mark's fill: its
 *  height (a share of a risen pillar's) and its glow. */
export function wakeGhost(fill: number): { height: number; glow: number } {
  const f = Math.max(0, Math.min(1, fill));
  return { height: 0.15 + 0.85 * f * f, glow: 0.25 + 0.75 * f };
}

/** Seconds before it lands that the rock drops (its last, accelerating fall). */
export const ROCK_FALL_SECONDS = 1.2;
/** How high over the floor that drop begins, and where the rock hangs when
 *  the mark goes on (it sinks from there through the mark: the soak's threat
 *  is in the sky for all of its five seconds, never only its last). */
export const ROCK_FALL_HEIGHT = 20;
export const ROCK_HANG_HEIGHT = 26;

/** The rock over a soak with `remaining` of `duration` seconds to go:
 *  visible for the whole mark, hanging high and turning, sinking slowly,
 *  then dropping (accelerating) over its last ROCK_FALL_SECONDS. */
export function rockFall(
  remaining: number,
  duration: number = T.rockMarkSeconds,
): { visible: boolean; height: number; spin: number } {
  if (remaining < 0 || remaining > Math.max(duration, ROCK_FALL_SECONDS) + 1e-6)
    return { visible: false, height: 0, spin: 0 };
  if (remaining > ROCK_FALL_SECONDS) {
    const hang = Math.max(1e-3, duration - ROCK_FALL_SECONDS);
    const u = Math.min(1, (remaining - ROCK_FALL_SECONDS) / hang);
    return {
      visible: true,
      height: ROCK_FALL_HEIGHT + (ROCK_HANG_HEIGHT - ROCK_FALL_HEIGHT) * u,
      spin: (1 - u) * 1.2,
    };
  }
  const t = 1 - remaining / ROCK_FALL_SECONDS;
  return { visible: true, height: ROCK_FALL_HEIGHT * (1 - t * t), spin: 1.2 + t * 4.2 };
}

/** The soak's countdown as it reads from the floor and from afar: the share
 *  of its time left (the rim's sweep), the beacon over its player (bright as
 *  the mark goes on, burning hotter to the end), and the rock's shadow on the
 *  floor (a share of the soak's radius, growing as the rock comes down, its
 *  darkness). The rim and the sweep are the soak's own radius (the sim's). */
export function soakCountdown(
  remaining: number,
  duration: number,
  out: { left: number; beacon: number; shadow: number; dark: number } = {
    left: 0,
    beacon: 0,
    shadow: 0,
    dark: 0,
  },
): { left: number; beacon: number; shadow: number; dark: number } {
  const left = duration > 0 ? Math.max(0, Math.min(1, remaining / duration)) : 0;
  const fall = rockFall(remaining, duration);
  const near = 1 - fall.height / ROCK_HANG_HEIGHT;
  out.left = left;
  out.beacon = 0.55 + 0.45 * (1 - left);
  out.shadow = 0.25 + 0.6 * near;
  out.dark = 0.25 + 0.5 * near;
  return out;
}

/** Resonance's ring round a marked player: its radius (the reach a pillar's
 *  face must be within) and its pulse. */
export function resonanceRing(clock: number, cracking: boolean): { radius: number; pulse: number } {
  const speed = cracking ? 9 : 3.2;
  return {
    radius: T.resonanceReach,
    pulse: 0.55 + 0.45 * Math.sin(clock * speed),
  };
}

/** The heroic pulse's ring round a pillar: out to its reach past the face. */
export function pulseRadius(pillarR: number): number {
  return pillarR + T.pulseReach;
}

/** The stream of stone light from a fallen member to a survivor: seconds it
 *  takes, and where a mote rides along it at `t` (0 to 1) with a lift. */
export const INHERIT_SECONDS = 2.2;
export function inheritArc(
  t: number,
  out: { along: number; lift: number } = { along: 0, lift: 0 },
): { along: number; lift: number } {
  const u = Math.max(0, Math.min(1, t));
  out.along = u * u * (3 - 2 * u);
  out.lift = Math.sin(u * Math.PI) * 6;
  return out;
}

/** The Wrath holder's gathering energy (0 to 100): its glow round the body
 *  and how often embers rise (a second). Above 80 it crackles. */
export function energyLook(energy: number): { glow: number; embers: number; crackle: boolean } {
  const e = Math.max(0, Math.min(1, energy / T.energyMax));
  return { glow: e * e, embers: 2 + e * 14, crackle: e >= 0.8 };
}

/** A Seam Bolt in flight: seconds from the Singer to its mark. */
export const BOLT_SECONDS = 0.38;

/** Hammer's Weight's slam: seconds the stone hammer takes to drop. */
export const WEIGHT_DROP_SECONDS = 0.28;

/** Is this cue one the council's painter draws in full (the renderer's
 *  generic draw of it skipped)? */
export function councilClaims(ability: string | undefined): boolean {
  if (!ability) return false;
  return (
    ability === COUNCIL_CUES.rise ||
    ability === COUNCIL_CUES.crack ||
    ability === COUNCIL_CUES.collapse ||
    ability === COUNCIL_CUES.rockImpact ||
    ability === COUNCIL_CUES.pulse ||
    ability === COUNCIL_CUES.inherit ||
    ability === COUNCIL_CUES.settle ||
    ability === COUNCIL_CUES.soulTake ||
    ability === COUNCIL_CUES.soulPip ||
    ability === COUNCIL_CUES.soulBurst ||
    ability === COUNCIL_CUES.echoBlast ||
    ability === COUNCIL_CUES.songPulse ||
    ability === COUNCIL_CUES.slabCrush ||
    ability === COUNCIL_CASTS.bolt ||
    ability === COUNCIL_CASTS.weight
  );
}

// ---- mythic: Soul in the Stone ------------------------------------------------------------

/** Each soul's own light, far apart in hue so a soul pillar is told from a
 *  plain one AND from another soul at a glance, on every tier: the
 *  Guardian's wrath an ember red-orange, the Slabwright's stone a jade
 *  green, the Seam Singer's song a sky blue (none of them the Wake circle's
 *  violet or the soak's gold). `core`/`edge` light the cracks (linear 0..1),
 *  `hex` the glow, the pips and the rings. */
export const SOUL_COLORS: Readonly<
  Record<
    CouncilRole,
    {
      core: readonly [number, number, number];
      edge: readonly [number, number, number];
      hex: number;
    }
  >
> = {
  guardian: { core: [1.0, 0.72, 0.42], edge: [1.0, 0.3, 0.1], hex: 0xff6a32 },
  slabwright: { core: [0.78, 1.0, 0.82], edge: [0.22, 0.86, 0.5], hex: 0x52e08a },
  singer: { core: [0.55, 0.82, 1.0], edge: [0.12, 0.42, 1.0], hex: 0x5aa8ff },
};

/** A soul pillar's look: its cracks always open and lit in the soul's
 *  colour (the more pips lost, the wider), its glow breathing, `charge`
 *  (0 to 1: the Echo's bar, the song's clock) brightening both. Fills `out`. */
export function soulPillarLook(
  pips: number,
  clock: number,
  charge: number,
  out: { crack: number; heat: number; glow: number } = { crack: 0, heat: 0, glow: 0 },
): { crack: number; heat: number; glow: number } {
  const lost = Math.max(0, T.soulPips - Math.max(0, Math.min(T.soulPips, pips)));
  const c = Math.max(0, Math.min(1, charge));
  const breath = 0.5 + 0.5 * Math.sin(clock * 2.2);
  out.crack = Math.min(1, 0.55 + lost * 0.18 + c * 0.2);
  out.heat = 0.9 + 0.35 * breath + c * 1.1;
  out.glow = 0.34 + 0.12 * breath + c * 0.45;
  return out;
}

/** The Echo of Wrath's ring round its pillar: the sim's own reach. */
export const ECHO_SPEC = {
  radius: T.echoRadius,
  color: TELEGRAPH_THREAT_COLORS.lethal,
  accent: SOUL_COLORS.guardian.hex,
  /** The shelter behind another pillar: a dark wedge, a pale rim. */
  shelter: 0x0e1626,
  shelterRim: 0xa8e4ff,
} as const;

/** How far inside the sim's own cover a drawn shelter's edge stands: the
 *  Echo's cover is `pillarBetween` (the wall's radius plus a 0.35 breath,
 *  council_pillars.ts), Mountain's Wrath's the sight line against the wall
 *  itself (ctx.hasLineOfSight). Drawn a hair inside each, so a player whose
 *  feet are in the dark is ALWAYS covered. */
export const SHELTER_PAD = { echo: 0.25, wrath: -0.05 } as const;

/** The real shadow a round cover (centre p, radius r) casts from a point
 *  source s out to `reach` from s: the floor between the two tangents from
 *  s, from the cover's far face outward (its width grows with the distance,
 *  never a needle from the cover's centre). Null when the cover is out of
 *  reach or s stands inside it. Fills `out`. Pure. */
export interface CoverShadow {
  sx: number;
  sz: number;
  px: number;
  pz: number;
  r: number;
  reach: number;
  /** Bearing from s through the cover's centre (sim convention) and the
   *  half angle the cover subtends at s. */
  yaw: number;
  half: number;
}

export function coverShadow(
  sx: number,
  sz: number,
  px: number,
  pz: number,
  r: number,
  reach: number,
  out: CoverShadow,
): CoverShadow | null {
  const dx = px - sx;
  const dz = pz - sz;
  const d = Math.hypot(dx, dz);
  if (r <= 0 || d <= r + 0.1 || d + r >= reach) return null;
  out.sx = sx;
  out.sz = sz;
  out.px = px;
  out.pz = pz;
  out.r = r;
  out.reach = reach;
  out.yaw = Math.atan2(dx, dz);
  out.half = Math.asin(Math.min(1, r / d));
  return out;
}

/** A point of a shadow's floor: `across` 0 to 1 tangent to tangent,
 *  `along` 0 at the cover's far face to 1 at the reach. Fills `out`. */
export function shadowPoint(
  sh: CoverShadow,
  across: number,
  along: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  const th = sh.yaw + (2 * Math.max(0, Math.min(1, across)) - 1) * sh.half * 0.995;
  const ux = Math.sin(th);
  const uz = Math.cos(th);
  const qx = sh.px - sh.sx;
  const qz = sh.pz - sh.sz;
  const t = qx * ux + qz * uz;
  const h2 = qx * qx + qz * qz - t * t;
  const near = t + Math.sqrt(Math.max(0, sh.r * sh.r - h2));
  const k = near + (sh.reach - near) * Math.max(0, Math.min(1, along));
  out.x = sh.sx + ux * k;
  out.z = sh.sz + uz * k;
  return out;
}

/** The Walking Slab's footprints: under it (a crush, lethal) and near it
 *  (the grind, danger), past its face. */
export function slabReach(pillarR: number): { crush: number; grind: number } {
  return { crush: pillarR + T.slabCrushReach, grind: pillarR + T.slabGrindReach };
}

/** The Endless Song's look at `pulses` sung: its next pulse's multiplier
 *  (the sim's), the rings a pulse throws (1 to 4) and their brightness, and
 *  the floor ring round the pillar (yards past its face). */
export function songLook(
  pulses: number,
  out: { mult: number; rings: number; bright: number; floor: number } = {
    mult: 1,
    rings: 1,
    bright: 0,
    floor: 0,
  },
): { mult: number; rings: number; bright: number; floor: number } {
  const mult = endlessSongMult(pulses);
  const share = (mult - 1) / (T.songPulseCap - 1);
  out.mult = mult;
  out.rings = 1 + Math.min(3, Math.floor(share * 4));
  out.bright = 0.45 + 0.55 * share;
  out.floor = 1.2 + share * 3;
  return out;
}

/** Pulses sung, read back off the song aura's next multiplier (its value:
 *  the wire omits a stack count of one, the multiplier always rides). */
export function songPulsesOf(nextMult: number): number {
  return Math.max(0, Math.round((nextMult - 1) / T.songPulseGrowth));
}

/** Seconds the soul takes to flow from the fallen into its pillar. */
export const SOUL_TAKE_SECONDS = 1.8;

// ---- mythic: the Walking Slab's own look ---------------------------------------------------

/** The Walking Slab's claws round its foot (the Heart kit's Kit_SlabClaw):
 *  each one's bearing off the slab's heading (degrees) and whether it reaches
 *  ahead and pulls (the front pair) or pushes from behind. */
export const SLAB_CLAWS: readonly { bear: number; ahead: boolean }[] = [
  { bear: -36, ahead: true },
  { bear: 36, ahead: true },
  { bear: 112, ahead: false },
  { bear: 180, ahead: false },
  { bear: 248, ahead: false },
];
/** Where a claw grips the column (yards from its axis), and its talon's
 *  reach past that grip. */
export const SLAB_CLAW_GRIP = 2.35;
export const SLAB_CLAW_REACH = 3.9;
/** Seconds of one pull while it drags at full pace. */
export const SLAB_PULL_SECONDS = 1.15;
/** The pull's phase when the front talons bite the floor (a gouge each). */
export const SLAB_BITE_PHASE = 0.5;
/** Seconds a gouge lies on the floor, fading. */
export const SLAB_GOUGE_SECONDS = 7;

const smooth01 = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** One pull of the Walking Slab at `phase` (0 to 1), `drag` how hard it moves
 *  (0 still, 1 full pace): a front claw's swing about its grip (radians, up
 *  and out above 0, dug in below), a rear claw's, the column's rock forward
 *  (radians) and its lurch (yards ahead of its sim spot, a surge on the
 *  pull). The front claws reach out (0 to 0.42), slam down and bite (to 0.5),
 *  then haul the stone forward (0.5 to 1) while the rear ones push. Fills
 *  `out`; still, everything rests (claws dug, the column upright). */
export function slabPull(
  phase: number,
  drag: number,
  out: { front: number; rear: number; rock: number; lurch: number } = {
    front: 0,
    rear: 0,
    rock: 0,
    lurch: 0,
  },
): { front: number; rear: number; rock: number; lurch: number } {
  const p = phase - Math.floor(phase);
  const d = Math.max(0, Math.min(1, drag));
  const reach = smooth01(0, 0.42, p) * (1 - smooth01(0.42, 0.5, p));
  const haul = smooth01(0.5, 1, p);
  out.front = d * (0.5 * reach - 0.16 * (p >= 0.5 ? 1 - haul * 0.6 : smooth01(0.42, 0.5, p)));
  out.rear = d * (0.22 * Math.sin(Math.PI * haul) - 0.06);
  out.rock = d * (0.07 * Math.sin(Math.PI * haul) - 0.02 * reach);
  out.lurch = d * (0.32 * Math.sin(Math.PI * haul) - 0.1);
  return out;
}

/** Where a claw's talon bites the floor, from the slab's centre (x, z) and
 *  heading: the claw's bearing, the grip and the reach. Fills `out`. */
export function slabTalon(
  x: number,
  z: number,
  heading: number,
  bear: number,
  scale: number,
  out: { x: number; z: number } = { x: 0, z: 0 },
): { x: number; z: number } {
  const a = heading + (bear * Math.PI) / 180;
  const r = (SLAB_CLAW_GRIP + SLAB_CLAW_REACH) * scale;
  out.x = x + Math.sin(a) * r;
  out.z = z + Math.cos(a) * r;
  return out;
}
