import type { RuntimeJoin } from './contract';

export type RuntimeWorkerInbound<Input = unknown, Message = unknown, Transfer = unknown> =
  | { type: 'start'; runtimeKey: string }
  | { type: 'stop' }
  | { type: 'join'; request: RuntimeJoin<Input> }
  | { type: 'leave'; characterId: string; routeEpoch: number }
  | { type: 'message'; characterId: string; routeEpoch: number; message: Message }
  | {
      type: 'prepare-transfer';
      characterId: string;
      sourceEpoch: number;
      transfer: Transfer;
    }
  | { type: 'commit-transfer'; characterId: string; routeEpoch: number }
  | { type: 'abort-transfer'; characterId: string; sourceEpoch: number };

export type RuntimeWorkerOutbound =
  | { type: 'ready'; runtimeKey: string }
  | { type: 'stopped'; runtimeKey: string }
  | {
      type: 'outbound';
      characterId: string;
      routeEpoch: number;
      payload: string | Uint8Array;
    }
  | { type: 'transfer-prepared'; characterId: string; sourceEpoch: number }
  | { type: 'fault'; runtimeKey: string; message: string };
