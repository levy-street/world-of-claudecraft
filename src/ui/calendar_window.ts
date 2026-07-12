// Thin DOM painter for the event calendar window.
//
// The consumer half of the pure-core + thin-painter split: it paints
// #calendar-window from the CalendarMonthView (calendar_view.ts) and owns the
// window's view-state (visible month, selected day) plus its lifecycle. System
// events come from the SYSTEM_EVENTS rules; guild events from the socialInfo
// mirror (online only). Officers and the Guild Master book/remove guild events
// through IWorld; everything player-visible renders from t() keys, and the
// only wall-clock reads (today, the initial month) live here, never in the core.

import { audio } from '../game/audio';
import type { GuildEventInfo, IWorld } from '../world_api';
import {
  buildCalendarMonth,
  type CalendarCell,
  canManageGuildEvents,
  monthOfIso,
  shiftMonth,
} from './calendar_view';
import { esc } from './esc';
import { formatDateTime, formatNumber, type TranslationKey, t } from './i18n';
import { svgIcon } from './ui_icons';
import { ensureWindowFrame } from './window_frame_mount';
import type { WindowFrameDescriptor } from './window_frame_view';

// A closable, tab-less, footer-less frame: the month grid and the day detail pane
// render inside one scrollable body (the day pane keeps its own flex scroll). The
// title + close keys are reused from the existing calendar catalog.
const CALENDAR_FRAME: WindowFrameDescriptor = {
  id: 'calendar-window',
  titleKey: 'hudChrome.calendar.title',
  closeLabelKey: 'hudChrome.calendar.close',
};

// System-event title/note keys by id (typed map so t() stays key-checked).
const SYSTEM_EVENT_TEXT: Record<string, { title: TranslationKey; note: TranslationKey }> = {
  raid_call: {
    title: 'hudChrome.calendar.events.raidCall.title',
    note: 'hudChrome.calendar.events.raidCall.note',
  },
  market_day: {
    title: 'hudChrome.calendar.events.marketDay.title',
    note: 'hudChrome.calendar.events.marketDay.note',
  },
  fiesta_night: {
    title: 'hudChrome.calendar.events.fiestaNight.title',
    note: 'hudChrome.calendar.events.fiestaNight.note',
  },
  arena_clash: {
    title: 'hudChrome.calendar.events.arenaClash.title',
    note: 'hudChrome.calendar.events.arenaClash.note',
  },
  fishing_derby: {
    title: 'hudChrome.calendar.events.fishingDerby.title',
    note: 'hudChrome.calendar.events.fishingDerby.note',
  },
  delve_day: {
    title: 'hudChrome.calendar.events.delveDay.title',
    note: 'hudChrome.calendar.events.delveDay.note',
  },
  moongate_communion: {
    title: 'hudChrome.calendar.events.moongateCommunion.title',
    note: 'hudChrome.calendar.events.moongateCommunion.note',
  },
};

export interface CalendarWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  showError(text: string): void;
}

export class CalendarWindow {
  private opened = false;
  private year = 1970;
  private month = 0;
  private selectedIso: string | null = null;
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;

  constructor(private readonly deps: CalendarWindowDeps) {}

  get isOpen(): boolean {
    return this.opened;
  }

  private todayIso(): string {
    // UI wall clock (painter side only; the core takes it as input).
    return new Date().toISOString().slice(0, 10);
  }

