// Pure derivation of the XP-bar visual state for the Max-Level XP Overflow
// system. Kept UI-framework-free (no DOM) so the label states can be snapshot
// tested directly. All display strings route through i18n's t().

import { MAX_LEVEL, virtualLevelProgress, xpForLevel } from '../sim/types';
import { t } from './i18n';

export interface XpBarInput {
  level: number;
  xp: number; // current level-bar XP (server-authoritative)
  lifetimeXp: number; // monotonic lifetime total (server-authoritative)
  showOverflow: boolean; // settings toggle; false → classic "MAX LEVEL"
}

export interface XpBarView {
  fillFrac: number; // 0..1 width of the fill
  label: string; // hover label
  postCap: boolean; // true → distinct prestige/gold styling
}

// Thousands-separated integer (locale-independent grouping so snapshots are
// stable across machines).
export function formatXp(n: number): string {
  return Math.floor(Math.max(0, n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function xpBarView(input: XpBarInput): XpBarView {
  const { level, xp, lifetimeXp, showOverflow } = input;
  const atCap = level >= MAX_LEVEL;

  if (!atCap) {
    const need = xpForLevel(level);
    const frac = need > 0 ? xp / need : 0;
    return {
      fillFrac: clamp01(frac),
      label: `${formatXp(xp)} / ${formatXp(need)} ${t('game.xp.suffix')} (${Math.floor(frac * 100)}%)`,
      postCap: false,
    };
  }

  // At the cap with overflow disabled: classic full bar, but still surface the
  // lifetime total on hover so the counter is never hidden entirely.
  if (!showOverflow) {
    return {
      fillFrac: 1,
      label: `${t('game.xp.maxLevel')}  ·  ${formatXp(lifetimeXp)} ${t('game.xp.totalXp')}`,
      postCap: false,
    };
  }

  // At/after the cap with overflow on: fill toward the next virtual level.
  const prog = virtualLevelProgress(lifetimeXp);
  const extra = prog.level - MAX_LEVEL;
  const pct = Math.floor((prog.into / prog.span) * 100);
  // FR-3.3 format: "Lv 20 (+7)  ·  1,284,500 total XP  ·  62% to next"
  const label =
    `${t('game.xp.lv')} ${MAX_LEVEL} (+${extra})  ·  ` +
    `${formatXp(lifetimeXp)} ${t('game.xp.totalXp')}  ·  ` +
    `${pct}% ${t('game.xp.toNext')}`;
  return { fillFrac: clamp01(prog.into / prog.span), label, postCap: true };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
