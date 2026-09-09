// One painter for all six aura tracks.
//
// The tracker-painter contract, verbatim: the static skeleton (a fixed pool of
// AURA_TRACK_ROW_CAP rows plus the overflow line) is built ONCE with a single
// innerHTML write, and every refresh routes through the PainterHostWriters
// elided facet only, never innerHTML per frame.
//
// THREE ROW SHAPES, because the data has three shapes and pretending otherwise
// would make one bar mean three things:
//   timer   the bar drains with the clock and prints seconds.
//   points  the bar drains with DAMAGE and prints points, seconds behind it
//           dimmed: an absorb's stored value is its remaining shield, and its
//           duration runs in parallel, so whichever hits zero first ends it.
//   mode    no bar to drain and no number at all. A countdown under stealth
//           would be a lie the player reads as "this is about to leave me".
//
// Per-row caches (the composed label, the resolved artwork) are keyed to the ROW
// rather than the slot index: a node that changes which row it carries drops
// them first, which is the pooled-node staleness trap auras_painter documents.
//
// Nothing here is graphics-tier gated. These are timers a player acts on, so the
// track's own setting is the only switch (root CLAUDE.md, gameplay-neutral
// graphics).

import { formatNumber } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { AURA_TRACK_ROW_CAP, type AuraTrackState } from './aura_track_view';

const ROW_CLASS = 'at-row';
const MODE_CLASS = 'at-mode-row';
const POINTS_CLASS = 'at-points-row';
const EXPIRING_CLASS = 'at-expiring';
const HIDDEN = 'none';
const SHOWN = '';
const SHOWN_FLEX = 'flex';

// The countdown's two shapes, hoisted: this runs per row per FRAME and
// numberFormatFor keys its cache on JSON.stringify(options), so a fresh literal
// per row would be an allocation plus a stringify on the hot path.
const NUMBER_OPTIONS = [
  { minimumFractionDigits: 0, maximumFractionDigits: 0 },
  { minimumFractionDigits: 1, maximumFractionDigits: 1 },
] as const;
const POINTS_OPTIONS = { maximumFractionDigits: 0 } as const;

export interface AuraTrackPainterDeps {
  root(): HTMLElement;
  writers: PainterHostWriters;
  iconBackground(iconKey: string): string;
  /** "<spell>" on a self row, "<spell> on <unit>" on an ally row. */
  rowLabel(auraName: string, unitName: string): string;
  /** The track's accessible name. */
  frameLabel(): string;
  overflowLabel(count: number): string;
  secondsSuffix(): string;
  /** The steady chip a mode row prints instead of a countdown. */
  modeLabel(): string;
}

interface RowEls {
  row: HTMLElement;
  icon: HTMLElement;
  fill: HTMLElement;
  labelEl: HTMLElement;
  time: HTMLElement;
  points: HTMLElement;
  stacks: HTMLElement;
  iconKey: string;
  key: string;
  label: string;
}

export class AuraTrackPainter {
  private readonly root: HTMLElement;
  private readonly rows: RowEls[] = [];
  private readonly overflowEl: HTMLElement;
  // Resolved once rather than per row per frame; relocalize() refreshes them,
  // the shape the aura strips use for their duration units.
  private secondsSuffix: string;
  private modeLabel: string;

