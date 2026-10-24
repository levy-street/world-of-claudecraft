// The Gravewyrm Sanctum's encounter ids and tuning, as a dependency-free leaf:
// the content (gravewyrm_sanctum.ts), the encounter modules, the trash kit's
// toss rings (mob/trash_kit/sanctum_kit.ts), the dev helpers, the renderer's
// telegraphs and the Calving Face, and the tests all key on these.
//
// docs/design/dungeon-rework/gravewyrm_sanctum.md sections 3, 5 and 6.

import { SANCTUM_BOSS_OBJECT_TEMPLATES } from './boss_ids';

export * from './boss_ids';

export const SANCTUM_DUNGEON = 'gravewyrm_sanctum';

/** The three bosses, in route order (their cores are phase B). */
export const KORGATH_ID = 'korgath_the_bound';
export const VELKHAR_ID = 'grand_necromancer_velkhar';
export const KORZUL_ID = 'korzul_the_gravewyrm';
/** The showpiece patrol of the Sledge Road. */
export const SLEDGE_TUSKER_ID = 'sledge_tusker';
/** The trash (the Boneguard, the Scaleguard and the Bonewalker are shipped). */
export const BONEGUARD_ID = 'sanctum_boneguard';
export const SCALEGUARD_ID = 'sanctum_drakonid';
export const BONEWALKER_ID = 'raised_bonewalker';
export const THAWCALLER_ID = 'broodsworn_thawcaller';
export const GOADSMITH_ID = 'broodsworn_goadsmith';
export const PYRE_TENDER_ID = 'broodsworn_pyre_tender';
export const SOUL_BRAZIER_ID = 'soul_brazier';
export const RIME_WHELP_ID = 'rime_whelp';
export const SLEDGE_HAULER_ID = 'ogre_sledge_hauler';
export const GLACIER_SPLINTER_ID = 'glacier_splinter';

// ---- the Sledge Tusker (section 5.3) -------------------------------------------

/** Tusk Sweep: a sweep of its tusks through a frontal cone, with a knockback. */
export const TUSKER_TUSK_SWEEP = 'sanctum_tusker_tusk_sweep';
/** Trample: a lane painted to the farthest player, then the charge down it. */
export const TUSKER_TRAMPLE = 'sanctum_tusker_trample';
/** The knockdown a Trample leaves (a short stun). */
export const TUSKER_KNOCKDOWN = 'sanctum_tusker_knockdown';
/** Spilled Braziers: the sledge tips at half health (a `nova` spellfx on the
 *  Tusker); three soulfire patches burn on the road. */
export const TUSKER_SPILLED_BRAZIERS = 'sanctum_tusker_spilled_braziers';
/** The damage a burning soulfire patch deals each second (its ability name). */
export const TUSKER_SOULFIRE = 'sanctum_tusker_soulfire';
/** The Tusker's Enrage under a fifth of its health (a damage-done aura). */
export const TUSKER_ENRAGE = 'sanctum_tusker_enrage';

/**
 * The Tusker's numbers (normal; heroic scales the damage through the claim's
 * mechanicDamageMult). Damage is stated LANDED on a level-20 cloth wearer of
 * about 950 health (README section 7): Tusk Sweep and Trample about 21 to 25
 * percent, both avoidable; a soulfire patch about 4 percent a second.
 */
