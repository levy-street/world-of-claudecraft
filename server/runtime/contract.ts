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
  routeEpoch: number;
  payload: string | Uint8Array;
}

export interface RuntimeJoin<Input = unknown> {
  characterId: string;
  routeEpoch: number;
  input: Input;
}

export interface RuntimeHost<Input = unknown, Message = unknown> {
  readonly runtimeKey: string;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  join(request: RuntimeJoin<Input>): void | Promise<void>;
  leave(characterId: string, routeEpoch: number): void | Promise<void>;
  handle(characterId: string, routeEpoch: number, message: Message): void | Promise<void>;
}
