// Reliquary HUD tracker painter (#reliquary-tracker): the always-on strip under
// the deed tracker showing the pages the player pinned (or, before they pin
// anything, the pages closest to Illumination) with live X/Y progress. The
// deed-tracker painter's contract, verbatim: the static skeleton is built ONCE
// (a single innerHTML write, see the allowance in tests/hud_perf_budget.test.ts)
// and every refresh routes through the PainterHostWriters elided facet only
// (setText/setWidth/setDisplay/setAttr/toggleClass per line; a line pool capped
// at RELIQUARY_TRACK_CAP, never innerHTML per refresh). The header is a real tab
// stop whose ARIA depends on what activating it DOES (view.chip decides): in the
// default disclosure tier it toggles the inline page list (aria-expanded plus
// aria-controls, the quest-tracker contract); on the compact touch tier the rows
// are folded away and the header is a count chip that opens The Reliquary, so it
// is a dialog opener (aria-haspopup="dialog", no aria-expanded or aria-controls).
// The chevron and progress-bar glyphs are decorative aria-hidden, the .dt-count
// text carries the numbers. Hud owns the header's click/keydown delegation, the
// chip-mode flag, and the persisted collapse setting.
//
// The dt-* class vocabulary is the shared tracker chrome (#delve-tracker reuses
// it too); the list gets its own id so aria-controls names THIS region. The one
// addition is dt-flash, toggled on a row whose owned count just rose, which the
// stylesheet turns into a short pulse (and skips entirely under reduced motion).
// Everything rendered here is player-chosen cosmetic information and none of it
// varies with the graphics tier.
//
// Rule of three, deliberately not taken yet: this is copy number TWO of the
// deed-tracker painter shape (deed_tracker_painter.ts is copy one), and two
// similar blocks are left alone by house rule. It collapses into a single
// descriptor-parameterized TrackerStripPainter the day a THIRD tracker wants
// the shape (the delve tracker is the natural third), at which point the
// hardcoded list id above moves into the descriptor alongside the label and
// progress keys.

import { formatNumber, t } from './i18n';
import type { PainterHostWriters } from './painter_host';
import { reliquaryPageName } from './reliquary_i18n';
import { RELIQUARY_TRACK_CAP, type ReliquaryTrackerView } from './reliquary_tracker_view';

export interface ReliquaryTrackerPainterDeps {
  /** The #reliquary-tracker container (Hud owns the id). */
  root(): HTMLElement;
  /** The shared write-elision facet (Hud's caches; one skip-rate). */
  writers: PainterHostWriters;
}

interface TrackerLineEls {
  line: HTMLElement;
  name: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  count: HTMLElement;
}

export class ReliquaryTrackerPainter {
  private readonly root: HTMLElement;
  private readonly header: HTMLElement;
  private readonly chevron: HTMLElement;
  private readonly label: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly list: HTMLElement;
  private readonly lines: TrackerLineEls[] = [];
  // Last painted header mode (null = never painted). The disclosure/chip ARIA
  // swap runs only on a transition (see applyHeaderMode), so this gates it.
  private lastChip: boolean | null = null;

  constructor(private readonly deps: ReliquaryTrackerPainterDeps) {
    this.root = deps.root();
    // Static skeleton, built once (chrome only; every visible string is
    // painted through the elided writers below). The header is a native
    // button tab stop; update() keeps its disclosure/dialog a11y in sync with
    // the collapse and chip state, and the decorative glyphs stay aria-hidden.
    const lineHtml =
      `<div class="dt-line" style="display:none"><span class="dt-name"></span>` +
      `<span class="dt-bar" aria-hidden="true"><span class="dt-bar-fill"></span></span>` +
      `<span class="dt-count"></span></div>`;
    this.root.innerHTML =
      `<button type="button" class="dt-header" aria-controls="reliquary-pin-list">` +
      `<span class="dt-chevron" aria-hidden="true"></span><span class="dt-label"></span><span class="dt-tally"></span></button>` +
      `<div class="dt-list" id="reliquary-pin-list">${lineHtml.repeat(RELIQUARY_TRACK_CAP)}</div>`;
    this.header = this.root.querySelector('.dt-header') as HTMLElement;
    this.chevron = this.root.querySelector('.dt-chevron') as HTMLElement;
    this.label = this.root.querySelector('.dt-label') as HTMLElement;
    this.countEl = this.root.querySelector('.dt-tally') as HTMLElement;
    this.list = this.root.querySelector('.dt-list') as HTMLElement;
    for (const line of this.root.querySelectorAll<HTMLElement>('.dt-line')) {
      this.lines.push({
        line,
        name: line.querySelector('.dt-name') as HTMLElement,
        bar: line.querySelector('.dt-bar') as HTMLElement,
        fill: line.querySelector('.dt-bar-fill') as HTMLElement,
        count: line.querySelector('.dt-count') as HTMLElement,
      });
    }
  }

