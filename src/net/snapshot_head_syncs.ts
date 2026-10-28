// The per-snapshot world syncs the ClientWorld runs before it applies the
// frame's entity records: the ground telegraph decode, the ferry clock and
// its berth gates, the in-dungeon gate collision mirror, and the trash
// engine's temporary combat walls, and the Stealth Rework footprints and
// shimmers. One call
// site in online.ts (the monolith ratchet), one module per sync.

import type { Entity } from '../sim/types';
import { syncClientCombatWalls } from './combat_wall_wire';
import { syncClientDungeonGates } from './dungeon_gate_wire';
import {
  applyGroundTelegraphSnapshot,
  type GroundTelegraphSnapshotSink,
} from './ground_telegraph_wire';
import { applyStealthFootprintSnapshot, type StealthFootprintSink } from './stealth_footprint_wire';
import { applyStealthShimmerSnapshot, type StealthShimmerSink } from './stealth_shimmer_wire';
import { applyTransportSnapshot, type TransportWireWorld } from './transport_wire';

export type SnapshotHeadWorld = GroundTelegraphSnapshotSink &
  TransportWireWorld &
  StealthFootprintSink &
  StealthShimmerSink & { entities: ReadonlyMap<number, Entity> };

export function applySnapshotHeadSyncs(
  world: SnapshotHeadWorld,
  snap: Readonly<Record<string, unknown>>,
): void {
  applyGroundTelegraphSnapshot(world, snap);
  applyTransportSnapshot(world, snap); // the ferry clock + its berth gates
  syncClientDungeonGates(world);
  syncClientCombatWalls(world); // the trash engine's temporary combat walls
  applyStealthFootprintSnapshot(world, snap); // enemy stealthers' lagged prints
  applyStealthShimmerSnapshot(world, snap); // enemy stealthers just past the cone
}
