// The Lady of the Bonechill's ids, tuning and pure geometry (the frost ravine
// floor of the Widow's Gallery, the second Hollow Crypt boss; the boss id stays
// `rimeweb`, frozen since the spider placeholder). A dependency-light leaf: the
// encounter modules, the dev helpers, the renderer, the HUD alert and the tests
// key on these. No SimContext, no rng.
//
// The ghost of a bride buried in the ravine's ice.
//
//   Bride's Lament     a long wail: frost on everyone NOT in the light of a
//                      lit grave lantern. A lantern shelters two at most and
//                      goes dark after a Lament (it misses the next one), so
//                      the group splits across the lanterns and rotates; every
//                      Lament taken leaves Lingering Lament (the next one bites
//                      harder), so the same players should not take two.
//   Frozen Embrace     she seizes a non-tank and rises into the air with them;
//                      a set share of her health dealt quickly makes her let go
//                      gently, otherwise she drops them from height.
//   Rime Path          where she drifts she leaves slippery ice.
//   Bridal Freeze      at half health the whole ravine floor freezes over.
//   Heroic             the lanterns burn out on their own after a while (they
//                      stay lit for less time), and the Embrace takes two.

import { BONECHILL_LANTERN_SPOTS, HOLLOW_CRYPT_ANCHORS } from '../../content/hollow_crypt_layout';

/** The boss id, frozen from the placeholder spider (spawns, loot, deeds). */
export const LADY_ID = 'rimeweb';

// ---- cast ids ----------------------------------------------------------------------
export const LADY_BRIDES_LAMENT = 'crypt_lady_brides_lament';
export const LADY_FROZEN_EMBRACE = 'crypt_lady_frozen_embrace';
/** The Embrace in flight (the hold): a channel bar while she hangs aloft. */
export const LADY_EMBRACE_HOLD = 'crypt_lady_embrace_hold';
export const LADY_BRIDAL_FREEZE = 'crypt_lady_bridal_freeze';

// ---- spellfx ability ids (presentation cues, never casts) -----------------------------
/** She lets go gently (from her to the freed player). */
export const LADY_EMBRACE_RELEASED = 'crypt_lady_embrace_released';
/** She drops them (from her to the falling player). */
export const LADY_EMBRACE_DROPPED = 'crypt_lady_embrace_dropped';
/** A dropped player hits the ice. */
export const LADY_SHATTERING_FALL = 'crypt_lady_shattering_fall';
/** A lantern shelters players through a Lament (from the lantern object). */
export const LADY_LANTERN_SHELTER = 'crypt_lady_lantern_shelter';

// ---- auras ------------------------------------------------------------------------
/** Held in her arms: stunned and carried (an unbreakable stun; the HUD's alert
 *  and tooltip read the rule from LADY_TUNING). */
export const LADY_EMBRACED = 'crypt_lady_embraced';
/** Every Lament taken: the next one bites harder (stacks). */
export const LADY_LINGERING_LAMENT = 'crypt_lady_lingering_lament';
/** While a Lament is being wailed: on every player, running out as it lands
 *  (the HUD's warning). value2 is 1 while they stand in a lit lantern's light
 *  with room for them, else 0: a hint only, the shelter is judged at the end. */
export const LADY_LAMENT_DREAD = 'crypt_lady_lament_dread';

// ---- encounter object templates -------------------------------------------------------
/** A grave lantern's state rides its object's template id. */
export const LADY_LANTERN_TEMPLATES = {
  lit: 'crypt_lady_lantern_lit',
  dark: 'crypt_lady_lantern_dark',
  kindling: 'crypt_lady_lantern_kindling',
} as const;
export type LanternState = keyof typeof LADY_LANTERN_TEMPLATES;
/** A patch of her Rime Path (scale = radius). */
export const LADY_RIME_PATCH_TEMPLATE = 'crypt_lady_rime_patch';
/** The frozen ravine after the Bridal Freeze (scale = radius). */
export const LADY_FROZEN_FLOOR_TEMPLATE = 'crypt_lady_frozen_floor';

export const LADY_OBJECT_TEMPLATES: ReadonlySet<string> = new Set([
  LADY_LANTERN_TEMPLATES.lit,
  LADY_LANTERN_TEMPLATES.dark,
  LADY_LANTERN_TEMPLATES.kindling,
  LADY_RIME_PATCH_TEMPLATE,
  LADY_FROZEN_FLOOR_TEMPLATE,
]);

/** The lantern state a template id names, or null for any other object. */
export function lanternStateOf(templateId: string): LanternState | null {
  if (templateId === LADY_LANTERN_TEMPLATES.lit) return 'lit';
  if (templateId === LADY_LANTERN_TEMPLATES.dark) return 'dark';
  if (templateId === LADY_LANTERN_TEMPLATES.kindling) return 'kindling';
  return null;
}

