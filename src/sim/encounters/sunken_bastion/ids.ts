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
  MOORING_POSTS,
} from '../../content/sunken_bastion_layout';
import { BASTION_TRASH_OBJECT_TEMPLATES } from '../../mob/trash_kit/bastion_cast_ids';
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
/** Olen, the fallen paladin (olen.ts): he drives his sword into the flags and
 *  the Hallowed Brine wells up round him. */
export const OLEN_HALLOWED_BRINE = 'bastion_hallowed_brine';
/** He hurls his kite shield: it rebounds from player to player. */
export const OLEN_REBOUNDING_BULWARK = 'bastion_rebounding_bulwark';
/** He points his sword at a player: the Sentence of the Tide falls on them. */
export const OLEN_TIDE_SENTENCE = 'bastion_tide_sentence';
/** At half health he kneels and plants his sword (the bar) ... */
export const OLEN_OATH_KNEEL = 'bastion_oath_kneel';
/** ... and keeps his vigil in the water bubble until his soldiers fall. */
export const OLEN_OATH_VIGIL = 'bastion_oath_vigil';
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
/** Before the veil: he stills and speaks while the fog gathers on the crown. */
export const VAEL_VEIL_GATHER = 'bastion_veil_gather';
/** His entrance (vael_intro.ts): he rises out of the roof (the Emerge rise,
 *  on the veil's pace) ... */
export const VAEL_INTRO_RISE = 'bastion_vael_rise';
/** ... and sinks back under it (the Vanish sink), there and before the veil. */
export const VAEL_SINK = 'bastion_vael_sink';

// ---- aura ids ---------------------------------------------------------------------
export const OLEN_BREACHED = 'bastion_breached';
export const OLEN_BREACHED_VULN = 'bastion_breached_vuln';
export const OLEN_UNBROKEN_OATH = 'bastion_unbroken_oath';
export const OLEN_UNDERTOW = 'bastion_undertow_wake';
/** Olen standing in his own Hallowed Brine: it shields him (the tank drags
 *  him out of it). */
export const OLEN_BRINE_HALLOWED = 'bastion_brine_hallowed';
/** On a player standing in the Hallowed Brine. */
export const OLEN_IN_BRINE = 'bastion_in_brine';
/** On the player the Sentence of the Tide will fall on. */
export const OLEN_SENTENCED = 'bastion_sentenced';
export const OSSICK_ANCHOR_MARK = 'bastion_anchor_mark';
/** Hooked by the Drowned Anchor. Its `sourceId` is the ANCHOR's entity id. */
export const OSSICK_ANCHORED = 'bastion_anchored';
/** Chained to a partner. Its `sourceId` is the PARTNER's entity id, so a client
 *  draws the chain between the two from the aura alone. */
export const OSSICK_SHACKLED = 'bastion_shackled';
export const OSSICK_KEELHAULED = 'bastion_keelhauled';
/** The cue (a spellfx from the post to the freed player) when a hooked player
 *  reaches a lit Mooring Post: the chain snaps taut to it and the lamp dies. */
export const OSSICK_MOORED = 'bastion_moored';
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
/** On Vael through his entrance and the fog's gathering: nothing touches him. */
export const VAEL_SHROUDED = 'bastion_vael_shrouded';
/** On every player on the crown while the veil's hymn drowns it (the HUD's
 *  veil alert reads it; its time left is the hymn's). */
export const VAEL_HYMN_DROWNING = 'bastion_hymn_drowning';
/** The beam has the real Vael (worn while lit and a breath after). */
export const VAEL_BEACON_LIT = 'bastion_beacon_lit';
/** The beam pours through a shade (worn while lit and a breath after). */
export const VAEL_SHADE_HOLLOW = 'bastion_shade_hollow';

