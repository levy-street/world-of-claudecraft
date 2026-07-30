// Pure per-element graphics-tier knobs (v0.16.0). Now
// that every hot HUD element is a core+painter, each per-element cost knob
// becomes a pure function of the STATIC ui effects tier (the data-fx-level the
// applier stamps from graphicsPresetLabel), NEVER the FPS governor. That is the
// two-controller hazard: the auto-governor
// cannot measure HUD/compositor cost, so the HUD effect tier is owned by the preset the
// player chose. This module is the single home of that mapping, so a knob can only move
// when the static preset moves.
//
// This file is host-agnostic and DOM/Three-free: it imports nothing at runtime (only the
// UiEffectsTier TYPE, erased at compile time), references no governor, and uses no DOM
// global / Math.random / Date.now / performance.now. It is registered in UI_PURE_CORES
// (tests/architecture.test.ts) alongside ui_effects_profile.ts; the purity guard pins the
// no-governor / no-DOM / determinism rules, and tests/ui_tier_knobs.test.ts adds the
// import-absence (no governor) + behavioral (only the tier moves a knob) assertions.
//
// NO-OP-ON-FULL INVARIANT: only the 'low' tier sheds cost (mirroring the resolver's own
// `lowCost = tier === 'low'`, ui_effects_profile.ts). Every knob returns its full-effects
// value for medium/high/ultra, so the tier branch is a no-op there and ultra stays
// byte-equivalent in HUD cost to pre-tiering. Each tiered cadence returns 0 ms for the
// full tiers, which cadenceDue() reads as "always due" (no extra throttle), so the full
// path is the unchanged per-frame path.

import type { UiEffectsTier } from './ui_effects_profile';

// ---------------------------------------------------------------------------
// FCT: max-concurrent live floaters + per-text lifetime scale.
// The FctPainter pre-allocates a fixed pool (FCT_POOL_CAP) and evicts the oldest
// at the live cap; on low the live cap is tighter and the TTL is shorter, so a burst
// sheds sooner. Every floater is still SPAWNED on every tier (low never refuses a damage
// number: hiding the player's own hits removed their primary combat feedback), so the pool
// cap + TTL are the only FCT cost knobs. (Crit EMPHASIS on low, the scale/pop, is a separate
// axis handled in CSS via [data-fx-level="low"] .fct.crit, hud.css; it keeps the number and
// only drops the pop, so it never hides information.)
// ---------------------------------------------------------------------------

/** Max simultaneous live FCT floaters on low (tighter than the full FCT_POOL_CAP, so a
 *  burst sheds sooner). Clamped to the pool cap by fctMaxConcurrent so a small test pool
 *  is never exceeded. */
export const FCT_MAX_CONCURRENT_LOW = 24;
/** Per-text lifetime multiplier at the full tiers (unchanged: 1250ms * 1 = 1250ms). */
export const FCT_TTL_SCALE_FULL = 1;
/** Per-text lifetime multiplier on low (floaters clear faster, lowering the live count
 *  and the eviction pressure). */
export const FCT_TTL_SCALE_LOW = 0.6;

/** The live-floater cap for `tier`, never above the painter's pre-allocated `poolCap`.
 *  Full tiers return `poolCap` (the pool-full eviction threshold = the pre-tiering
 *  behavior); low returns the tighter cap. */
export function fctMaxConcurrent(tier: UiEffectsTier, poolCap: number): number {
  return tier === 'low' ? Math.min(FCT_MAX_CONCURRENT_LOW, poolCap) : poolCap;
}

/** The TTL multiplier the painter applies to each descriptor ttlMs. Full tiers = 1
 *  (byte-identical); low shortens. */
export function fctTtlScale(tier: UiEffectsTier): number {
  return tier === 'low' ? FCT_TTL_SCALE_LOW : FCT_TTL_SCALE_FULL;
}

// ---------------------------------------------------------------------------
// Minimap: the canvas redraw cadence. The marker core + painter are
// unchanged; only how often the Hud calls them is tiered.
// ---------------------------------------------------------------------------

/** Minimum ms between minimap redraws on low. The Hud drives the minimap from its
 *  ~10Hz fastHud band (100ms); gating with this interval quantizes to roughly 3-4Hz on
 *  low (every ~3rd fastHud tick), down from the full ~10Hz. */
export const MINIMAP_REDRAW_INTERVAL_LOW_MS = 250;

