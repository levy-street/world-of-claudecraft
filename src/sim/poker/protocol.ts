import type { PokerAction, PokerViewerSnapshot } from './engine';

export interface PokerTableSummary {
  tableId: string;
  watcherCount: number;
  seatedCount: number;
  inHand: boolean;
  openSeats: number[];
}

export interface PokerClientSnapshot extends PokerViewerSnapshot {
  revision: number;
  viewerSeat: number | null;
  watching: boolean;
  turnDeadlineMs: number | null;
}

export type PokerErrorCode =
  | 'busy'
  | 'disabled'
  | 'invalid_action'
  | 'participation_suspended'
  | 'rebuy_not_allowed'
  | 'seat_conflict'
  | 'stale_action'
  | 'table_not_found'
  | 'watch_conflict';

const POKER_ERROR_CODES = new Set<PokerErrorCode>([
  'busy',
  'disabled',
  'invalid_action',
  'participation_suspended',
  'rebuy_not_allowed',
  'seat_conflict',
  'stale_action',
  'table_not_found',
  'watch_conflict',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function isPokerErrorCode(value: unknown): value is PokerErrorCode {
  return typeof value === 'string' && POKER_ERROR_CODES.has(value as PokerErrorCode);
}

export function isPokerTableSummary(value: unknown): value is PokerTableSummary {
  if (!isRecord(value) || typeof value.tableId !== 'string') return false;
  if (!/^[a-z0-9-]{1,64}$/.test(value.tableId)) return false;
  if (!isNonNegativeInteger(value.watcherCount) || !isNonNegativeInteger(value.seatedCount)) {
    return false;
  }
  if (value.seatedCount > 6 || typeof value.inHand !== 'boolean') return false;
  return (
    Array.isArray(value.openSeats) &&
    value.openSeats.length <= 6 &&
    value.openSeats.every((seat) => isNonNegativeInteger(seat) && seat < 6) &&
    new Set(value.openSeats).size === value.openSeats.length
  );
}

export function isPokerClientSnapshot(value: unknown): value is PokerClientSnapshot {
  if (!isRecord(value) || !isRecord(value.config)) return false;
  const seatCount = value.config.numSeats;
  if (!Number.isSafeInteger(seatCount) || (seatCount as number) < 2 || (seatCount as number) > 6) {
    return false;
  }
  if (!Array.isArray(value.seats) || value.seats.length !== seatCount) return false;
  if (!Array.isArray(value.communityCards) || value.communityCards.length > 5) return false;
  if (!Array.isArray(value.pots) || value.pots.length > 6) return false;
  if (
    !isNonNegativeInteger(value.handNumber) ||
    !isNonNegativeInteger(value.actionSequence) ||
    !isNonNegativeInteger(value.revision) ||
    typeof value.watching !== 'boolean'
  ) {
    return false;
  }
  if (
    value.viewerSeat !== null &&
    (!isNonNegativeInteger(value.viewerSeat) || value.viewerSeat >= seatCount)
  ) {
    return false;
  }
  if (value.turnDeadlineMs !== null && !isNonNegativeInteger(value.turnDeadlineMs)) return false;
  return value.seats.every(
    (seat) =>
      seat === null ||
      (isRecord(seat) &&
        isNonNegativeInteger(seat.seat) &&
        seat.seat < seatCount &&
        isNonNegativeInteger(seat.playerId) &&
        isNonNegativeInteger(seat.stack) &&
        (seat.holeCards === null || (Array.isArray(seat.holeCards) && seat.holeCards.length <= 2))),
  );
}

export interface PokerClientState {
  connected: boolean;
  enabled: boolean;
  tables: PokerTableSummary[];
  snapshot: PokerClientSnapshot | null;
  names: Record<number, string>;
  error: PokerErrorCode | null;
}

export interface PokerClientPort {
  pokerState(): PokerClientState;
  subscribe(listener: () => void): () => void;
  requestTables(): void;
  join(tableId: string, seatIndex: number): void;
  watch(tableId: string): void;
  stopWatching(tableId: string): void;
  rebuy(tableId: string): void;
  leave(tableId: string): void;
  act(action: PokerAction): void;
}
