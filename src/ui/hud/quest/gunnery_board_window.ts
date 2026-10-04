// Thin painter for Master Gunner Alder's Gunnery Board, painted into the quest
// dialog's root while the player talks to him, so the dialog's Escape, focus trap,
// walk-away close and quest-event repaints all hold for it unchanged. The pure
// gunnery_board_view.ts decides every row and fact from the character's own records
// (IWorld.fireAndFlyRecords); this module owns the pick and the keyboard: arrows
// move the pick, Enter takes it. Cold: it paints on open, a pick and a quest-event
// repaint, never per frame.

import type { IWorld } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import { esc } from '../../esc';
import {
  findFocusKey,
  focusedWithin,
  focusKeyAttr,
  restoreFirstEnabled,
} from '../../focus_restore';
import { svgIcon } from '../../ui_icons';
import {
  buildGunneryBoardView,
  type GunneryBoardDetail,
  type GunneryBoardRow,
  type GunneryBoardView,
  gunneryBestsFromRecords,
  gunneryBoardStep,
} from './gunnery_board_view';

export type GunneryBoardWorld = Pick<IWorld, 'fireAndFlyRecruitment' | 'fireAndFlyRecords'>;

export interface GunneryBoardWindowDeps {
  world(): GunneryBoardWorld;
  /** Seat the player for a scenario through the instructor's start command. */
  start(scenarioId: string): void;
  close(): void;
}

/** What the instructor dialog hands the board for one paint. */
export interface GunneryBoardSpeaker {
  speakerName: string;
  speakerTitle: string;
  greeting: string;
  /** Today's row is completed: every run is practice. */
  rewardCollected: boolean;
}

type FocusMode = 'selected' | 'keep';

const ROW_KEY = 'gb-row:';
const ACTION_KEY = 'gb-action';
const CLOSE_KEY = 'gb-close';