  /** Slow-band repaint from the reused tracker view (allocation-light core). */
  update(view: ReliquaryTrackerView): void {
    const w = this.deps.writers;
    w.setDisplay(this.root, view.visible ? '' : 'none');
    if (!view.visible) return;
    w.setText(this.chevron, view.collapsed ? '▸' : '▾');
    w.setText(this.label, t('hudChrome.reliquary.trackerLabel'));
    w.setText(this.countEl, t('hudChrome.questTracker.count', { count: this.fmt(view.count) }));
    this.applyHeaderMode(view);
    w.setDisplay(this.list, view.collapsed ? 'none' : '');
    if (view.collapsed) return;
    for (let i = 0; i < this.lines.length; i++) {
      const els = this.lines[i];
      if (i >= view.count) {
        w.setDisplay(els.line, 'none');
        // Clear the flash with the row: a lit class left on a recycled pool
        // slot would elide the next real flash of whichever page lands here.
        w.toggleClass(els.line, 'dt-flash', false);
        continue;
      }
      const line = view.lines[i];
      w.setDisplay(els.line, '');
      // Page names resolve from the id at paint time (the reliquary_i18n
      // channel), never from the catalog English the core never carries.
      w.setText(els.name, reliquaryPageName(line.pageId));
      const pct = line.total > 0 ? Math.round((line.owned / line.total) * 100) : 0;
      w.setWidth(els.fill, `${pct}%`);
      w.setText(
        els.count,
        t('hudChrome.reliquary.progressText', {
          owned: this.fmt(line.owned),
          total: this.fmt(line.total),
        }),
      );
      w.toggleClass(els.line, 'dt-flash', line.flash);
    }
  }

  // The header's disclosure-vs-dialog a11y (see the module comment). The
  // presence-toggling attrs (aria-expanded / aria-controls / aria-haspopup) flip
  // only when the mode changes; the elided setAttr facet has no removal path and
  // would cache a stale value across a raw removeAttribute, so that swap is a
  // direct DOM write done once per transition (slow-band chrome, within the perf
  // contract). The title, and aria-expanded's true/false within disclosure mode,
  // stay on the elided facet.
  private applyHeaderMode(view: ReliquaryTrackerView): void {
    const w = this.deps.writers;
    if (this.lastChip !== view.chip) {
      if (view.chip) {
        // Chip mode: the header opens The Reliquary, it does not disclose an
        // inline region. Drop the disclosure wiring, advertise the dialog opener.
        this.header.removeAttribute('aria-expanded');
        this.header.removeAttribute('aria-controls');
        this.header.setAttribute('aria-haspopup', 'dialog');
      } else {
        // Disclosure mode: restore the quest-tracker contract. Re-add aria-controls
        // and aria-expanded with direct writes (a raw re-add defeats the setAttr
        // cache's stale hit, which would otherwise elide re-adding aria-expanded
        // after the removeAttribute above); the steady-state setAttr below keeps
        // aria-expanded in sync afterward.
        this.header.removeAttribute('aria-haspopup');
        this.header.setAttribute('aria-controls', 'reliquary-pin-list');
        this.header.setAttribute('aria-expanded', view.collapsed ? 'false' : 'true');
      }
      this.lastChip = view.chip;
    }
    if (view.chip) {
      w.setAttr(this.header, 'title', t('hudChrome.reliquary.openWindowHint'));
      return;
    }
    w.setAttr(
      this.header,
      'title',
      t(view.collapsed ? 'hudChrome.reliquary.expandHint' : 'hudChrome.reliquary.collapseHint'),
    );
    w.setAttr(this.header, 'aria-expanded', view.collapsed ? 'false' : 'true');
  }

  private fmt(n: number): string {
    return formatNumber(n, { maximumFractionDigits: 0 });
  }
}
