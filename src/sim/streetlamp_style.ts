// streetlamp_style: which modeled fixture stands in which area, and how wide a
// body it presents. Pure data plus one resolver, no DOM and no Three, so BOTH
// halves of a lamp read it: the renderer picks the GLB to instance, and
// colliders.ts sizes the post you walk into from the same row.
//
// It lives in src/sim (not src/render) for exactly that reason. A streetlamp is
// world geometry now, not decoration: the sim owns where the posts stand
// (streetlamp_layout.ts) and how solid they are, and the renderer draws what the
// sim already decided, the same arrangement props and dungeon furniture use.
import type { BiomeId } from './types';

export const STREETLAMP_STYLE_BY_ZONE = {
  eastbrook_vale: 'eastbrook_civic',
  mirefen_marsh: 'mirefen_witchflame',
  thornpeak_heights: 'thornpeak_beacon',
  veiled_hollow: 'veiled_crystal',
  drakelands: 'drakelands_brazier',
  frostveil: 'frostveil_icicle',
  amberfall: 'amberfall_crystal',
  willowfen: 'willowfen_reed',
  nightbloom: 'nightbloom_moonflower',
  wraithwood: 'wraithwood_ghost',
  palmreach: 'palmreach_totem',
  evergarden: 'evergarden_flower',
  galecrest: 'galecrest_mast',
  farshore_isle: 'farshore_coral',
} as const;

export type StreetlampStyleId =
  (typeof STREETLAMP_STYLE_BY_ZONE)[keyof typeof STREETLAMP_STYLE_BY_ZONE];

const STYLE_BY_BIOME: Readonly<Record<BiomeId, StreetlampStyleId>> = {
  vale: 'eastbrook_civic',
  marsh: 'mirefen_witchflame',
  peaks: 'thornpeak_beacon',
  beach: 'farshore_coral',
  desert: 'amberfall_crystal',
  volcano: 'drakelands_brazier',
  cave: 'veiled_crystal',
  dusk: 'veiled_crystal',
  ember: 'drakelands_brazier',
  frost: 'frostveil_icicle',
  amber: 'amberfall_crystal',
  fen: 'willowfen_reed',
  night: 'nightbloom_moonflower',
  haunt: 'wraithwood_ghost',
  jungle: 'palmreach_totem',
  garden: 'evergarden_flower',
  gale: 'galecrest_mast',
};

export const STREETLAMP_DEFAULT_STYLE: StreetlampStyleId = 'eastbrook_civic';

export function resolveStreetlampStyle(
  areaId: string | null,
  biome: BiomeId | null,
): StreetlampStyleId {
  if (areaId && areaId in STREETLAMP_STYLE_BY_ZONE) {
    return STREETLAMP_STYLE_BY_ZONE[areaId as keyof typeof STREETLAMP_STYLE_BY_ZONE];
  }
  return biome ? STYLE_BY_BIOME[biome] : STREETLAMP_DEFAULT_STYLE;
}

/**
 * Every fixture is normalized to this height when it is placed
 * (`STREETLAMP_ASSET_DEFS[*].targetHeight` imports it), so it doubles as the
 * lamp's visual top for the sight check: a post is well above eye level and
 * blocks a cast the way a tree trunk does.
 */
export const STREETLAMP_FIXTURE_HEIGHT = 5.5;

/**
 * How much of a fixture, measured up from its foot, counts as the body a mover
 * walks into. Above this only arms, hanging lanterns and crowns overhang, and
 * those must not widen a collider that blocks at every altitude: an extruded 2D
 * circle sized to an overhanging head would wall off ground nothing stands on.
 * Comfortably clear of a character's own height, so nothing a body can touch
 * is left out of the measurement.
 */
export const STREETLAMP_COLLIDER_BAND = 2.4;

/**
 * The radius of the post a body collides with, per style, in yards.
 *
 * MEASURED from each shipped GLB at the scale the renderer places it (the
 * widest horizontal reach of any vertex within `STREETLAMP_COLLIDER_BAND` of
 * the foot, from the instance origin, rounded UP to the nearest centimetre so
 * the collider always covers the fixture it stands for). The same rule the
 * parkour tops in colliders.ts follow, and the same reason: a hand-guessed
 * number drifts from the silhouette and the lamp becomes either a ghost or an
 * invisible wall. `tests/streetlamp_colliders.test.ts` re-measures the shipped
 * bytes and fails if a row here stops matching its model.
 *
 * The circle is centred on the instance origin rather than on the post's own
 * footing, which is what makes it correct at EVERY yaw: fixtures are turned to
 * hang their light over the road (see `lampFixtureYaw`), and a circle about the
 * point the fixture rotates around cannot swing out of alignment with it. The
 * cost is a little slack on the two styles whose post stands off-centre under a
 * reaching head, which errs toward solid, the safe direction for collision.
 */
export const STREETLAMP_COLLIDER_RADIUS: Readonly<Record<StreetlampStyleId, number>> = {
  amberfall_crystal: 0.83,
  drakelands_brazier: 0.79,
  eastbrook_civic: 0.45,
  evergarden_flower: 0.85,
  farshore_coral: 1.0,
  frostveil_icicle: 0.55,
  galecrest_mast: 1.02,
  mirefen_witchflame: 1.02,
  nightbloom_moonflower: 1.06,
  palmreach_totem: 0.72,
  thornpeak_beacon: 1.08,
  veiled_crystal: 0.69,
  willowfen_reed: 0.82,
  wraithwood_ghost: 0.93,
};