/** Focus a row and bring it into its list's view (the phone strip scrolls sideways). */
function reveal(row: HTMLElement | null): void {
  if (!row) return;
  row.focus();
  // Guarded: the DOM test environments ship no scrollIntoView.
  if (typeof row.scrollIntoView === 'function') {
    row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function medalStyle(url: string | null): string {
  return url ? ` style="--gb-medal:url('${esc(url)}')"` : '';
}

export class GunneryBoardWindow {
  private host: HTMLElement | null = null;
  private speaker: GunneryBoardSpeaker | null = null;
  private selectedId: string | null = null;
  private view: GunneryBoardView | null = null;

  constructor(private readonly deps: GunneryBoardWindowDeps) {}

  get isActive(): boolean {
    return this.host !== null;
  }

  /** Paint into `host`; the first paint after a reset opens on the default pick. */
  paint(host: HTMLElement, speaker: GunneryBoardSpeaker): void {
    const fresh = this.host === null;
    this.host = host;
    this.speaker = speaker;
    if (fresh) this.selectedId = null;
    this.render(fresh ? 'selected' : 'keep');
  }

  /** The dialog closed or moved on: forget the open. */
  reset(): void {
    this.host = null;
    this.speaker = null;
    this.view = null;
  }

  private render(mode: FocusMode): void {
    const host = this.host;
    const speaker = this.speaker;
    if (!host || !speaker) return;
    const focused = mode === 'keep' ? focusedWithin(host) : null;
    const kept = focused?.dataset.focusKey ?? null;
    const world = this.deps.world();
    const view = buildGunneryBoardView({
      recruitment: world.fireAndFlyRecruitment,
      rewardCollected: speaker.rewardCollected,
      bests: gunneryBestsFromRecords(world.fireAndFlyRecords),
      selectedId: this.selectedId,
      speakerName: speaker.speakerName,
      speakerTitle: speaker.speakerTitle,
      greeting: speaker.greeting,
    });
    this.view = view;
    markDialogRoot(host, { labelledBy: 'quest-dialog-title' });
    host.innerHTML = this.headHtml(view) + this.bodyHtml(view);
    this.bind(host);
    if (mode === 'selected') {
      this.focusSelected(host);
      return;
    }
    if (focused === null) return;
    const selectedRow = `${ROW_KEY}${view.selectedId}`;
    // Before the player picks, the focused row follows the default pick. A control
    // the rebuild cannot hand focus back to (no key, or the action now disabled)
    // falls back to the picked row, so focus never drops out of the dialog's trap.
    if (kept === null || (kept.startsWith(ROW_KEY) && this.selectedId === null)) {
      reveal(findFocusKey(host, selectedRow));
      return;
    }
    restoreFirstEnabled([findFocusKey(host, kept), findFocusKey(host, selectedRow)]);
  }

  private focusSelected(host: HTMLElement): void {
    if (!this.view) return;
    reveal(findFocusKey(host, `${ROW_KEY}${this.view.selectedId}`));
  }

  private select(scenarioId: string, focus: boolean): void {
    this.selectedId = scenarioId;
    this.render('keep');
    if (focus && this.host) this.focusSelected(this.host);
  }

  private take(): void {
    const detail = this.view?.detail;
    if (!detail || detail.actionDisabled) return;
    this.deps.start(detail.scenarioId);
  }

  private bind(host: HTMLElement): void {
    host.querySelector('[data-close]')?.addEventListener('click', () => this.deps.close());
    host.querySelector('[data-gb-take]')?.addEventListener('click', () => this.take());
    for (const row of host.querySelectorAll<HTMLElement>('[data-gb-row]')) {
      const id = row.dataset.gbRow ?? '';
      row.addEventListener('click', () => this.select(id, true));
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          if (this.view?.selectedId !== id) this.select(id, true);
          this.take();
          return;
        }
        if (event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          this.select(id, true);
          return;
        }
        const next = gunneryBoardStep(id, event.key);
        if (next === null) return;
        // The arrows also walk the character: the board keeps them while a row has focus.
        event.preventDefault();
        event.stopPropagation();
        this.select(next, true);
      });
    }
  }

  private headHtml(view: GunneryBoardView): string {
    const sub = view.speakerTitle
      ? `${esc(view.speakerName)} &lt;${esc(view.speakerTitle)}&gt;`
      : esc(view.speakerName);
    const mastery = view.masteryText
      ? `<span class="ui-chip gb-chip gb-mastery">${esc(view.masteryText)}</span>`
      : '';
    return (
      `<div class="panel-title ui-win-head gb-head">` +
      `<span class="gb-heading"><span class="ui-win-title" id="quest-dialog-title">${esc(view.title)}</span>` +
      `<span class="ui-win-sub gb-speaker">${sub}</span></span>` +
      `<span class="gb-progress"><span class="ui-chip gb-chip gb-recruit">${esc(view.recruitmentText)}</span>${mastery}</span>` +
      `<button type="button" class="x-btn ui-x-btn" data-close aria-label="${esc(view.closeLabel)}"${focusKeyAttr(CLOSE_KEY)}>${svgIcon('close')}</button>` +
      `</div>`
    );
  }

  private bodyHtml(view: GunneryBoardView): string {
    const greeting = view.greeting ? `<p class="gb-greeting">"${esc(view.greeting)}"</p>` : '';
    const sections = view.sections
      .map((section) => {
        const titleId = `gb-group-${section.group}`;
        return (
          `<div class="gb-group" role="group" aria-labelledby="${titleId}">` +
          `<div class="gb-group-title" id="${titleId}">${esc(section.title)}</div>` +
          section.rows.map((row) => this.rowHtml(row)).join('') +
          `</div>`
        );
      })
      .join('');
    return (
      `<div class="gb" data-gunnery-board>${greeting}<div class="gb-split">` +
      `<div class="gb-list ui-well" role="listbox" aria-label="${esc(view.listLabel)}">${sections}</div>` +
      this.detailHtml(view.detail) +
      `</div></div>`
    );
  }

  private rowHtml(row: GunneryBoardRow): string {
    let mark: string;
    if (row.state === 'medal') {
      mark = `<span class="gb-medal gb-medal-${row.medal}"${medalStyle(row.medalArt)} title="${esc(row.stateText)}" aria-hidden="true"></span>`;
    } else if (row.state === 'won') {
      mark = `<span class="gb-won" aria-hidden="true">${svgIcon('check')}</span>`;
    } else if (row.state === 'locked') {
      mark = `<span class="gb-lock" aria-hidden="true">${svgIcon('lock')}</span>`;
    } else {
      mark = `<span class="gb-dash" aria-hidden="true"></span>`;
    }
    return (
      `<div class="gb-row gb-row-${row.state}${row.selected ? ' is-on' : ''}" role="option" aria-selected="${row.selected ? 'true' : 'false'}"` +
      ` tabindex="${row.selected ? '0' : '-1'}" data-gb-row="${esc(row.scenarioId)}"${focusKeyAttr(`${ROW_KEY}${row.scenarioId}`)}>` +
      `<span class="gb-row-name">${esc(row.name)}</span>${mark}` +
      `<span class="visually-hidden">${esc(row.stateText)}</span></div>`
    );
  }

  private detailHtml(detail: GunneryBoardDetail): string {
    const arsenal = detail.arsenal
      .map(
        (chip) =>
          `<span class="ui-chip gb-chip gb-weapon${chip.empty ? ' is-empty' : ''}">${esc(chip.text)}</span>`,
      )
      .join('');
    const bestMedal = detail.bestMedal
      ? `<span class="gb-medal gb-medal-${detail.bestMedal}"${medalStyle(detail.bestMedalArt)} aria-hidden="true"></span>`
      : '';
    const fact = (cls: string, label: string, value: string): string =>
      `<div class="gb-fact gb-fact-${cls}"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
    const locked = detail.lockedReason
      ? `<p class="gb-locked" id="gb-locked">${svgIcon('lock')}<span>${esc(detail.lockedReason)}</span></p>`
      : '';
    return (
      `<section class="gb-detail ui-well" aria-labelledby="gb-detail-name" data-gb-detail="${esc(detail.scenarioId)}">` +
      `<div class="gb-detail-scroll">` +
      `<div class="gb-kicker">${esc(detail.kicker)}</div>` +
      `<h3 class="gb-name" id="gb-detail-name">${esc(detail.name)}</h3>` +
      `<p class="gb-brief">${esc(detail.brief)}</p>` +
      `<dl class="gb-facts">` +
      fact('arsenal', detail.arsenalLabel, `<span class="gb-chips">${arsenal}</span>`) +
      fact('gold', detail.goldLabel, esc(detail.goldText)) +
      fact('waves', detail.wavesLabel, esc(detail.wavesText)) +
      fact('best', detail.bestLabel, `${bestMedal}<span>${esc(detail.bestText)}</span>`) +
      fact(
        detail.rewardCollected ? 'reward is-collected' : 'reward',
        detail.rewardLabel,
        esc(detail.rewardText),
      ) +
      `</dl></div>` +
      `<div class="gb-foot">${locked}<button type="button" class="btn ui-btn ui-btn--red ui-btn--lg gb-action" data-gb-take` +
      ` aria-label="${esc(detail.actionAria)}"${detail.lockedReason ? ' aria-describedby="gb-locked" disabled' : ''}${focusKeyAttr(ACTION_KEY)}>` +
      `${esc(detail.actionLabel)}</button></div>` +
      `</section>`
    );
  }
}
