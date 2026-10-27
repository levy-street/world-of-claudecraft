// Pure plan for the Heart (the Smith's Heart's separate final room) and the
// floating islands of the raid: what heart_room.ts paints.
//
//   - The Anvil of the World hangs over the Smith's own heart, a molten
//     white-gold core deep in the chasm under the platform (`HEART_CORE`),
//     beating; shafts of its light rise through the chasm round the platform.
//   - Four colossal chains (`heartChains`) hold the platform: each runs from
//     its altar's ring up and out across the chasm into the mountain's crown,
//     and each carries its vein's light down into its altar (the pours).
//   - The floating islands (the Seal Dais, the platform, the terrace) each
//     have a keel under them (`heartKeelProfile`): a stepped, tapering cone
//     of dark stone with a glowing band, so they read as hung over the void
//     rather than standing on a pillar to its floor.
//   - The platform's floor carries three rune rings (`HEART_RUNE_RINGS`).
//
// Three-free, DOM-free, deterministic.

import {
  HEART_ALTARS,
  HEART_ROOM,
  HEART_ROOM_CHASM_R,
  HEART_TERRACE,
  SEAL_DAIS,
  type SmithHeartVein,
} from '../../sim/content/smith_heart_layout';

/** The Smith's heart in the chasm: centre (instance-local), radius. */
export const HEART_CORE = { x: HEART_ROOM.x, y: -50, z: HEART_ROOM.z, r: 20 } as const;

/** The shafts of the core's light rising through the chasm ring. */
export const HEART_CORE_SHAFTS: readonly { x: number; z: number; r: number; tilt: number }[] = [
  20, 80, 140, 300, 345,
].map((deg, i) => {
  const a = (deg * Math.PI) / 180;
  const d = HEART_ROOM.r + 12 + (i % 3) * 4;
  return {
    x: HEART_ROOM.x + Math.sin(a) * d,
    z: HEART_ROOM.z + Math.cos(a) * d,
    r: 3 + (i % 2) * 2,
    tilt: 0.06 + (i % 3) * 0.03,
  };
});

/** One chain: its altar end (on the altar's ring) and its crown end (in the
 *  mountain), and how many links span it. */
export interface HeartChain {
  vein: SmithHeartVein;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  links: number;
}

/** The yards one link adds along its chain (links interlock). */
export const HEART_CHAIN_PITCH = 5.4;
/** How far out and up each chain runs from its altar (yards from the room's
 *  centre, height over the platform). */
const CHAIN_CROWN = { r: 104, y: 78 } as const;

/** The four chains, one per altar, from the altar's ring to the crown. */
export function heartChains(): HeartChain[] {
  return HEART_ALTARS.map((a) => {
    const dx = a.x - HEART_ROOM.x;
    const dz = a.z - HEART_ROOM.z;
    const l = Math.hypot(dx, dz);
    const ux = dx / l;
    const uz = dz / l;
    const ax = a.x + ux * 2.6;
    const az = a.z + uz * 2.6;
    const ay = HEART_ROOM.h + 6.2;
    const bx = HEART_ROOM.x + ux * CHAIN_CROWN.r;
    const bz = HEART_ROOM.z + uz * CHAIN_CROWN.r;
    const by = HEART_ROOM.h + CHAIN_CROWN.y;
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    return { vein: a.vein, ax, ay, az, bx, by, bz, links: Math.floor(len / HEART_CHAIN_PITCH) };
  });
}

/** A chain link's centre and roll (alternate links turn 90 degrees). */
export function heartChainLink(
  c: HeartChain,
  i: number,
): { x: number; y: number; z: number; roll: number } {
  const t = (i + 0.5) / c.links;
  return {
    x: c.ax + (c.bx - c.ax) * t,
    y: c.ay + (c.by - c.ay) * t,
    z: c.az + (c.bz - c.az) * t,
    roll: i % 2 === 0 ? 0 : Math.PI / 2,
  };
}

/** One floating island and its keel: a lathe profile (radius, height over
 *  the island's floor), top first, tapering to a point. */
export interface HeartKeel {
  id: string;
  x: number;
  z: number;
  h: number;
  profile: readonly (readonly [number, number])[];
  /** The glowing band's height range down the keel (yards under the floor). */
  band: readonly [number, number];
  color: number;
}

/** A stepped keel profile for an island of radius `r`, `depth` deep. */
export function heartKeelProfile(r: number, depth: number): [number, number][] {
  const steps: [number, number][] = [
    [1, 0.06],
    [0.97, 0.12],
    [0.86, 0.16],
    [0.84, 0.3],
    [0.68, 0.36],
    [0.64, 0.52],
    [0.46, 0.6],
    [0.4, 0.74],
    [0.2, 0.86],
    [0.04, 1],
  ];
  return steps.map(([k, d]) => [r * k - 0.3, -2.6 - d * (depth - 2.6)]);
}

/** Every floating island's keel: the Seal Dais (main map) and the Heart's
 *  platform and terrace. */
export function heartKeels(): HeartKeel[] {
  return [
    {
      id: 'seal_dais',
      x: SEAL_DAIS.x,
      z: SEAL_DAIS.z,
      h: SEAL_DAIS.h,
      profile: heartKeelProfile(SEAL_DAIS.r, 30),
      band: [6.5, 8.5],
      color: 0xd8c8a0,
    },
    {
      id: 'heart_anvil',
      x: HEART_ROOM.x,
      z: HEART_ROOM.z,
      h: HEART_ROOM.h,
      profile: heartKeelProfile(HEART_ROOM.r, 26),
      band: [8, 11],
      color: 0xffd890,
    },
    {
      id: 'heart_terrace',
      x: HEART_TERRACE.x,
      z: HEART_TERRACE.z,
      h: HEART_TERRACE.h,
      profile: heartKeelProfile(HEART_TERRACE.r, 18),
      band: [4, 5.5],
      color: 0xffd890,
    },
  ];
}

/** The keel's deepest point stays above the core (the heart is never inside
 *  stone). */
export function heartKeelBottom(k: HeartKeel): number {
  return k.h + k.profile[k.profile.length - 1][1];
}

/** The platform's rune rings (radii from the room's centre). */
export const HEART_RUNE_RINGS: readonly number[] = [14, 26, 38.5];

/** The chasm's embers: a rising swirl over the core, by the static preset. */
export function heartEmberCount(lowGfx: boolean): number {
  return lowGfx ? 70 : 260;
}

/** The chasm's open radius (re-exported for the painter's shaft check). */
export const HEART_CHASM_R = HEART_ROOM_CHASM_R;
