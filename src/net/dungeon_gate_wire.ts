// The online client's half of in-dungeon gates (src/sim/instances/
// dungeon_gates.ts is the authority). Nothing new rides the wire: each gate is
// a ground-object entity whose template id carries its state, mirrored like
// any other entity. From the gate entities it holds, the ClientWorld rebuilds
// each slot's open set and publishes it to the shared collision view
// (dungeon_gate_state.ts), so the local movement prediction walls where the
// server walls. Run once per snapshot, from the gate entities of the previous
// one (a single snapshot of lag, the same as every other mirrored state).
//
// DOM-free and socket-free.

import { DUNGEONS, dungeonAt, instanceOrigin, instanceSlotForZ } from '../sim/data';
import { setOpenDungeonGates } from '../sim/instances/dungeon_gate_state';
import { dungeonGateAt, dungeonGateStateOf } from '../sim/instances/dungeon_gates';
import type { Entity } from '../sim/types';

export interface DungeonGateWireWorld {
  entities: ReadonlyMap<number, Entity>;
  readonly player: Entity | undefined;
}

/** Publish every mirrored gate's state to the collision view. */
export function syncClientDungeonGates(world: DungeonGateWireWorld): void {
  const self = world.player;
  if (!self) return;
  const dungeon = dungeonAt(self.pos.x);
  if (!dungeon?.gates || dungeon.gates.length === 0) return;
  const open = new Map<string, { ox: number; oz: number; ids: string[] }>();
  for (const e of world.entities.values()) {
    if (e.kind !== 'object' || !e.dungeonId) continue;
    const state = dungeonGateStateOf(e.templateId);
    if (state === null) continue;
    const def = DUNGEONS[e.dungeonId];
    if (!def) continue;
    const o = instanceOrigin(def.index, instanceSlotForZ(e.pos.z));
    const gate = dungeonGateAt(e.dungeonId, e.pos.x - o.x, e.pos.z - o.z);
    if (!gate) continue;
    const key = `${o.x}|${o.z}`;
    let slot = open.get(key);
    if (!slot) {
      slot = { ox: o.x, oz: o.z, ids: [] };
      open.set(key, slot);
    }
    if (state === 'open') slot.ids.push(gate.id);
  }
  for (const slot of open.values()) setOpenDungeonGates(slot.ox, slot.oz, slot.ids);
}
