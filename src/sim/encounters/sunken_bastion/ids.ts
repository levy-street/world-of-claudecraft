// The Sunken Bastion bosses' ids, tuning and pure geometry, as a dependency-
// light leaf: the encounter modules, the dev helpers, the renderer's boss
// visuals and the tests all key on these. No SimContext, no rng.

import {
  BASTION_BUTTRESSES,
  BEACON_CROWN,
  BREACH_BASTION,
  BUTTRESS_HALF,
  DROWNING_WINCH,
  DROWNING_YARD,
  FOGBEACON,
} from '../../content/sunken_bastion_layout';
import { inLane } from '../../mob/trash_kit/lane';

export const OLEN_ID = 'knight_commander_olen';
export const OSSICK_ID = 'gaoler_ossick';
export const VAEL_ID = 'vael_the_mistcaller';
export const TURRETBACK_ID = 'turretback_hermit';
/** The Gaol Turnkey, the gaol's miniboss (encounters/sunken_bastion/turnkey.ts). */
export const TURNKEY_ID = 'gaol_turnkey';
/** The Iron Cage the Turnkey drops on a player: a hittable encounter body. */
export const GAOL_CAGE_ID = 'bastion_gaol_cage';
/** Ossick's Drowned Anchor, hooked into a player: the chain the group breaks. */
export const DROWNED_ANCHOR_ID = 'bastion_drowned_anchor';
export const FOG_SHADE_ID = 'vael_fog_shade';
export const DROWNED_THRALL_ID = 'drowned_thrall';
export const SHACKLED_PRISONER_ID = 'shackled_prisoner';

// ---- cast ids (real cast bars on the bosses) -------------------------------------
export const OLEN_OATHBOUND_CHARGE = 'bastion_oathbound_charge';
export const OSSICK_ANCHOR = 'bastion_drowned_anchor_cast';
export const OSSICK_SHACKLE = 'bastion_shackle_pair';
export const OSSICK_CUDGEL = 'bastion_gaolers_cudgel';
export const TURNKEY_IRON_CAGE = 'bastion_iron_cage';
/** Vael sinks into the shadows (the vanish and the pool both ride this bar). */
export const VAEL_SHADOWSTEP = 'bastion_shadowstep';
/** Vael rises behind his mark and brings the scythe round. */
export const VAEL_REAPING_SCYTHE = 'bastion_reaping_scythe';
export const VAEL_MIST_SURGE = 'bastion_mist_surge';
export const VAEL_DROWNING_HYMN = 'bastion_drowning_hymn';
/** The Fog Veil's figures (Vael and his three shades) rise out of the roof
 *  together before the hymn: a short bar on each, his Emerge rise. */
export const VAEL_VEIL_RISE = 'bastion_veil_rise';

// ---- aura ids ---------------------------------------------------------------------
export const OLEN_BREACHED = 'bastion_breached';
export const OLEN_BREACHED_VULN = 'bastion_breached_vuln';
export const OLEN_UNBROKEN_OATH = 'bastion_unbroken_oath';
export const OLEN_UNDERTOW = 'bastion_undertow_wake';
export const OSSICK_ANCHOR_MARK = 'bastion_anchor_mark';
/** Hooked by the Drowned Anchor. Its `sourceId` is the ANCHOR's entity id. */
export const OSSICK_ANCHORED = 'bastion_anchored';
/** Chained to a partner. Its `sourceId` is the PARTNER's entity id, so a client
 *  draws the chain between the two from the aura alone. */
export const OSSICK_SHACKLED = 'bastion_shackled';
export const OSSICK_KEELHAULED = 'bastion_keelhauled';
export const TURNKEY_CAGE_MARK = 'bastion_cage_mark';
/** Locked in the Iron Cage. Its `sourceId` is the CAGE's entity id, so a client
 *  finds the cage (and the escape progress on its health) from the aura. */
export const TURNKEY_CAGED = 'bastion_caged';
export const OSSICK_CUDGEL_SLOW = 'bastion_cudgel_slow';
export const VAEL_FOG_VEIL = 'bastion_fog_veil';
export const VAEL_STAGGER = 'bastion_vael_stagger';
export const VAEL_EXPOSED = 'bastion_vael_exposed';
export const VAEL_FOGBURST = 'bastion_fogburst';
/** Vael in the shadows: untouchable while he crosses to his mark. */
export const VAEL_SHADOWED = 'bastion_vael_shadowed';
/** On the player the reaper rises behind. */
export const VAEL_REAP_MARK = 'bastion_reap_mark';

