// Painter for the Target dots frame (#target-dots): one bar row per debuff the
// local player has out, across every enemy in interest range. The reliquary /
// deed tracker contract, verbatim: the static skeleton (a fixed pool of
// TARGET_DOTS_ROW_CAP rows plus the overflow line) is built ONCE with a single
// innerHTML write, and every refresh routes through the PainterHostWriters
// elided facet only (setText / setWidth / setStyleProp / setDisplay / setAttr /
// toggleClass), never innerHTML per frame.
//
// A row is icon + bar + countdown. The bar's fill is the remaining fraction and
// its tint is the aura's magic school (the same --color-debuff-* tokens the aura
// strips use), so a school reads the same wherever it is painted. The label rides
// ON the bar, WoW-tracker style: aura name, then the enemy it is on.
//
// The frame is player-chosen, ALWAYS-actionable information (these are the timers
// a refresh is scheduled against), so nothing here is graphics-tier gated: it is
// governed by the showTargetDots setting alone. See the gameplay-neutral-graphics
// invariant in root CLAUDE.md.

import { formatNumber } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { TARGET_DOTS_ROW_CAP, type TargetDotsState } from './target_dots_view';

const ROW_CLASS = 'td-row';
const TARGET_CLASS = 'td-on-target';
const EXPIRING_CLASS = 'td-expiring';
const SCHOOL_ATTR = 'data-school';
const HIDDEN = 'none';
const SHOWN = '';
const SHOWN_FLEX = 'flex';

// The countdown's two shapes, hoisted: this runs per row per FRAME, and
// numberFormatFor keys its cache on JSON.stringify(options), so a fresh literal
// per row is an allocation plus a stringify on the hot path. Indexed by the
// core's decimals field, the same pair nameplate_painter.ts hoists.
const NUMBER_OPTIONS = [
  { minimumFractionDigits: 0, maximumFractionDigits: 0 },
  { minimumFractionDigits: 1, maximumFractionDigits: 1 },
] as const;

export interface TargetDotsPainterDeps {
  /** The #target-dots container (Hud owns the id). */
  root(): HTMLElement;
  /** The shared write-elision facet (Hud's caches; one skip-rate). */
  writers: PainterHostWriters;
  /** Aura artwork identity to a CSS background value. */
  iconBackground(iconKey: string): string;
  /** Localized "<aura> on <target>" row label. */
  rowLabel(auraName: string, targetName: string): string;
  /** Localized accessible name for the whole frame. */
  frameLabel(): string;
  /** Localized "+N more" overflow line. */
  overflowLabel(count: number): string;
  /** Localized seconds suffix for the countdown ('s' in English). */
  secondsSuffix(): string;
}

interface RowEls {
  row: HTMLElement;
  icon: HTMLElement;
  fill: HTMLElement;
  labelEl: HTMLElement;
  time: HTMLElement;
  stacks: HTMLElement;
  /** Last painted icon key, so the background is resolved only on a change. */
  iconKey: string;
  /** The row key this node currently carries, '' while parked. */
  key: string;
  /** The composed "<aura> on <target>" label, cached because it is a pure
   *  function of the row: re-resolving a t() interpolation per row per frame
   *  builds a params object and re-walks the catalog for a string that cannot
   *  have changed (src/ui/CLAUDE.md: elide the upstream resolve, not only the
   *  write). Dropped with the rest on a recycle and on a language switch. */
  label: string;
}

export class TargetDotsPainter {
  private readonly root: HTMLElement;
  private readonly rows: RowEls[] = [];
  private readonly overflowEl: HTMLElement;
  // Resolved once rather than per row per frame; relocalize() refreshes it, the
  // same shape the aura strips use for their duration units.
  private secondsSuffix: string;

