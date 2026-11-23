// Choirmother Selthe's Score: the pure plan behind temple_score_fx.ts (sim:
// src/sim/encounters/drowned_temple/selthe_score.ts). No Three, no DOM.
//
// A moon tile reads in six states, and every state has a SHAPE as well as a
// light, so the order survives a colour-blind eye, the low preset and a
// zoomed-out camera:
//   dark  a thin dormant rim, nothing else (also the heroic answer: hidden);
//   note  the whole disc full, a pillar of light, its place as pips on the
//         disc and a numeral standing over it;
//   lit   a soft disc with its pips and its numeral (part of the melody);
//   next  the same, CALLED OUT: rings closing on its centre, a thin beacon,
//         the numeral bobbing (motion, not colour, says "this one now");
//   done  a full moon, warm, steady (sounded in its turn);
//   sour  a cross struck through it (stepped out of turn).
// The place is drawn twice on purpose: pips on the floor (they read the same
// from every side) and a numeral in the air (it reads from far away).

import {
  COURT,
  MOON_TILE_MAX_PLACE,
  type MoonTileState,
  SELTHE_SCORE,
  SELTHE_SCORE_ANSWER,
} from '../../sim/encounters/drowned_temple/ids';

export interface MoonTileLook {
  /** The halo round the disc and the light inside it, 0 to 1. */
  glow: number;
  /** The rim's brightness, 0 to 1. */
  rim: number;
  /** How much of the disc is a full moon, 0 to 1. */
  fill: number;
  /** Pips drawn on the disc: the tile's place, 0 for none. */
  pips: number;
  /** The numeral standing over the tile: its place, 0 for none. */
  numeral: number;
  /** The call-out (closing rings, beacon, bob), 0 or 1. */
  call: number;
  /** The pillar of light over it, 0 to 1. */
  pillar: number;
  /** The cross struck through it, 0 or 1. */
  sour: number;
  /** Moon silver (0) to the warm gold of a tile sounded in its turn (1). */
  warm: number;
}

const LOOKS: Readonly<Record<MoonTileState, Omit<MoonTileLook, 'pips' | 'numeral'>>> = {
  dark: { glow: 0.14, rim: 0.34, fill: 0, call: 0, pillar: 0, sour: 0, warm: 0 },
  note: { glow: 1, rim: 1, fill: 0.9, call: 0, pillar: 1, sour: 0, warm: 0.2 },
  lit: { glow: 0.62, rim: 0.85, fill: 0.34, call: 0, pillar: 0, sour: 0, warm: 0 },
  next: { glow: 0.95, rim: 1, fill: 0.46, call: 1, pillar: 0.5, sour: 0, warm: 0 },
  done: { glow: 0.75, rim: 0.92, fill: 1, call: 0, pillar: 0, sour: 0, warm: 1 },
  sour: { glow: 0.7, rim: 0.9, fill: 0.3, call: 0, pillar: 0, sour: 1, warm: 0 },
};

/** A fresh look to write into (one per tile slot, reused every frame). */
export function newMoonTileLook(): MoonTileLook {
  return { glow: 0, rim: 0, fill: 0, pips: 0, numeral: 0, call: 0, pillar: 0, sour: 0, warm: 0 };
}

/** What a tile in `state`, at `place` in the melody, shows. Written into
 *  `out` (no allocation on the frame path). */
export function moonTileLook(
  state: MoonTileState,
  place: number,
  out: MoonTileLook = newMoonTileLook(),
): MoonTileLook {
  const look = LOOKS[state];
  out.glow = look.glow;
  out.rim = look.rim;
  out.fill = look.fill;
  out.call = look.call;
  out.pillar = look.pillar;
  out.sour = look.sour;
  out.warm = look.warm;
  // A dormant or soured tile shows no place (heroic hides the order this way).
  const n =
    state === 'dark' || state === 'sour'
      ? 0
      : Math.max(0, Math.min(MOON_TILE_MAX_PLACE, Math.floor(place)));
  out.pips = n;
  out.numeral = n;
  return out;
}

