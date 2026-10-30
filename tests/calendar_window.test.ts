// @vitest-environment happy-dom

// The calendar window's slow-band refresh (src/ui/calendar_window.ts): an open
// month stays live while the data it shows moves, and a repeated identical poll
// does nothing. The signature used to cover only the visible month, the
// selected day and the guild-event mirror, so three things went stale on an
// open window: an officer promotion or demotion (the booking form and the
// delete buttons), joining or leaving a guild (the guild-only note), and the
// midnight rollover (the today ring and the past-day booking gate). The pure
// month grid is covered by tests/calendar_view.test.ts; this file drives the
// painter.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarWindow } from '../src/ui/calendar_window';
import { t } from '../src/ui/i18n';
import type { GuildEventInfo, IWorld } from '../src/world_api';

interface FakeGuild {
  name: string;
  rank: string;
  members: unknown[];
  events: GuildEventInfo[];
}

function rig(rank = 'leader'): {
  win: CalendarWindow;
  root: HTMLElement;
  social: { guild: FakeGuild | null };
} {
  const root = document.createElement('div');
  root.id = 'calendar-window';
  root.style.display = 'none';
  document.body.appendChild(root);
  const social: { guild: FakeGuild | null } = {
    guild: { name: 'Ashen Vow', rank, members: [], events: [] },
  };
  const world = {
    get socialInfo() {
      return social;
    },
    guildEventCreate: () => {},
    guildEventRemove: () => {},
  } as unknown as IWorld;
  const noop = (): void => {};
  const win = new CalendarWindow({
    root: () => root,
    world: () => world,
    closeOthers: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    showError: noop,
  });
  win.open();
  return { win, root, social };
}

const form = (root: HTMLElement) => root.querySelector('#cal-ev-title');
const paneText = (root: HTMLElement) => root.querySelector('#cal-day-pane')?.textContent ?? '';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-10T12:00:00Z'));
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('CalendarWindow.refreshIfChanged', () => {
  it('does nothing on a repeated identical poll (no rebuild after open)', () => {
    const { win, root } = rig();
    const grid = root.querySelector('.cal-grid');
    expect(grid).not.toBeNull();
    win.refreshIfChanged();
    win.refreshIfChanged();
    expect(root.querySelector('.cal-grid'), 'an unchanged poll rebuilt the window').toBe(grid);
  });

  it('a day click re-latches, so the next poll does not rebuild a second time', () => {
    const { win, root } = rig();
    root.querySelector<HTMLButtonElement>('[data-cal-day="2026-07-11"]')?.click();
    const grid = root.querySelector('.cal-grid');
    win.refreshIfChanged();
    expect(root.querySelector('.cal-grid')).toBe(grid);
  });

  it('shows a guild event the mirror gains while open', () => {
    const { win, root, social } = rig();
    expect(root.querySelector('[data-cal-event]')).toBeNull();
    social.guild?.events.push({
      id: 7,
      day: '2026-07-10',
      hour: 20,
      title: 'Crypt night',
      note: '',
      createdBy: 'Lead',
    });
    win.refreshIfChanged();
    expect(root.querySelector('[data-cal-event="7"]')).not.toBeNull();
  });

  it('drops the booking form and delete buttons on a demotion, and restores them on a promotion', () => {
    const { win, root, social } = rig('leader');
    social.guild?.events.push({
      id: 3,
      day: '2026-07-10',
      hour: null,
      title: 'Raid',
      note: '',
      createdBy: 'Lead',
    });
    win.refreshIfChanged();
    expect(form(root)).not.toBeNull();
    expect(root.querySelector('[data-cal-del="3"]')).not.toBeNull();

    if (social.guild) social.guild.rank = 'member';
    win.refreshIfChanged();
    expect(form(root), 'a demoted member still sees the booking form').toBeNull();
    expect(root.querySelector('[data-cal-del="3"]')).toBeNull();

    if (social.guild) social.guild.rank = 'leader';
    win.refreshIfChanged();
    expect(form(root), 'a promoted officer must get the booking form').not.toBeNull();
  });

  it('shows the guild-only note after leaving the guild', () => {
    const { win, root, social } = rig('member');
    const note = t('hudChrome.calendar.guildOnlyNote');
    expect(paneText(root)).not.toContain(note);
    social.guild = null;
    win.refreshIfChanged();
    expect(paneText(root), 'leaving the guild left the pane stale').toContain(note);
  });

  it('moves the today ring across midnight', () => {
    const { win, root } = rig();
    expect(root.querySelector('.cal-cell.today')?.getAttribute('data-cal-day')).toBe('2026-07-10');
    vi.setSystemTime(new Date('2026-07-11T00:00:05Z'));
    win.refreshIfChanged();
    expect(root.querySelector('.cal-cell.today')?.getAttribute('data-cal-day')).toBe('2026-07-11');
  });

  it('keeps a half-typed booking and its focus across a poll-driven rebuild', () => {
    const { win, root, social } = rig('leader');
    const title = form(root) as HTMLInputElement;
    const note = root.querySelector<HTMLInputElement>('#cal-ev-note') as HTMLInputElement;
    const hour = root.querySelector<HTMLInputElement>('#cal-ev-hour') as HTMLInputElement;
    title.value = 'Molten Core';
    note.value = 'Bring fire resist';
    hour.value = '20';
    note.focus();
    expect(document.activeElement).toBe(note);

    // Another officer books an event: the mirror moves and the window rebuilds.
    social.guild?.events.push({
      id: 9,
      day: '2026-07-10',
      hour: 18,
      title: 'Warmup',
      note: '',
      createdBy: 'Officer',
    });
    win.refreshIfChanged();
    const rebuilt = root.querySelector<HTMLInputElement>('#cal-ev-title');
    expect(rebuilt, 'the poll must really rebuild the form').not.toBe(title);
    expect(root.querySelector('[data-cal-event="9"]')).not.toBeNull();
    expect(rebuilt?.value).toBe('Molten Core');
    expect(root.querySelector<HTMLInputElement>('#cal-ev-note')?.value).toBe('Bring fire resist');
    expect(root.querySelector<HTMLInputElement>('#cal-ev-hour')?.value).toBe('20');
    expect(document.activeElement).toBe(root.querySelector('#cal-ev-note'));

    // And the restore is not undone by a second rebuild on the next poll.
    const kept = root.querySelector('#cal-ev-title');
    win.refreshIfChanged();
    expect(root.querySelector('#cal-ev-title')).toBe(kept);
  });
});
