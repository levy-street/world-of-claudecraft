// Pure resolver for the graphics-tier UI effects profile. It maps the three
// player-facing inputs (graphics preset label, effectsQuality, reduced-motion)
// onto a small profile the applier publishes to the page as `data-fx-level` plus
// the `--fx-*` tokens. Driven by the STATIC graphics preset only, never the FPS
// governor (the two-controller hazard: the auto-governor cannot measure compositor
// blur cost, so the HUD effect tier is owned by the preset the player chose).
//
// This module is host-agnostic and DOM/Three-free: it is registered with
// tests/architecture.test.ts and unit-tested directly under Node. It is a
// render-importable LEAF in src/game (not src/ui): src/render/gfx.ts imports
// EFFECTS_QUALITY_LOW_CUTOFF from here so the HUD effect tier and the 3D renderer
// agree on the same effectsQuality cutoff (one source of truth, no duplication),
// and render must never import ui. It imports NOTHING (no governor, no render, no
// ui), which is the heart of the two-controller-hazard acceptance.

/** The discrete HUD effect tier stamped onto `html[data-fx-level]`. */
export type UiEffectsTier = 'low' | 'medium' | 'high' | 'ultra';

/**
 * Motion vocabulary. Reduced-motion is the strongest motion authority and maps
 * straight to 'none' (calm, not deleted: the applier writes a near-zero
 * --motion-scale, never 0, so transitionend/animationend still fire). 'reduced'
 * is reserved for a future intermediate policy and is not emitted today.
 */
export type UiEffectsMotion = 'full' | 'reduced' | 'none';

/** Ambient/idle loop play-state, written to `--fx-ambient-anim`. */
export type UiEffectsAmbient = 'running' | 'paused';

export interface UiEffectsProfile {
  /** Discrete tier: drives `data-fx-level` whole-rule gates (glass, glow, FCT crit). */
  tier: UiEffectsTier;
  /** Motion axis (independent of tier): drives `--motion-scale` + ambient pause. */
  motion: UiEffectsMotion;
  /** Whether decorative box-shadow glows are kept (`--fx-shadow` 1) or cut (0). */
  heavyShadows: boolean;
  /** Ambient infinite loops run or pause (`--fx-ambient-anim`). */
  ambientAnim: UiEffectsAmbient;
  /** Whether floating-combat-text crits get their scale/pop (the number always shows). */
  allowFctCrit: boolean;
}

/** The resolved inputs: the static preset label, the effectsQuality slider, and the
 *  effective reduced-motion flag (OS prefers-reduced-motion OR the in-game setting). */
export interface UiEffectsInput {
  presetLabel: 'low' | 'medium' | 'high' | 'ultra' | 'advanced';
  effectsQuality: number;
  reduceMotion: boolean;
}

/**
 * The effectsQuality value below which the Advanced (custom) graphics preset
 * drops to its low cost path. Shared with src/render/gfx.ts (settingsFor) so the
 * HUD effect tier and the 3D renderer downgrade at the SAME threshold: gfx.ts
 * imports this constant rather than re-typing the literal.
 */
export const EFFECTS_QUALITY_LOW_CUTOFF = 0.5;

/**
 * Resolve the UI effects profile from the static preset label, the effectsQuality
 * slider, and the effective reduced-motion flag. Pure: same input always yields the
 * same profile.
 *
 * Precedence (unit-tested in tests/ui_effects_profile.test.ts):
 * - The tier is a FLOOR, not a ceiling: the preset sets the baseline effect level
 *   and nothing here raises it above the player's choice.
 * - For 'advanced', effectsQuality < EFFECTS_QUALITY_LOW_CUTOFF clamps to the low
 *   cost path (mirroring the renderer's own effectsQuality<cutoff downgrade);
 *   otherwise 'advanced' behaves as ultra. It is NOT collapsed to 'high': the expert
 *   path sheds HUD cost independently.
 * - Reduced-motion is the STRONGEST motion authority: it forces motion:'none' and
 *   pauses ambient loops, but it does NOT by itself drop glass (that is the tier's
 *   job, so an Ultra reduced-motion player keeps glass and only loses motion).
 * - Low tier cuts cost independent of motion: no heavy decorative shadows, no FCT
 *   crit emphasis, ambient paused. (Glass is dropped by the data-fx-level CSS at
 *   low; this profile carries the JS/token-driven cuts.)
 */
