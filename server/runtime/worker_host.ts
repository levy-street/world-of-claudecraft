import type { RuntimeHost, RuntimeJoin } from './contract';
import type { RuntimeWorkerInbound, RuntimeWorkerOutbound } from './worker_protocol';

export interface RuntimeWorkerLike {
  postMessage(message: RuntimeWorkerInbound, transfer?: readonly ArrayBuffer[]): void;
  terminate(): void | Promise<number>;
  on(event: 'message', listener: (message: RuntimeWorkerOutbound) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

export class WorkerRuntimeHost<Input = unknown, Message = unknown>
  implements RuntimeHost<Input, Message>
{
  private started = false;

  constructor(
    readonly runtimeKey: string,
    private readonly worker: RuntimeWorkerLike,
    onMessage: (message: RuntimeWorkerOutbound) => void,
    onError: (error: Error) => void,
  ) {
    worker.on('message', onMessage);
    worker.on('error', onError);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.worker.postMessage({ type: 'start', runtimeKey: this.runtimeKey });
  }

  async stop(): Promise<void> {
    if (this.started) this.worker.postMessage({ type: 'stop' });
    this.started = false;
    await this.worker.terminate();
  }

  join(request: RuntimeJoin<Input>): void {
    this.requireStarted();
    this.worker.postMessage({ type: 'join', request });
  }

  leave(characterId: string, routeEpoch: number): void {
    this.requireStarted();
    this.worker.postMessage({ type: 'leave', characterId, routeEpoch });
  }

  handle(characterId: string, routeEpoch: number, message: Message): void {
    this.requireStarted();
    this.worker.postMessage({ type: 'message', characterId, routeEpoch, message });
  }

  private requireStarted(): void {
    if (!this.started) throw new Error('runtime worker has not started');
  }
}
