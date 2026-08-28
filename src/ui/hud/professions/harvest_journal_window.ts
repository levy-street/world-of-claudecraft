// The Harvest Journal window painter (#harvest-journal-window): a cold
// read-only list of the caller's own planted beds over IWorldFarming, opened
// from the professions window's Farming row and from its own keybind. The
// pure model lives in harvest_journal_view.ts; this module only paints it and
// owns the one clock the countdown needs.
//
// INFORMATIONAL ONLY, and that is a design decision rather than an oversight:
// the window carries NO plant button and NO harvest button. Both verbs stay
// at the garden beds themselves, so nothing here sends a command and there is
// no confirm channel to build.
//
// THE COUNTDOWN CLOCK (the one driver this module owns). A 1 Hz interval,
// armed on open and cleared on close, doing two things per tick:
//   1. rebuild the pure view from a FRESH myFarmPlots read and compare its
//      VALUE signature against the painted one. Anything that moved the model
//      (a plot planted or harvested elsewhere, a growing plot flipping to
//      ready or withered, a countdown crossing its deadline into the
//      finishing arm) repaints the window whole. A 1 Hz re-read is what makes
//      this window naturally consistent with the server's events-before-
//      snapshots message order: there is no event-forced cache here, and none
//      is wanted.
//   2. otherwise rewrite ONLY the countdown cells' text, through the refs the
//      paint collected when it minted the cells (stamped with each row's
//      readyAtMs via data-harvest-journal-countdown; the lockpick #2498 ref
//      discipline), and only when the rendered string moved against the
//      cached copy, so an unchanged tick touches no DOM at all.
// The cadence is a fixed wall-clock second: it is never preset-, tier-, or
// governor-keyed, because a crop timer is actionable information and the
// graphics-fairness invariant forbids shedding it by tier.
//
// CLOCK BASE: every subtraction uses world.farmNowMs(), the authority's own
// base the plot timestamps were written in. Date.now() never appears here;
// feeding it to an offline plot would render every bed ready the instant it
// was planted.

