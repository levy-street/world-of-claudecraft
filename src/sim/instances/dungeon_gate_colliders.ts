// Gate colliders: one box across each gate's passage, tagged with its gate id
// so the per-slot view (dungeon_gate_state.ts) can drop it while the gate is
// open in that slot. Instance-local, seated on the field's ground. Pure leaf.

import type { Collider } from '../colliders';
import type { DungeonGateDef } from '../types';
import { authoredFieldHeight } from './authored_field/height';
import type { AuthoredFieldDef } from './authored_field/types';

/** Half thickness of a gate's blocking box along its passage. */
export const GATE_HALF_DEPTH = 0.9;
/** Sight top above the ground: a closed gate blocks spells and pulls. */
const GATE_SIGHT_HEIGHT = 9;

export function dungeonGateColliders(
  gates: readonly DungeonGateDef[],
  field: AuthoredFieldDef | null,
  floorY: number,
): Collider[] {
  return gates.map(
    (g): Collider => ({
      type: 'obb',
      x: g.x,
      z: g.z,
      hw: g.hw,
      hd: GATE_HALF_DEPTH,
      rot: g.rot,
      cameraTopY: floorY + (field ? authoredFieldHeight(field, g.x, g.z) : 0) + GATE_SIGHT_HEIGHT,
      gate: g.id,
    }),
  );
}
