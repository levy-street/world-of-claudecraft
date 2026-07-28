import {
  DEFAULT_SNAPSHOT_BINARY_LIMITS,
  decodeSnapshotBinary as decodeCore,
  encodeSnapshotBinary as encodeCore,
  SNAPSHOT_BINARY_WIRE_VERSION,
  type SnapshotBinaryLimits,
  type SnapshotObject,
} from './snapshot_binary_core';

const QUANTIZED_ENTITY_FIELDS = ['x', 'y', 'z', 'f'] as const;

function quantizeRecord(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const result = { ...source };
  for (const key of QUANTIZED_ENTITY_FIELDS) {
    const coordinate = source[key];
    if (typeof coordinate === 'number' && Number.isFinite(coordinate)) {
      result[key] = Math.round(coordinate * 100);
    }
  }
  return result;
}

function dequantizeRecord(value: unknown): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  for (const key of QUANTIZED_ENTITY_FIELDS) {
    const coordinate = record[key];
    if (typeof coordinate === 'number') record[key] = coordinate / 100;
  }
}

export function encodeSnapshotBinary(
  snapshot: SnapshotObject,
  limits?: Partial<SnapshotBinaryLimits>,
): Uint8Array {
  const quantized: SnapshotObject = {
    ...snapshot,
    ents: Array.isArray(snapshot.ents)
      ? snapshot.ents.map((entity) => quantizeRecord(entity))
      : snapshot.ents,
  };
  if (Object.hasOwn(snapshot, 'self')) quantized.self = quantizeRecord(snapshot.self);
  return encodeCore(quantized, limits);
}

export function decodeSnapshotBinary(
  input: ArrayBuffer | ArrayBufferView,
  limits?: Partial<SnapshotBinaryLimits>,
): SnapshotObject {
  const snapshot = decodeCore(input, limits);
  dequantizeRecord(snapshot.self);
  if (Array.isArray(snapshot.ents)) {
    for (const entity of snapshot.ents) dequantizeRecord(entity);
  }
  return snapshot;
}

export {
  DEFAULT_SNAPSHOT_BINARY_LIMITS,
  SNAPSHOT_BINARY_WIRE_VERSION,
  type SnapshotBinaryLimits,
  type SnapshotObject,
};