export const TUSKER_TUNING = {
  /** Tusk Sweep: every 12 s a 1.5 s bar, then a frontal 120 degree cone 10 yd
   *  deep from its body's edge (its tusk tips reach 11 yd ahead of its centre). */
  sweepEvery: 12,
  sweepFirst: 5,
  sweepCast: 1.5,
  sweepRange: 10,
  sweepArcDeg: 120,
  sweepMin: 180,
  sweepMax: 220,
  /** Yards the Tusk Sweep throws a player. */
  sweepKnockback: 8,
  /** Trample: every 16 s a 2 s bar painting a lane to the farthest player,
   *  then the charge down it (30 yd, 4 yd wide). */
  trampleEvery: 16,
  trampleFirst: 9,
  trampleCast: 2,
  trampleLength: 30,
  trampleHalfWidth: 2.5,
  /** Seconds the charge takes to run the lane. */
  trampleRun: 0.8,
  trampleMin: 200,
  trampleMax: 240,
  /** The knockdown (a stun) on everyone the charge runs over. */
  knockdown: 1,
  /** Spilled Braziers: once, at half health: three soulfire patches. */
  spillAtHpPct: 0.5,
  patchRadius: 4,
  patchSeconds: 10,
  patchTick: 1,
  patchMin: 36,
  patchMax: 44,
  /** Where the three patches land in the Tusker's own frame (yards to its
   *  left, yards forward): where its sledge's Tip clip throws the three soul
   *  braziers (the sledge hangs 10.5 yd behind it; E:/woc/entregas/santuario/
   *  tusker NOTAS.md). */
  patchSpots: [
    { left: 5.2, fwd: -8.1 },
    { left: 6.0, fwd: -11.1 },
    { left: 4.8, fwd: -13.7 },
  ],
  /** Enrage under a fifth of its health: 30 percent more damage. */
  enrageAtHpPct: 0.2,
  enrageDamage: 0.3,
} as const;

/** The Tusker's chat line when its sledge tips (re-localized by src/ui/sim_i18n.ts). */
export const TUSKER_SPILL_LOG =
  'The sledge tips over! Burning soul braziers spill across the Sledge Road.';

// ---- encounter objects: their template id carries their look -----------------

/** A burning soulfire patch on the road (scale = radius). */
export const SANCTUM_SOULFIRE_PATCH = 'sanctum_soulfire_patch';
/** An Ice Block Toss's ring where the block will land (scale = radius). */
export const SANCTUM_TOSS_RING = 'sanctum_toss_ring';

// ---- the Calving Face's crack steps (section 3) ----------------------------------

/**
 * The story markers' template ids: the Calving Face's crack step, driven by the
 * run's encounter state (never a timer). Step 0 arrival; 1 the Sledge Tusker is
 * dead; 2 to 5 one to four of Korgath's chains broken (phase B; his death fills
 * them all); 6 Korgath is dead; 7 Velkhar is dead; 8 Korzul is pulled (he tears
 * free and the face collapses). Monotonic for the life of the claim.
 */
export const SANCTUM_STORY_STEPS = 8;
export const SANCTUM_STORY_PREFIX = 'sanctum_story_';

export function sanctumStoryTemplate(step: number): string {
  const s = Math.max(0, Math.min(SANCTUM_STORY_STEPS, Math.floor(step)));
  return `${SANCTUM_STORY_PREFIX}${s}`;
}

/** The crack step a story marker's template id carries, or null for any other
 *  template. */
export function sanctumStoryStepOf(templateId: string): number | null {
  if (!templateId.startsWith(SANCTUM_STORY_PREFIX)) return null;
  const n = Number(templateId.slice(SANCTUM_STORY_PREFIX.length));
  return Number.isInteger(n) && n >= 0 && n <= SANCTUM_STORY_STEPS ? n : null;
}

/** The Calving Face's five render stages (design section 3) from a crack step:
 *  0 the hairline crack; 1 the first plate falls; 2 the chains (with
 *  `chains` broken); 3 the lock open; 4 the face calved, the head bare; 5 the
 *  wyrm torn free. */
export function sanctumFaceStage(step: number): { stage: number; chains: number } {
  if (step >= 8) return { stage: 5, chains: 4 };
  if (step >= 7) return { stage: 4, chains: 4 };
  if (step >= 6) return { stage: 3, chains: 4 };
  if (step >= 2) return { stage: 2, chains: step - 1 };
  return { stage: step >= 1 ? 1 : 0, chains: 0 };
}

/** Every template the Sanctum draws itself (the renderer gives each an empty
 *  anchor, render/gate_objects.ts). */
export const SANCTUM_OBJECT_TEMPLATES: ReadonlySet<string> = new Set<string>([
  SANCTUM_SOULFIRE_PATCH,
  SANCTUM_TOSS_RING,
  ...Array.from({ length: SANCTUM_STORY_STEPS + 1 }, (_, i) => sanctumStoryTemplate(i)),
  ...SANCTUM_BOSS_OBJECT_TEMPLATES,
]);