// ---- encounter object templates (the state rides the template id) ----------------
export const BUTTRESS_TEMPLATES = {
  intact: 'bastion_buttress_intact',
  cracked: 'bastion_buttress_cracked',
  broken: 'bastion_buttress_broken',
} as const;
export type ButtressState = keyof typeof BUTTRESS_TEMPLATES;
export const BEACON_LAMP_TEMPLATE = 'bastion_beacon_lamp';
export const UNDERTOW_TEMPLATE = 'bastion_undertow_wake';
/** A pool of Hallowed Brine (scale = its radius). */
export const HALLOWED_BRINE_TEMPLATE = 'bastion_hallowed_brine';
/** The shadow pool Vael rises out of (facing = the scythe's sweep yaw). */
export const REAPER_POOL_TEMPLATE = 'bastion_reaper_pool';
/** Heroic: the pool left burning behind the sweep. */
export const GRAVE_SHADOW_TEMPLATE = 'bastion_grave_shadow';

/** A Mooring Post's lamp in the Drowning Yard (ossick_moorings.ts): lit (a
 *  hooked player who reaches it moors the chain), dark (spent), or kindling
 *  (the last seconds of the dark, re-lighting; still spent). */
export const MOORING_TEMPLATES = {
  lit: 'bastion_mooring_lit',
  dark: 'bastion_mooring_dark',
  kindling: 'bastion_mooring_kindling',
} as const;
export type MooringState = keyof typeof MOORING_TEMPLATES;

/** Every Bastion encounter object template (the renderer draws them itself). */
export const BASTION_OBJECT_TEMPLATES: ReadonlySet<string> = new Set([
  ...Object.values(BUTTRESS_TEMPLATES),
  BEACON_LAMP_TEMPLATE,
  UNDERTOW_TEMPLATE,
  HALLOWED_BRINE_TEMPLATE,
  REAPER_POOL_TEMPLATE,
  GRAVE_SHADOW_TEMPLATE,
  ...Object.values(MOORING_TEMPLATES),
  ...BASTION_TRASH_OBJECT_TEMPLATES,
]);

export function mooringStateOf(templateId: string): MooringState | null {
  if (templateId === MOORING_TEMPLATES.lit) return 'lit';
  if (templateId === MOORING_TEMPLATES.dark) return 'dark';
  if (templateId === MOORING_TEMPLATES.kindling) return 'kindling';
  return null;
}

export function buttressStateOf(templateId: string): ButtressState | null {
  if (templateId === BUTTRESS_TEMPLATES.intact) return 'intact';
  if (templateId === BUTTRESS_TEMPLATES.cracked) return 'cracked';
  if (templateId === BUTTRESS_TEMPLATES.broken) return 'broken';
  return null;
}

// ---- Olen, the fallen paladin ------------------------------------------------------
//
// His kit (olen.ts), against the Oathbound Charge it replaced (150 to 180 to
// the charge's mark every 18 s, about 9 a second the group could not avoid
// once the lane was set): what nobody can avoid is the Sentence's mark (110
// to 125 every 22 s, 5.3 a second) and the Bulwark's first victim (60 to 70
// every 18 s, 3.6 a second), 8.9 a second together, about the same. Every
// other point is a mistake: a rebound onto a player standing too close, a
// splash of the Sentence on a neighbour, a second in the brine (18 a second).
// The Oath adds two Drowned Sergeants at half health (three on heroic) while
// he is immune; breaking it leaves him Breached (stunned 4 s, 20 percent more
// damage taken for 10 s), the window the old buttress crash gave.
//
// The brine at 9 yd (10 heroic; it was 6 and 7) against his arena, the Breach
// Bastion's 22 yd floor (about 1520 square yards): the brine's countdown runs
// only outside his bars, so a pool lands at least 14 + 1.2 = 15.2 s after the
// last, which dries at 15 s: never two at once. One pool is 254 square yards
// (17 percent of the floor; 314 and 21 percent heroic). Dropped at his spawn
// (2 yd off the middle), at least 11 yd of open floor (10 heroic) stand past
// its rim on every side, so the tank always has room. The walk out grows from 6 to 9 yd: about 1.3 s at run speed
// (was 0.9), so a player who steps out at once still takes one pulse (18, 26
// heroic) and a late one two, as before; the drag costs the tank about half a
// second more of the 40 percent shield. Neither the 15 s life nor the damage
// a second needed to move.

