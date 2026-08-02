import type { PokerAction } from '../src/sim/poker/engine';
import type { PokerErrorCode } from '../src/sim/poker/protocol';
import type { PokerService } from './poker_service';

export interface PokerWireSession {
  accountId: number;
  characterId: number;
  name: string;
  linkdead: boolean;
  left: boolean;
}

export type PokerWireMessage = Record<string, unknown> & {
  action?: unknown;
  actionSequence?: unknown;
  handNumber?: unknown;
  seatIndex?: unknown;
  tableId?: unknown;
};

type PokerWireService = Pick<
  PokerService,
  | 'act'
  | 'buyIn'
  | 'initialize'
  | 'leaveTable'
  | 'listTables'
  | 'rebuy'
  | 'snapshot'
  | 'stopWatching'
  | 'tableForCharacter'
  | 'viewerIds'
  | 'watchTable'
>;

export interface PokerWireDeps<Session extends PokerWireSession> {
  enabled: () => boolean;
  participationAllowed?: (accountId: number) => boolean;
  send: (session: Session, message: unknown) => void;
  service: PokerWireService;
  sessionForCharacter: (characterId: number) => Session | null;
}

class PokerWireError extends Error {
  constructor(readonly code: PokerErrorCode) {
    super(code);
  }
}

function tableIdFrom(message: PokerWireMessage): string {
  if (typeof message.tableId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(message.tableId)) {
    throw new PokerWireError('table_not_found');
  }
  return message.tableId;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function actionFrom(message: PokerWireMessage): PokerAction {
  if (
    !Number.isSafeInteger(message.handNumber) ||
    (message.handNumber as number) <= 0 ||
    !nonNegativeSafeInteger(message.actionSequence) ||
    !message.action ||
    typeof message.action !== 'object' ||
    Array.isArray(message.action)
  ) {
    throw new PokerWireError('invalid_action');
  }
  const action = message.action as Record<string, unknown>;
  if (action.type === 'fold' || action.type === 'check' || action.type === 'call') {
    return { type: action.type };
  }
  if (action.type === 'all-in') return { type: 'all-in' };
  if (
    (action.type === 'bet' || action.type === 'raise') &&
    Number.isSafeInteger(action.to) &&
    (action.to as number) > 0
  ) {
    return { type: action.type, to: action.to as number };
  }
  throw new PokerWireError('invalid_action');
}

export function pokerErrorCode(error: unknown): PokerErrorCode {
  if (error instanceof PokerWireError) return error.code;
  const message = String(error instanceof Error ? error.message : error);
  if (/disabled/i.test(message)) return 'disabled';
  if (/not found/i.test(message)) return 'table_not_found';
  if (/busy|concurrently/i.test(message)) return 'busy';
  if (/stale/i.test(message)) return 'stale_action';
  if (/watch/i.test(message)) return 'watch_conflict';
  if (/rebuy/i.test(message)) return 'rebuy_not_allowed';
  if (/seated|seat/i.test(message)) return 'seat_conflict';
  return 'invalid_action';
}

export function createPokerWireController<Session extends PokerWireSession>(
  deps: PokerWireDeps<Session>,
) {
  const busyCharacters = new Set<number>();

  async function request(session: Session, run: () => Promise<void>): Promise<void> {
    if (busyCharacters.has(session.characterId)) {
      deps.send(session, { t: 'poker_error', code: 'busy' });
      return;
    }
    busyCharacters.add(session.characterId);
    try {
      await run();
    } catch (error) {
      deps.send(session, { t: 'poker_error', code: pokerErrorCode(error) });
    } finally {
      busyCharacters.delete(session.characterId);
    }
  }

  function sendSnapshot(session: Session, tableId: string): void {
    const snapshot = deps.service.snapshot(tableId, session.characterId);
    const names = Object.fromEntries(
      snapshot.seats.flatMap((seat) => {
        if (!seat) return [];
        const name = deps.sessionForCharacter(seat.playerId)?.name;
        return name ? [[seat.playerId, name]] : [];
      }),
    );
    deps.send(session, { t: 'poker_snapshot', snapshot, names });
  }

  function requireParticipation(session: Session): void {
    if (deps.participationAllowed?.(session.accountId) === false) {
      throw new PokerWireError('participation_suspended');
    }
  }

  return {
    list(session: Session): Promise<void> {
      if (!deps.enabled()) {
        deps.send(session, { t: 'poker_tables', enabled: false, tables: [] });
        return Promise.resolve();
      }
      return request(session, async () => {
        deps.send(session, {
          t: 'poker_tables',
          enabled: true,
          tables: await deps.service.listTables(),
        });
      });
    },

    join(session: Session, message: PokerWireMessage): Promise<void> {
      return request(session, async () => {
        requireParticipation(session);
        const tableId = tableIdFrom(message);
        if (
          !Number.isSafeInteger(message.seatIndex) ||
          (message.seatIndex as number) < 0 ||
          (message.seatIndex as number) >= 6
        ) {
          throw new PokerWireError('seat_conflict');
        }
        await deps.service.buyIn({
          tableId,
          accountId: session.accountId,
          characterId: session.characterId,
          seatIndex: message.seatIndex as number,
        });
      });
    },

    rebuy(session: Session, message: PokerWireMessage): Promise<void> {
      return request(session, async () => {
        requireParticipation(session);
        await deps.service.rebuy({
          tableId: tableIdFrom(message),
          accountId: session.accountId,
          characterId: session.characterId,
        });
      });
    },

    leave(session: Session, message: PokerWireMessage): Promise<void> {
      return request(session, async () => {
        const tableId = tableIdFrom(message);
        await deps.service.leaveTable({ tableId, characterId: session.characterId });
        sendSnapshot(session, tableId);
      });
    },

    watch(session: Session, message: PokerWireMessage): Promise<void> {
      return request(session, async () => {
        const tableId = tableIdFrom(message);
        await deps.service.watchTable({ tableId, characterId: session.characterId });
        sendSnapshot(session, tableId);
      });
    },

    stopWatching(session: Session, message: PokerWireMessage): Promise<void> {
      return request(session, async () => {
        await deps.service.stopWatching({
          tableId: tableIdFrom(message),
          characterId: session.characterId,
        });
        const enabled = deps.enabled();
        deps.send(session, {
          t: 'poker_tables',
          enabled,
          tables: enabled ? await deps.service.listTables() : [],
        });
      });
    },

    action(session: Session, message: PokerWireMessage): Promise<void> {
      return request(session, async () => {
        requireParticipation(session);
        await deps.service.act({
          tableId: tableIdFrom(message),
          accountId: session.accountId,
          characterId: session.characterId,
          handNumber: message.handNumber as number,
          actionSequence: message.actionSequence as number,
          action: actionFrom(message),
        });
      });
    },

    broadcast(tableId: string, includeResult: boolean): void {
      if (!deps.enabled()) return;
      for (const characterId of deps.service.viewerIds(tableId)) {
        const session = deps.sessionForCharacter(characterId);
        if (!session || session.linkdead || session.left) continue;
        const snapshot = deps.service.snapshot(tableId, session.characterId);
        const names = Object.fromEntries(
          snapshot.seats.flatMap((seat) => {
            if (!seat) return [];
            const name = deps.sessionForCharacter(seat.playerId)?.name;
            return name ? [[seat.playerId, name]] : [];
          }),
        );
        deps.send(session, { t: 'poker_snapshot', snapshot, names });
        if (includeResult) {
          deps.send(session, { t: 'poker_result', tableId, result: snapshot.lastResult });
        }
      }
    },

    async resume(session: Session): Promise<void> {
      if (!deps.enabled()) {
        deps.send(session, { t: 'poker_tables', enabled: false, tables: [] });
        return;
      }
      await deps.service.initialize();
      const tableId = deps.service.tableForCharacter(session.characterId);
      if (tableId) sendSnapshot(session, tableId);
    },
  };
}

export type PokerWireController<Session extends PokerWireSession> = ReturnType<
  typeof createPokerWireController<Session>
>;
