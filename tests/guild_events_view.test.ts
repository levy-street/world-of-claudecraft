// The guild Events section's pure core (menu consolidation step 4: guild
// event booking moved from the removed Event Calendar window into the Social
// window's Guild tab).
import { describe, expect, it } from 'vitest';
import {
  canManageGuildEvents,
  isoDayOf,
  parseGuildEventDraft,
  upcomingGuildEvents,
} from '../src/ui/guild_events_view';
import type { GuildEventInfo } from '../src/world_api';

const ev = (id: number, day: string, hour: number | null): GuildEventInfo => ({
  id,
  day,
  hour,
  title: `e${id}`,
  note: '',
  createdBy: 'Aelric',
});

describe('upcomingGuildEvents', () => {
  it('lists today and later only, soonest first, all-day events leading their day', () => {
    const events = [
      ev(1, '2026-11-06', 20),
      ev(2, '2026-11-04', 12),
      ev(3, '2026-11-06', null),
      ev(4, '2026-11-05', 9),
      ev(5, '2026-11-05', 9),
    ];
    expect(upcomingGuildEvents(events, '2026-11-05').map((e) => e.id)).toEqual([4, 5, 3, 1]);
    expect(upcomingGuildEvents(null, '2026-11-05')).toEqual([]);
  });

  it('reads the UTC day the server stores', () => {
    expect(isoDayOf(Date.UTC(2026, 10, 5, 23, 59))).toBe('2026-11-05');
  });
});

describe('canManageGuildEvents', () => {
  it('follows the viewer rank events permission and is false guildless', () => {
    expect(canManageGuildEvents(null)).toBe(false);
    expect(canManageGuildEvents({ rank: 'leader', ranks: undefined } as never)).toBe(true);
    expect(canManageGuildEvents({ rank: 'officer', ranks: undefined } as never)).toBe(true);
    expect(canManageGuildEvents({ rank: 'member', ranks: undefined } as never)).toBe(false);
  });
});

describe('parseGuildEventDraft', () => {
  const today = '2026-11-05';
  it('needs a title and a day from today on; a blank hour is all day', () => {
    expect(
      parseGuildEventDraft({ day: today, hour: '', title: ' Raid ', note: ' bring food ' }, today),
    ).toEqual({
      ok: true,
      day: today,
      hour: null,
      title: 'Raid',
      note: 'bring food',
    });
    expect(parseGuildEventDraft({ day: today, hour: '', title: '  ', note: '' }, today).ok).toBe(
      false,
    );
    expect(
      parseGuildEventDraft({ day: '2026-11-04', hour: '', title: 'x', note: '' }, today).ok,
    ).toBe(false);
    expect(parseGuildEventDraft({ day: 'soon', hour: '', title: 'x', note: '' }, today).ok).toBe(
      false,
    );
  });

  it('clamps the hour to 0..23', () => {
    const draft = (hour: string) =>
      parseGuildEventDraft({ day: today, hour, title: 'x', note: '' }, today);
    expect(draft('30')).toMatchObject({ ok: true, hour: 23 });
    expect(draft('-4')).toMatchObject({ ok: true, hour: 0 });
    expect(draft('8')).toMatchObject({ ok: true, hour: 8 });
  });
});