export const OLEN_KIT = {
  brineFirst: 6,
  brineEvery: 14,
  /** Driving the sword into the flags (the bar). */
  brineCast: 1.2,
  brineRadius: 9,
  brineRadiusHeroic: 10,
  brineSeconds: 15,
  brinePerSecond: 18,
  brinePerSecondHeroic: 26,
  /** The share of damage Olen sheds while he stands in his own brine. */
  brineShield: 0.4,
  bulwarkFirst: 11,
  bulwarkEvery: 18,
  bulwarkCast: 1.5,
  /** Players the shield strikes at most (the first, then each rebound). */
  bulwarkHits: 3,
  bulwarkHitsHeroic: 4,
  /** A rebound finds the nearest player not yet struck within this reach. */
  bulwarkReach: 10,
  /** The shield's flight between two bodies. */
  bulwarkHop: 0.35,
  bulwarkMin: 60,
  bulwarkMax: 70,
  sentenceFirst: 16,
  sentenceEvery: 22,
  /** The point (the bar), then the mark the column falls on. */
  sentenceCast: 1,
  sentenceSeconds: 5,
  sentenceRadius: 6,
  sentenceRadiusHeroic: 8,
  sentenceMin: 110,
  sentenceMax: 125,
  /** The Unbroken Oath: at this share of his health, once a fight. */
  oathAt: 0.5,
  oathKneel: 1.5,
  oathSoldiers: 2,
  oathSoldiersHeroic: 3,
  /** The soldiers rise this far from him, spread round him. */
  oathSoldierRing: 9,
  oathBrokenStun: 4,
  oathBrokenVulnSeconds: 10,
  oathBrokenVuln: 0.2,
} as const;

/** The Oath's soldiers: his own drowned garrison. */
export const OLEN_SOLDIER_ID = 'drowned_sergeant';

/** The Hallowed Brine's radius on a difficulty. */
export function brineRadius(heroic: boolean): number {
  return heroic ? OLEN_KIT.brineRadiusHeroic : OLEN_KIT.brineRadius;
}

/** The Sentence's splash radius on a difficulty. */
export function sentenceRadius(heroic: boolean): number {
  return heroic ? OLEN_KIT.sentenceRadiusHeroic : OLEN_KIT.sentenceRadius;
}

/** The order the Rebounding Bulwark strikes in: the first victim, then each
 *  rebound to the nearest player not yet struck within `reach` of the last
 *  (ties to the lower id), up to `max` players. Pure. */
export function bulwarkChain(
  first: { id: number; x: number; z: number },
  others: readonly { id: number; x: number; z: number }[],
  reach: number,
  max: number,
): number[] {
  const out = [first.id];
  let at = first;
  while (out.length < max) {
    let best: { id: number; x: number; z: number } | null = null;
    let bestD = Infinity;
    for (const o of others) {
      if (out.includes(o.id)) continue;
      const d = Math.hypot(o.x - at.x, o.z - at.z);
      if (d > reach) continue;
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best !== null && o.id < best.id)) {
        best = o;
        bestD = d;
      }
    }
    if (!best) break;
    out.push(best.id);
    at = best;
  }
  return out;
}

// ---- Olen: the retired Oathbound Charge (its constants stay for the renderer's
// lane visuals until those retire with it) ----------------------------------------

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
  // The Mooring Posts (ossick_moorings.ts): a hooked player who comes within
  // postReach of a LIT post moors the chain to it and is freed; that post's
  // lamp dies for postDarkSeconds (its last postKindleSeconds re-lighting),
  // the others stay lit. Heroic keeps all four: its faster haul already
  // shortens the run (see the reach note below).
  postReach: 3,
  postDarkSeconds: 30,
  postKindleSeconds: 5,
  /** A post takes only a chain that had to be run to it: never one whose
   *  victim was hooked within this many yards of it (no camping a post,
   *  and the mark's warning cannot be spent standing on one). */
  postRun: 6,
} as const;

