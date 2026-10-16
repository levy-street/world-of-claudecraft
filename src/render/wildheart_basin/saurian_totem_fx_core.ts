// Pure plan for the Great Saurian's totem rework and its heroic drum
// (saurian_totem_fx.ts): how tall a Sunbone Sap Totem stands and where its
// crown is, the arc of the rider's throw, the sap tether's life (it charges
// through the totem's arming bar, then feeds; a pulse runs down it on every
// mending, a white snap on the break), the ring that marks a totem as the
// thing to break, the beacon over it, and the drum: where it rides the
// howdah, its sticks on a beat, the pulse a beat throws.
//
// Three-free, DOM-free, deterministic.

import { MOBS } from '../../sim/data';
import { SAP_TOTEM_ID, SAURIAN_TUNING } from '../../sim/encounters/wildheart_basin/ids';
import { SUN_TOTEM_MODEL, TOTEM_CLIP, TOTEM_SIM_SCALE } from './basin_trash_model_core';
import { SAURIAN_MODEL, saurianModelScale } from './saurian_model_core';

// ---- the totem's body --------------------------------------------------------------

/** The Sap Totem's sim scale (sim/content/wildheart.ts sunbone_sap_totem). */
export const SAP_TOTEM_SIM_SCALE = MOBS[SAP_TOTEM_ID]?.scale ?? 2;

/** How tall the Sap Totem is drawn (yards): the Sunbone Totem's post grown to
 *  its own scale (the post stands 6.6 yd at 1.6): over three players. */
export function sapTotemHeight(scale = SAP_TOTEM_SIM_SCALE): number {
  return ((SUN_TOTEM_MODEL.idleTop - SUN_TOTEM_MODEL.idleMin) * scale) / TOTEM_SIM_SCALE;
}

/** The height the tether leaves the totem at (the jaguar skull under its bone
 *  sun), as a share of its drawn height. */
export const SAP_TOTEM_CROWN = 0.86;

/** The war red the rider's totem is washed in (the Howdah Hexcaller's own),
 *  so it never reads as a Totem-Binder's. */
export const SAP_TOTEM_TINT = 0xa3322a;
export const SAP_TOTEM_TINT_STRENGTH = 0.45;

/** The sap's colours: the sickly gold-green of the tether and its hot core,
 *  and the white-red of a tether snapping. */
export const SAP_COLORS = {
  sap: 0xc6f25a,
  core: 0xfff0a0,
  snap: 0xffd0b0,
} as const;

// ---- the throw ----------------------------------------------------------------------

/** Seconds the thrown bundle is in the air: the totem's own Rise clip keeps
 *  its body under the ford until this beat, so it erupts where the bundle
 *  lands. */
export const TOTEM_THROW_SECONDS = TOTEM_CLIP.riseUp;
/** How high over the straight line the throw arcs (yards). */
export const TOTEM_THROW_APEX = 5;
/** Seconds the Rise gesture stays on offer (its view may land a frame late). */
export const TOTEM_RISE_OFFER = 0.5;

/** The thrown bundle `t` seconds after it left the howdah: its place on the
 *  arc (0..1 of the way), its lift over the straight line and its spin; null
 *  once it has landed. */
export function totemThrow(
  t: number,
  out: { along: number; lift: number; spin: number } = { along: 0, lift: 0, spin: 0 },
): { along: number; lift: number; spin: number } | null {
  if (t < 0 || t >= TOTEM_THROW_SECONDS) return null;
  const u = t / TOTEM_THROW_SECONDS;
  out.along = u;
  out.lift = 4 * TOTEM_THROW_APEX * u * (1 - u);
  out.spin = t * 9;
  return out;
}

// ---- the tether ---------------------------------------------------------------------

/** Seconds a mending's pulse takes to run the tether, totem to beast, and a
 *  break's snap. */
export const SAP_PULSE_SECONDS = 0.45;
export const SAP_SNAP_SECONDS = 0.3;