  constructor(private readonly deps: TargetDotsPainterDeps) {
    this.root = deps.root();
    // Static skeleton, built once: chrome only, no player text (every visible
    // string is painted through the elided writers below).
    const rowHtml =
      `<div class="${ROW_CLASS}" style="display:none">` +
      `<span class="td-icon" aria-hidden="true"></span>` +
      `<span class="td-bar"><span class="td-fill"></span><span class="td-label"></span>` +
      `<span class="td-stacks" style="display:none"></span></span>` +
      `<span class="td-time"></span></div>`;
    this.root.innerHTML = `${rowHtml.repeat(TARGET_DOTS_ROW_CAP)}<div class="td-overflow" style="display:none"></div>`;
    const rowNodes = this.root.querySelectorAll<HTMLElement>(`.${ROW_CLASS}`);
    for (const row of rowNodes) {
      this.rows.push({
        row,
        icon: row.querySelector('.td-icon') as HTMLElement,
        fill: row.querySelector('.td-fill') as HTMLElement,
        labelEl: row.querySelector('.td-label') as HTMLElement,
        time: row.querySelector('.td-time') as HTMLElement,
        stacks: row.querySelector('.td-stacks') as HTMLElement,
        iconKey: '',
        key: '',
        label: '',
      });
    }
    this.overflowEl = this.root.querySelector('.td-overflow') as HTMLElement;
    // The frame is a live region only in the weak sense: it names itself, and a
    // screen reader user reads it on demand rather than being interrupted by
    // every tick. The countdown text is the reason polite would be wrong here.
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', deps.frameLabel());
    this.secondsSuffix = deps.secondsSuffix();
  }

  /** Re-resolve everything this painter resolved ONCE and then cached: the
   *  frame's accessible name, the seconds suffix, and every row's composed
   *  label. Without this a language switch would leave all three in the previous
   *  locale, which is exactly what caching them buys and owes. */
  relocalize(): void {
    this.deps.writers.setAttr(this.root, 'aria-label', this.deps.frameLabel());
    this.secondsSuffix = this.deps.secondsSuffix();
    for (const els of this.rows) els.label = '';
  }

  update(state: TargetDotsState): void {
    const w = this.deps.writers;
    // Hidden rather than emptied: an empty bordered box floating over the world
    // is the thing players report as a bug, and the frame is genuinely absent
    // whenever the player has no dots out.
    w.setDisplay(this.root, state.count === 0 ? HIDDEN : SHOWN_FLEX);
    for (let i = 0; i < this.rows.length; i++) {
      const els = this.rows[i];
      if (i >= state.count) {
        // Park the node AND clear the key it was carrying, so the next row to
        // take this slot is treated as a recycle rather than as the same row.
        els.key = '';
        w.setDisplay(els.row, HIDDEN);
        continue;
      }
      const model = state.rows[i];
      // A node that is now showing a DIFFERENT row is recycled: drop every
      // per-row cache it holds before repainting it. Keying the caches to the
      // row rather than to the slot index is what keeps a refreshed or newly
      // applied dot from inheriting the previous occupant's artwork, which is
      // the pooled-node staleness trap auras_painter.ts documents.
      const recycled = els.key !== model.key;
      if (recycled) {
        els.key = model.key;
        els.iconKey = '';
        els.label = '';
      }
      w.setDisplay(els.row, SHOWN_FLEX);
      if (els.iconKey !== model.iconKey) {
        els.iconKey = model.iconKey;
        w.setStyleProp(els.icon, 'background-image', this.deps.iconBackground(model.iconKey));
      }
      w.setWidth(els.fill, `${Math.round(model.fraction * 1000) / 10}%`);
      w.setAttr(els.fill, SCHOOL_ATTR, model.school || null);
      if (els.label === '') els.label = this.deps.rowLabel(model.auraName, model.targetName);
      w.setText(els.labelEl, els.label);
      w.setText(
        els.time,
        `${formatNumber(model.remaining, NUMBER_OPTIONS[model.decimals])}${this.secondsSuffix}`,
      );
      w.setDisplay(els.stacks, model.stacks > 0 ? SHOWN : HIDDEN);
      if (model.stacks > 0) w.setText(els.stacks, formatNumber(model.stacks));
      w.toggleClass(els.row, TARGET_CLASS, model.onCurrentTarget);
      w.toggleClass(els.row, EXPIRING_CLASS, model.expiring);
    }
    w.setDisplay(this.overflowEl, state.overflow > 0 ? SHOWN : HIDDEN);
    if (state.overflow > 0) {
      w.setText(this.overflowEl, this.deps.overflowLabel(state.overflow));
    }
  }
}
