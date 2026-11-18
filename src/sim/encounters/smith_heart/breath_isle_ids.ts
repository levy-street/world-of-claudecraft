// The Islands of the Wind's leaf (the Guardian of the Breath, docs/design/raid/
// smith_heart.md section 7.2; the team's 50 percent phase of 2026-11-18,
// replacing the Gale Bulwark's rounds): every id the phase's sim, renderer,
// HUD, dev helpers, bots and tests key on, the per-tier rows, the SKETCH
// tuning, and the pure template codecs. Imports nothing; no SimContext, no rng.
//
// What every client reads (no wire or IWorld change; all of it rides
// existing entity fields):
//   - the Gale Cocoon: a marker aura on the guardian (it is untouchable
//     while it wears it) and Skyrend Nova, the guardian's channel bar (its
//     cast total and remaining: the nova's clock);
//   - an Updraft (`padTemplate`: from where to which isle, its radius in
//     `scale`): Captain Thessaly's jump pad, on the Cornice or on an isle;
//   - a body riding the gale: carried by a ride object (`rideTemplate`),
//     stunned, with the ride aura;
//   - an isle's Closing Storm (`closingTemplate`: the isle, the whole seconds
//     left and its whole): the ring that closes on the isle's floor; Sky's
//     Reckoning's strikes are the barrage's own strike objects;
//   - the isles' adds (real mobs), their bars (Mending Gale, Shoving Gale),
//     the Shieldbearer's ward (a marker aura on it, `FRONT_WARD_AURA`);
//   - a Stillstone (a usable body, the trash engine's G3 use) and its
//     stilling (a marker on the guardian per stone stilled, `stilled`).
//
// EVERY number is a SKETCH (bot-measured where the report says so).

/** The isles' adds (mob template ids). */
export const ISLE_MOBS = {
  /** First isle: the melee warden. */
  sentinel: 'heart_gale_sentinel',
  /** First isle: the caster who mends its allies (Mending Gale, kickable). */
  mender: 'heart_gale_mender',
  /** Second isle: the caster whose Shoving Gale throws a line of players
   *  toward the rim. */
  herald: 'heart_gust_herald',
  /** Second isle: the squall that splits in two as it falls. */
  squall: 'heart_riven_squall',
  /** One of the two halves a Riven Squall leaves. */
  fragment: 'heart_squall_fragment',
  /** Third isle: the warden whose shield turns aside every blow from the
   *  front (turn it: strike its back). */
  shieldbearer: 'heart_squall_shieldbearer',
  /** Third isle: the stone Thessaly's calm is bound into (the G3 use). */
  stillstone: 'heart_breath_stillstone',
} as const;

/** The isles' bars. */
export const ISLE_CASTS = {
  /** The guardian's channel inside its Gale Cocoon: when it ends, the nova. */
  nova: 'heart_breath_skyrend_nova',
  /** The Gale Mender's channel into its allies: a player interrupt cuts it
   *  (mob/healer_channel.ts SCRIPTED_INTERRUPTIBLE_CHANNELS). */
  mending: 'heart_breath_mending_gale',
  /** The Gust Herald's bar: a line of wind toward its mark. */
  shove: 'heart_breath_shoving_gale',
  /** A player's use on a Stillstone (the G3 use's cast id). */
  still: 'kituse_heart_still_the_gale',
} as const;

/** The player interrupt's school for the Mender's channel. */
export const ISLE_CAST_SCHOOLS: Readonly<Record<string, { school: 'nature' }>> = {
  [ISLE_CASTS.mending]: { school: 'nature' },
};

export const ISLE_AURAS = {
  /** On the guardian through the phase: untouchable, the nova gathering
   *  (value: the Stillstones stilled, value2: how many there are). */
  cocoon: 'heart_breath_gale_cocoon',
  /** On the guardian with it: its own root, so it holds where it began. */
  hold: 'heart_breath_cocoon_hold',
  /** On a body the wind carries (an unbreakable stun). */
  riding: 'heart_breath_riding_gale',
  /** On the Shieldbearer: its frontal ward (combat/front_ward.ts). */
  ward: 'heart_breath_squall_ward',
} as const;

export const ISLE_OBJECTS = {
  /** An Updraft: `<prefix><from>_<to>` (`from` c for the Cornice, else an
   *  isle; `to` an isle, or h for home). */
  padPrefix: 'sh_breath_updraft_',
  /** The carrier of a ride: `<prefix><out|home>_<isle>_<tenths>`. */
  ridePrefix: 'sh_breath_gale_ride_',
  /** An isle's Closing Storm: `<prefix><isle>_<left>_<whole>` (seconds). */
  closingPrefix: 'sh_breath_closing_',
} as const;