import { ITEMS } from '../../../sim/data';
import type { FarmGrowthStage } from '../../../sim/professions/farm_projection';
import { FARM_COMPOST_ITEM_ID, FARM_GROWTH_TONIC_ITEM_ID } from '../../../sim/professions/farming';
import type { IWorld } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import { itemDisplayName, zoneDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { captureFocusKey, restoreFirstEnabled } from '../../focus_restore';
import { formatNumber, type TranslationKey, t } from '../../i18n';
import { svgIcon } from '../../ui_icons';
import {
  buildHarvestJournalView,
  type HarvestJournalClock,
  type HarvestJournalRow,
  type HarvestJournalTimer,
  type HarvestJournalView,
  harvestJournalClock,
  harvestJournalViewSignature,
} from './harvest_journal_view';

/** The countdown clock's cadence: one wall-clock second, the resolution of
 *  the finest line the journal renders. Fixed for every player on every
 *  preset and tier (the graphics-fairness invariant). */
export const HARVEST_JOURNAL_TICK_MS = 1000;

// Keyed by the stage union itself, so a stage added to farmGrowthStage stops
// this file compiling until its label lands rather than rendering a raw id.
const STAGE_LABEL_KEYS: Record<FarmGrowthStage, TranslationKey> = {
  sprout: 'hudChrome.harvestJournal.stageSprout',
  seedling: 'hudChrome.harvestJournal.stageSeedling',
  maturing: 'hudChrome.harvestJournal.stageMaturing',
  ready: 'hudChrome.harvestJournal.stageRipe',
};

// How many of the four track steps each growth stage fills (the shared
// .prof-track family, phase 14: the journal's growth stages and the
// Perfecting rank track are one presentation). Keyed by the union like
// STAGE_LABEL_KEYS, for the same compile-time reason.
const STAGE_STEP_FILL: Record<FarmGrowthStage, number> = {
  sprout: 1,
  seedling: 2,
  maturing: 3,
  ready: 4,
};
const STAGE_STEP_TOTAL = 4;

/** The aria-hidden compact step track beside a growing row's stage word (the
 *  stage word stays the accessible text, the perfecting track's split). */
function stageStepsHtml(stage: FarmGrowthStage): string {
  const filled = STAGE_STEP_FILL[stage];
  const steps = Array.from(
    { length: STAGE_STEP_TOTAL },
    (_, i) => `<span class="prof-track-step${i < filled ? ' filled' : ''}"></span>`,
  ).join('');
  return `<span class="prof-track-steps compact" aria-hidden="true">${steps}</span>`;
}

// Keyed by the settled timer arms for the same reason as STAGE_LABEL_KEYS: a
// fifth HarvestJournalTimer arm stops this file compiling until its label
// lands, instead of a template-built key degrading at runtime. The growing
// arm is excluded because it renders through countdownText's {time} token.
const TIMER_LABEL_KEYS: Record<Exclude<HarvestJournalTimer['kind'], 'growing'>, TranslationKey> = {
  finishing: 'hudChrome.harvestJournal.finishing',
  ready: 'hudChrome.harvestJournal.ready',
  withered: 'hudChrome.harvestJournal.withered',
};

/** The whole number a clock part splices, never grouped: these are unit
 *  counts inside a token template, not quantities. */
const clockPart = (value: number): string =>
  formatNumber(value, { maximumFractionDigits: 0, useGrouping: false });

/** One decomposed clock, rendered through its own arm's key. Seconds are
 *  zero-padded ONLY where a minutes value precedes them (the gathering
 *  respawnClock idiom), so a draining line does not jitter in width between
 *  3m 9s and 3m 10s. The final-minute arm stands alone and reads 7s rather
 *  than 07s, which would look like a truncated clock. */
function clockText(clock: HarvestJournalClock): string {
  return t(clock.key, {
    days: clockPart(clock.days),
    hours: clockPart(clock.hours),
    minutes: clockPart(clock.minutes),
    seconds: clock.minutes > 0 ? String(clock.seconds).padStart(2, '0') : clockPart(clock.seconds),
  });
}

/** The growing arm's full cell text for a deadline and a clock reading. The
 *  ONE place that string is composed, shared by the build and by the 1 Hz
 *  rebind so the tick can never render a different sentence than the paint. */
function countdownText(readyAtMs: number, nowMs: number): string {
  return t('hudChrome.harvestJournal.growing', {
    time: clockText(harvestJournalClock(readyAtMs - nowMs)),
  });
}

/** An item's display name, the handle both the crop cell and the care chips
 *  use. Crop records carry no name of their own, so a crop is named by its
 *  produce; an id the client's catalog does not carry degrades to the raw id
 *  rather than to an empty cell (the farmPlantedTokenId contract). */
function itemName(itemId: string): string {
  const item = ITEMS[itemId];
  return item ? itemDisplayName(item) : itemId;
}

function bedText(row: HarvestJournalRow): string {
  if (row.zoneId === null) return t('hudChrome.harvestJournal.bedLineUnknown');
  return t('hudChrome.harvestJournal.bedLine', {
    zone: zoneDisplayName(row.zoneId),
    index: clockPart(row.bedIndex),
  });
}

export interface HarvestJournalWindowDeps {
  /** The #harvest-journal-window root (Hud owns the id). */
  root(): HTMLElement;
  /** The live world (offline Sim or online ClientWorld mirror). */
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  /** Fired after the root's display flips either way (the leaderboard /
   *  daily-rewards family shape): Hud wires it to syncAnyWindowOpenState so
   *  the mobile chrome's body classes track this window like every sibling
   *  (the P9b QA body-class gap this dep closes). */
  onVisibilityChange?(): void;
}

export class HarvestJournalWindow {
  private openerFocus: HTMLElement | null = null;
  private countdown: number | null = null;
  private paintedSignature: string | null = null;
  /** The growing rows' countdown cells, collected ONCE per paint at the one
   *  innerHTML site that mints them (the lockpick #2498 ref discipline), with
   *  each cell's deadline and last rendered string, so the 1 Hz tick walks no
   *  subtree, reads no dataset, and writes only a cell whose text moved. */
  private countdownCells: { el: HTMLElement; readyAtMs: number; lastText: string }[] = [];
  /** The persistent in-dialog status line (see liveStatusNode). */
  private liveStatus: HTMLElement | null = null;
  /** Bed ids observed ready by the LAST paint of an open journal, or null
   *  before the first paint after an open: the flip detector's baseline, so
   *  rows already ready at open are shown but never announced. */
  private readyBedIds: Set<string> | null = null;

  constructor(private readonly deps: HarvestJournalWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'flex';
  }

  open(): void {
    if (this.isOpen) {
      // A second open (the professions row re-clicked while the journal is
      // up) is a deliberate refresh: one cold whole-repaint, no interval
      // re-arm, and focus-safe (the opener sits outside this root, so the
      // repaint's focus carry is a no-op).
      this.render();
      return;
    }
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    const root = this.deps.root();
    markDialogRoot(root, { labelledBy: 'harvest-journal-title' });
    // Flex, not block: the window family's stylesheet (flex-direction: column,
    // .hj-body flex + overflow-y) only engages under flex, and the mobile rule
    // pins the root with overflow hidden, so block would clip the bed list
    // with no scroller on a phone.
    root.style.display = 'flex';
    this.deps.onVisibilityChange?.();
    this.render();
    root.querySelector<HTMLElement>('[data-close]')?.focus();
    this.countdown = window.setInterval(() => this.tick(), HARVEST_JOURNAL_TICK_MS);
  }

  close(): void {
    const root = this.deps.root();
    if (root.style.display !== 'flex') {
      this.openerFocus = null;
      return;
    }
    this.clearCountdown();
    root.style.display = 'none';
    this.deps.onVisibilityChange?.();
    this.paintedSignature = null;
    this.countdownCells = [];
    // The flip baseline and any standing announcement die with the session:
    // a reopen observes fresh and must not re-announce (or announce stale).
    this.readyBedIds = null;
    this.liveStatus?.replaceChildren();
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.open();
  }

  /** A forced full repaint from the live world: the open path and the
   *  language switch (the model's signature is ids and numbers, so a locale
   *  change alone never moves it and the tick would leave the old language up
   *  until a plot did something). */
  render(): void {
    if (!this.isOpen) return;
    const nowMs = this.deps.world().farmNowMs();
    this.paint(this.buildViewAt(nowMs), nowMs);
  }

  private clearCountdown(): void {
    if (this.countdown === null) return;
    window.clearInterval(this.countdown);
    this.countdown = null;
  }

  private buildViewAt(nowMs: number): HarvestJournalView {
    const world = this.deps.world();
    return buildHarvestJournalView({
      // Read fresh every time and never retained: the Sim mints a new array
      // per read while ClientWorld reuses one, so the value signature below
      // is the only honest change detector (the read-identity trap).
      plots: world.myFarmPlots,
      patches: world.farmPatches,
      nowMs,
      farmingSkill:
        world.professionsState.skills.find((row) => row.professionId === 'farming')?.skill ?? 0,
    });
  }

  /** The countdown clock's tick. One world clock read shared by both arms, so
   *  the signature comparison and the digits it authorizes can never disagree
   *  about what time it is. */
  private tick(): void {
    if (!this.isOpen) return;
    const nowMs = this.deps.world().farmNowMs();
    const view = this.buildViewAt(nowMs);
    if (harvestJournalViewSignature(view) !== this.paintedSignature) {
      this.paint(view, nowMs);
      return;
    }
    this.paintCountdowns(nowMs);
  }

  /** Rewrite the live countdown cells in place, off the refs paint()
   *  collected when it minted them. Only growing rows are collected, and the
   *  signature check above has already established that every collected row
   *  is STILL growing at this same nowMs, so this never has to re-decide a
   *  plot's state; it only moves digits. The compare runs against the cached
   *  string, so an unchanged cell costs no DOM access at all (a journal of
   *  day-long crops touches nothing between minute boundaries). */
  private paintCountdowns(nowMs: number): void {
    for (const cell of this.countdownCells) {
      const text = countdownText(cell.readyAtMs, nowMs);
      if (text === cell.lastText) continue;
      cell.lastText = text;
      cell.el.textContent = text;
    }
  }

  /** Collect the countdown cell refs from a freshly painted subtree: the one
   *  querySelectorAll, at the innerHTML site that just replaced the nodes,
   *  never from the tick. The stamped attribute stays the collection key (and
   *  the markup contract the tests pin); its value is read here once, and the
   *  cached rendered string seeds the tick's write elision. */
  private collectCountdownCells(content: HTMLElement, nowMs: number): void {
    this.countdownCells = [];
    for (const el of content.querySelectorAll<HTMLElement>('[data-harvest-journal-countdown]')) {
      const readyAtMs = Number(el.dataset.harvestJournalCountdown);
      if (!Number.isFinite(readyAtMs)) continue;
      this.countdownCells.push({ el, readyAtMs, lastText: countdownText(readyAtMs, nowMs) });
    }
  }

  private paint(view: HarvestJournalView, nowMs: number): void {
    const root = this.deps.root();
    // A whole repaint destroys the subtree, so the focused control must be
    // carried across the innerHTML write or a mid-session repaint (a plot
    // flipping to ready under an open window) strands focus on <body> while
    // the dialog is still up (the focus_restore contract).
    const focusKey = captureFocusKey(root);
    // The repaint targets an INNER content element, never the root: the
    // status line beside it must be a PERSISTENT live region, and writing
    // root.innerHTML would destroy and re-insert it every repaint, which
    // assistive tech treats as a region leaving and re-entering the tree
    // (announcements drop or repeat). The wrapper is display: contents in
    // CSS, so the title and body still lay out as the root's own flex
    // children.
    let content = root.querySelector<HTMLElement>('.hj-content');
    if (content === null) {
      root.textContent = '';
      content = document.createElement('div');
      content.className = 'hj-content';
      root.appendChild(content);
      root.appendChild(this.liveStatusNode());
    }
    content.innerHTML =
      `<div class="panel-title"><span id="harvest-journal-title">${esc(t('hudChrome.harvestJournal.title'))}</span>` +
      `<button type="button" class="x-btn" data-close data-focus-key="harvestJournalClose" aria-label="${esc(t('hudChrome.harvestJournal.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="hj-body">${this.bodyHtml(view, nowMs)}</div>`;
    this.collectCountdownCells(content, nowMs);
    this.announceReadyFlips(view);
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    if (focusKey !== null) {
      restoreFirstEnabled([
        root.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`),
        root.querySelector<HTMLElement>('[data-close]'),
      ]);
    }
    this.paintedSignature = harvestJournalViewSignature(view);
  }

  /** The persistent in-dialog status line (role=status, implicit polite
   *  aria-live). Appended beside the content element ONCE per open and never
   *  removed while the window lives (the repaint targets the content element
   *  only), so AT tracks one stable live region; #chatlog and #combat-live
   *  are the shipped persistent-region exemplars this follows. */
  private liveStatusNode(): HTMLElement {
    if (this.liveStatus === null) {
      this.liveStatus = document.createElement('div');
      this.liveStatus.className = 'hj-live-status';
      this.liveStatus.setAttribute('role', 'status');
    }
    return this.liveStatus;
  }

  /** The a11y batch's recorded follow-up: a row flipping to ready UNDER an
   *  open journal announces through the in-dialog status line. The chat line
   *  already reaches the LOG live region, but a reader standing in the
   *  journal dialog hears nothing there; this line is both visible and the
   *  announcement. The first paint after an open only observes (rows already
   *  ready at open are visible, not news), and the baseline tracks bed ids
   *  so a repaint that changes nothing announces nothing. Each announcement
   *  lands as a FRESH child span: a repeat of the same crop (harvest,
   *  replant, ready again) is byte-identical text, and writing the same
   *  string into textContent mutates nothing, so AT would announce nothing;
   *  replacing the child node is a real mutation every time. */
  private announceReadyFlips(view: HarvestJournalView): void {
    const ready = new Set<string>();
    if (view.kind === 'rows') {
      for (const row of view.rows) if (row.status === 'ready') ready.add(row.bedId);
    }
    const prior = this.readyBedIds;
    this.readyBedIds = ready;
    if (prior === null || view.kind !== 'rows') return;
    const flipped = view.rows.filter((row) => row.status === 'ready' && !prior.has(row.bedId));
    if (flipped.length === 0) return;
    const name = flipped.map((row) => itemName(row.produceItemId)).join(', ');
    const line = document.createElement('span');
    line.textContent = t('hudChrome.harvestJournal.readyAnnounce', { name });
    this.liveStatusNode().replaceChildren(line);
  }

  /** The Hud's runtime-language-switch arm: clear any standing announcement
   *  (its text was minted in the OLD locale and no flip re-mints it until a
   *  plot changes) and re-render the whole window in the new locale. */
  relocalize(): void {
    if (!this.isOpen) return;
    this.liveStatusNode().replaceChildren();
    this.render();
  }

  private bodyHtml(view: HarvestJournalView, nowMs: number): string {
    if (view.kind !== 'rows') {
      const title =
        view.kind === 'novice'
          ? t('hudChrome.harvestJournal.noviceTitle')
          : t('hudChrome.harvestJournal.emptyTitle');
      const body =
        view.kind === 'novice'
          ? t('hudChrome.harvestJournal.noviceBody')
          : t('hudChrome.harvestJournal.emptyBody');
      return `<div class="prof-empty"><h3>${esc(title)}</h3><p>${esc(body)}</p></div>`;
    }
    const rows = view.rows.map((row) => this.rowHtml(row, nowMs)).join('');
    return `<ul class="hj-list" role="list" aria-label="${esc(t('hudChrome.harvestJournal.listLabel'))}">${rows}</ul>`;
  }

  private rowHtml(row: HarvestJournalRow, nowMs: number): string {
    // Only the growing arm carries live digits, so only it is stamped for the
    // 1 Hz rebind; every other arm is a settled statement the tick must not
    // touch. The state class is the second, non-hue signal beside the words.
    const time =
      row.timer.kind === 'growing'
        ? `<span class="hj-time prof-track-text" data-harvest-journal-countdown="${esc(String(row.readyAtMs))}">${esc(countdownText(row.readyAtMs, nowMs))}</span>`
        : `<span class="hj-time prof-track-text">${esc(t(TIMER_LABEL_KEYS[row.timer.kind]))}</span>`;
    const stage =
      row.timer.kind === 'growing'
        ? `${stageStepsHtml(row.stage)}<span class="hj-stage">${esc(t(STAGE_LABEL_KEYS[row.stage]))}</span>`
        : '';
    return (
      `<li class="hj-row hj-${esc(row.timer.kind)}">` +
      `<span class="hj-crop">${esc(itemName(row.produceItemId))}</span>` +
      `<span class="hj-bed">${esc(bedText(row))}</span>` +
      `<span class="hj-state">${time}${stage}</span>` +
      `<span class="hj-care">${this.careHtml(row)}</span>` +
      `</li>`
    );
  }

  /** The plant-time knobs this plot was paid for. Compost and the tonic name
   *  themselves through the item catalog, which keeps the chips identical to
   *  what the same items read in the bags; the watch is a produce fee with no
   *  item, so it is the one chip with copy of its own. */
  private careHtml(row: HarvestJournalRow): string {
    const chips: string[] = [];
    if (row.compost) chips.push(itemName(FARM_COMPOST_ITEM_ID));
    if (row.watch) chips.push(t('hudChrome.harvestJournal.careWatch'));
    if (row.tonic) chips.push(itemName(FARM_GROWTH_TONIC_ITEM_ID));
    if (chips.length === 0) {
      return `<span class="hj-care-none">${esc(t('hudChrome.harvestJournal.careNone'))}</span>`;
    }
    return chips.map((chip) => `<span class="hj-care-chip">${esc(chip)}</span>`).join('');
  }
}
