// Pure derivation of the XP-bar visual state for the Max-Level XP Overflow
// system. Kept UI-framework-free (no DOM) so the label states can be snapshot
// tested directly. All display strings route through i18n's t().

import { MAX_LEVEL, virtualLevelProgress, xpForLevel } from '../sim/types';
import { formatNumber, t } from './i18n';

export interface XpBarInput {
  level: number;
  xp: number; // current level-bar XP (server-authoritative)
  lifetimeXp: number; // monotonic lifetime total (server-authoritative)
  showOverflow: boolean; // settings toggle; false → classic "MAX LEVEL"
  restedXp?: number; // classic inn-rested pool; doubles kill XP until spent
}

export interface XpBarView {
  fillFrac: number; // 0..1 width of the fill
  // 0..1 width of the rested overlay segment that sits AHEAD of the fill (the
  // portion of the bar the rested bonus will cover). 0 when not rested / at cap.
  restedFrac: number;
  label: string; // hover label
  postCap: boolean; // true → distinct prestige/gold styling
}

// Locale-grouped non-negative integer XP count (e.g. en "1,000"). Routes
// through formatNumber so the digit grouping/numerals follow the active locale.
export function formatXp(n: number): string {
  return formatNumber(Math.floor(Math.max(0, n)), { maximumFractionDigits: 0 });
}

// Locale-formatted whole percent. The fraction is floored to a whole percent
// first (matching the classic truncate-don't-round behaviour, byte-identical in
// en) and then formatted as a percent so the symbol/placement localizes.
function formatPercent(frac: number): string {
  return formatNumber(Math.floor(frac * 100) / 100, { style: 'percent', maximumFractionDigits: 0 });
}

export function xpBarView(input: XpBarInput): XpBarView {
  const { level, xp, lifetimeXp, showOverflow } = input;
  const atCap = level >= MAX_LEVEL;

  if (!atCap) {
    const need = xpForLevel(level);
    const frac = need > 0 ? xp / need : 0;
    const rested = Math.max(0, input.restedXp ?? 0);
    // Rested overlay spans from the current fill up to where the rested pool
    // would carry the bar (clamped to the bar end), so it reads as a preview of
    // the bonus to come.
    const restedFrac = rested > 0 && need > 0 ? clamp01((xp + rested) / need) - clamp01(frac) : 0;
    const restedLabel = rested > 0 ? `  ·  ${t('game.xp.rested')} +${formatXp(rested)}` : '';
    return {
      fillFrac: clamp01(frac),
      restedFrac: Math.max(0, restedFrac),
      label: `${formatXp(xp)} / ${formatXp(need)} ${t('game.xp.suffix')} (${formatPercent(frac)})${restedLabel}`,
      postCap: false,
    };
  }

  // At the cap with overflow disabled: classic full bar, but still surface the
  // lifetime total on hover so the counter is never hidden entirely.
  if (!showOverflow) {
    return {
      fillFrac: 1,
      restedFrac: 0,
      label: `${t('game.xp.maxLevel')}  ·  ${formatXp(lifetimeXp)} ${t('game.xp.totalXp')}`,
      postCap: false,
    };
  }

  // At/after the cap with overflow on: fill toward the next virtual level.
  const prog = virtualLevelProgress(lifetimeXp);
  const extra = prog.level - MAX_LEVEL;
  // FR-3.3 format: "Lv 20 (+7)  ·  1,284,500 total XP  ·  62% to next"
  const label =
    `${t('game.xp.lv')} ${MAX_LEVEL} (+${extra})  ·  ` +
    `${formatXp(lifetimeXp)} ${t('game.xp.totalXp')}  ·  ` +
    `${formatPercent(prog.into / prog.span)} ${t('game.xp.toNext')}`;
  return { fillFrac: clamp01(prog.into / prog.span), restedFrac: 0, label, postCap: true };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
