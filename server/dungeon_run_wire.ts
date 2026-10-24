// The self record's `dgrun` key: the group dungeon run a player stands in
// (IWorld.dungeonRun, the HUD's dungeon objectives tracker), emitted through
// selfWireJson's delta-eliding `maybeSerialized` (server/game.ts). The client
// decode is src/net/dungeon_run_wire.ts; the key is registered in
// ALL_DELTA_KEYS (tests/snapshots.test.ts).
//
// Cost on the per-tick self path: outside a dungeon the read is one x-band
// test and the wire value is the shared 'null' literal. Inside one it is a
// handful of roster reads per boss (src/sim/instances/dungeon_run.ts), bounded
// by the dungeon's own boss list and never by anything that grows with the
// realm. The sim hands every member of a claim the SAME frozen view until a
// boss falls, so the JSON is built once per change per claim, never per
// session and never per tick; the WeakMap lets a freed claim's view go.

import { dungeonRunForPlayer } from '../src/sim/instances/dungeon_run';
import type { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { DungeonRunView } from '../src/world_api/dungeons';

const serialized = new WeakMap<DungeonRunView, string>();

/** The `dgrun` wire value for `pid`, already serialized ('null' outside a run). */
export function dungeonRunWireJson(ctx: SimContext, pid: number): string {
  const view = dungeonRunForPlayer(ctx, pid);
  if (!view) return 'null';
  let json = serialized.get(view);
  if (json === undefined) {
    json = JSON.stringify(view);
    serialized.set(view, json);
  }
  return json;
}

/** The run readouts of the self record, in their wire order: the delve run
 *  (`drun`), the group dungeon run (`dgrun`), the delve companion
 *  (`dcompanion`) and the delve marks (`dmarks`). The emission moved here from
 *  selfWireJson (server/game.ts) under the monolith ratchet; the keys and their
 *  order are unchanged (ALL_DELTA_KEYS, tests/snapshots.test.ts). */
export function appendRunSelfWire(
  sim: Pick<Sim, 'ctx' | 'delveRunWire' | 'delveCompanionWire' | 'delveMarksFor'>,
  pid: number,
  maybe: (key: string, value: unknown) => void,
  maybeSerialized: (key: string, serialized: string) => void,
): void {
  maybe('drun', sim.delveRunWire(pid));
  maybeSerialized('dgrun', dungeonRunWireJson(sim.ctx, pid));
  maybe('dcompanion', sim.delveCompanionWire(pid));
  maybe('dmarks', sim.delveMarksFor(pid));
}