export const ISLE_CUES = {
  /** The cocoon closes round the guardian (spellfx 'nova' on it). */
  cocoonUp: 'heart_breath_cocoon_up',
  /** The cocoon shatters, the nova cut (spellfx 'nova' on the guardian). */
  cocoonBreak: 'heart_breath_cocoon_break',
  /** Skyrend Nova lands (spellfx 'nova' on the guardian). */
  novaBurst: 'heart_breath_nova_burst',
  /** Thessaly raises an Updraft (spellfxAt 'burst' at the pad). */
  padUp: 'heart_breath_updraft_up',
  /** A Stillstone is stilled (spellfx 'beam' stone to guardian). */
  stilled: 'heart_breath_stillstone_stilled',
  /** Mending Gale lands (spellfx 'beam' Mender to the add it mends). */
  mended: 'heart_breath_mended',
  /** A Riven Squall splits (spellfxAt 'burst'). */
  split: 'heart_breath_squall_split',
  /** Shoving Gale lands (spellfx 'nova' on the Herald). */
  shoved: 'heart_breath_shoving_landed',
  /** A ride begins (spellfxAt 'burst' at the pad). */
  rideUp: 'heart_breath_ride_up',
  /** A ride lands (spellfxAt 'burst' where it set the body down). */
  rideDown: 'heart_breath_ride_down',
  /** An isle's adds rise (spellfxAt 'burst' at the isle). */
  isleWake: 'heart_breath_isle_wake',
  /** An isle's Closing Storm runs out: Sky's Reckoning begins there. */
  reckoning: 'heart_breath_sky_reckoning',
} as const;

/** Damage and aura names (re-localized by src/ui/sim_i18n.ts). */
export const ISLE_NAMES = {
  cocoon: 'Gale Cocoon',
  nova: 'Skyrend Nova',
  mending: 'Mending Gale',
  shove: 'Shoving Gale',
  riding: 'Riding the Gale',
  pad: 'Updraft',
  closing: 'Closing Storm',
  reckoning: "Sky's Reckoning",
  ward: 'Squall Ward',
  still: 'Still the Gale',
} as const;

/** One tier's row of the phase (BREATH_DIFFICULTY's names). */
export interface IsleTier {
  /** Skyrend Nova's channel (seconds): the whole phase's clock. */
  novaSeconds: number;
  /** The nova's blow, a share of each player's whole health (over 1: a
   *  wipe, whatever shields them). */
  novaShare: number;
  /** An isle's Closing Storm (seconds from the first rider's landing). */
  closingSeconds: number;
  /** Sky's Reckoning: a strike under each player on the isle every
   *  `reckonEvery` seconds, each a share of the struck one's whole health. */
  reckonEvery: number;
  reckonShare: number;
  /** The adds' health (set as they rise; the tier's addHealthMult on top). */
  sentinelHealth: number;
  menderHealth: number;
  heraldHealth: number;
  squallHealth: number;
  fragmentHealth: number;
  shieldHealth: number;
  /** The ward's cut of a blow from the front, and its arc's half (degrees). */
  wardCut: number;
  wardHalfDeg: number;
  /** Shoving Gale: how far it throws, and whether it is held short of the
   *  rim (Normal: a step from the lip at most; Heroic: off it). */
  shoveYards: number;
  shoveSafe: boolean;
  /** Mending Gale: the share of each mended add's whole it restores. */
  mendShare: number;
}

export const ISLE_TIERS: Readonly<Record<'normal' | 'heroic' | 'mythic', IsleTier>> = {
  normal: {
    novaSeconds: 150,
    novaShare: 0.9,
    closingSeconds: 50,
    reckonEvery: 2.5,
    reckonShare: 0.16,
    sentinelHealth: 2300,
    menderHealth: 1300,
    heraldHealth: 1500,
    squallHealth: 1700,
    fragmentHealth: 650,
    shieldHealth: 3000,
    wardCut: 0.85,
    wardHalfDeg: 60,
    shoveYards: 12,
    shoveSafe: true,
    mendShare: 0.2,
  },
  heroic: {
    novaSeconds: 125,
    novaShare: 3,
    closingSeconds: 38,
    reckonEvery: 2,
    reckonShare: 0.3,
    sentinelHealth: 2300,
    menderHealth: 1300,
    heraldHealth: 1500,
    squallHealth: 1700,
    fragmentHealth: 650,
    shieldHealth: 3000,
    wardCut: 0.9,
    wardHalfDeg: 70,
    shoveYards: 20,
    shoveSafe: false,
    mendShare: 0.3,
  },
  // Heroic whole for now (the mythic ideas are in the design doc).
  mythic: {
    novaSeconds: 125,
    novaShare: 3,
    closingSeconds: 38,
    reckonEvery: 2,
    reckonShare: 0.3,
    sentinelHealth: 2300,
    menderHealth: 1300,
    heraldHealth: 1500,
    squallHealth: 1700,
    fragmentHealth: 650,
    shieldHealth: 3000,
    wardCut: 0.9,
    wardHalfDeg: 70,
    shoveYards: 20,
    shoveSafe: false,
    mendShare: 0.3,
  },
};

