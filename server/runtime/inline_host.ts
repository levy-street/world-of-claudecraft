import type { RuntimeHost, RuntimeJoin, RuntimeTransfer } from './contract';

export interface InlineRuntimeAdapter<Input, Message, Transfer = Input> {
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  join(request: RuntimeJoin<Input>): void | Promise<void>;
  prepareTransfer(request: RuntimeTransfer<Transfer>): void | Promise<void>;
  commitTransfer(characterId: string, routeEpoch: number): void | Promise<void>;
  abortTransfer(characterId: string, routeEpoch: number): void | Promise<void>;
  leave(characterId: string, routeEpoch: number): void | Promise<void>;
  handle(characterId: string, routeEpoch: number, message: Message): void;
}

export class InlineRuntimeHost<Input = unknown, Message = unknown, Transfer = Input>
  implements RuntimeHost<Input, Message, Transfer>
{
  constructor(
    readonly runtimeKey: string,
    private readonly adapter: InlineRuntimeAdapter<Input, Message, Transfer>,
  ) {}

  start(): void | Promise<void> {
    return this.adapter.start();
  }

  stop(): void | Promise<void> {
    return this.adapter.stop();
  }

  join(request: RuntimeJoin<Input>): void | Promise<void> {
    return this.adapter.join(request);
  }

  prepareTransfer(request: RuntimeTransfer<Transfer>): void | Promise<void> {
    return this.adapter.prepareTransfer(request);
  }

  commitTransfer(characterId: string, routeEpoch: number): void | Promise<void> {
    return this.adapter.commitTransfer(characterId, routeEpoch);
  }

  abortTransfer(characterId: string, routeEpoch: number): void | Promise<void> {
    return this.adapter.abortTransfer(characterId, routeEpoch);
  }

  leave(characterId: string, routeEpoch: number): void | Promise<void> {
    return this.adapter.leave(characterId, routeEpoch);
  }

  handle(characterId: string, routeEpoch: number, message: Message): void {
    this.adapter.handle(characterId, routeEpoch, message);
  }
}
