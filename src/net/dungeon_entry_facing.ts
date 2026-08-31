// Synchronous input fencing for authoritative dungeon-entry snapshots. The
// exact sim generation proves this client observed the landing before its
// queued camera heading regains authority.

import { dungeonAt, isDungeonEntryTransition } from '../sim/data';

export interface DungeonEntrySnapshotFacingUpdate {
  entrySeq: number | null;
  inputFacing: number | null;
  entryAck: number | null;
  forceFacing: boolean;
}

export function dungeonEntrySnapshotFacing(
  currentEntrySeq: number | null,
  wireEntrySeq: unknown,
  fromX: number,
  toX: number,
  landedFacing: number,
  currentInputFacing: number | null,
): DungeonEntrySnapshotFacingUpdate {
  const hasWireEntrySeq = Number.isSafeInteger(wireEntrySeq) && (wireEntrySeq as number) >= 0;
  const entrySeq = hasWireEntrySeq ? (wireEntrySeq as number) : currentEntrySeq;
  const entryAck =
    dungeonAt(toX) !== null &&
    entrySeq !== null &&
    ((currentEntrySeq === null && entrySeq > 0) ||
      (currentEntrySeq !== null && entrySeq > currentEntrySeq))
      ? entrySeq
      : null;
  const forceFacing = entryAck !== null || isDungeonEntryTransition(fromX, toX);
  return {
    entrySeq,
    inputFacing: forceFacing ? landedFacing : currentInputFacing,
    entryAck,
    forceFacing,
  };
}
