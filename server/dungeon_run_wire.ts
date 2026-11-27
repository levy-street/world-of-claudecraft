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

import { type BossKillTally, EMPTY_BOSS_KILLS } from '../src/sim/boss_kill_tally';
import { dungeonRunForPlayer } from '../src/sim/instances/dungeon_run';
import { raidRunForPlayer } from '../src/sim/instances/raid_run';
import type { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { DungeonRunView, RaidRunView } from '../src/world_api/dungeons';

const serialized = new WeakMap<DungeonRunView | RaidRunView, string>();

function serializedRun(view: DungeonRunView | RaidRunView | null): string {
  if (!view) return 'null';
  let json = serialized.get(view);
  if (json === undefined) {
    json = JSON.stringify(view);
    serialized.set(view, json);
  }
  return json;
}

/** The `dgrun` wire value for `pid`, already serialized ('null' outside a run). */
export function dungeonRunWireJson(ctx: SimContext, pid: number): string {
  return serializedRun(dungeonRunForPlayer(ctx, pid));
}

/** The `rdrun` wire value for `pid` (IWorld.raidRun, the Adventure Journal's
 *  landing read), already serialized ('null' outside a tracked raid). The same
 *  cost shape as `dgrun`: the sim hands every member of a claim one frozen view
 *  until a boss falls or a pull starts or ends, so the JSON is built once per
 *  change per claim. */
export function raidRunWireJson(ctx: SimContext, pid: number): string {
  return serializedRun(raidRunForPlayer(ctx, pid));
}

const serializedTallies = new WeakMap<BossKillTally, string>();

/** The `bkills` wire value for `pid` (IWorld.bossKills, the Adventure Journal's
 *  "Your kills"), already serialized ('{}' for a missing player or an empty
 *  tally). The sim replaces a character's frozen tally on every kill and never
 *  mutates it, so the JSON is built once per kill per character, never per
 *  tick or per session, and the delta gate drops it from every other tick. */
export function bossKillsWireJson(ctx: SimContext, pid: number): string {
  const tally = ctx.players.get(pid)?.bossKills ?? EMPTY_BOSS_KILLS;
  let json = serializedTallies.get(tally);
  if (json === undefined) {
    json = JSON.stringify(tally);
    serializedTallies.set(tally, json);
  }
  return json;
}

/** The run readouts of the self record, in their wire order: the delve run
 *  (`drun`), the group dungeon run (`dgrun`), the raid run (`rdrun`), the boss
 *  kill tally (`bkills`), the delve companion (`dcompanion`) and the delve marks
 *  (`dmarks`). The emission moved here from selfWireJson (server/game.ts) under
 *  the monolith ratchet; every key is in ALL_DELTA_KEYS (tests/snapshots.test.ts). */
export function appendRunSelfWire(
  sim: Pick<Sim, 'ctx' | 'delveRunWire' | 'delveCompanionWire' | 'delveMarksFor'>,
  pid: number,
  maybe: (key: string, value: unknown) => void,
  maybeSerialized: (key: string, serialized: string) => void,
): void {
  maybe('drun', sim.delveRunWire(pid));
  maybeSerialized('dgrun', dungeonRunWireJson(sim.ctx, pid));
  maybeSerialized('rdrun', raidRunWireJson(sim.ctx, pid));
  maybeSerialized('bkills', bossKillsWireJson(sim.ctx, pid));
  maybe('dcompanion', sim.delveCompanionWire(pid));
  maybe('dmarks', sim.delveMarksFor(pid));
}
