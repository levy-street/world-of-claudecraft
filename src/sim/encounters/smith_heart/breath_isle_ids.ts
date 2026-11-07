// The Islands of the Wind's leaf (the Guardian of the Breath, docs/design/raid/
// smith_heart.md section 7.2; the owner's idea of 2026-11-03): every id the
// isles' sim, renderer, HUD, dev helpers and tests key on, the SKETCH tuning,
// and the pure template codecs. Imports nothing; no SimContext, no rng.
//
// What every client reads (no wire or IWorld change; all of it rides
// existing entity fields):
//   - the Gale Bulwark: an absorb aura on the guardian (its value the shield
//     left, `value2` its whole), and the guardian's channel bar while it holds;
//   - a Gale Path on the Cornice (an object, `galePathTemplate`: which isle)
//     and a Homeward Gale on an isle (`homeGaleTemplate`), their radius in
//     `scale`;
//   - a body riding the gale: carried by a ride object (`rideTemplate`: which
//     isle, out or home, the ride's length), stunned, with the ride aura;
//   - the isles' adds (real mobs) and the Gale Mender's channel (its bar);
//   - Mythic's Windworn (an aura on the player).
//
// EVERY number is a SKETCH (unmeasured), anchored to the fight's (about
// 99,000 health after the elite factor, a bot raid of 400 to 460 a second).

/** The isles' adds (mob template ids). */
export const ISLE_MOBS = {
  /** The melee warden of an isle. */
  sentinel: 'heart_gale_sentinel',
  /** The caster who channels Mending Gale into the Bulwark (kickable). */
  mender: 'heart_gale_mender',
} as const;

/** The isles' bars (on the guardian and on the Gale Mender). */
export const ISLE_CASTS = {
  /** The guardian holds still behind its Gale Bulwark (a channel bar). */
  bulwark: 'heart_breath_gale_bulwark',
  /** The Gale Mender's channel into the Bulwark: a player interrupt cuts it
   *  (mob/healer_channel.ts SCRIPTED_INTERRUPTIBLE_CHANNELS). */
  mending: 'heart_breath_mending_gale',
} as const;

/** The player interrupt's school for the Mender's channel. */
export const ISLE_CAST_SCHOOLS: Readonly<Record<string, { school: 'nature' }>> = {
  [ISLE_CASTS.mending]: { school: 'nature' },
};

export const ISLE_AURAS = {
  /** On the guardian: the shield (an absorb; value2 its whole). */
  bulwark: 'heart_breath_gale_bulwark',
  /** On the guardian with it: its own root, so it holds where it raised it. */
  hold: 'heart_breath_bulwark_hold',
  /** On a body the wind carries to or from an isle (an unbreakable stun). */
  riding: 'heart_breath_riding_gale',
  /** Mythic: rode the wind already; no Gale Path takes this player again. */
  windworn: 'heart_breath_windworn',
} as const;

export const ISLE_OBJECTS = {
  /** A Gale Path on the Cornice: `<prefix><isle>` (galePathTemplate). */
  pathPrefix: 'sh_breath_gale_path_',
  /** A Homeward Gale on an isle: `<prefix><isle>`. */
  homePrefix: 'sh_breath_home_gale_',
  /** The carrier of a ride: `<prefix><out|home>_<isle>_<tenths>`. */
  ridePrefix: 'sh_breath_gale_ride_',
} as const;

export const ISLE_CUES = {
  /** The Bulwark rises (spellfx 'nova' on the guardian). */
  bulwarkUp: 'heart_breath_bulwark_up',
  /** The Bulwark breaks (spellfx 'nova' on the guardian). */
  bulwarkBreak: 'heart_breath_bulwark_break',
  /** The Bulwark bursts by itself, too long held (spellfx 'nova'). */
  bulwarkBurst: 'heart_breath_bulwark_burst',
  /** Mending Gale lands on the Bulwark (spellfx 'beam' Mender to guardian). */
  mended: 'heart_breath_mended',
  /** A ride begins (spellfxAt 'burst' at the circle). */
  rideUp: 'heart_breath_ride_up',
  /** A ride lands (spellfxAt 'burst' where it set the body down). */
  rideDown: 'heart_breath_ride_down',
  /** An isle's adds rise (spellfxAt 'burst' at the isle). */
  isleWake: 'heart_breath_isle_wake',
} as const;

/** Damage and aura names (re-localized by src/ui/sim_i18n.ts). */
export const ISLE_NAMES = {
  bulwark: 'Gale Bulwark',
  burst: 'Bulwark Burst',
  mending: 'Mending Gale',
  riding: 'Riding the Gale',
  windworn: 'Windworn',
  path: 'Gale Path',
  home: 'Homeward Gale',
} as const;

export const ISLE_TUNING = {
  /** The Bulwark's whole, as a share of the guardian's health. */
  bulwarkShare: 0.07,
  /** While any add of the round lives: the share of the whole it regrows
   *  each second (beyond the Cornice raid's damage on its own). */
  regrowShare: 0.05,
  /** Too long held: it bursts by itself after this, striking the Cornice. */
  bulwarkMax: 75,
  burstMin: 480,
  burstMax: 560,
  /** The Gale Mender's channel: first after it rises, then this often; how
   *  long it channels and the share of the whole it restores. */
  mendFirst: 5,
  mendEvery: 9,
  mendCast: 3,
  mendShare: 0.35,
  /** The adds' health (set as they rise; the elite factor is the claim's). */
  sentinelHealth: 1700,
  menderHealth: 1150,
  /** A circle's reach, how far inside the rim a Gale Path stands. */
  circleR: 2.6,
  pathInset: 6,
  /** A ride: its seconds and how high its arc climbs over the higher end. */
  rideSeconds: 3.2,
  rideApex: 11,
  /** A body set down by a ride does not take a circle again for this long. */
  rideGrace: 1.5,
} as const;

/** A Gale Path's template: the isle it carries to. */
export function galePathTemplate(isle: number): string {
  return `${ISLE_OBJECTS.pathPrefix}${isle}`;
}

/** A Homeward Gale's template: the isle it stands on. */
export function homeGaleTemplate(isle: number): string {
  return `${ISLE_OBJECTS.homePrefix}${isle}`;
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

/** The isle a Gale Path or a Homeward Gale template names, or null. */
export function isleCircleOf(templateId: string): { kind: 'path' | 'home'; isle: number } | null {
  for (const [kind, prefix] of [
    ['path', ISLE_OBJECTS.pathPrefix],
    ['home', ISLE_OBJECTS.homePrefix],
  ] as const) {
    if (!templateId.startsWith(prefix)) continue;
    const i = Number(templateId.slice(prefix.length));
    return Number.isInteger(i) && i >= 0 ? { kind, isle: i } : null;
  }
  return null;
}
