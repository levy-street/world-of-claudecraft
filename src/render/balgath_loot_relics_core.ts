// The pure half of the Balgath trinket presentation (balgath_loot_relics.ts): which of
// the five trinkets' states an entity shows, read off its auras, and the few curves the
// Three half poses its pieces with. No Three, no DOM, so a Vitest drives it directly.

/** The trinket auras (src/sim/content/trinkets.ts TRINKET_AURA), by id. */
export const LOOT_AURA = Object.freeze({
  foremanShape: 'trinket_foreman_shape',
  musterStandard: 'trinket_muster_standard',
  gutteredGlare: 'trinket_guttered_glare',
  stoneStatue: 'trinket_barrowstone_statue',
});

/** The spellfx cues the sim emits for them (combat/balgath_trinkets.ts). */
export const LOOT_CUE = Object.freeze({
  foremanShape: 'trinket_knucklebone_of_balgath',
  musterStandard: 'trinket_muster_standard',
  gutteredGlare: 'trinket_guttered_eye',
  grapnel: 'trinket_muster_grapnel',
  statue: 'trinket_barrowstone_heart',
  statueRelease: 'trinket_barrowstone_heart_release',
});

export const LOOT_FOREMAN = 1;
export const LOOT_STANDARD = 2;
export const LOOT_GLARE = 4;
export const LOOT_STATUE = 8;

export interface LootScan {
  flags: number;
  standardX: number;
  standardZ: number;
  standardRemaining: number;
  glareRemaining: number;
}

export function createLootScan(): LootScan {
  return { flags: 0, standardX: 0, standardZ: 0, standardRemaining: 0, glareRemaining: 0 };
}

interface AuraLike {
  id?: string;
  kind?: string;
  remaining?: number;
  value2?: number;
  value3?: number;
}

/** One pass over an entity's auras: what it shows, and where its standard stands. */
export function scanLootAuras(auras: readonly AuraLike[], out: LootScan): LootScan {
  out.flags = 0;
  for (const a of auras) {
    if (a.id === LOOT_AURA.foremanShape || a.kind === 'form_foreman') out.flags |= LOOT_FOREMAN;
    else if (
      a.id === LOOT_AURA.musterStandard &&
      a.value2 !== undefined &&
      a.value3 !== undefined
    ) {
      out.flags |= LOOT_STANDARD;
      out.standardX = a.value2;
      out.standardZ = a.value3;
      out.standardRemaining = a.remaining ?? 0;
    } else if (a.id === LOOT_AURA.gutteredGlare) {
      out.flags |= LOOT_GLARE;
      out.glareRemaining = a.remaining ?? 0;
    } else if (a.id === LOOT_AURA.stoneStatue) out.flags |= LOOT_STATUE;
  }
  return out;
}

/**
 * The asset the Metamorphosis form slot should hold for these auras (the renderer shares
 * that slot between the warlock's demon and the Shape of the Foreman), or null when the
 * body asks for neither. Mirrors characters/form_visual_selection_core.ts.
 */
export function metamorphSlotAsset(
  auras: readonly AuraLike[],
): 'form_foreman' | 'form_metamorph' | null {
  let metamorph = false;
  for (const a of auras) {
    if (a.kind === 'form_foreman') return 'form_foreman';
    if (a.kind === 'form_metamorph' || a.kind === 'form_lich') metamorph = true;
  }
  return metamorph ? 'form_metamorph' : null;
}

/** Seconds the standard takes to drive into the ground, and to sink back out of sight. */
export const STANDARD_PLANT_SEC = 0.32;
export const STANDARD_SINK_SEC = 0.7;
/** How high above its spot the standard starts its drop. */
export const STANDARD_DROP_HEIGHT = 2.2;

/** Height above the ground of a planting standard `age` seconds after it appeared: an
 *  accelerating drop that stops dead on the spike (the dust burst fires on that frame). */
export function standardPlantOffset(age: number): number {
  if (age >= STANDARD_PLANT_SEC) return 0;
  const k = Math.max(0, age) / STANDARD_PLANT_SEC;
  return STANDARD_DROP_HEIGHT * (1 - k * k);
}

/** How far into the ground a falling standard has sunk (0 standing, 1 gone). */
export function standardSinkProgress(since: number): number {
  return Math.min(1, Math.max(0, since / STANDARD_SINK_SEC));
}

/** The banner cloth's swing about its crossbar (radians): a slow wind wave, still when
 *  reduced motion asks for it. Phase-shifted per owner so two standards never sway alike. */
export function bannerSway(t: number, ownerId: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  const p = ownerId * 1.618;
  return 0.07 * Math.sin(t * 1.7 + p) + 0.03 * Math.sin(t * 3.9 + p * 2);
}

/** Seconds the grapnel hook flies out before it bites, the rope's full life, and the
 *  closing reel back into the hand. */
export const GRAPNEL_THROW_SEC = 0.14;
export const GRAPNEL_ROPE_SEC = 0.85;
export const GRAPNEL_REEL_SEC = 0.16;
/** The rope stays taut, reel held back, while the ally is still this far from the hand
 *  (a slow frame or a long haul must not reel the hook in mid-flight), up to a cap. */
export const GRAPNEL_HOLD_DIST = 2.5;
export const GRAPNEL_MAX_HOLD_SEC = 1.5;

/** How much of the way from the hand to the ally the hook has travelled: out fast, then
 *  pinned to the ally for the haul, then reeled back into the hand at the end. */
export function grapnelReach(age: number, life = GRAPNEL_ROPE_SEC): number {
  if (age <= 0) return 0;
  if (age < GRAPNEL_THROW_SEC) return age / GRAPNEL_THROW_SEC;
  const reelStart = life - GRAPNEL_REEL_SEC;
  if (age < reelStart) return 1;
  return Math.max(0, 1 - (age - reelStart) / GRAPNEL_REEL_SEC);
}

/** The rope's age after one more frame: it runs on, except that it waits just short of
 *  the reel while the ally is still far from the hand, for at most the hold cap. */
export function advanceRopeAge(
  age: number,
  held: number,
  dt: number,
  allyDistance: number,
): { age: number; held: number } {
  const reelStart = GRAPNEL_ROPE_SEC - GRAPNEL_REEL_SEC;
  const next = age + dt;
  if (next < reelStart || allyDistance <= GRAPNEL_HOLD_DIST || held >= GRAPNEL_MAX_HOLD_SEC)
    return { age: next, held };
  return { age: Math.max(age, reelStart - 1e-3), held: held + dt };
}

/** The rope's sag at fraction `k` along it: taut while the haul pulls, slack as it
 *  flies out and reels in. */
export function ropeSag(k: number, reach: number, length: number): number {
  const slack = reach < 1 ? 0.35 : 0.08;
  return -Math.sin(Math.PI * k) * Math.min(1.2, length * 0.06) * slack * 4;
}

/** The beam's flicker multiplier: a gutted crystal's uneven burn. */
export function glareFlicker(t: number, ownerId: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  const p = ownerId * 0.73;
  return 0.86 + 0.1 * Math.sin(t * 23 + p) + 0.04 * Math.sin(t * 57 + p * 3);
}
