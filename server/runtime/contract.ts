export type RuntimeKind = 'overworld' | 'dungeon' | 'delve' | 'arena';
export type RuntimeMode = 'inline' | 'instance-workers';

export interface RuntimeKey {
  realm: string;
  kind: RuntimeKind;
  claimId: string;
}

export interface RuntimeRoute {
  characterId: string;
  runtimeKey: string;
  routeEpoch: number;
}

export interface RuntimeOutbound {
  characterId: string;
  runtimeKey: string;
  routeEpoch: number;
  payload: string | Uint8Array;
}

export interface RuntimeJoin<Input = unknown> {
  characterId: string;
  routeEpoch: number;
  input: Input;
}

export interface RuntimeTransfer<Transfer = unknown> {
  characterId: string;
  sourceEpoch: number;
  targetEpoch: number;
  transfer: Transfer;
}

export interface RuntimeHost<Input = unknown, Message = unknown, Transfer = Input> {
  readonly runtimeKey: string;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  join(request: RuntimeJoin<Input>): void | Promise<void>;
  prepareTransfer(request: RuntimeTransfer<Transfer>): void | Promise<void>;
  commitTransfer(characterId: string, routeEpoch: number): void | Promise<void>;
  abortTransfer(characterId: string, routeEpoch: number): void | Promise<void>;
  leave(characterId: string, routeEpoch: number): void | Promise<void>;
  // The hot input path is intentionally one-way. Inline dispatch and
  // worker.postMessage both complete synchronously at this boundary.
  handle(characterId: string, routeEpoch: number, message: Message): void;
}