// ---- encounter object templates (the state rides the template id) ----------------
export const BUTTRESS_TEMPLATES = {
  intact: 'bastion_buttress_intact',
  cracked: 'bastion_buttress_cracked',
  broken: 'bastion_buttress_broken',
} as const;
export type ButtressState = keyof typeof BUTTRESS_TEMPLATES;
export const BEACON_LAMP_TEMPLATE = 'bastion_beacon_lamp';
export const UNDERTOW_TEMPLATE = 'bastion_undertow_wake';
/** The shadow pool Vael rises out of (facing = the scythe's sweep yaw). */
export const REAPER_POOL_TEMPLATE = 'bastion_reaper_pool';
/** Heroic: the pool left burning behind the sweep. */
export const GRAVE_SHADOW_TEMPLATE = 'bastion_grave_shadow';

/** Every Bastion encounter object template (the renderer draws them itself). */
export const BASTION_OBJECT_TEMPLATES: ReadonlySet<string> = new Set([
  ...Object.values(BUTTRESS_TEMPLATES),
  BEACON_LAMP_TEMPLATE,
  UNDERTOW_TEMPLATE,
  REAPER_POOL_TEMPLATE,
  GRAVE_SHADOW_TEMPLATE,
]);

export function buttressStateOf(templateId: string): ButtressState | null {
  if (templateId === BUTTRESS_TEMPLATES.intact) return 'intact';
  if (templateId === BUTTRESS_TEMPLATES.cracked) return 'cracked';
  if (templateId === BUTTRESS_TEMPLATES.broken) return 'broken';
  return null;
}

// ---- Olen: the Oathbound Charge ---------------------------------------------------

export const OLEN_TUNING = {
  chargeFirst: 10,
  chargeEvery: 18,
  chargeCast: 2.5,
  /** The lane's half width (a 4 yd lane). */
  laneHalf: 2,
  /** Seconds the charge takes to cross the lane. */
  dashSeconds: 0.5,
  min: 150,
  max: 180,
  knockback: 6,
  breachedStun: 5,
  breachedVulnSeconds: 8,
  breachedVuln: 0.3,
  /** Unbroken Oath: damage done per stack. */
  oathPerStack: 0.1,
  // Heroic: Undertow Wake floods the lane after the charge.
  wakeSeconds: 8,
  wakePerSecond: 25,
  wakeSlow: 0.5,
} as const;

/** Where a charge from (x, z) along `yaw` stops on the Breach Bastion: at the
 *  first standing buttress in its lane (the crash), else at the rim. Pure; the
 *  renderer paints the same lane the sim resolves. `standing` lists the
 *  buttress ids that still block (intact or cracked). */
export function oathLaneEnd(
  x: number,
  z: number,
  yaw: number,
  standing: ReadonlySet<string>,
): { length: number; buttress: string | null } {
  const ax = Math.sin(yaw);
  const az = Math.cos(yaw);
  // The rim: solve |p + t*a - c| = r - 1 for the forward root.
  const r = BREACH_BASTION.r - 1;
  const ox = x - BREACH_BASTION.x;
  const oz = z - BREACH_BASTION.z;
  const b = ox * ax + oz * az;
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - c;
  let rim = disc > 0 ? -b + Math.sqrt(disc) : 0;
  rim = Math.max(0, rim);
  let best = rim;
  let hit: string | null = null;
  for (const bt of BASTION_BUTTRESSES) {
    if (!standing.has(bt.id)) continue;
    const dx = bt.x - x;
    const dz = bt.z - z;
    const along = dx * ax + dz * az;
    if (along <= 0) continue;
    const side = Math.abs(dx * az - dz * ax);
    // The lane meets the buttress when their widths overlap.
    if (side > OLEN_TUNING.laneHalf + BUTTRESS_HALF) continue;
    const stop = Math.max(0, along - BUTTRESS_HALF - 1.2);
    if (stop < best) {
      best = stop;
      hit = bt.id;
    }
  }
  return { length: best, buttress: hit };
}

/** Is (px, pz) inside the charge lane that starts at (x, z)? */
export function inOathLane(
  x: number,
  z: number,
  yaw: number,
  length: number,
  px: number,
  pz: number,
): boolean {
  return inLane(x, z, yaw, length, OLEN_TUNING.laneHalf, px, pz);
}

// ---- Ossick: the Drowned Anchor and the Shackle Pair ----------------------------------