// ---- the arena -------------------------------------------------------------------
/** The ravine floor (instance-local centre and radius): the Great Web circle of
 *  the layout, now the Lady's frozen ravine. */
export const BONECHILL_RAVINE = {
  x: HOLLOW_CRYPT_ANCHORS.greatWeb.x,
  z: HOLLOW_CRYPT_ANCHORS.greatWeb.z,
  r: 20,
} as const;

/** The three grave lanterns round the ravine (instance-local), clear of the
 *  south entrance and the west postern. */
export const GRAVE_LANTERNS: readonly { x: number; z: number }[] = BONECHILL_LANTERN_SPOTS;

/** The frozen bridal grave on the ravine's north lip (where she rose). */
export const BRIDAL_GRAVE = { x: BONECHILL_RAVINE.x, z: BONECHILL_RAVINE.z + 15.5 } as const;

// ---- tuning (normal-mode bases; the heroic transform scales the damage) ------------------
// Numbers basis (docs/design/dungeon-rework/README.md 7): cloth about 320 health at
// level 9. An unsheltered Lament is about 20 percent (a pulse a player takes now and
// then by design: the lanterns cannot cover everyone every time), each Lingering
// Lament stack half again; the drop from the Embrace is the fumbled core (about 50
// percent, never a one-shot from full).
export const LADY_TUNING = {
  lamentFirst: 14,
  lamentEvery: 22,
  lamentCast: 3,
  lamentMin: 60,
  lamentMax: 75,
  /** Lingering Lament: more Lament damage per stack, its seconds and cap. */
  lingerPerStack: 0.5,
  lingerSeconds: 45,
  lingerMaxStacks: 3,
  /** A lantern's light (yd) and how many it shelters at once. */
  lanternRadius: 4.5,
  lanternCap: 2,
  /** Seconds a lantern stays dark after it sheltered anyone (it misses the next
   *  Lament), the last few kindling. */
  lanternDark: 28,
  lanternKindle: 4,
  /** Heroic: a lantern burns this long once lit, then gutters on its own for
   *  `lanternGutter` seconds even if nobody used it. */
  lanternLitHeroic: 30,
  lanternGutter: 10,
  embraceFirst: 24,
  embraceEvery: 30,
  embraceCast: 1.2,
  embraceVictims: 1,
  embraceVictimsHeroic: 2,
  /** The lift (seconds) and the height she carries them to. */
  embraceRise: 1.5,
  embraceHeight: 5,
  /** The longest hold before she drops them. */
  embraceHold: 8,
  /** The share of her max health dealt during the hold that makes her let go. */
  embraceBreakShare: 0.06,
  /** Frost a second on the held. */
  embracePerSecond: 6,
  /** The gentle release (seconds to set them down). */
  embraceSetDown: 1,
  /** The drop's impact when they hit the floor. */
  dropMin: 150,
  dropMax: 180,
  /** Rime Path: a patch every so far she drifts, its radius, life and cap. */
  rimeSpacing: 2.5,
  rimeRadius: 2.6,
  rimeSeconds: 25,
  rimeCap: 14,
  /** The ice's grip (yd/s per second) under a player on her ice. */
  iceGrip: 8,
  /** The Bridal Freeze: at this health share, its bar, and the frozen floor. */
  freezeAt: 0.5,
  freezeCast: 2.5,
} as const;

/** Which of `players` a lit lantern at (lx, lz) shelters: those within its
 *  light, nearest first (ties to the lower id), at most `cap`. Pure. */
export function lanternShelters<P extends { id: number; x: number; z: number }>(
  lx: number,
  lz: number,
  players: readonly P[],
  radius: number,
  cap: number,
): P[] {
  const inside = players
    .map((p) => ({ p, d: Math.hypot(p.x - lx, p.z - lz) }))
    .filter((e) => e.d <= radius)
    .sort((a, b) => a.d - b.d || a.p.id - b.p.id);
  return inside.slice(0, cap).map((e) => e.p);
}

/** A lantern's shown state from its dark countdown (0: lit). Pure. */
export function lanternStateFor(dark: number): LanternState {
  if (dark <= 0) return 'lit';
  return dark <= LADY_TUNING.lanternKindle ? 'kindling' : 'dark';
}

/** Is (px, pz) on the ravine floor? */
export function onRavine(px: number, pz: number): boolean {
  return Math.hypot(px - BONECHILL_RAVINE.x, pz - BONECHILL_RAVINE.z) <= BONECHILL_RAVINE.r + 0.5;
}