/**
 * The tether of a standing totem. `charge` is how far it reaches toward the
 * beast (it grows through the totem's arming bar, then holds), `strength` how
 * thick and bright it burns (thin while it arms, full once it feeds).
 * `arming` is whether its bar is the longer arming one, `fill` the bar's own
 * 0..1.
 */
export function sapTether(
  arming: boolean,
  fill: number,
  out: { charge: number; strength: number } = { charge: 0, strength: 0 },
): { charge: number; strength: number } {
  const f = Math.min(1, Math.max(0, fill));
  if (arming) {
    out.charge = 0.12 + 0.88 * f;
    out.strength = 0.3 + 0.35 * f;
  } else {
    out.charge = 1;
    // It swells toward each mending.
    out.strength = 0.72 + 0.28 * f;
  }
  return out;
}

/** Is a totem's bar its arming bar (the longer first one)? */
export function sapTotemArming(castTotal: number): boolean {
  return castTotal > SAURIAN_TUNING.totemHealEvery + 0.01;
}

/** Where a pulse is on the tether `t` seconds after it left (0..1), or -1
 *  once it has arrived. */
export function sapPulse(t: number, seconds = SAP_PULSE_SECONDS): number {
  if (t < 0 || t >= seconds) return -1;
  const u = t / seconds;
  return u * u * (3 - 2 * u);
}

/** How far a tether's middle hangs under the straight line, for a span. */
export function sapSag(span: number): number {
  return Math.min(4, span * 0.09);
}

/** The ring at a totem's foot (yards): a step wider than its plinth. */
export const SAP_RING_RADIUS = 2.6;
/** The beacon over a totem (yards over its crown): seen from across the ford
 *  and over the Saurian's back. */
export const SAP_BEACON_HEIGHT = 16;

/** Where the tether ties onto the Saurian (model space: its withers, under
 *  the howdah), at sim `scale`: yards over the ground and forward of centre. */
export function sapAnchor(scale: number): { up: number; forward: number } {
  const k = saurianModelScale(scale);
  return { up: SAURIAN_MODEL.deckTop * 0.78 * k, forward: (SAURIAN_MODEL.deckZ + 1.6) * k };
}

// ---- the drum -----------------------------------------------------------------------

export const DRUM_LOOK = {
  /** The drum's skin (yards across) and its barrel's height. */
  radius: 1.5,
  height: 1.3,
  /** The drummer, seated behind it: taller than a player on foot. */
  drummer: 3.4,
  /** Where the drum rides (model yards over the deck, along the body): on
   *  a platform lashed to the howdah's roof (measured on the model: the roof
   *  stands 4.6 over the deck from the shoulders to 3 yd aft; inside the
   *  cage the bars hid it), so it reads from anywhere on the ford. */
  seat: { x: 0, y: 4.65, z: -0.4 },
  /** The platform under the drum and its drummer (yards across). */
  platform: 2.9,
  /** The beat's ring in the air round the howdah (yards), and on the ford. */
  airRing: 7,
  groundRing: SAURIAN_TUNING.stompRadius,
  beatSeconds: 0.5,
} as const;

/** The drummer's two sticks `t` seconds after a beat (radians down from
 *  raised): the right falls on the beat and lifts, the left follows half a
 *  beat on. Silenced, both hang. */
export function drumSticks(
  t: number,
  beating: boolean,
  out: { right: number; left: number } = { right: 0, left: 0 },
): { right: number; left: number } {
  if (!beating) {
    out.right = 1.25;
    out.left = 1.25;
    return out;
  }
  const strike = (dt: number): number => {
    const u =
      ((dt % SAURIAN_TUNING.drumBeatEvery) + SAURIAN_TUNING.drumBeatEvery) %
      SAURIAN_TUNING.drumBeatEvery;
    // Down in a tenth of a second, up over the rest.
    return u < 0.1 ? 1.1 * (u / 0.1) : 1.1 * (1 - (u - 0.1) / (SAURIAN_TUNING.drumBeatEvery - 0.1));
  };
  out.right = strike(t + 0.1);
  out.left = strike(t + 0.1 + SAURIAN_TUNING.drumBeatEvery / 2);
  return out;
}