export const OSSICK_TUNING = {
  anchorFirst: 8,
  anchorEvery: 24,
  /** The throw's bar: the mark sits under the victim the whole time. */
  anchorCast: 1.8,
  /** Hits that break the chain (any player's or pet's hit is one). */
  anchorHits: 12,
  anchorHitsHeroic: 16,
  /** The chain winds taut this long before the winch starts to haul. */
  anchorSettle: 1.5,
  /** The haul reaches the pit rim in about this long, whatever the start. */
  dragSeconds: 8,
  dragSecondsHeroic: 7,
  /** The slowest the haul ever crawls (yd/s). */
  dragMinSpeed: 1,
  /** Share of the victim's health the pit takes. */
  pitShare: 0.6,
  pitShareHeroic: 0.8,
  keelhaulStun: 3,
  // Heroic: the anchor's landing crushes everyone near its victim.
  crashRadius: 6,
  crashMin: 50,
  crashMax: 60,
  shackleFirst: 16,
  shackleEvery: 28,
  shackleCast: 1.2,
  shackleSeconds: 12,
  /** How far apart the pair may stand before the chain bites. */
  shackleRange: 8,
  shackleRangeHeroic: 6,
  /** Strain damage each second the pair stands too far apart. */
  strainMin: 40,
  strainMax: 50,
  cudgelFirst: 6,
  cudgelEvery: 12,
  cudgelCast: 1,
  cudgelMult: 1.5,
  cudgelSlow: 0.7,
  cudgelSlowSeconds: 6,
  /** Open the Cells: prisoners break out at these health shares. */
  cells: [0.6, 0.3],
  prisonersPerCell: 3,
} as const;

export const WINCH = DROWNING_WINCH;
export const YARD = DROWNING_YARD;

/** The pit's rim: a hauled player this near the winch's centre falls in (the
 *  winch's own collider stops a body about a yard outside its radius). */
export const PIT_RIM = DROWNING_WINCH.r + 1.2;

/** The anchor's strength on a difficulty (hits to break the chain). */
export function anchorHits(heroic: boolean): number {
  return heroic ? OSSICK_TUNING.anchorHitsHeroic : OSSICK_TUNING.anchorHits;
}

/** How fast the winch hauls a player standing `dist` yd from its centre:
 *  about `dragSeconds` to the rim from anywhere, never slower than the floor. */
export function anchorDragSpeed(dist: number, heroic: boolean): number {
  const seconds = heroic ? OSSICK_TUNING.dragSecondsHeroic : OSSICK_TUNING.dragSeconds;
  return Math.max(OSSICK_TUNING.dragMinSpeed, (dist - PIT_RIM) / seconds);
}

/** The Shackle Pair's reach on a difficulty. */
export function shackleRange(heroic: boolean): number {
  return heroic ? OSSICK_TUNING.shackleRangeHeroic : OSSICK_TUNING.shackleRange;
}

/** Is a shackled pair standing `dist` apart past the chain's reach? */
export function shackleStrained(dist: number, heroic: boolean): boolean {
  return dist > shackleRange(heroic);
}

// ---- The Gaol Turnkey: the Iron Cage -------------------------------------------------

export const TURNKEY_TUNING = {
  cageFirst: 9,
  cageEvery: 24,
  /** The drop's bar: a cage shadow grows under the victim the whole time. */
  cageCast: 1.6,
  /** The cage's strength in points (its health bar reads points left). */
  cageHits: 16,
  cageHitsHeroic: 20,
  /** A counted escape press breaks this many points. */
  pressPoints: 1,
  /** Counted presses are at least this far apart (about 8 a second at most);
   *  faster presses are ignored, never queued. */
  pressGap: 0.12,
  /** A teammate's hit (or a pet's) on the cage breaks this many points. */
  helperPoints: 2,
  /** The cage mends one point this often (the escape decays slowly). */
  mendEvery: 0.6,
  /** Nobody broke it in time: the cage crushes its prisoner and bursts. */
  cageMax: 10,
  crushShare: 0.3,
  crushShareHeroic: 0.45,
  // Heroic: two cages at once, and the brine rises inside each one.
  cagesHeroic: 2,
  floodBase: 0.02,
  floodStep: 0.01,
  /** The cage falls from this high over its prisoner... */
  dropHeight: 9,
  /** ...and lands this long after it appears. */
  dropSeconds: 0.35,
} as const;

/** The cage's height over its floor `age` seconds after it appears: a fall
 *  under gravity from `dropHeight`, down to 0 at `dropSeconds`. */
export function cageDropHeight(age: number): number {
  const k = Math.min(1, Math.max(0, age / TURNKEY_TUNING.dropSeconds));
  return TURNKEY_TUNING.dropHeight * (1 - k * k);
}

/** The cage's strength on a difficulty. */
export function cageHits(heroic: boolean): number {
  return heroic ? TURNKEY_TUNING.cageHitsHeroic : TURNKEY_TUNING.cageHits;
}

/** Heroic brine flood: the share of max health a caged player loses on the
 *  `second`-th second inside (1-based). */
export function cageFloodShare(second: number): number {
  return TURNKEY_TUNING.floodBase + TURNKEY_TUNING.floodStep * Math.max(0, second - 1);
}

/** Escape progress (0 locked, 1 free) from the cage's health. Pure: the HUD
 *  prompt reads the same number the sim resolves. */
export function cageEscapeProgress(hp: number, maxHp: number): number {
  if (maxHp <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - hp / maxHp));
}

