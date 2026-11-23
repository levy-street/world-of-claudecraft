// Dungeon objectives tracker painter (#dungeon-tracker): the plate at the top
// of the right tracker stack that names the group dungeon a player stands in,
// with a progress rail, and under it one row per boss counted 0 of 1 until it
// falls ("0 / 1 Sexton Marrow"). Thin consumer of dungeon_tracker_view.ts.
//
// The tracker-painter contract of the deed and Reliquary strips, on the same
// budget: the static skeleton (the plate plus a fixed pool of
// DUNGEON_TRACKER_ROW_CAP rows) is built ONCE in the constructor, in a single
// innerHTML write (see the allowance in tests/hud_perf_budget.test.ts), and
// every refresh routes through the PainterHostWriters elided facet only. The
// nodes therefore PERSIST across a boss kill, which is what lets the done
// state ease in (a CSS transition on the row) instead of popping: a rebuild
// would replace the row and there would be nothing to transition from.
//
// A poll does three things, at three costs:
//   state    the visibility, done and highlight classes: elided toggles over
//            the reused model, every poll, no allocation;
//   text     every t(), formatter and name lookup, ONLY when the model's `rev`
//            or the locale generation moved (the quest strip's raw-key idiom);
//            an unchanged run resolves nothing at all;
//   seat     where the plate may reach before the button rail, measured (three
//            rect reads) on every RAIL_MEASURE_POLLS-th poll while a run is on
//            screen, and never outside one. See clearRail().
// On TOUCH the plate is hidden (hud.mobile.css) and the run is a page of the
// quest strip instead, so update() stops at the door and resolves nothing;
// stripQuest() hands the strip its page, remembered until the run changes.
//
// Names never come from a literal: the dungeon and each boss resolve through
// the entity name resolvers from the ids the sim carries, and the counts
// through the formatter. Everything painted is actionable progress, so none of
// it varies with the graphics tier (the kill glow is a decoration over a count
// that is already on screen, and it rides the motion kills in CSS).

