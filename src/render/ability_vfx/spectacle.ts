// Central spectacle-calibration constants for the per-ability VFX engine,
// tuned against the Ability VFX Gallery with the A/B pixel harness
// (scripts/_tmp_ab_measure.mjs: effect pixel coverage / peak luminance delta /
// bbox vs the gallery ground truth, measured at the DEFAULT chase camera).
//
// The measured gap lived in the 0.3s CRESCENDO of targeted abilities: at
// release/impact the game effect occupied the same screen region as the
// gallery (bbox ~1.0, per-pixel peak ~0.75x) but was sparse inside it  -
// coverage 4.5-12.7x smaller (lightning_bolt 12.7:1, heroic_strike 8:1,
// fireball 6:1). Ground novas, shout rings, buff orbits, and persistence were
// already AT gallery parity, so these multipliers deliberately apply only to
// the targeted-crescendo archetypes and leave the radial/held families alone.
//
// Every constant multiplies an authored spawn value at a single seam in
// fx.ts / sequencer.ts; degrade tiers scale off the same seams, so tier
// ratios are preserved. Nothing here changes pool caps, slot counts, or
// per-frame allocation behavior: bigger sprites/ribbons/quads ride the same
// pooled primitives.
import type { AbilityVfxArchetype, AbilityVfxFullSpec } from '../ability_vfx_core';

// The archetypes whose release/impact moment measured far below the gallery.
// nova/shout (ground rings at parity), heal/buff/cc (gentle by design), and
// summon/dash/beam (already carried by their own set-pieces) stay at 1x.
const CRESCENDO_ARCHETYPES: ReadonlySet<AbilityVfxArchetype> = new Set([
  'bolt',
  'strike',
  'burst',
  'dot',
] as AbilityVfxArchetype[]);

export function isCrescendoArchetype(arch: AbilityVfxArchetype): boolean {
  return CRESCENDO_ARCHETYPES.has(arch);
}

// A bolt can use the full phase anatomy without carrying marquee-scale
// release flashes, screen trauma, or long afterglow. This keeps rapidly cast
// fillers inside the same renderer architecture without flattening the visual
// hierarchy between rotational attacks and finishers.
export function usesCrescendoScale(
  spec: Pick<AbilityVfxFullSpec, 'archetype' | 'filler'>,
): boolean {
  return spec.filler !== true && isCrescendoArchetype(spec.archetype);
}

