import type { RuntimeHost, RuntimeJoin } from './contract';

export interface InlineRuntimeAdapter<Input, Message> {
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  join(request: RuntimeJoin<Input>): void | Promise<void>;
  leave(characterId: string, routeEpoch: number): void | Promise<void>;
  handle(characterId: string, routeEpoch: number, message: Message): void | Promise<void>;
}

export class InlineRuntimeHost<Input = unknown, Message = unknown>
  implements RuntimeHost<Input, Message>
{
  constructor(
    readonly runtimeKey: string,
    private readonly adapter: InlineRuntimeAdapter<Input, Message>,
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

  leave(characterId: string, routeEpoch: number): void | Promise<void> {
    return this.adapter.leave(characterId, routeEpoch);
  }

  handle(characterId: string, routeEpoch: number, message: Message): void | Promise<void> {
    return this.adapter.handle(characterId, routeEpoch, message);
  }
}