import type { IWorld } from '../../../world_api';
import type { DungeonRunView } from '../../../world_api/dungeons';
import { mobDisplayName } from '../../entity_display_core';
import { dungeonDisplayName } from '../../entity_i18n';
import { formatNumber, t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { svgIcon } from '../../ui_icons';
import type { TrackedQuest } from '../quest/quest_tracker';
import {
  buildDungeonTracker,
  DUNGEON_TRACKER_ROW_CAP,
  type DungeonStripText,
  type DungeonTrackerModel,
  dungeonPlateFraction,
  dungeonStripQuest,
  makeDungeonTrackerModel,
} from './dungeon_tracker_view';

/** The class the touch layout carries on <body> (the quest strip's own gate). */
const TOUCH_BODY_CLASS = 'mobile-touch';

/** The plate's share of its column, read by the stylesheet as its width. */
const PLATE_WIDTH_PROP = '--dgt-plate-w';

/** The seat is re-measured on every Nth poll while a run is on screen: the
 *  medium band is about 4 Hz, so the rail is found again within half a second
 *  of a resize, a UI scale change or the rail being moved. */
export const RAIL_MEASURE_POLLS = 2;

export interface DungeonTrackerPainterDeps {
  /** The #dungeon-tracker container. Left out (as the Hud leaves it), the
   *  painter finds it in the document by that id. */
  root?(): HTMLElement;
  /** The shared write-elision facet (Hud's caches; one skip-rate). */
  writers: PainterHostWriters;
  world(): Pick<IWorld, 'dungeonRun'>;
  /** The button rail the plate must not cover (#side-buttons). Left out, the
   *  painter finds it in the root's own document; null means there is none. */
  rail?(): HTMLElement | null;
}

interface TrackerRowEls {
  row: HTMLElement;
  boss: HTMLElement;
  count: HTMLElement;
}

export class DungeonTrackerPainter {
  private readonly root: HTMLElement;
  private readonly plate: HTMLElement;
  private readonly name: HTMLElement;
  private readonly difficulty: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly tally: HTMLElement;
  private readonly rail: HTMLElement | null;
  private readonly rows: TrackerRowEls[] = [];
  private readonly model: DungeonTrackerModel = makeDungeonTrackerModel();
  private readonly stripText: DungeonStripText;
  /** Bumped by relocalize(): the half of the text gate the run cannot move. */
  private generation = 0;
  /** The model rev and locale generation the text was last resolved for. */
  private lastRev = -1;
  private lastGeneration = -1;
  /** Polls since the tracker came on screen; clocks the seat measure. */
  private polls = 0;
  /** The strip page, remembered for the run and generation it was built from. */
  private lastStripRun: DungeonRunView | null = null;
  private lastStripGeneration = -1;
  private stripPage: TrackedQuest | null = null;

  constructor(private readonly deps: DungeonTrackerPainterDeps) {
    this.root = deps.root
      ? deps.root()
      : (document.querySelector('#dungeon-tracker') as HTMLElement);
    this.rail = deps.rail ? deps.rail() : this.root.ownerDocument.getElementById('side-buttons');
    this.stripText = {
      title: (dungeonId, heroic) =>
        heroic
          ? t('hudChrome.dungeonTracker.heroicTitle', {
              name: dungeonDisplayName(dungeonId),
              difficulty: t('hudChrome.finder.heroic'),
            })
          : dungeonDisplayName(dungeonId),
      bossName: mobDisplayName,
    };
    // Static skeleton, built once (chrome only; every visible string is
    // painted through the elided writers below). A row reads count first, the
    // classic objective line, so its text hugs the left edge of the column.
    // The rail and the check are decoration: the boss name and its count
    // carry the meaning as text.
    const rowHtml =
      `<div class="dgt-row" role="listitem" style="display:none">` +
      `<span class="dgt-count ui-num"></span><span class="dgt-boss"></span>` +
      `<span class="dgt-mark" aria-hidden="true">${svgIcon('check')}</span></div>`;
    this.root.innerHTML =
      `<div class="dgt-plate ui-panel-soft">` +
      `<div class="dgt-name ui-cin"></div>` +
      `<div class="dgt-progress"><span class="dgt-diff ui-chip"></span>` +
      `<span class="dgt-bar ui-bar" aria-hidden="true">` +
      `<span class="dgt-bar-fill ui-bar-fill"></span></span>` +
      `<span class="dgt-tally ui-num"></span></div></div>` +
      `<div class="dgt-list" role="list">${rowHtml.repeat(DUNGEON_TRACKER_ROW_CAP)}</div>`;
    this.plate = this.root.querySelector('.dgt-plate') as HTMLElement;
    this.name = this.root.querySelector('.dgt-name') as HTMLElement;
    this.difficulty = this.root.querySelector('.dgt-diff') as HTMLElement;
    this.fill = this.root.querySelector('.dgt-bar-fill') as HTMLElement;
    this.tally = this.root.querySelector('.dgt-tally') as HTMLElement;
    for (const row of this.root.querySelectorAll<HTMLElement>('.dgt-row')) {
      this.rows.push({
        row,
        boss: row.querySelector('.dgt-boss') as HTMLElement,
        count: row.querySelector('.dgt-count') as HTMLElement,
      });
    }
  }

  /**
   * Re-localize after an in-game language switch (the Hud's language fan-out).
   * The text gate below compares a model rev and this generation, both of them
   * blind to the locale, so a plain update() would keep the old language until
   * a boss fell. Bumping the generation forces exactly one resolve, here and
   * for the strip page; the gate re-latches inside update(), never cleared.
   */
  relocalize(): void {
    this.generation++;
    this.update();
  }

  /** Medium-band repaint: rebuild the reused model, then state the DOM. */
  update(): void {
    const w = this.deps.writers;
    // On touch the quest strip carries the run and the plate is hidden, so
    // there is nothing here to state, resolve or measure.
    if (this.onTouch()) {
      w.toggleClass(this.root, 'is-live', false);
      this.polls = 0;
      return;
    }
    const view = buildDungeonTracker(this.deps.world(), this.model);
    // Visibility is this one class: the stylesheet folds the tracker out of
    // the stack without it, and keeps the empty plate out of the placeholder
    // the frame editor force-shows for a hidden tracker.
    w.toggleClass(this.root, 'is-live', view.visible);
    if (!view.visible) {
      this.polls = 0;
      return;
    }
    w.toggleClass(this.plate, 'is-heroic', view.heroic);
    w.toggleClass(this.plate, 'is-complete', view.complete);
    w.toggleClass(this.plate, 'is-complete-flash', view.completeFlash);
    for (let i = 0; i < this.rows.length; i++) {
      const els = this.rows[i];
      const live = i < view.count;
      w.setDisplay(els.row, live ? '' : 'none');
      // A pooled slot past the list drops its state with its row, or a class
      // left on it would elide the next real kill glow of whichever boss
      // lands there.
      w.toggleClass(els.row, 'is-done', live && view.rows[i].done);
      w.toggleClass(els.row, 'is-flash', live && view.rows[i].flash);
    }
    if (view.rev !== this.lastRev || this.generation !== this.lastGeneration) {
      this.lastRev = view.rev;
      this.lastGeneration = this.generation;
      this.resolveText(view);
    }
    if (this.polls++ % RAIL_MEASURE_POLLS === 0) this.clearRail();
  }

  /** Every string and number on the tracker. Run only when the gate moved. */
  private resolveText(view: DungeonTrackerModel): void {
    const w = this.deps.writers;
    w.setAttr(this.root, 'aria-label', t('hudChrome.interfaceUnlock.frameNames.dungeonTracker'));
    w.setText(this.name, dungeonDisplayName(view.dungeonId));
    w.setText(this.difficulty, view.heroic ? t('hudChrome.finder.heroic') : '');
    w.setWidth(this.fill, `${Math.round((view.defeated / view.total) * 100)}%`);
    w.setText(
      this.tally,
      view.complete
        ? t('hudChrome.dungeonTracker.complete')
        : this.progress(view.defeated, view.total),
    );
    for (let i = 0; i < view.count; i++) {
      const row = view.rows[i];
      w.setText(this.rows[i].boss, mobDisplayName(row.mobId));
      w.setText(this.rows[i].count, this.progress(row.done ? 1 : 0, 1));
    }
  }

  /**
   * Keep the plate out from under the button rail. The plate is the one opaque
   * box in the stack and the stack paints above the rail, so where the two
   * meet it would cover buttons. Whether they meet depends on the viewport,
   * the UI scale, a horizontal or moved rail and a moved tracker, none of which
   * a media query can see, so it is MEASURED: three rect reads, all in the
   * same zoomed space, and a share of the column written back as a percentage
   * (dungeonPlateFraction; scale-free by construction).
   *
   * Bounded forced-reflow cost by contract (the allowance in
   * tests/hud_perf_budget.test.ts): only while a run is on screen, on every
   * RAIL_MEASURE_POLLS-th poll, never per frame.
   */
  private clearRail(): void {
    const fraction = dungeonPlateFraction(
      this.root.getBoundingClientRect(),
      this.plate.getBoundingClientRect(),
      this.rail ? this.rail.getBoundingClientRect() : null,
    );
    const w = this.deps.writers;
    w.setStyleProp(this.root, PLATE_WIDTH_PROP, `${Math.round(fraction * 1000) / 10}%`);
    // The narrowed plate sets its name a size down, so a dungeon name that fit
    // one line still does; the line height holds, so the plate never gets
    // SHORTER by narrowing and the measure cannot flip-flop.
    w.toggleClass(this.root, 'is-narrow', fraction < 1);
  }

  private onTouch(): boolean {
    return this.root.ownerDocument.body?.classList.contains(TOUCH_BODY_CLASS) === true;
  }

  /**
   * The run as a page of the touch quest strip (null outside a tracked
   * dungeon). The plate is hidden on touch, where the strip is the tracker, so
   * the quest tracker's controller asks for this on every poll and hands it
   * to the strip. Both worlds hand back the SAME run object until the run
   * changes, so the page is rebuilt only then (or after a language switch),
   * never per poll.
   */
  stripQuest(): TrackedQuest | null {
    const run = this.deps.world().dungeonRun;
    if (run !== this.lastStripRun || this.generation !== this.lastStripGeneration) {
      this.lastStripRun = run;
      this.lastStripGeneration = this.generation;
      this.stripPage = dungeonStripQuest({ dungeonRun: run }, this.stripText);
    }
    return this.stripPage;
  }

  /** "current / total" in the quest tracker's own counted-objective template. */
  private progress(current: number, total: number): string {
    return t('hudChrome.questTracker.objectiveValue', {
      current: formatNumber(current, { maximumFractionDigits: 0 }),
      total: formatNumber(total, { maximumFractionDigits: 0 }),
    });
  }
}