export const SPECTACLE = {
  // ---- release: the caster's cast-off moment (sequencer.release/transients)
  /** Transient release-star size multiplier (gallery caster flash). */
  releaseStar: 3.0,
  /** Release flash duration in seconds (was 0.10; gallery holds ~0.35s hot). */
  releaseDur: 0.28,
  /** Radial filament sprites fanning out of the release flash (overlay pushes,
   *  immediate-mode: zero pool cost). */
  releaseFilaments: 10,
  /** Vertical shock halo radius at the caster on release (yd, x power). */
  releaseRingR: 2.5,
  /** Release light-pulse intensity multiplier. */
  releaseLight: 2.6,
  /** Release spark-burst count multiplier. */
  releaseSparks: 1.8,

  // ---- travel: the projectile in flight (fx.sequenceBolt)
  /** Styled/comet trail ribbon width multiplier. */
  boltWidth: 2.0,
  /** Projectile head-sprite scale multiplier. */
  boltHead: 1.6,

  /** Release cast-off flipbook size (yd, x power; tier 0). The gallery fires
   *  a full-size explosion sheet AT the caster on release - the single
   *  biggest reason its release frame reads 8x denser than the game's. */
  releaseFlipbook: 4.2,

  // ---- impact: the landing stack (sequencer.impact)
  // ROUND 2 (user brief): "impact effects are too small - maximise the visuals
  // ... satisfying, large, beautiful effects". The transient 35%-of-frame
  // conservatism is rescinded for the impact MOMENT; only sustained effects
  // stay gameplay-readable. Constants re-raised against the stored gallery
  // ground truth (tmp/vfx/ab/gallery_results.json).
  /** Impact flipbook world-size multiplier. */
  flipbook: 3.4,
  /** Impact spark-burst count multiplier (still capped at 60 in the seam). */
  impactSparkCount: 2.0,
  /** Impact spark-burst power (spread velocity) multiplier. */
  impactSparkPower: 1.5,
  /** Impact light-pulse intensity multiplier (pooled point light, range 7yd:
   *  in a daylight scene the lit ground IS most of the readable coverage). */
  impactLight: 3.6,
  /** Vertical impact halo radius multiplier. */
  vRing: 2.3,
  /** Staggered follow-up ring (ring2/ring3) radius multiplier. */
  followRing: 1.9,
  /** Strike slash-arc scale multiplier (span; width follows via the ribbon
   *  seam's width-with-scale rule). Melee contact measured 8-20x under. */
  strikeArc: 2.9,
  /** Second staggered flipbook after the first (tier 0): stretches the hot
   *  window toward the gallery's ~1s aftermath instead of a one-sheet pop  -
   *  0.3s lands it deep in the measured impact window. */
  flipbook2Delay: 0.3,
  /** Crescendo flipbook HDR multiplier: colored sheets (flame, void) on the
   *  bright daylit terrain read far dimmer than the gallery's night stage  -
   *  brightness, not size, is the honest recovery lever. Rides bloom. */
  flipbookHdr: 1.65,
  /** Finisher impact light pillar (radius yd x power, height yd, seconds).
   *  The gallery's post-impact column IS its impact-phase coverage. */
  pillarR: 1.3,
  pillarH: 8.5,
  pillarDur: 1.3,
  /** Sustained afterglow light: intensity and seconds (crescendo tier 0,
   *  fired with the impact so the lit ground carries the aftermath). */
  sustainLight: 6.0,
  sustainLightDur: 2.0,
  /** Point-light range (yd) for crescendo release/impact pulses (pool default
   *  is 7): in daylight the lit-ground disc IS most of the readable area. */
  lightRange: 12,
  /** Camera trauma per crescendo tier-0 impact (the gallery lands 0.45-0.62
   *  per hit; the host's rolling shake budget + distance falloff still cap
   *  chains, so this is a request, not a guarantee). */
  impactShake: 0.3,
  finisherShake: 0.45,
  /** Finisher double shockwave (the gallery critFinisher "death-sentence
   *  beat" at +0.12s): huge ground wave radius + white vertical halo radius
   *  (yd, x ringScale). */
  finisherWaveR: 6.0,
  finisherWaveVR: 4.4,
  /** Screen ripple+flash strength for crescendo tier-0 sequences (post pass
   *  clamps flash at 0.4 and ripple at 1.4, so these are safe asks; gallery
   *  flashes 0.22 normal / 0.35 crit). Non-crescendo keeps the old 0.8/1.0. */
  screenFx: 1.5,
  screenFxFinisher: 2.0,
  /** Delayed after-image swing for single-swing tier-0 strikes: the same arc
   *  echoed a beat later (gallery layering: staggered beats read bigger than
   *  one simultaneous blob). */
  strikeEchoDelay: 0.32,

  // ---- linger: the afterglow dwell (sequencer.update)
  /** Seconds of post-impact afterglow (fading ground dome + periodic embers)
   *  for SPELL crescendos (bolt/burst/dot) at tier 0. Independent of the
   *  authored linger so short-linger finishers (mind_blast) still hold a
   *  readable aftermath. */
  afterglowDur: 2.8,
  /** Strikes hold a SHORT hot-metal afterglow (gallery strike linger is tiny,
   *  but its impact frame stays hot ~1s - sparks, lit ground, halo). */
  strikeAfterglowDur: 1.3,
  /** Afterglow ember-burst period in seconds. */
  afterglowEvery: 0.4,
  /** Afterglow dome sprite size (yd). */
  afterglowSize: 2.2,
} as const;

// Ribbon slash arcs widen with their span so a scaled-up arc keeps its
// aspect instead of turning into a thin hoop (applied inside ribbons.ts).
export function slashWidthScale(scale: number): number {
  return 0.55 + 0.45 * scale;
}