export function resolveUiEffectsProfile(input: UiEffectsInput): UiEffectsProfile {
  const { presetLabel, effectsQuality, reduceMotion } = input;
  const tier: UiEffectsTier =
    presetLabel === 'advanced'
      ? effectsQuality < EFFECTS_QUALITY_LOW_CUTOFF
        ? 'low'
        : 'ultra'
      : presetLabel;

  const motion: UiEffectsMotion = reduceMotion ? 'none' : 'full';

  // Only the low tier sheds GPU cost; medium/high/ultra stay at full effects
  // (visually identical to today). This keeps the default ultra tier untouched.
  const lowCost = tier === 'low';

  return {
    tier,
    motion,
    heavyShadows: !lowCost,
    ambientAnim: lowCost || reduceMotion ? 'paused' : 'running',
    allowFctCrit: uiEffectsAllowFctCrit(tier),
  };
}

/**
 * Whether two resolved profiles are identical across every field the applier stamps
 * (tier + motion + heavyShadows + ambientAnim + allowFctCrit, i.e. every field
 * data-fx-level + uiEffectsTokens read). The applier uses this as its diff-guard so
 * it never re-stamps on a no-op settings change (a tier switch forces a one-time
 * large style recalc, so a same-profile re-apply must short-circuit). A
 * null/undefined previous profile is never equal (boot must apply once). Pure +
 * unit-tested so the guard cannot silently regress into an always-restamp.
 */
export function uiEffectsProfilesEqual(
  a: UiEffectsProfile | null | undefined,
  b: UiEffectsProfile,
): boolean {
  return (
    !!a &&
    a.tier === b.tier &&
    a.motion === b.motion &&
    a.heavyShadows === b.heavyShadows &&
    a.ambientAnim === b.ambientAnim &&
    a.allowFctCrit === b.allowFctCrit
  );
}

/**
 * The flat `--fx-*` custom-property map the applier loops onto `:root`, mirroring
 * theme.ts's `themeCssVars` (a pure map; the host does the setProperty loop). Kept
 * pure (and unit-tested) so the load-bearing rules are pinned without a DOM: the
 * "calm, never deleted" motion rule writes a near-zero (not 0) --motion-scale so
 * transitionend/animationend still fire, and heavyShadows maps to the 0/1 --fx-shadow
 * glow multiplier. `data-fx-level` is NOT a custom property: the applier stamps it as
 * an attribute straight from `profile.tier`.
 */
export function uiEffectsTokens(profile: UiEffectsProfile): Record<string, string> {
  return {
    '--fx-shadow': profile.heavyShadows ? '1' : '0',
    '--fx-ambient-anim': profile.ambientAnim,
    // Calm, never deleted: 0.001 (not 0) keeps transitionend/animationend firing.
    '--motion-scale': profile.motion === 'full' ? '1' : '0.001',
  };
}

/** Whether a floating-combat-text crit keeps its scale/pop emphasis at the given
 *  published `data-fx-level` value (the damage number, colour and "!" always show;
 *  only the crit emphasis is gated off at the low tier). Takes the published tier
 *  STRING (= `profile.tier`, what `document.documentElement.dataset.fxLevel` holds)
 *  rather than a profile object. The resolver above derives `profile.allowFctCrit` from
 *  it (and the diff-guard compares that field); the FCT painter's own per-element crit
 *  gate ships separately via `fctDropNonCrit` (src/game/ui_tier_knobs.ts), so this helper
 *  is the resolver-side rule, not the painter call site. */
export function uiEffectsAllowFctCrit(fxLevel: string | null | undefined): boolean {
  return fxLevel !== 'low';
}
