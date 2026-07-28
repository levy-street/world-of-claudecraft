import type { RuntimeJoin, RuntimeTransfer } from './contract';

export type RuntimeWorkerInbound<Input = unknown, Message = unknown, Transfer = unknown> =
  | { type: 'start'; requestId: string; runtimeKey: string }
  | { type: 'stop'; requestId: string }
  | { type: 'join'; requestId: string; request: RuntimeJoin<Input> }
  | { type: 'leave'; requestId: string; characterId: string; routeEpoch: number }
  | { type: 'message'; characterId: string; routeEpoch: number; message: Message }
  | {
      type: 'prepare-transfer';
      requestId: string;
      request: RuntimeTransfer<Transfer>;
    }
  | { type: 'commit-transfer'; requestId: string; characterId: string; routeEpoch: number }
  | { type: 'abort-transfer'; requestId: string; characterId: string; routeEpoch: number };

export type RuntimeWorkerOutbound =
  | { type: 'ready'; requestId: string; runtimeKey: string }
  | { type: 'stopped'; requestId: string; runtimeKey: string }
  | {
      type: 'joined';
      requestId: string;
      runtimeKey: string;
      characterId: string;
      routeEpoch: number;
    }
  | {
      type: 'left';
      requestId: string;
      runtimeKey: string;
      characterId: string;
      routeEpoch: number;
    }
  | {
      type: 'outbound';
      characterId: string;
      routeEpoch: number;
      payload: string | Uint8Array;
    }
  | {
      type: 'transfer-prepared';
      requestId: string;
      runtimeKey: string;
      characterId: string;
      sourceEpoch: number;
      targetEpoch: number;
    }
  | {
      type: 'transfer-committed';
      requestId: string;
      runtimeKey: string;
      characterId: string;
      routeEpoch: number;
    }
  | {
      type: 'transfer-aborted';
      requestId: string;
      runtimeKey: string;
      characterId: string;
      routeEpoch: number;
    }
  | { type: 'fault'; requestId?: string; runtimeKey: string; message: string };
