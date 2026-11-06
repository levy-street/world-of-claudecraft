// Pure core for the guild Events section of the Social window's Guild tab
// (menu consolidation step 4, which removed the Event Calendar window). Guild
// events are the calendar's real half: officers book a dated event through
// IWorld.guildEventCreate and every member sees it. This core decides which
// events are listed, in what order, and whether the viewer may book or remove
// them; the Social window paints the result.

import type { GuildEventInfo, GuildInfo } from '../world_api';
import { viewerGuildCan } from './guild_ranks_view';

/** A YYYY-MM-DD day string, compared as text (it sorts chronologically). */
export type IsoDay = string;

/** The UTC day of an epoch-millisecond instant, as the server stores days. */
export function isoDayOf(nowMs: number): IsoDay {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Today and later, soonest first; all-day events lead their day. */
export function upcomingGuildEvents(
  events: readonly GuildEventInfo[] | null | undefined,
  today: IsoDay,
): GuildEventInfo[] {
  return (events ?? [])
    .filter((ev) => ev.day >= today)
    .sort((a, b) => {
      if (a.day !== b.day) return a.day < b.day ? -1 : 1;
      return (a.hour ?? -1) - (b.hour ?? -1) || a.id - b.id;
    });
}

/** Whether the viewer's rank may book and remove events (UX only: the server
 *  enforces the real gate). */
export function canManageGuildEvents(
  guild: Pick<GuildInfo, 'rank' | 'ranks'> | null | undefined,
): boolean {
  return viewerGuildCan(guild, 'events');
}

export type GuildEventDraft =
  | {
      readonly ok: true;
      readonly day: IsoDay;
      readonly hour: number | null;
      readonly title: string;
      readonly note: string;
    }
  | { readonly ok: false };

/** Validate the booking form's raw values: a title and a day that is today
 *  or later are required; a blank hour means all day, any other hour is
 *  clamped to 0..23. */
export function parseGuildEventDraft(
  raw: { day: string; hour: string; title: string; note: string },
  today: IsoDay,
): GuildEventDraft {
  const title = raw.title.trim();
  const day = raw.day.trim();
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day < today) return { ok: false };
  const hourText = raw.hour.trim();
  const parsed = Number.parseInt(hourText, 10);
  const hour = hourText === '' || Number.isNaN(parsed) ? null : Math.max(0, Math.min(23, parsed));
  return { ok: true, day, hour, title, note: raw.note.trim() };
}
