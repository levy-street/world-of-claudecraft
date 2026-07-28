import { decodeSnapshotBinary, type SnapshotObject } from './snapshot_binary';
import { SnapshotDecodeQueue, type SnapshotDecodeToken } from './snapshot_decode_queue_core';

// The initial renderer prewarm may legitimately occupy most of its 12-second
// budget while the socket continues receiving snapshots at 20 Hz. Keep the
// strict-order worker queue bounded, but large enough to span that startup
// window plus scheduling jitter instead of forcing every busy client to JSON.
export const SNAPSHOT_DECODE_MAX_PENDING = 256;

interface WorkerDecodeRequest extends SnapshotDecodeToken {
  bytes: ArrayBuffer;
}

interface WorkerDecodeSuccess extends SnapshotDecodeToken {
  snapshot: SnapshotObject;
  decodeMs: number;
  byteLength: number;
}

interface WorkerDecodeFailure extends SnapshotDecodeToken {
  error: string;
}

export interface SnapshotDecodeWorkerLike {
  postMessage(message: WorkerDecodeRequest, transfer: readonly ArrayBuffer[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerDecodeSuccess | WorkerDecodeFailure>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface SnapshotTransportHooks {
  apply(message: unknown, meta: SnapshotTransportFrameMeta): void;
  downgrade(reason: string): void;
}

export interface SnapshotTransportFrameMeta {
  approxBytes: number;
  decodeMs: number;
  binary: boolean;
}

interface DecodedFrame {
  message: unknown;
  meta: SnapshotTransportFrameMeta;
}

export class SnapshotTransportDecoder {
  private readonly queue: SnapshotDecodeQueue<DecodedFrame>;
  private worker: SnapshotDecodeWorkerLike | null = null;
  private generation = 0;
  private downgradedGeneration = -1;

  constructor(
    private readonly hooks: SnapshotTransportHooks,
    workerFactory: (() => SnapshotDecodeWorkerLike) | null,
    maxPending = SNAPSHOT_DECODE_MAX_PENDING,
  ) {
    this.queue = new SnapshotDecodeQueue(maxPending);
    if (workerFactory) {
      try {
        this.worker = workerFactory();
        this.worker.onmessage = (event) => this.onWorkerMessage(event.data);
        this.worker.onerror = (event) => {
          this.failGeneration(event.message || 'snapshot worker failed');
        };
      } catch {
        this.worker = null;
      }
    }
  }

  beginSocket(): number {
    this.generation = this.queue.beginGeneration();
    this.downgradedGeneration = -1;
    return this.generation;
  }

  get workerAvailable(): boolean {
    return this.worker !== null;
  }

  receiveString(raw: string): void {
    const token = this.enqueue();
    if (!token) return;
    let value: unknown;
    const started = performance.now();
    try {
      value = JSON.parse(raw);
    } catch {
      this.failGeneration('invalid JSON frame');
      return;
    }
    this.queue.resolve(token, {
      message: value,
      meta: {
        approxBytes: raw.length,
        decodeMs: performance.now() - started,
        binary: false,
      },
    });
    this.drain();
  }

  receiveBinary(bytes: ArrayBuffer): void {
    const token = this.enqueue();
    if (!token) return;
    if (this.worker) {
      this.worker.postMessage({ ...token, bytes }, [bytes]);
      return;
    }
    const started = performance.now();
    try {
      this.queue.resolve(token, {
        message: decodeSnapshotBinary(bytes),
        meta: {
          approxBytes: bytes.byteLength,
          decodeMs: performance.now() - started,
          binary: true,
        },
      });
      this.drain();
    } catch (error) {
      this.failGeneration(error instanceof Error ? error.message : 'snapshot decode failed');
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private enqueue(): SnapshotDecodeToken | null {
    if (this.downgradedGeneration === this.generation) return null;
    try {
      return this.queue.enqueue();
    } catch (error) {
      this.failGeneration(error instanceof Error ? error.message : 'snapshot queue overflow');
      return null;
    }
  }

  private onWorkerMessage(message: WorkerDecodeSuccess | WorkerDecodeFailure): void {
    if ('error' in message) {
      if (message.generation === this.generation) this.failGeneration(message.error);
      return;
    }
    this.queue.resolve(message, {
      message: message.snapshot,
      meta: {
        approxBytes: message.byteLength,
        decodeMs: message.decodeMs,
        binary: true,
      },
    });
    this.drain();
  }

  private drain(): void {
    this.queue.drain((decoded) => this.hooks.apply(decoded.value.message, decoded.value.meta));
  }

  private failGeneration(reason: string): void {
    if (this.downgradedGeneration === this.generation) return;
    this.downgradedGeneration = this.generation;
    this.hooks.downgrade(reason);
  }
}
