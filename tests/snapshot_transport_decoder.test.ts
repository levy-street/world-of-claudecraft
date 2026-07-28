import { describe, expect, it, vi } from 'vitest';
import { encodeSnapshotBinary } from '../server/snapshot_binary';
import {
  type SnapshotDecodeWorkerLike,
  SnapshotTransportDecoder,
} from '../src/net/snapshot_transport';

function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('SnapshotTransportDecoder', () => {
  it('preserves exact order when a later JSON frame resolves first', () => {
    let workerMessage: (event: MessageEvent<any>) => void = () => undefined;
    const worker: SnapshotDecodeWorkerLike = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      set onmessage(value) {
        if (value) workerMessage = value;
      },
      get onmessage() {
        return workerMessage;
      },
      onerror: null,
    };
    const applied: unknown[] = [];
    const decoder = new SnapshotTransportDecoder(
      { apply: (value) => applied.push(value), downgrade: vi.fn() },
      () => worker,
    );
    const generation = decoder.beginSocket();
    decoder.receiveBinary(buffer(encodeSnapshotBinary({ t: 'snap', ents: [], tick: 1 })));
    decoder.receiveString(JSON.stringify({ t: 'event', name: 'after' }));
    expect(applied).toEqual([]);

    workerMessage({
      data: { generation, sequence: 0, snapshot: { t: 'snap', ents: [], tick: 1 } },
    } as MessageEvent);
    expect(applied).toEqual([
      { t: 'snap', ents: [], tick: 1 },
      { t: 'event', name: 'after' },
    ]);
  });

  it('decodes synchronously when worker construction fails', () => {
    const applied: unknown[] = [];
    const decoder = new SnapshotTransportDecoder(
      { apply: (value) => applied.push(value), downgrade: vi.fn() },
      () => {
        throw new Error('worker blocked');
      },
    );
    decoder.beginSocket();
    decoder.receiveBinary(buffer(encodeSnapshotBinary({ t: 'snap', ents: [], tick: 4 })));
    expect(applied).toEqual([{ t: 'snap', ents: [], tick: 4 }]);
  });

  it('requests one downgrade for malformed frames in a socket generation', () => {
    const downgrade = vi.fn();
    const decoder = new SnapshotTransportDecoder({ apply: vi.fn(), downgrade }, null);
    decoder.beginSocket();
    decoder.receiveBinary(new ArrayBuffer(1));
    decoder.receiveBinary(new ArrayBuffer(1));
    expect(downgrade).toHaveBeenCalledOnce();
  });

  it('requests one downgrade when the decode worker faults', () => {
    let workerError: ((event: ErrorEvent) => void) | null = null;
    const worker: SnapshotDecodeWorkerLike = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      onmessage: null,
      set onerror(value) {
        workerError = value;
      },
      get onerror() {
        return workerError;
      },
    };
    const downgrade = vi.fn();
    const decoder = new SnapshotTransportDecoder({ apply: vi.fn(), downgrade }, () => worker);
    decoder.beginSocket();

    worker.onerror?.({ message: 'worker crashed' } as ErrorEvent);
    worker.onerror?.({ message: 'worker crashed again' } as ErrorEvent);

    expect(downgrade).toHaveBeenCalledOnce();
    expect(downgrade).toHaveBeenCalledWith('worker crashed');
  });
});