// The hook is a tether, not a root: the victim keeps their feet but can never
// stand further from the winch than the chain, which reels in at the haul's
// pace (a victim who stands still is hauled exactly as before). The posts
// stand 14.85 yd from the winch (10.5 yd along each diagonal), so a post is in
// reach only while the chain is longer than 14.85 - 3 = 11.85 yd. Hooked at
// the yard's edge (20 yd) that leaves about 7.9 s (the 1.5 s settle, then the
// reel from 20 to 11.85 yd), 7.2 s on heroic; hooked at 14 yd, about 3.6 s;
// hooked inside 11.85 yd, no post: break the chain. With an anchor every 24 s
// and a post dark for 30, at most two posts are ever spent at once, so a lit
// post is always somewhere: the question is whether the victim stands where
// it can be reached. A post never takes a chain whose victim was hooked
// within postRun of it, so parking the group by the posts buys nothing: a
// victim hooked at one post must run to another (21 yd round the rim, about
// 3 s), a race against the reel.

export const WINCH = DROWNING_WINCH;
export const YARD = DROWNING_YARD;

/** The Mooring Posts (instance-local), in their fixed order. */
export const MOORING_POST_SPOTS: readonly { id: string; x: number; z: number }[] = MOORING_POSTS;

/** The post a hooked player at (x, z) moors to: the nearest LIT post within
 *  `postReach` (ties to the lower index) that stands at least `postRun` from
 *  where the anchor hooked them (hookX, hookZ), or -1. Pure. */
export function mooringPostInReach(
  x: number,
  z: number,
  lit: readonly boolean[],
  hookX: number,
  hookZ: number,
): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < MOORING_POSTS.length; i++) {
    if (!lit[i]) continue;
    const post = MOORING_POSTS[i];
    if (Math.hypot(hookX - post.x, hookZ - post.z) < OSSICK_TUNING.postRun) continue;
    const d = Math.hypot(x - MOORING_POSTS[i].x, z - MOORING_POSTS[i].z);
    if (d > OSSICK_TUNING.postReach) continue;
    if (d < bestD - 1e-9) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/** The longest chain (yd from the winch's centre) that can no longer reach
 *  any post: inside it, only breaking the chain frees the victim. */
export const MOORING_CHAIN_FLOOR =
  Math.min(
    ...MOORING_POSTS.map((p) => Math.hypot(p.x - DROWNING_WINCH.x, p.z - DROWNING_WINCH.z)),
  ) - OSSICK_TUNING.postReach;

/** A dark post's lamp: kindling once `left` seconds of its dark remain within
 *  `postKindleSeconds`, else dark; lit at 0. */
export function mooringStateFor(left: number): MooringState {
  if (left <= 1e-6) return 'lit';
  return left <= OSSICK_TUNING.postKindleSeconds + 1e-6 ? 'kindling' : 'dark';
}

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
  /** A figure the beam touched wears its tell (lit, or hollow) this long after
   *  the beam moves on: the beam crosses a figure in about a quarter second. */
  beamLinger: 1.5,
  // The Reaper's Shadowstep: he sinks into the shadows, a pool opens behind
  // one player, and he rises out of it with the scythe; then again behind a
  // second player and a third (vael_shadowstep.ts). The countdown runs only
  // in the open fight (never through a chain, a veil or a Mist Surge bar,
  // which takes 1.5 of every 13.5 s), so a cycle is the chain plus
  // reapEvery x 13.5 / 12 of wall time. Against the single step it replaced
  // (3 s step + 16 s countdown, a 21 s cycle, one sweep of 80 to 95): a chain
  // is 3 x (0.8 + 1.6 + 0.6 + 0.5) = 10.5 s, the cycle 10.5 + 22.5 = 33 s,
  // 5.5 sweeps a minute (was 2.9) of 60 to 70, each on a DIFFERENT player:
  // in a group of five (four non-tanks, the tank only marked when nobody else
  // is free), a non-tank who fails every step takes 89 a minute (was 63), one
  // who steps out takes nothing. What nobody can dodge FALLS: his
  // swing and the surge clock stop while he steps, 10.5 of every 33 s (32
  // percent, was 3 of 21, 14 percent), so the tank's melee and the Mist Surge
  // (now every 19.8 s, was 15.8) each land about 20 percent less a minute.
  // Under the floor he is untouchable 7.2 of every 33 s (22 percent, was 11);
  // each rise and the beat after each sweep stay touchable.
  reapFirst: 12,
  reapEvery: 20,
  /** Steps in one chain, each on a different player while enough stand. */
  reapChain: 3,
  /** The beat after a sweep before he sinks for the next step (the scythe's
   *  follow-through), and after the last before he fights on. */
  reapRecover: 0.5,
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
  sweepMin: 60,
  sweepMax: 70,
  // Heroic: Grave Shadow, the pool lingers and burns.
  graveSeconds: 6,
  graveRadius: 3,
  gravePerSecond: 18,
  // Before the Fog Veil: he stills and speaks while the fog gathers on the
  // crown (untouchable), sinks, and the four figures rise (veilRiseSeconds).
  veilGatherSeconds: 2.4,
  // His entrance (vael_intro.ts): buried under the crown until a player
  // climbs onto it, he rises, speaks, sinks and rises again round the
  // Fogbeacon, then takes his place and only there turns to fight. Full:
  // 3 x (1.2 + 1.6 + 0.8 + 0.3) + 1.2 + 1.6 = 14.5 s; after a wipe, one rise
  // at his place and one line: 2.8 s.
  introSpeakSeconds: 1.6,
  /** The crossing under the flags between a sink and the next rise. */
  introUnderSeconds: 0.3,
  /** How deep under the flags he waits, out of every camera's sight. */
  buriedDepth: 14,
  /** A player this far inside the crown's rim (and on its floor) wakes him. */
  introTriggerInset: 2,
} as const;