/** Minimum ms between minimap redraws for `tier`. 0 (full tiers) means "no extra
 *  throttle" (redraw every fastHud tick = the unchanged ~10Hz); low throttles. */
export function minimapRedrawIntervalMs(tier: UiEffectsTier): number {
  return tier === 'low' ? MINIMAP_REDRAW_INTERVAL_LOW_MS : 0;
}

// ---------------------------------------------------------------------------
// Auras: visible-count cap + refresh (tick) granularity. The keyed-pool
// painter renders at most the cap; extra auras are recycled out of the pool. The refresh
// interval coarsens how often the strip repaints (the duration countdown granularity).
// ---------------------------------------------------------------------------

/** No visible-count cap at the full tiers (render every active aura). Named so the
 *  painter references a constant, not a bare Infinity. */
export const AURA_VISIBLE_CAP_FULL = Number.POSITIVE_INFINITY;
/** Max simultaneously rendered auras on low (the rest are recycled out of the pool). */
export const AURA_VISIBLE_CAP_LOW = 8;
/** Minimum ms between aura-strip repaints on low (coarser duration tick). */
export const AURA_REFRESH_INTERVAL_LOW_MS = 250;

/** Max rendered auras for `tier`: uncapped at the full tiers, capped on low. */
export function auraVisibleCap(tier: UiEffectsTier): number {
  return tier === 'low' ? AURA_VISIBLE_CAP_LOW : AURA_VISIBLE_CAP_FULL;
}

/** Minimum ms between aura-strip repaints for `tier`. 0 (full tiers) means "every frame"
 *  (the unchanged path); low coarsens it. */
export function auraRefreshIntervalMs(tier: UiEffectsTier): number {
  return tier === 'low' ? AURA_REFRESH_INTERVAL_LOW_MS : 0;
}

// ---------------------------------------------------------------------------
// Target NON-SELF cadence: on low, the TARGET frame body (HP / level /
// portrait) refreshes slower; the SELF/player frame always stays full-rate (a separate
// painter instance with no gate). Target HP is a COARSE read (execute range, is-it-dead)
// resolved well inside the ~200ms human reaction loop, and the interrupt-critical cast
// bar is painted OUTSIDE this throttle, so a 100ms (2-tick) target-body cadence sheds
// portrait / HP-bar redraw smoothness without degrading any signal the player reacts to.
//
// PARTY frames are deliberately NOT tiered. Party-member HP is a healer's only actionable
// signal (the game has no self-dispel, so the frame IS the read), and the population most
// likely to run the low preset is large-raid players, exactly where a healer must not be
// handicapped. Tiering it would make the game worse to play on low for the role that needs
// it most, so party is left on the ~4Hz mediumHud band it already runs at on EVERY
// tier. (The rule: tier COSMETIC richness, never ACTIONABLE info latency;
// the only graphics knobs touching party are the shared cosmetic ones, not a per-tier shed.)
// ---------------------------------------------------------------------------

/** Minimum ms between target-frame BODY refreshes on low (~10Hz, down from per-frame). A
 *  target SWAP bypasses this (nonSelfRepaintDue) so selecting a new target updates
 *  immediately; the target cast bar is never throttled. */
export const TARGET_FRAME_NONSELF_INTERVAL_LOW_MS = 100;

/** Minimum ms between target-frame refreshes for `tier`. 0 (full tiers) = per-frame
 *  (unchanged); low throttles. */
export function targetFrameNonSelfIntervalMs(tier: UiEffectsTier): number {
  return tier === 'low' ? TARGET_FRAME_NONSELF_INTERVAL_LOW_MS : 0;
}

/** Whether a tier-throttled NON-SELF element (the target frame, the target debuff strip)
 *  repaints this frame: ALWAYS on a subject change (a target SWAP must never leave the
 *  previous target's HP / debuffs on screen while throttled), otherwise only once the tier
 *  cadence is due. With intervalMs <= 0 (the full tiers) cadenceDue is always true, so this
 *  collapses to the unchanged every-frame path. Pure (now injected): the swap-bypass is the
 *  load-bearing correctness rule, so it is lifted here to be unit-testable rather than left
 *  inline in hud.update(). */
export function nonSelfRepaintDue(
  subjectChanged: boolean,
  lastAt: number,
  now: number,
  intervalMs: number,
): boolean {
  return subjectChanged || cadenceDue(lastAt, now, intervalMs);
}

