// Pure lifecycle core for the Thornhollow Fields kill feed (DOM-free, Node-tested):
// the short top-right stack of "who felled whom" lines a match shows for a
// few seconds per death. The painter (battleground_kill_feed_painter.ts) owns
// the DOM and the localized line text; this core owns the list rules, so the
// cap and expiry math are directly unit-testable.

export interface BgKillFeedLine {
  killerName: string | null; // null: unattributed (no enemy credit)
  victimName: string;
  killerTeam: number | null;
  victimTeam: number;
  expiresAt: number; // seconds on the caller's clock
}

export const BG_KILL_FEED_TTL = 9; // seconds a line stays up
export const BG_KILL_FEED_MAX = 5; // the feed never stacks past this; oldest drops first

/** Append a kill, stamping its expiry; trims the oldest lines past the cap. */
export function pushBgKillLine(
  lines: BgKillFeedLine[],
  kill: Omit<BgKillFeedLine, 'expiresAt'>,
  now: number,
): BgKillFeedLine[] {
  const next = [...lines, { ...kill, expiresAt: now + BG_KILL_FEED_TTL }];
  return next.length > BG_KILL_FEED_MAX ? next.slice(next.length - BG_KILL_FEED_MAX) : next;
}

/** Drop expired lines; returns the SAME array when nothing expired, so the
 *  per-frame caller can elide its repaint on reference equality. */
export function pruneBgKillLines(lines: BgKillFeedLine[], now: number): BgKillFeedLine[] {
  return lines.some((l) => l.expiresAt <= now) ? lines.filter((l) => l.expiresAt > now) : lines;
}