/** The spots he rises at through his entrance (instance-local), round the
 *  Fogbeacon in front of the crown stair (where the group climbs up: the
 *  stair mouth's bearing from the crown's middle, sim yaw), then his place. */
export const VAEL_INTRO_ARRIVAL_YAW = Math.atan2(-11, -20);
/** His place (his spawn): west of the Fogbeacon, in sight of the crown stair. */
export const VAEL_HOME = { x: -22, z: 214 } as const;
export const VAEL_INTRO_STOPS: readonly { x: number; z: number }[] = [
  [0.96, 14],
  [-0.96, 14],
  [0, 12],
]
  .map(([turn, r]) => {
    const a = VAEL_INTRO_ARRIVAL_YAW + turn;
    return { x: BEACON_CROWN.x + Math.sin(a) * r, z: BEACON_CROWN.z + Math.cos(a) * r };
  })
  .concat([{ x: VAEL_HOME.x, z: VAEL_HOME.z }]);

/** Seconds one entrance stop takes: the rise, the line, and (all but the
 *  last) the sink and the crossing under the flags. */
export function vaelIntroSeconds(short: boolean): number {
  const T = VAEL_TUNING;
  const last = T.veilRiseSeconds + T.introSpeakSeconds;
  if (short) return last;
  const stop = T.veilRiseSeconds + T.introSpeakSeconds + T.vanishSeconds + T.introUnderSeconds;
  return stop * (VAEL_INTRO_STOPS.length - 1) + last;
}

/** Seconds from a veil threshold to the four figures standing risen. */
export const VAEL_VEIL_TRANSITION_SECONDS =
  VAEL_TUNING.veilGatherSeconds + VAEL_TUNING.vanishSeconds + VAEL_TUNING.veilRiseSeconds;

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
