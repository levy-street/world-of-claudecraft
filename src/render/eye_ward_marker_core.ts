// Where to aim the Shardpike, drawn on the boss himself.
//
// The trial's missing half. The HUD can say "strike the eye" in words, but words do not tell
// a player WHICH part of a thirty-foot silhouette is the eye, whether they are close enough,
// or whether the thing is even open right now. Those are spatial facts and they belong in the
// world, on the target, where the player is already looking.
//
// State comes off the BOSS ENTITY's own auras rather than the wielder's self-snapshot, and
// that is deliberate: the ward auras are already the sanctioned presentation mirror of the
// two timestamps that hold the truth (src/sim/mob/eye_ward.ts), they are on the wire for
// every viewer, and reading them means a second pike-carrier standing beside you sees the
// same ring at the same moment without a single new wire field.
//
// Three/DOM/i18n-free and deterministic, so a Vitest drives it and the RENDER_PURE_CORES
// purity sweep in tests/architecture.test.ts covers it.

/** Aura ids the ward mirrors itself through (src/sim/mob/eye_ward.ts). */
export const EYE_WARD_AURA_ID = 'eye_ward';
export const EYE_WARD_BLINDED_AURA_ID = 'eye_ward_blinded';

/** What the ring is saying this frame. */
export type EyeWardMarkerState =
  /** Ward up, seal lifted: a thrust lands. The one state that invites a press. */
  | 'open'
  /** Ward up but sealed, or the wielder is out of reach. Present, not actionable. */
  | 'shut'
  /** The eye is already out. The mechanic is done; the ring is a countdown, not a target. */
  | 'blinded';

/**
 * Who this drawing is for, which decides what it is allowed to say.
 *
 * The split exists because two different jobs were being done by one flag. "Aim the pike
 * HERE, and you are/are not close enough" is an instruction, and an instruction shown to
 * someone with no pike is noise on their screen for the whole fight. But "his ward is down,
 * your damage finally lands" is not an instruction, it is the single most actionable fact in
 * the encounter, and hiding it from the twenty players doing the damage was the bug: they
 * were the ones who needed it. So the STATE reads for everybody and only the reticle's
 * aiming behaviour is gated on carrying the pike.
 */
export type EyeWardMarkerRole = 'state' | 'aim';

export interface EyeWardMarkerPlan {
  role: EyeWardMarkerRole;
  state: EyeWardMarkerState;
  /** Ring colour. */
  color: number;
  /** Base opacity before the breath. */
  alpha: number;
  /** Breaths per second. */
  pulseHz: number;
  /** Ring radius as a multiple of the core radius, so a state can tighten or open it. */
  radiusScale: number;
}

const OPEN = 0x76e0d8; // the Loomshard's own teal: this is its socket
const SHUT = 0x8b8378; // dead stone
const BLINDED = 0x7fd06a; // the same green the mend/window cues use

/**
 * Read the ward state off an entity's aura list.
 *
 * Returns null for anything that is not a warded boss at all, which is how the caller
 * decides whether to draw a marker in the first place.
 */
export function eyeWardStateOf(
  auras: readonly { id?: string }[] | undefined,
): 'up' | 'down' | null {
  if (!auras) return null;
  let warded = false;
  for (const a of auras) {
    if (a.id === EYE_WARD_BLINDED_AURA_ID) return 'down';
    if (a.id === EYE_WARD_AURA_ID) warded = true;
  }
  return warded ? 'up' : null;
}

/**
 * The ring for this frame.
 *
 * `inReach` deliberately only changes the ring's TIGHTNESS and brightness, never its
 * presence: a marker that vanishes when you step back teaches nothing about where to stand,
 * while one that opens up as you approach teaches it without a word. It is only consulted in
 * the `aim` role; a viewer with no pike has no reach to be inside.
 *
 * BLINDED is loud in both roles and that is deliberate: it is the raid's damage window, so a
 * player with no pike must see it as clearly as the wielder does.
 */
export function eyeWardMarkerPlan(
  role: EyeWardMarkerRole,
  ward: 'up' | 'down',
  sealed: boolean,
  inReach: boolean,
): EyeWardMarkerPlan {
  if (ward === 'down') {
    return { role, state: 'blinded', color: BLINDED, alpha: 0.72, pulseHz: 1.4, radiusScale: 2.4 };
  }
  if (sealed) {
    return { role, state: 'shut', color: SHUT, alpha: 0.3, pulseHz: 0.25, radiusScale: 1.5 };
  }
  // Warded and pryable. For a non-wielder this is just "still shielded", so it stays quiet;
  // for the wielder it is a live target, and it tightens as they close.
  if (role === 'state') {
    return { role, state: 'open', color: OPEN, alpha: 0.42, pulseHz: 0.7, radiusScale: 2.1 };
  }
  return inReach
    ? { role, state: 'open', color: OPEN, alpha: 0.92, pulseHz: 2.2, radiusScale: 1.85 }
    : { role, state: 'open', color: OPEN, alpha: 0.5, pulseHz: 0.9, radiusScale: 2.9 };
}

/**
 * Which state badge floats over him, or null to show none.
 *
 * The badge is the read a DAMAGE DEALER needs and the ring alone cannot give them: a ring
 * colour is learned, a picture of a shattered eye is not. Nothing shows while he is merely
 * warded-and-sealed to a non-wielder, because a permanent badge over a boss for the 40
 * seconds nothing can be done about it trains people to ignore the badge.
 */
export function eyeWardBadgeId(plan: EyeWardMarkerPlan): string | null {
  if (plan.state === 'blinded') return 'eye_ward_blinded';
  if (plan.state === 'shut') return plan.role === 'aim' ? 'eye_ward_sealed' : null;
  return 'eye_ward_open';
}

/** Ring opacity at `clock`, breathing at the plan's own rate. */
export function eyeWardMarkerAlpha(
  plan: EyeWardMarkerPlan,
  clock: number,
  reducedMotion = false,
): number {
  if (reducedMotion) return plan.alpha;
  return plan.alpha * (0.68 + 0.32 * Math.sin(clock * plan.pulseHz * Math.PI * 2));
}

/** Seconds a landed-thrust burst lives. Short: it marks an instant, it is not a state. */
export const EYE_WARD_BURST_SECONDS = 0.85;

/**
 * A landed thrust's burst, as (radiusScale, alpha) at `age`.
 *
 * Expands and fades at once, which is the shape a player already reads as impact. Alpha
 * falls faster than the radius grows so the ring thins out rather than becoming a big
 * bright disc at the end of its life.
 */
export function eyeWardBurstAt(age: number): { radiusScale: number; alpha: number } | null {
  if (age < 0 || age >= EYE_WARD_BURST_SECONDS) return null;
  const t = age / EYE_WARD_BURST_SECONDS;
  return { radiusScale: 1 + 7 * t, alpha: (1 - t) ** 2 };
}
