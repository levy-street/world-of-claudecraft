// Group-link jump (a chat [LFM: ...] link, src/ui/hud/chat/group_chat_link.ts):
// whether the Groups window can land on one listing. Pure and DOM-free so a
// Vitest imports it directly; the window painter (dungeon_finder_window.ts)
// only applies the answer: spotlight the card, or say why it cannot.
//
// The board is the realm-wide `dfb` snapshot every client already mirrors, so
// no new world read is needed: a listing that is not on it has closed, filled,
// or fallen off the bounded board. My own listing counts as listed (it paints
// in the sidebar card rather than the browse column).
//
// The token carries the activity it was posted for, and the label the reader
// clicked was built from it. A listing number alone is not trusted: a typed
// token, a stale link from before a server restart (listing ids restart at 1),
// or any other number reused by a different group would otherwise spotlight a
// group the label never named. The jump lands only when the listing is still
// for the SAME content; a leader's in-place difficulty switch keeps it.

import { finderActivity } from '../sim/content/dungeon_finder';

export type BoardJumpTarget = 'listed' | 'gone' | 'unsynced';

interface JumpListing {
  id: number;
  activityId: string;
}

function sameContent(a: string, b: string): boolean {
  if (a === b) return true;
  const left = finderActivity(a);
  const right = finderActivity(b);
  return Boolean(left && right && left.dungeonId === right.dungeonId);
}

export function boardJumpTarget(
  board: readonly JumpListing[] | null,
  myListing: JumpListing | null | undefined,
  listingId: number,
  activityId: string,
): BoardJumpTarget {
  const mine = myListing?.id === listingId ? myListing : undefined;
  if (mine) return sameContent(mine.activityId, activityId) ? 'listed' : 'gone';
  if (!board) return 'unsynced';
  const row = board.find((listing) => listing.id === listingId);
  return row && sameContent(row.activityId, activityId) ? 'listed' : 'gone';
}