  constructor(private readonly deps: AuraTrackPainterDeps) {
    this.root = deps.root();
    const rowHtml =
      `<div class="${ROW_CLASS}" style="display:none">` +
      `<span class="at-icon" aria-hidden="true"></span>` +
      `<span class="at-bar"><span class="at-fill"></span><span class="at-label"></span>` +
      `<span class="at-stacks" style="display:none"></span></span>` +
      `<span class="at-points" style="display:none"></span>` +
      `<span class="at-time"></span></div>`;
    this.root.innerHTML = `${rowHtml.repeat(AURA_TRACK_ROW_CAP)}<div class="at-overflow" style="display:none"></div>`;
    for (const row of this.root.querySelectorAll<HTMLElement>(`.${ROW_CLASS}`)) {
      this.rows.push({
        row,
        icon: row.querySelector('.at-icon') as HTMLElement,
        fill: row.querySelector('.at-fill') as HTMLElement,
        labelEl: row.querySelector('.at-label') as HTMLElement,
        time: row.querySelector('.at-time') as HTMLElement,
        points: row.querySelector('.at-points') as HTMLElement,
        stacks: row.querySelector('.at-stacks') as HTMLElement,
        iconKey: '',
        key: '',
        label: '',
      });
    }
    this.overflowEl = this.root.querySelector('.at-overflow') as HTMLElement;
    this.secondsSuffix = deps.secondsSuffix();
    this.modeLabel = deps.modeLabel();
    // Through the facet like every other write in this file: the two are
    // build-time, but a painter that reaches the DOM directly ANYWHERE is a
    // painter someone will copy the direct form out of.
    deps.writers.setAttr(this.root, 'role', 'group');
    deps.writers.setAttr(this.root, 'aria-label', deps.frameLabel());
  }

  /** Re-resolve everything resolved ONCE and then cached: the accessible name,
   *  the seconds suffix, the mode chip, and every row's composed label. Caching
   *  a localized string owes exactly this. */
  relocalize(): void {
    this.deps.writers.setAttr(this.root, 'aria-label', this.deps.frameLabel());
    this.secondsSuffix = this.deps.secondsSuffix();
    this.modeLabel = this.deps.modeLabel();
    for (const els of this.rows) els.label = '';
  }

  update(state: AuraTrackState): void {
    const w = this.deps.writers;
    // Hidden rather than emptied: an empty bordered box floating over the world
    // is the thing players report as a bug, and a track is genuinely absent
    // whenever it has nothing to say.
    w.setDisplay(this.root, state.count === 0 ? HIDDEN : SHOWN_FLEX);
    for (let i = 0; i < this.rows.length; i++) {
      const els = this.rows[i];
      if (i >= state.count) {
        els.key = '';
        w.setDisplay(els.row, HIDDEN);
        continue;
      }
      const model = state.rows[i];
      if (els.key !== model.key) {
        els.key = model.key;
        els.iconKey = '';
        els.label = '';
      }
      w.setDisplay(els.row, SHOWN_FLEX);
      if (els.iconKey !== model.iconKey) {
        els.iconKey = model.iconKey;
        w.setStyleProp(els.icon, 'background-image', this.deps.iconBackground(model.iconKey));
      }
      if (els.label === '') els.label = this.deps.rowLabel(model.auraName, model.unitName);
      w.setText(els.labelEl, els.label);
      w.setWidth(els.fill, `${Math.round(model.fraction * 1000) / 10}%`);
      w.toggleClass(els.row, MODE_CLASS, model.mode);
      w.toggleClass(els.row, EXPIRING_CLASS, model.expiring);

      const isPoints = model.points > 0;
      w.toggleClass(els.row, POINTS_CLASS, isPoints);
      // Display goes through setStyleProp on the nodes that also take setText:
      // the two single-slot writers would share one cache entry and never elide
      // (painter_host.ts, PainterHostWriters; the collision guard test pins it).
      w.setStyleProp(els.points, 'display', isPoints ? SHOWN : HIDDEN);
      if (isPoints) w.setText(els.points, formatNumber(model.points, POINTS_OPTIONS));

      // A mode prints its steady chip; everything else prints its countdown.
      w.setText(
        els.time,
        model.mode
          ? this.modeLabel
          : `${formatNumber(model.remaining, NUMBER_OPTIONS[model.decimals])}${this.secondsSuffix}`,
      );

      w.setStyleProp(els.stacks, 'display', model.stacks > 0 ? SHOWN : HIDDEN);
      if (model.stacks > 0) w.setText(els.stacks, formatNumber(model.stacks, POINTS_OPTIONS));
    }
    w.setStyleProp(this.overflowEl, 'display', state.overflow > 0 ? SHOWN : HIDDEN);
    if (state.overflow > 0) w.setText(this.overflowEl, this.deps.overflowLabel(state.overflow));
  }
}