// ---------------------------------------------------------------------------
// Nameplate refresh cadence: how often the renderer re-projects +
// repaints the overhead nameplates. Unlike the shed-on-low knobs above, this is a
// BASE cadence that throttles on EVERY tier (projecting and DOM-writing every rig
// every frame is wasteful even at full effects), so it always returns a positive
// interval rather than 0. It REPLACES the old mobile-vs-desktop runtime fork
// (renderer.ts: isMobileRuntime() ? 1/15 : 1/24) with a static-preset read. NOTE
// the control AXIS changed device -> preset: the old fork capped EVERY mobile
// device at 1/15s (a weak-GPU cost ceiling, the PR901 lesson); here 1/15s is the
// LOW tier alone and 1/24s every richer tier, so a mobile device on a non-low
// preset runs the faster/costlier 1/24s. The 1/15s is still the STALENESS floor (no
// tier refreshes slower, so a nameplate never lags more than before); the mobile
// weak-GPU cost ceiling is restored by the device-aware first-run default (gfx.ts
// resolveDefaultGraphicsPreset): a recognized-weak or software GPU defaults to the LOW
// preset, so it lands on this 1/15s cadence (a mid/unknown device defaults to medium = the
// 1/24s tier), and this knob stays a pure function of the resulting tier. Seconds, not ms: the
// renderer accumulates dt (seconds) against this, so
// it is NOT gated through cadenceDue(). Two-controller invariant: the
// renderer derives the tier from the static data-fx-level (coerceFxTier), never the
// FPS governor.
// ---------------------------------------------------------------------------

/** Nameplate refresh interval on the lowest tier (seconds): the pre-tiering mobile
 *  cadence (1/15s ~ 66.7ms). Kept as the STALENESS floor (no tier refreshes slower
 *  than this); it now binds the LOW tier, NOT every mobile device as the old device
 *  fork did (see the axis-change note above). */
export const NAMEPLATE_INTERVAL_LOW_SEC = 1 / 15;
/** Nameplate refresh interval at the full tiers (seconds): the pre-tiering desktop
 *  cadence (1/24s ~ 41.7ms). */
export const NAMEPLATE_INTERVAL_FULL_SEC = 1 / 24;

/** Seconds between full nameplate refreshes for `tier`: the LOW tier holds 1/15s,
 *  every richer tier runs 1/24s. The axis is the tier, not the device; the device-aware
 *  first-run default (gfx.ts resolveDefaultGraphicsPreset) lands a recognized-weak or
 *  software device on the LOW tier, restoring the 1/15s ceiling for weak GPUs. Always positive
 *  (nameplates throttle on every tier), so the renderer compares it directly against its
 *  accumulated dt, not through cadenceDue(). */
export function nameplateIntervalSec(tier: UiEffectsTier): number {
  return tier === 'low' ? NAMEPLATE_INTERVAL_LOW_SEC : NAMEPLATE_INTERVAL_FULL_SEC;
}

// ---------------------------------------------------------------------------
// Shared cadence predicate + tier coercion.
// ---------------------------------------------------------------------------

/** A tier cadence gate shared by the minimap / auras / party / target knobs. With
 *  intervalMs <= 0 (the full-tier value) it is ALWAYS due, so the tiered path collapses
 *  to the unchanged every-call path; with a positive interval it is due only once that
 *  many ms have elapsed since `lastAt`. Pure (no clock of its own; `now` is injected). */
export function cadenceDue(lastAt: number, now: number, intervalMs: number): boolean {
  return intervalMs <= 0 || now - lastAt >= intervalMs;
}

const FX_TIERS: readonly UiEffectsTier[] = ['low', 'medium', 'high', 'ultra'];

/** Coerce a published data-fx-level string (document.documentElement.dataset.fxLevel,
 *  written only by the static-preset applier) to a tier. An unknown / unset value
 *  defaults to 'ultra' (full effects), so a missing stamp never silently sheds HUD cost.
 *  Pure: takes the raw string, touches no DOM (the Hud reads the dataset and passes it
 *  here), so the two-controller wiring stays out of this pure module. */
export function coerceFxTier(value: string | null | undefined): UiEffectsTier {
  return value && (FX_TIERS as readonly string[]).includes(value)
    ? (value as UiEffectsTier)
    : 'ultra';
}
