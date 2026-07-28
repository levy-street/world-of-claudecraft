import type { RuntimeHost, RuntimeJoin, RuntimeOutbound, RuntimeTransfer } from './contract';
import type { RuntimeWorkerInbound, RuntimeWorkerOutbound } from './worker_protocol';

export interface RuntimeWorkerLike {
  postMessage(message: RuntimeWorkerInbound, transfer?: readonly ArrayBuffer[]): void;
  terminate(): Promise<number> | undefined;
  on(event: 'message', listener: (message: RuntimeWorkerOutbound) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

type WorkerAck = Exclude<RuntimeWorkerOutbound, { type: 'outbound' | 'fault' }>;

interface PendingAck {
  expectedType: WorkerAck['type'];
  matches(message: WorkerAck): boolean;
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

type WorkerState = 'new' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'faulted';

export class WorkerRuntimeHost<Input = unknown, Message = unknown, Transfer = Input>
  implements RuntimeHost<Input, Message, Transfer>
{
  private state: WorkerState = 'new';
  private sequence = 0;
  private readonly pending = new Map<string, PendingAck>();
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private terminationPromise: Promise<void> | null = null;

  constructor(
    readonly runtimeKey: string,
    private readonly worker: RuntimeWorkerLike,
    private readonly onOutbound: (message: RuntimeOutbound) => void,
    private readonly onError: (error: Error) => void,
    private readonly operationTimeoutMs = 5_000,
  ) {
    if (!Number.isFinite(operationTimeoutMs) || operationTimeoutMs <= 0) {
      throw new RangeError('worker operation timeout must be finite and positive');
    }
    worker.on('message', (message) => this.handleWorkerMessage(message));
    worker.on('error', (error) => this.fail(error));
  }

  start(): Promise<void> {
    if (this.state === 'ready') return Promise.resolve();
    if (this.state === 'starting' && this.startPromise) return this.startPromise;
    if (this.state !== 'new') {
      return Promise.reject(new Error(`runtime worker cannot start from ${this.state}`));
    }
    this.state = 'starting';
    const requestId = this.nextRequestId();
    this.startPromise = this.request(
      { type: 'start', requestId, runtimeKey: this.runtimeKey },
      requestId,
      'ready',
      () => true,
    )
      .then(() => {
        this.state = 'ready';
      })
      .catch((error) => {
        if (this.state !== 'faulted') this.fail(error);
        throw error;
      });
    return this.startPromise;
  }

  join(request: RuntimeJoin<Input>): Promise<void> {
    this.requireReady();
    const requestId = this.nextRequestId();
    return this.request(
      { type: 'join', requestId, request },
      requestId,
      'joined',
      (message) =>
        message.type === 'joined' &&
        message.characterId === request.characterId &&
        message.routeEpoch === request.routeEpoch,
    );
  }

  prepareTransfer(request: RuntimeTransfer<Transfer>): Promise<void> {
    this.requireReady();
    const requestId = this.nextRequestId();
    return this.request(
      { type: 'prepare-transfer', requestId, request },
      requestId,
      'transfer-prepared',
      (message) =>
        message.type === 'transfer-prepared' &&
        message.characterId === request.characterId &&
        message.sourceEpoch === request.sourceEpoch &&
        message.targetEpoch === request.targetEpoch,
    );
  }

  commitTransfer(characterId: string, routeEpoch: number): Promise<void> {
    this.requireReady();
    const requestId = this.nextRequestId();
    return this.request(
      { type: 'commit-transfer', requestId, characterId, routeEpoch },
      requestId,
      'transfer-committed',
      (message) =>
        message.type === 'transfer-committed' &&
        message.characterId === characterId &&
        message.routeEpoch === routeEpoch,
    );
  }

  abortTransfer(characterId: string, routeEpoch: number): Promise<void> {
    this.requireReady();
    const requestId = this.nextRequestId();
    return this.request(
      { type: 'abort-transfer', requestId, characterId, routeEpoch },
      requestId,
      'transfer-aborted',
      (message) =>
        message.type === 'transfer-aborted' &&
        message.characterId === characterId &&
        message.routeEpoch === routeEpoch,
    );
  }

  leave(characterId: string, routeEpoch: number): Promise<void> {
    this.requireReady();
    const requestId = this.nextRequestId();
    return this.request(
      { type: 'leave', requestId, characterId, routeEpoch },
      requestId,
      'left',
      (message) =>
        message.type === 'left' &&
        message.characterId === characterId &&
        message.routeEpoch === routeEpoch,
    );
  }

  handle(characterId: string, routeEpoch: number, message: Message): void {
    this.requireReady();
    this.worker.postMessage({ type: 'message', characterId, routeEpoch, message });
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (this.state === 'stopped' || this.state === 'faulted') return this.terminateOnce();
    if (this.state === 'new') {
      this.state = 'stopped';
      return this.terminateOnce();
    }
    if (this.state !== 'ready') {
      return Promise.reject(new Error(`runtime worker cannot stop from ${this.state}`));
    }
    this.state = 'stopping';
    const requestId = this.nextRequestId();
    this.stopPromise = this.request({ type: 'stop', requestId }, requestId, 'stopped', () => true)
      .then(() => {
        this.state = 'stopped';
      })
      .finally(() => this.terminateOnce());
    return this.stopPromise;
  }

  private request(
    message: RuntimeWorkerInbound<Input, Message, Transfer>,
    requestId: string,
    expectedType: WorkerAck['type'],
    matches: (message: WorkerAck) => boolean,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error(`runtime worker ${expectedType} timed out`));
      }, this.operationTimeoutMs);
      this.pending.set(requestId, { expectedType, matches, resolve, reject, timer });
      try {
        this.worker.postMessage(message);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleWorkerMessage(message: RuntimeWorkerOutbound): void {
    if (message.type === 'outbound') {
      try {
        this.onOutbound({
          characterId: message.characterId,
          runtimeKey: this.runtimeKey,
          routeEpoch: message.routeEpoch,
          payload: message.payload,
        });
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }
    if (message.type === 'fault') {
      this.fail(new Error(`runtime worker fault: ${message.message}`));
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    if (
      message.runtimeKey !== this.runtimeKey ||
      message.type !== pending.expectedType ||
      !pending.matches(message)
    ) {
      this.fail(new Error(`runtime worker acknowledgement mismatch: ${message.type}`));
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    pending.resolve();
  }

  private fail(error: Error): void {
    if (this.state === 'faulted' || this.state === 'stopped') return;
    this.state = 'faulted';
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    try {
      this.onError(error);
    } catch {
      // Error reporting cannot be allowed to skip worker termination.
    }
    void this.terminateOnce().catch(() => undefined);
  }

  private terminateOnce(): Promise<void> {
    if (!this.terminationPromise) {
      this.terminationPromise = (async () => {
        await this.worker.terminate();
      })();
    }
    return this.terminationPromise;
  }

  private nextRequestId(): string {
    this.sequence++;
    return `${this.runtimeKey}:${this.sequence}`;
  }

  private requireReady(): void {
    if (this.state !== 'ready') throw new Error('runtime worker is not ready');
  }
}
