import {
  HOARD_TIDE_WAVE_HALF_DEPTH,
  HOARD_TIDE_WAVE_HALF_GAP,
  HOARD_TIDE_WAVE_HALF_SPAN,
  HOARD_TIDE_WAVE_LEAD_SEC,
  hoardTideWaveCenter,
} from '../sim/rift/hoard_boss_kits';

export interface HoardTideVisualCue {
  radius: number;
  remaining: number;
  total: number;
  waveGap?: number;
  waveSpan?: number;
  waveLead?: number;
}

export interface HoardTideVisualPlan {
  center: number;
  leftStart: number;
  leftWidth: number;
  rightStart: number;
  rightWidth: number;
  gap: number;
  /** The gap lies outside the lane: one solid crest, and no gap rails to draw. */
  solid: boolean;
  depth: number;
  height: number;
  leadProgress: number;
  travelProgress: number;
  tail: number;
  moving: boolean;
}

export const HOARD_TIDE_FOAM_TAIL_SEC = 1;

/** Tint is decorative; the white lip and mint gap rails retain their contrast. */
export function hoardTideThemeTint(zone: string | null): number {
  if (zone === 'willowfen' || zone === 'wraithwood') return 0x93ffa5;
  if (zone === 'frostveil') return 0xdaf6ff;
  if (zone === 'drakelands') return 0x9cbacb;
  if (zone === 'nightbloom') return 0xc3b5ff;
  return 0xffffff;
}

/** Mutates a persistent plan. Required geometry is identical on every static preset. */
export function hoardTideVisualPlanInto(out: HoardTideVisualPlan, cue: HoardTideVisualCue): void {
  const lead = cue.waveLead ?? HOARD_TIDE_WAVE_LEAD_SEC;
  const age = Math.max(0, cue.total - cue.remaining);
  const span = cue.waveSpan ?? HOARD_TIDE_WAVE_HALF_SPAN;
  out.gap = cue.waveGap ?? 0;
  out.solid = Math.abs(out.gap) - HOARD_TIDE_WAVE_HALF_GAP >= span;
  out.leftStart = -span;
  // Clamped to the lane: a gap laid outside the span (a SOLID lane) draws one
  // full-width crest and nothing beyond it.
  out.leftWidth = Math.max(0, Math.min(span * 2, out.gap - HOARD_TIDE_WAVE_HALF_GAP + span));
  out.rightStart = Math.min(span, out.gap + HOARD_TIDE_WAVE_HALF_GAP);
  out.rightWidth = Math.max(0, span - out.rightStart);
  out.center = hoardTideWaveCenter(cue.radius, cue.remaining, cue.total, lead);
  out.depth = HOARD_TIDE_WAVE_HALF_DEPTH * 2;
  out.leadProgress = Math.min(1, age / Math.max(0.05, lead));
  out.travelProgress = Math.max(0, Math.min(1, (age - lead) / Math.max(0.05, cue.total - lead)));
  out.tail = Math.max(0, Math.min(1, 1 + cue.remaining / HOARD_TIDE_FOAM_TAIL_SEC));
  out.moving = age >= lead && cue.remaining > 0;
  // Keep the complete footprint while alive. Only vertical volume changes.
  out.height =
    (0.18 + 0.82 * Math.sin(out.leadProgress * Math.PI * 0.5)) *
    (cue.remaining < 0 ? out.tail * out.tail : 1);
}

/** Stable pooled spray placement never enters the actionable calm corridor. */
export function hoardTideSprayLateral(index: number, plan: HoardTideVisualPlan): number {
  const fraction = ((index * 0.61803398875) % 1) * 0.92 + 0.04;
  // A solid lane has one side only: all of its spray rides that one crest.
  return index % 2 === 0 || plan.rightWidth <= 0
    ? plan.leftStart + fraction * plan.leftWidth
    : plan.rightStart + fraction * plan.rightWidth;
}