/** The strokes of a numeral, as the shader's eight switches: the seven
 *  segments a, b, c, d, e, f, g (top, upper right, lower right, bottom, lower
 *  left, upper left, middle) and an eighth, a centred upright, which is how a
 *  1 is drawn so it sits in the middle of its plate. */
const STROKES: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 0, 1, 1, 0, 1, 0],
  [1, 1, 1, 1, 0, 0, 1, 0],
  [0, 1, 1, 0, 0, 1, 1, 0],
];

export function numeralStrokes(digit: number): readonly number[] {
  return STROKES[Math.max(0, Math.min(MOON_TILE_MAX_PLACE, Math.floor(digit)))];
}

/** Where pip `i` of `count` sits on the unit disc (a die's face: one in the
 *  middle, two side by side, three in a triangle, four in a square). */
export function pipSpot(i: number, count: number, out: { x: number; y: number }): void {
  if (count <= 1) {
    out.x = 0;
    out.y = 0;
    return;
  }
  const turn = count === 2 ? Math.PI / 2 : count === 4 ? Math.PI / 4 : 0;
  const a = (Math.PI * 2 * i) / count + turn;
  out.x = Math.sin(a) * PIP_RING;
  out.y = Math.cos(a) * PIP_RING;
}
/** The pips' ring and their size, as shares of the tile's radius. */
export const PIP_RING = 0.42;
export const PIP_RADIUS = 0.15;

/** How high over the floor a tile's numeral stands and how tall it is (yards):
 *  over a player's head, so a body on the tile never hides it. */
export const NUMERAL_HEIGHT = 4.7;
export const NUMERAL_SIZE = 2.1;
/** A ringing note's pillar and the call-out's beacon (yards). */
export const NOTE_PILLAR_HEIGHT = 13;
export const BEACON_HEIGHT = 7;

/** Is she singing the Score (her ward's water stands round her)? */
export function scoreSinging(castingAbility: string | null | undefined): boolean {
  return castingAbility === SELTHE_SCORE || castingAbility === SELTHE_SCORE_ANSWER;
}

/** How tall her ward's water stands, 0 to 1: full through the melody, then
 *  sinking with the verse's own clock so the water IS the time left. */
export function scoreVeilLevel(
  castingAbility: string | null | undefined,
  castRemaining: number,
  castTotal: number,
): number {
  if (castingAbility === SELTHE_SCORE) return 1;
  if (castingAbility !== SELTHE_SCORE_ANSWER) return 0;
  const left = castTotal > 0 ? Math.max(0, Math.min(1, castRemaining / castTotal)) : 0;
  return 0.3 + 0.7 * left;
}

/** Discord: the wave of sound rolls from her to the court's rim. */
export const DISCORD_SECONDS = 1.1;
export const DISCORD_REACH = COURT.r + 12;

export interface DiscordWave {
  radius: number;
  height: number;
  alpha: number;
}

/** The wave `age` seconds after Discord (null once it has passed). */
export function discordWave(age: number, out: DiscordWave): DiscordWave | null {
  if (age < 0 || age >= DISCORD_SECONDS) return null;
  const k = age / DISCORD_SECONDS;
  // Fast off her, slowing to the rim.
  out.radius = 3 + (DISCORD_REACH - 3) * (1 - (1 - k) * (1 - k));
  out.height = 1.2 + 7 * Math.sin(Math.PI * Math.min(1, k * 1.1));
  out.alpha = 1 - k * k;
  return out;
}

/** The broken voice's burst: her ward's water falls in `VOICE_BREAK_SECONDS`
 *  while a ring of spray runs out to `VOICE_BREAK_REACH`. */
export const VOICE_BREAK_SECONDS = 0.8;
export const VOICE_BREAK_REACH = 15;
