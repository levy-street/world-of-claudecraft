// Pinned-recipe HUD tracker painter (#recipe-tracker): the always-on strip
// under the Reliquary tracker showing the recipes the player pinned from the
// crafting window, each with its reagents' carried/needed counts. The
// deed-tracker painter's contract, verbatim: the static skeleton is built ONCE
// (a single innerHTML write, see the allowance in tests/hud_perf_budget.test.ts)
// and every refresh routes through the PainterHostWriters elided facet only
// (setText/setDisplay/setAttr/toggleClass per line; a block pool capped at
// RECIPE_TRACK_CAP, each block's reagent pool at RECIPE_TRACKER_MAX_REAGENTS,
// never innerHTML per refresh). The header is a real tab stop with the
// quest-tracker disclosure contract (aria-expanded plus aria-controls); the
// strip is hidden on touch (hud.mobile.css, the Reliquary tracker's rationale),
// so it has no chip mode. The chevron is decorative aria-hidden. Hud owns the
// header's click/keydown delegation (tracker_header_wiring.ts) and the
// persisted collapse setting.
//
// The dt-* header vocabulary is the shared tracker chrome; the rows are rt-*
// because their shape (a result line over reagent lines) is this strip's own.
// Everything rendered here is player-chosen information and none of it varies
// with the graphics tier.

import { ITEMS } from '../sim/data';
import { itemDisplayName } from './entity_i18n';
import { formatNumber, t } from './i18n';
import { ownEntry } from './known_item';
import type { PainterHostWriters } from './painter_host';
import {
  RECIPE_TRACK_CAP,
  RECIPE_TRACKER_MAX_REAGENTS,
  type RecipeTrackerView,
} from './recipe_tracker_view';

export interface RecipeTrackerPainterDeps {
  /** The #recipe-tracker container (Hud owns the id). */
  root(): HTMLElement;
  /** The shared write-elision facet (Hud's caches; one skip-rate). */
  writers: PainterHostWriters;
}

interface ReagentEls {
  line: HTMLElement;
  name: HTMLElement;
  count: HTMLElement;
}

interface BlockEls {
  block: HTMLElement;
  name: HTMLElement;
  reagents: ReagentEls[];
}

/** Item name from the shipped catalog, or the raw id for a stale bundle. */
function itemName(itemId: string): string {
  const def = ownEntry(ITEMS, itemId);
  return def ? itemDisplayName(def) : itemId;
}

export class RecipeTrackerPainter {
  private readonly root: HTMLElement;
  private readonly header: HTMLElement;
  private readonly chevron: HTMLElement;
  private readonly label: HTMLElement;
  private readonly tally: HTMLElement;
  private readonly list: HTMLElement;
  private readonly blocks: BlockEls[] = [];

  constructor(private readonly deps: RecipeTrackerPainterDeps) {
    this.root = deps.root();
    // Static skeleton, built once (chrome only; every visible string is
    // painted through the elided writers below).
    const reagentHtml =
      `<div class="rt-mat" style="display:none"><span class="rt-mat-name"></span>` +
      `<span class="rt-mat-count"></span></div>`;
    const blockHtml =
      `<div class="rt-recipe" style="display:none"><div class="rt-name"></div>` +
      `${reagentHtml.repeat(RECIPE_TRACKER_MAX_REAGENTS)}</div>`;
    // The list id derives from the root's own id, so a second instance never
    // mints a duplicate id or cross-wires the disclosure.
    const listId = `${this.root.id || 'recipe-tracker'}-pin-list`;
    this.root.innerHTML =
      `<button type="button" class="dt-header" aria-controls="${listId}">` +
      `<span class="dt-chevron" aria-hidden="true"></span><span class="dt-label"></span><span class="dt-tally"></span></button>` +
      `<div class="dt-list" id="${listId}">${blockHtml.repeat(RECIPE_TRACK_CAP)}</div>`;
    this.header = this.root.querySelector('.dt-header') as HTMLElement;
    this.chevron = this.root.querySelector('.dt-chevron') as HTMLElement;
    this.label = this.root.querySelector('.dt-label') as HTMLElement;
    this.tally = this.root.querySelector('.dt-tally') as HTMLElement;
    this.list = this.root.querySelector('.dt-list') as HTMLElement;
    for (const block of this.root.querySelectorAll<HTMLElement>('.rt-recipe')) {
      const reagents: ReagentEls[] = [];
      for (const line of block.querySelectorAll<HTMLElement>('.rt-mat')) {
        reagents.push({
          line,
          name: line.querySelector('.rt-mat-name') as HTMLElement,
          count: line.querySelector('.rt-mat-count') as HTMLElement,
        });
      }
      this.blocks.push({ block, name: block.querySelector('.rt-name') as HTMLElement, reagents });
    }
  }

  /** Slow-band repaint from the tracker view. */
  update(view: RecipeTrackerView): void {
    const w = this.deps.writers;
    w.setDisplay(this.root, view.visible ? '' : 'none');
    if (!view.visible) return;
    w.setText(this.chevron, view.collapsed ? '▸' : '▾');
    w.setText(this.label, t('hudChrome.recipeTracker.trackerLabel'));
    w.setText(
      this.tally,
      view.collapsed ? t('hudChrome.questTracker.count', { count: this.fmt(view.count) }) : '',
    );
    w.setAttr(
      this.header,
      'title',
      t(
        view.collapsed
          ? 'hudChrome.recipeTracker.expandHint'
          : 'hudChrome.recipeTracker.collapseHint',
      ),
    );
    w.setAttr(this.header, 'aria-expanded', view.collapsed ? 'false' : 'true');
    w.setDisplay(this.list, view.collapsed ? 'none' : '');
    if (view.collapsed) return;
    for (let i = 0; i < this.blocks.length; i++) {
      const els = this.blocks[i];
      if (i >= view.lines.length) {
        w.setDisplay(els.block, 'none');
        continue;
      }
      const line = view.lines[i];
      w.setDisplay(els.block, '');
      w.toggleClass(els.block, 'rt-ready', line.ready);
      const result = itemName(line.resultItemId);
      w.setText(
        els.name,
        line.resultCount > 1
          ? t('hudChrome.recipeTracker.resultCount', {
              name: result,
              count: this.fmt(line.resultCount),
            })
          : result,
      );
      for (let j = 0; j < els.reagents.length; j++) {
        const mat = els.reagents[j];
        if (j >= line.reagents.length) {
          w.setDisplay(mat.line, 'none');
          continue;
        }
        const reagent = line.reagents[j];
        w.setDisplay(mat.line, '');
        w.toggleClass(mat.line, 'done', reagent.done);
        w.setText(mat.name, itemName(reagent.itemId));
        w.setText(
          mat.count,
          t('hudChrome.recipeTracker.haveNeed', {
            have: this.fmt(reagent.have),
            need: this.fmt(reagent.need),
          }),
        );
      }
    }
  }

  private fmt(n: number): string {
    return formatNumber(n, { maximumFractionDigits: 0 });
  }
}