/** The drum skin's flash `t` seconds after a beat (1 on the beat, gone by
 *  DRUM_LOOK.beatSeconds), and the air ring's radius and brightness. */
export function drumBeat(
  t: number,
  out: { flash: number; radius: number; alpha: number } = { flash: 0, radius: 0, alpha: 0 },
): { flash: number; radius: number; alpha: number } {
  if (t < 0 || t >= DRUM_LOOK.beatSeconds) {
    out.flash = 0;
    out.radius = 0;
    out.alpha = 0;
    return out;
  }
  const u = t / DRUM_LOOK.beatSeconds;
  out.flash = (1 - u) * (1 - u);
  out.radius = DRUM_LOOK.airRing * (0.15 + 0.85 * (1 - (1 - u) * (1 - u)));
  out.alpha = 1 - u;
  return out;
}

/** How many of each pooled look the painter builds: the three totems that
 *  can stand and a spare; the throws in the air at once. */
export const SAP_POOLS = { totems: SAURIAN_TUNING.totemMax + 1, throws: 2 } as const;

// ---- the rider, the break -------------------------------------------------------------

/** Where the Hexcaller sits in the howdah (model yards: up from the ground,
 *  forward of centre): his hands, a head over the deck. */
export function riderHands(scale: number): { up: number; forward: number } {
  const k = saurianModelScale(scale);
  return { up: (SAURIAN_MODEL.deckTop + 1.7) * k, forward: (SAURIAN_MODEL.deckZ + 0.6) * k };
}

/** Where the drum rides (model yards: up from the ground, forward of centre). */
export function drumSeat(scale: number): { up: number; forward: number } {
  const k = saurianModelScale(scale);
  return {
    up: (SAURIAN_MODEL.deckTop + DRUM_LOOK.seat.y) * k,
    forward: (SAURIAN_MODEL.deckZ + DRUM_LOOK.seat.z) * k,
  };
}

/** Seconds the rider's throw flare burns (the hex gathering in his hands,
 *  then flung). */
export const RIDER_FLARE_SECONDS = 0.9;

/** The rider's flare `t` seconds after a throw: gathers for a third of its
 *  life, then bursts and fades. 0 outside it. */
export function riderFlare(t: number): number {
  if (t < 0 || t >= RIDER_FLARE_SECONDS) return 0;
  const u = t / RIDER_FLARE_SECONDS;
  if (u < 0.3) return 0.35 + 0.65 * (u / 0.3);
  const v = (u - 0.3) / 0.7;
  return (1 - v) * (1 - v);
}

/** The ember the rider holds between throws while the howdah stands and the
 *  beast fights: breathing, never out. */
export function riderEmber(clock: number): number {
  return 0.32 + 0.12 * Math.sin(clock * 3.1) + 0.06 * Math.sin(clock * 7.7);
}

/** Seconds a broken totem's burst lives (flash, splinters landing), and the
 *  flash `t` seconds in. */
export const SAP_BREAK_SECONDS = 1.6;
export function sapBreakFlash(t: number): number {
  if (t < 0 || t >= 0.6) return 0;
  const u = t / 0.6;
  return (1 - u) * (1 - u);
}

/** A mending's flare at the crown and on the beast `t` seconds after it
 *  left (the crown at once, the beast when the pulse arrives). */
export function sapMendFlare(t: number, atBeast: boolean): number {
  const t0 = atBeast ? SAP_PULSE_SECONDS : 0;
  const u = (t - t0) / 0.55;
  if (u < 0 || u >= 1) return 0;
  return (1 - u) * (1 - u);
}

/** The splinters a break throws (carved red wood, bone, dark heartwood), on
 *  the full tier; the low tier keeps a share, never none. */
export const SAP_SHARDS = { full: 44, min: 12 } as const;
export function sapShardCount(density: number): number {
  return Math.max(SAP_SHARDS.min, Math.round(SAP_SHARDS.full * density));
}