export const ISLE_TUNING = {
  /** The guardian's health the phase begins at (a share of its whole):
   *  nothing takes it under this until the phase is over. */
  at: 0.5,
  /** The Mender's channel: first after it rises, then this often, how long. */
  mendFirst: 5,
  mendEvery: 10,
  mendCast: 3,
  /** Shoving Gale: first, then this often; its bar; its line's half width
   *  and reach; the slide's seconds. */
  shoveFirst: 4,
  shoveEvery: 9,
  shoveCast: 2.5,
  shoveHalfWidth: 2.5,
  shoveReach: 26,
  shoveSlide: 0.7,
  /** Normal's held throw stops this far in from the isle's rim. */
  shoveLipMargin: 2.2,
  /** Sky's Reckoning's strikes: their warning (seconds) and reach (yards). */
  reckonWarn: 1.3,
  reckonR: 3.2,
  /** An Updraft's reach, how far inside a rim it stands. */
  padR: 2.6,
  padInset: 5,
  /** A ride: its seconds and how high its arc climbs over the higher end. */
  rideSeconds: 3.2,
  rideApex: 11,
  /** A body set down by a ride does not take a pad again for this long. */
  rideGrace: 1.5,
  /** The phase's end: the raid rides home, then the storm breaks after this. */
  homeSeconds: 4,
} as const;

/** The pad's ends: `from` the Cornice (-1) or an isle, `to` an isle or home (-1). */
export function padTemplate(from: number, to: number): string {
  return `${ISLE_OBJECTS.padPrefix}${from < 0 ? 'c' : from}_${to < 0 ? 'h' : to}`;
}

/** A pad template's ends, or null. */
export function padOf(templateId: string): { from: number; to: number } | null {
  if (!templateId.startsWith(ISLE_OBJECTS.padPrefix)) return null;
  const [a, b] = templateId.slice(ISLE_OBJECTS.padPrefix.length).split('_');
  const from = a === 'c' ? -1 : Number(a);
  const to = b === 'h' ? -1 : Number(b);
  if (!Number.isInteger(from) || from < -1 || !Number.isInteger(to) || to < -1) return null;
  if (from < 0 && to < 0) return null;
  return { from, to };
}

/** A ride carrier's template: out to an isle or home, which, and how long. */
export function rideTemplate(dir: 'out' | 'home', isle: number, seconds: number): string {
  return `${ISLE_OBJECTS.ridePrefix}${dir}_${isle}_${Math.max(0, Math.round(seconds * 10))}`;
}

/** A ride carrier template's parts, or null. */
export function rideOf(
  templateId: string,
): { dir: 'out' | 'home'; isle: number; seconds: number } | null {
  if (!templateId.startsWith(ISLE_OBJECTS.ridePrefix)) return null;
  const [dir, isle, tenths] = templateId.slice(ISLE_OBJECTS.ridePrefix.length).split('_');
  if (dir !== 'out' && dir !== 'home') return null;
  const i = Number(isle);
  const t = Number(tenths);
  if (!Number.isInteger(i) || i < 0 || !Number.isInteger(t) || t < 0) return null;
  return { dir, isle: i, seconds: t / 10 };
}

/** A Closing Storm's template: the isle, the whole seconds left, its whole. */
export function closingTemplate(isle: number, left: number, whole: number): string {
  return `${ISLE_OBJECTS.closingPrefix}${isle}_${Math.max(0, Math.ceil(left - 1e-9))}_${Math.max(1, Math.round(whole))}`;
}

/** A Closing Storm template's parts, or null. */
export function closingOf(
  templateId: string,
): { isle: number; left: number; whole: number } | null {
  if (!templateId.startsWith(ISLE_OBJECTS.closingPrefix)) return null;
  const [a, b, c] = templateId.slice(ISLE_OBJECTS.closingPrefix.length).split('_').map(Number);
  if (![a, b, c].every((n) => Number.isInteger(n) && n >= 0) || c < 1) return null;
  return { isle: a, left: b, whole: c };
}
