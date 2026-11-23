// Group-link jump (a chat [LFM: ...] link, src/ui/hud/chat/group_chat_link.ts):
// whether the Groups window can land on one listing id. Pure and DOM-free so a
// Vitest imports it directly; the window painter (dungeon_finder_window.ts)
// only applies the answer: spotlight the card, or say the group is gone.
//
// The board is the realm-wide `dfb` snapshot every client already mirrors, so
// no new world read is needed: a listing that is not on it has closed, filled,
// or fallen off the bounded board. My own listing counts as listed (it paints
// in the sidebar card rather than the browse column).

export type BoardJumpTarget = 'listed' | 'gone' | 'unsynced';

export function boardJumpTarget(
  board: readonly { id: number }[] | null,
  myListing: { id: number } | null | undefined,
  listingId: number,
): BoardJumpTarget {
  if (myListing?.id === listingId) return 'listed';
  if (!board) return 'unsynced';
  return board.some((listing) => listing.id === listingId) ? 'listed' : 'gone';
}
