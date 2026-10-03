// The per-snapshot world syncs the ClientWorld runs before it applies the
// frame's entity records: the ground telegraph decode, the ferry clock and
// its berth gates, and the in-dungeon gate collision mirror. One call site in
// online.ts (the monolith ratchet), one module per sync.

import type { Entity } from '../sim/types';
import { syncClientDungeonGates } from './dungeon_gate_wire';
import {
  applyGroundTelegraphSnapshot,
  type GroundTelegraphSnapshotSink,
} from './ground_telegraph_wire';
import { applyTransportSnapshot, type TransportWireWorld } from './transport_wire';

export type SnapshotHeadWorld = GroundTelegraphSnapshotSink &
  TransportWireWorld & { entities: ReadonlyMap<number, Entity> };

export function applySnapshotHeadSyncs(
  world: SnapshotHeadWorld,
  snap: Readonly<Record<string, unknown>>,
): void {
  applyGroundTelegraphSnapshot(world, snap);
  applyTransportSnapshot(world, snap); // the ferry clock + its berth gates
  syncClientDungeonGates(world);
}