/** The cells the prisoners break out of: round the yard's west and east rims. */
export const CELL_DOORS: readonly { x: number; z: number }[] = [
  { x: DROWNING_YARD.x - 19, z: DROWNING_YARD.z + 6 },
  { x: DROWNING_YARD.x - 19, z: DROWNING_YARD.z - 6 },
  { x: DROWNING_YARD.x + 19, z: DROWNING_YARD.z },
];

// ---- Vael: the Fog Veil and the beacon's beam -----------------------------------------

export const VAEL_TUNING = {
  surgeFirst: 6,
  surgeEvery: 12,
  lastHymnEvery: 8,
  lastHymnBelow: 0.25,
  surgeCast: 1.5,
  surgeRadius: 12,
  surgeMin: 30,
  surgeMax: 40,
  veilAt: [0.7, 0.4],
  hymnSeconds: 18,
  hymnBase: 8,
  hymnStep: 3,
  hymnStepEvery: 3,
  /** Share of his health a hit on the real Vael must take to break the veil. */
  breakShare: 0.05,
  staggerSeconds: 4,
  exposedSeconds: 10,
  exposed: 0.2,
  fogburstRadius: 6,
  fogburstMin: 50,
  fogburstMax: 60,
  fogburstStun: 2,
  /** One full sweep of the beam during the veil. */
  beamPeriod: 4,
  /** Half the beam's angle (radians): a figure inside it is lit. */
  beamHalf: 0.22,
  /** Heroic: Drifting Shades swap places this often. */
  driftEvery: 5,
  // The Reaper's Shadowstep: he sinks into the shadows, a pool opens behind
  // one player, and he rises out of it with the scythe.
  reapFirst: 10,
  reapEvery: 16,
  /** Sinking into the shadow (the Vanish clip). */
  vanishSeconds: 0.8,
  /** The pool shows behind the mark this long before he rises. */
  poolSeconds: 1.6,
  /** Rising out of the pool, scythe drawn back (the Emerge clip). */
  riseSeconds: 0.6,
  /** The Fog Veil's figures rise out of the roof this slowly (the Emerge
   *  rise, played at half pace so all four read as rising, not appearing). */
  veilRiseSeconds: 1.2,
  /** How far behind the mark the pool opens. */
  behind: 2.5,
  sweepRange: 8,
  /** The sweep's full arc in degrees, centred on the pool's facing. */
  sweepArcDeg: 150,
  sweepMin: 80,
  sweepMax: 95,
  // Heroic: Grave Shadow, the pool lingers and burns.
  graveSeconds: 6,
  graveRadius: 3,
  gravePerSecond: 18,
} as const;

/** Where the pool opens: `behind` yd behind a player at (x, z) facing `facing`
 *  (the sim's yaw), and the yaw the scythe sweeps along (toward the player). */
export function reaperPoolSpot(
  x: number,
  z: number,
  facing: number,
): { x: number; z: number; yaw: number } {
  const bx = x - Math.sin(facing) * VAEL_TUNING.behind;
  const bz = z - Math.cos(facing) * VAEL_TUNING.behind;
  return { x: bx, z: bz, yaw: Math.atan2(x - bx, z - bz) };
}

/** Is (px, pz) inside the scythe's sweep from (x, z) along `yaw`? */
export function inReapingSweep(x: number, z: number, yaw: number, px: number, pz: number): boolean {
  const dx = px - x;
  const dz = pz - z;
  const d = Math.hypot(dx, dz);
  if (d > VAEL_TUNING.sweepRange) return false;
  if (d < 1e-6) return true;
  let a = Math.atan2(dx, dz) - yaw;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return Math.abs(a) <= ((VAEL_TUNING.sweepArcDeg / 2) * Math.PI) / 180;
}

export const CROWN = BEACON_CROWN;
export const BEACON = FOGBEACON;

/** The four rim spots the veiled figures stand on (clockwise from `phase`). */
export function veilSlots(phase: number): { x: number; z: number }[] {
  const r = BEACON_CROWN.r - 5;
  return [0, 1, 2, 3].map((k) => {
    const a = phase + (k * Math.PI) / 2;
    return { x: BEACON_CROWN.x + Math.sin(a) * r, z: BEACON_CROWN.z + Math.cos(a) * r };
  });
}

/** The beam's yaw (sim convention) `elapsed` seconds into a veil. */
export function veilBeamYaw(start: number, elapsed: number): number {
  return (start + (elapsed / VAEL_TUNING.beamPeriod) * Math.PI * 2) % (Math.PI * 2);
}

/** Is a figure at (x, z) inside the beam turning at `yaw` from the Fogbeacon? */
export function inBeam(yaw: number, x: number, z: number): boolean {
  const a = Math.atan2(x - FOGBEACON.x, z - FOGBEACON.z);
  let d = a - yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) <= VAEL_TUNING.beamHalf;
}
