// Pure derivation of the HEAL-absorb overlay for unit-frame health bars.
//
// A heal absorb (`kind: 'heal_absorb'`: the Quench Guardian's Living Rime,
// Final Hammer's Stone Shell, the necrotic blights) is a budget of incoming
// healing the unit must chew through before its health moves again. Classic
// raid frames draw it as a hatched segment laid OVER current health, from the
// right edge of the filled health inward, so a healer reads at a glance how
// much of the bar is "locked". That is the opposite direction from a damage
// shield (absorb_bar.ts), which extends PAST current health toward the bar's
// right edge, so the two never share a segment or a look.
//
// The segment covers min(remaining, hp) of the bar (it can never cover more
// health than the unit has); the number on the bar is the FULL remaining
// budget, because that is the healing a healer still has to land. The amount is
// actionable, so it shows on every graphics tier and is never tied to the
// Show Absorb Shields option (that option hides the decorative shield hatch).
//
// DOM-free and allocation-light: the Into path fills a caller-owned view and
// caches the percent strings and the formatted number by their quantized value,
// so a steady frame allocates nothing and hands the painter identical strings
// (which is what keeps the write-elision cache hitting). The number runs through
// formatNumber (digits follow the active locale; no t(), no translated text).

import type { Aura } from '../sim/types';
import { clamp01 } from './clamp';
import { formatNumber, getLanguage } from './i18n';

/** The entity-shaped input. A player/target frame passes the live entity (its
 *  auras carry each heal absorb's remaining `value`); a party row passes the
 *  pre-summed `healTotal` its compact snapshot carries instead of auras. */
export interface HealAbsorbBarInput {
  hp: number;
  maxHp: number;
  auras?: readonly Pick<Aura, 'kind' | 'value'>[];
  /** Pre-summed remaining heal absorb (party snapshots). Wins over `auras`. */
  healTotal?: number;
}

/** What the painter writes. Percent strings are quantized to a tenth of a
 *  percent; `on` is false whenever there is nothing to draw. */
export interface HealAbsorbBarView {
  /** Remaining heal absorb across every heal_absorb aura (the full budget). */
  total: number;
  /** Left edge of the hatched segment, 0..1 of the bar. */
  startFrac: number;
  /** Width of the hatched segment, 0..1 of the bar (clamped to current health). */
  sizeFrac: number;
  /** The overlay is drawn (a live unit carrying a heal absorb). */
  on: boolean;
  /** `startFrac` as a CSS percent ("62.5%"), for the segment's left edge. */
  start: string;
  /** The current-health edge as a CSS percent ("80.0%"), the segment's right edge
   *  and the number's anchor. */
  end: string;
  /** The remaining amount, locale-formatted ("420"); '' when off. */
  text: string;
  // Caches behind the strings above (quantized tenths of a percent and the whole
  // amount last formatted), so an unchanged frame reformats nothing.
  startTenths: number;
  endTenths: number;
  textAmount: number;
  textLanguage: string;
}

const AMOUNT_OPTS: Intl.NumberFormatOptions = { maximumFractionDigits: 0, useGrouping: false };

/** Remaining heal absorb across every heal_absorb aura; spent ones add nothing. */
export function healAbsorbTotal(auras: readonly Pick<Aura, 'kind' | 'value'>[]): number {
  let n = 0;
  for (const a of auras) if (a.kind === 'heal_absorb' && a.value > 0) n += a.value;
  return n;
}

/** A fresh, off view (one per unit-frame buffer, or per allocating call). */
export function newHealAbsorbBarView(): HealAbsorbBarView {
  return {
    total: 0,
    startFrac: 0,
    sizeFrac: 0,
    on: false,
    start: '0.0%',
    end: '0.0%',
    text: '',
    startTenths: 0,
    endTenths: 0,
    textAmount: 0,
    textLanguage: '',
  };
}

/** The shared off view for a hidden frame. Never mutated (only buffers are). */
export const HEAL_ABSORB_OFF: Readonly<HealAbsorbBarView> = Object.freeze(newHealAbsorbBarView());

function pctTenths(frac: number): number {
  return Math.round(frac * 1000);
}

function pctString(tenths: number): string {
  return `${(tenths / 10).toFixed(1)}%`;
}

/**
 * Fill a caller-owned view from the input (null = no unit / no overlay). The
 * HUD's per-frame path; the strings are rebuilt only when their quantized value
 * changes.
 */
export function healAbsorbBarViewInto(
  out: HealAbsorbBarView,
  input: HealAbsorbBarInput | null,
): HealAbsorbBarView {
  const max = input ? Math.max(1, input.maxHp) : 1;
  const hp = input ? Math.max(0, Math.min(input.hp, max)) : 0;
  const raw = input ? (input.healTotal ?? healAbsorbTotal(input.auras ?? [])) : 0;
  const total = raw > 0 && Number.isFinite(raw) ? raw : 0;
  const on = total > 0 && hp > 0;
  const covered = on ? Math.min(total, hp) : 0;
  out.total = total;
  out.on = on;
  out.sizeFrac = on ? clamp01(covered / max) : 0;
  out.startFrac = on ? clamp01((hp - covered) / max) : 0;
  const startTenths = pctTenths(out.startFrac);
  if (startTenths !== out.startTenths) {
    out.startTenths = startTenths;
    out.start = pctString(startTenths);
  }
  const endTenths = on ? pctTenths(clamp01(hp / max)) : 0;
  if (endTenths !== out.endTenths) {
    out.endTenths = endTenths;
    out.end = pctString(endTenths);
  }
  // Ceil, so the last sliver of a crust still reads "1" until it truly breaks.
  const amount = on ? Math.ceil(total) : 0;
  // Keyed by language too, so an in-session language switch reformats the digits.
  const language = amount > 0 ? getLanguage() : out.textLanguage;
  if (amount !== out.textAmount || language !== out.textLanguage) {
    out.textAmount = amount;
    out.textLanguage = language;
    out.text = amount > 0 ? formatNumber(amount, AMOUNT_OPTS) : '';
  }
  return out;
}

/** The allocating form, for pure callers and tests. */
export function healAbsorbBarView(input: HealAbsorbBarInput | null): HealAbsorbBarView {
  return healAbsorbBarViewInto(newHealAbsorbBarView(), input);
}