  open(): void {
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    this.opened = true;
    const today = monthOfIso(this.todayIso());
    this.year = today.year;
    this.month = today.month;
    this.selectedIso = this.todayIso();
    this.lastSig = '';
    this.render();
    this.deps.root().style.display = 'flex';
    audio.bagOpen();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.deps.root().style.display = 'none';
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  /** Guild calendar command outcome relayed by the HUD (handleEvents). */
  onCalendarResult(code: string): void {
    if (!this.opened) return;
    if (code === 'created') {
      const title = this.deps.root().querySelector<HTMLInputElement>('#cal-ev-title');
      const note = this.deps.root().querySelector<HTMLInputElement>('#cal-ev-note');
      if (title) title.value = '';
      if (note) note.value = '';
    }
    this.lastSig = '';
  }

  // Slow-band refresh: repaint when the guild-event mirror changes.
  refreshIfChanged(): void {
    if (!this.opened) return;
    const guild = this.deps.world().socialInfo?.guild ?? null;
    const sig = JSON.stringify([this.year, this.month, this.selectedIso, guild?.events ?? []]);
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.render();
  }

  private guildEvents(): GuildEventInfo[] {
    return this.deps.world().socialInfo?.guild?.events ?? [];
  }

  private monthTitle(): string {
    return formatDateTime(new Date(Date.UTC(this.year, this.month, 1)), {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  private weekdayHeaders(): string[] {
    // 1970-06-01 was a Monday; render seven consecutive days for Mon..Sun.
    const out: string[] = [];
    for (let i = 0; i < 7; i++) {
      out.push(
        formatDateTime(new Date(Date.UTC(1970, 5, 1 + i)), {
          weekday: 'short',
          timeZone: 'UTC',
        }),
      );
    }
    return out;
  }

  render(): void {
    const el = this.deps.root();
    // The shared frame owns the titlebar + close (built cold on first open,
    // reused after); this repaints only the scrollable body (month nav + grid +
    // day pane) so the month/day navigation keeps its full-rebuild behavior.
    const { body } = ensureWindowFrame(el, CALENDAR_FRAME, { onClose: () => this.close() });
    const view = buildCalendarMonth({
      year: this.year,
      month: this.month,
      todayIso: this.todayIso(),
      guildEvents: this.guildEvents(),
    });
    const nav =
      `<div class="cal-nav">` +
      `<button type="button" class="cal-nav-btn" data-cal-nav="-1" aria-label="${esc(t('hudChrome.calendar.prevMonth'))}">${svgIcon('prev')}</button>` +
      `<span class="cal-month-title">${esc(this.monthTitle())}</span>` +
      `<button type="button" class="cal-nav-btn" data-cal-nav="1" aria-label="${esc(t('hudChrome.calendar.nextMonth'))}">${svgIcon('next')}</button>` +
      `</div>`;
    const heads = this.weekdayHeaders()
      .map((h) => `<span class="cal-weekday">${esc(h)}</span>`)
      .join('');
    const cells = view.cells
      .map((cell) => {
        const marks =
          (cell.systemIds.length > 0 ? '<span class="cal-dot system"></span>' : '') +
          (cell.guildEvents.length > 0 ? '<span class="cal-dot guild"></span>' : '');
        const cls = [
          'cal-cell',
          cell.inMonth ? '' : 'out',
          cell.isToday ? 'today' : '',
          cell.iso === this.selectedIso ? 'sel' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          `<button type="button" class="${cls}" data-cal-day="${cell.iso}" aria-pressed="${cell.iso === this.selectedIso ? 'true' : 'false'}" aria-label="${esc(
            t('hudChrome.calendar.dayAria', {
              date: formatDateTime(new Date(`${cell.iso}T00:00:00Z`), {
                dateStyle: 'long',
                timeZone: 'UTC',
              }),
              count: formatNumber(cell.systemIds.length + cell.guildEvents.length, {
                maximumFractionDigits: 0,
              }),
            }),
          )}">` +
          `<span class="cal-daynum">${formatNumber(cell.day, { maximumFractionDigits: 0 })}</span>` +
          `<span class="cal-marks">${marks}</span>` +
          `</button>`
        );
      })
      .join('');
    body.innerHTML =
      nav +
      `<div class="cal-grid" role="grid">${heads}${cells}</div>` +
      `<div class="cal-day-pane" id="cal-day-pane"></div>`;
    body.querySelectorAll<HTMLButtonElement>('[data-cal-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = shiftMonth(this.year, this.month, Number(btn.dataset.calNav));
        this.year = next.year;
        this.month = next.month;
        this.lastSig = '';
        audio.click();
        this.render();
        (el.querySelector(`[data-cal-nav="${btn.dataset.calNav}"]`) as HTMLElement | null)?.focus();
      });
    });
    body.querySelectorAll<HTMLButtonElement>('[data-cal-day]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedIso = btn.dataset.calDay ?? null;
        this.lastSig = '';
        audio.click();
        this.render();
        (el.querySelector(`[data-cal-day="${this.selectedIso}"]`) as HTMLElement | null)?.focus();
      });
    });
    this.renderDayPane(view.cells);
  }

  private renderDayPane(cells: CalendarCell[]): void {
    const pane = this.deps.root().querySelector<HTMLElement>('#cal-day-pane');
    if (!pane) return;
    const cell = cells.find((c) => c.iso === this.selectedIso) ?? null;
    if (!cell) {
      pane.innerHTML = '';
      return;
    }
    const guild = this.deps.world().socialInfo?.guild ?? null;
    const manage = canManageGuildEvents(guild?.rank);
    const dayLabel = formatDateTime(new Date(`${cell.iso}T00:00:00Z`), {
      dateStyle: 'full',
      timeZone: 'UTC',
    });
    const rows: string[] = [];
    for (const id of cell.systemIds) {
      const keys = SYSTEM_EVENT_TEXT[id];
      if (!keys) continue;
      rows.push(
        `<div class="cal-event system"><span class="cal-dot system"></span>` +
          `<span class="cal-event-text"><span class="cal-event-title">${esc(t(keys.title))}</span>` +
          `<span class="cal-event-note">${esc(t(keys.note))}</span></span></div>`,
      );
    }
    for (const ev of cell.guildEvents) {
      const when =
        ev.hour === null
          ? t('hudChrome.calendar.allDay')
          : formatDateTime(new Date(Date.UTC(1970, 0, 1, ev.hour)), {
              hour: 'numeric',
              minute: '2-digit',
              timeZone: 'UTC',
            });
      rows.push(
        `<div class="cal-event guild" data-cal-event="${ev.id}"><span class="cal-dot guild"></span>` +
          `<span class="cal-event-text"><span class="cal-event-title">${esc(ev.title)} <span class="cal-event-when">${esc(when)}</span></span>` +
          (ev.note ? `<span class="cal-event-note">${esc(ev.note)}</span>` : '') +
          (ev.createdBy
            ? `<span class="cal-event-by">${esc(t('hudChrome.calendar.bookedBy', { name: ev.createdBy }))}</span>`
            : '') +
          `</span>` +
          (manage
            ? `<button type="button" class="cal-event-del" data-cal-del="${ev.id}" aria-label="${esc(t('hudChrome.calendar.deleteAria', { title: ev.title }))}">${svgIcon('close')}</button>`
            : '') +
          `</div>`,
      );
    }
    const empty =
      rows.length === 0
        ? `<div class="cal-empty">${esc(t('hudChrome.calendar.noEvents'))}</div>`
        : '';
    const form =
      manage && !cell.isPast
        ? `<div class="cal-form">` +
          `<span class="cal-form-title">${esc(t('hudChrome.calendar.bookTitle'))}</span>` +
          `<input id="cal-ev-title" type="text" maxlength="48" placeholder="${esc(t('hudChrome.calendar.titlePlaceholder'))}" aria-label="${esc(t('hudChrome.calendar.titlePlaceholder'))}">` +
          `<input id="cal-ev-note" type="text" maxlength="160" placeholder="${esc(t('hudChrome.calendar.notePlaceholder'))}" aria-label="${esc(t('hudChrome.calendar.notePlaceholder'))}">` +
          `<div class="cal-form-row"><label for="cal-ev-hour">${esc(t('hudChrome.calendar.hourLabel'))}</label>` +
          `<input id="cal-ev-hour" type="number" min="0" max="23" placeholder="${esc(t('hudChrome.calendar.hourAllDay'))}">` +
          `<button type="button" class="cal-add-btn" id="cal-ev-add">${esc(t('hudChrome.calendar.addButton'))}</button></div>` +
          `</div>`
        : guild === null
          ? `<div class="cal-empty">${esc(t('hudChrome.calendar.guildOnlyNote'))}</div>`
          : '';
    pane.innerHTML = `<div class="cal-day-title">${esc(dayLabel)}</div>${rows.join('')}${empty}${form}`;
    pane.querySelectorAll<HTMLButtonElement>('[data-cal-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.deps.world().guildEventRemove(Number(btn.dataset.calDel));
        audio.click();
      });
    });
    pane.querySelector('#cal-ev-add')?.addEventListener('click', () => {
      const title = pane.querySelector<HTMLInputElement>('#cal-ev-title')?.value.trim() ?? '';
      const note = pane.querySelector<HTMLInputElement>('#cal-ev-note')?.value.trim() ?? '';
      const hourRaw = pane.querySelector<HTMLInputElement>('#cal-ev-hour')?.value ?? '';
      const hour = hourRaw === '' ? null : Math.max(0, Math.min(23, parseInt(hourRaw, 10) || 0));
      if (!title || !cell.iso) {
        this.deps.showError(t('hudChrome.calendar.result.badInput'));
        return;
      }
      this.deps.world().guildEventCreate(cell.iso, hour, title, note);
      audio.click();
    });
  }
}
