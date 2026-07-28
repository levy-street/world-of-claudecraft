import { SNAPSHOT_BINARY_WIRE_VERSION } from '../src/protocol/snapshot_binary_core';

export type SnapshotTransport = 'json' | 'binary-v1';

export function selectSnapshotTransport(
  offeredVersion: unknown,
  binaryEnabled: boolean,
): SnapshotTransport {
  return binaryEnabled && offeredVersion === SNAPSHOT_BINARY_WIRE_VERSION ? 'binary-v1' : 'json';
}
