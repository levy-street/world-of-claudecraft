/// <reference lib="webworker" />

import { decodeSnapshotBinary } from './snapshot_binary';

interface DecodeRequest {
  generation: number;
  sequence: number;
  bytes: ArrayBuffer;
}

interface DecodeSuccess {
  generation: number;
  sequence: number;
  snapshot: ReturnType<typeof decodeSnapshotBinary>;
  decodeMs: number;
  byteLength: number;
}

interface DecodeFailure {
  generation: number;
  sequence: number;
  error: string;
}

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<DecodeRequest>) => {
  const { generation, sequence, bytes } = event.data;
  const started = performance.now();
  try {
    const response: DecodeSuccess = {
      generation,
      sequence,
      snapshot: decodeSnapshotBinary(bytes),
      decodeMs: performance.now() - started,
      byteLength: bytes.byteLength,
    };
    self.postMessage(response);
  } catch (error) {
    const response: DecodeFailure = {
      generation,
      sequence,
      error: error instanceof Error ? error.message : 'snapshot decode failed',
    };
    self.postMessage(response);
  }
};
