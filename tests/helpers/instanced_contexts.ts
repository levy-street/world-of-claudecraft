// Putting a unit-test player INSIDE each instanced context, through that
// context's real entry flow.
//
// Written for the Materials Vault craft gate (src/sim/vault_craft_gate.ts),
// whose arms do NOT all read the same authority: battleground, arena and delve
// answer from a per-player membership registry, while dungeon, raid and rift
// answer from a position-keyed lookup over a live slot pool. A helper that only
// teleported a body into a band would exercise the geometry backstop six times
// and leave every membership arm unpinned, so each helper below runs the
// SHIPPED entry point and then asserts the authority the gate actually reads,
// throwing a named error when the flow silently declined. A placement that
// quietly failed would otherwise read as "open world" and turn a blocked-here
// assertion green for the wrong reason.
//
// Dependency-light on purpose: the sim entry points, the two position readers
// the gate itself uses, and nothing else. No DOM, no server, no fixtures.

import { DELVES } from '../../src/sim/data';
import { enterDungeon, instanceInfoAt, isInRaidInstance } from '../../src/sim/instances/dungeons';
import { riftInstanceAtPos } from '../../src/sim/rift/runs';
import type { RiftInstance } from '../../src/sim/rift/types';
import type { ArenaMatch, Sim } from '../../src/sim/sim';
import { startArenaMatch } from '../../src/sim/social/arena';
import { type BgMatch, bgResolveDesertion, startBgMatch } from '../../src/sim/social/battleground';
import type { DelveRun, Entity } from '../../src/sim/types';
import { placePlayerInOpenField } from './open_field';

/** A five-man dungeon with no attunement and no raid-group requirement: the
 *  cheapest live claim in the pool. */
export const TEST_DUNGEON_ID = 'hollow_crypt';
/** The raid-required wing (RAID_REQUIRED_DUNGEON_IDS, instances/dungeons.ts):
 *  entering it proves a real raid group, not a solo claim on a raid-allowed id. */
export const TEST_RAID_DUNGEON_ID = 'nythraxis_boss_arena';
/** instances/dungeons.ts canEnterNythraxisRaid gates the wing on this quest. */
export const RAID_ATTUNEMENT_QUEST = 'q_nythraxis_bound_guardian';
/** social/party.ts RAID_MIN, which is module-private: convertPartyToRaid
 *  refuses a smaller group. */
export const RAID_MIN_MEMBERS = 5;
/** Delve entry gates on the delve's own minLevel; rift mobs spawn at the base
 *  level passed to enterRift and RIFT_MIN_LEVEL is 20. */
export const TEST_DELVE_ID = 'collapsed_reliquary';
export const TEST_DELVE_TIER = 'normal';
export const RIFT_BASE_LEVEL = 20;

function entityOf(sim: Sim, pid: number): Entity {
  const e = sim.ctx.entities.get(pid);
  if (!e) throw new Error(`instanced_contexts: no entity for pid ${pid}`);
  return e;
}

function nameFor(sim: Sim, prefix: string): string {
  return `${prefix}${sim.ctx.players.size}`;
}

export interface DungeonPlacement {
  dungeonId: string;
  /** The live claim's slot, from the same instanceInfoAt read the gate makes. */
  slot: number;
}

/** Enter a five-man dungeon instance the ordinary way. `enterDungeon` claims a
 *  free slot and teleports the body inside, so the position-keyed authority
 *  (instanceInfoAt) is live on return. */
export function placeInDungeon(
  sim: Sim,
  pid: number = sim.playerId,
  dungeonId: string = TEST_DUNGEON_ID,
): DungeonPlacement {
  if (!enterDungeon(sim.ctx, dungeonId, pid)) {
    throw new Error(`instanced_contexts: enterDungeon(${dungeonId}) refused pid ${pid}`);
  }
  const info = instanceInfoAt(sim.ctx, entityOf(sim, pid).pos);
  if (!info || info.dungeonId !== dungeonId) {
    throw new Error(`instanced_contexts: pid ${pid} is not inside ${dungeonId} after entry`);
  }
  return { dungeonId, slot: info.slot };
}

export interface RaidPlacement {
  dungeonId: string;
  slot: number;
  /** Every pid in the raid group, the caller's first. Only the caller zones
   *  in; the fillers clear RAID_MIN and stay where they were. All of them are
   *  attuned, so a caller that wants a second body inside can zone one in with
   *  `enterDungeon` and needs no further setup. */
  raiders: number[];
}

/** Enter the raid wing through the real raid flow: attune, build a group of
 *  RAID_MIN, convert it to a raid, then zone in.
 *
 *  A raid instance is an ordinary slot carrying a RAID_ALLOWED dungeon id, so
 *  it shares the gate's dungeon arm; what makes this a distinct context is the
 *  raid-required wing, and `isInRaidInstance` is asserted here so the helper
 *  cannot degrade into a second five-man placement without saying so. */
export function placeInRaid(sim: Sim, pid: number = sim.playerId): RaidPlacement {
  const meta = sim.ctx.players.get(pid);
  if (!meta) throw new Error(`instanced_contexts: no meta for pid ${pid}`);
  meta.questsDone.add(RAID_ATTUNEMENT_QUEST);
  const raiders = [pid];
  while ((sim.partyOf(pid)?.members.length ?? 1) < RAID_MIN_MEMBERS) {
    const filler = sim.addPlayer('priest', nameFor(sim, 'RaidFill'));
    sim.partyInvite(filler, pid);
    sim.partyAccept(filler);
    // The wing's attunement gate reads each entering player's OWN meta, not
    // the party's, so every filler is attuned here: a caller zoning a second
    // body in would otherwise be refused for a reason unrelated to their test.
    sim.ctx.players.get(filler)?.questsDone.add(RAID_ATTUNEMENT_QUEST);
    raiders.push(filler);
  }
  sim.convertPartyToRaid(pid);
  if (!enterDungeon(sim.ctx, TEST_RAID_DUNGEON_ID, pid)) {
    throw new Error(`instanced_contexts: raid entry refused pid ${pid}`);
  }
  const pos = entityOf(sim, pid).pos;
  if (!isInRaidInstance(sim.ctx, pos)) {
    throw new Error(`instanced_contexts: pid ${pid} is not inside a raid instance after entry`);
  }
  const info = instanceInfoAt(sim.ctx, pos);
  if (!info) throw new Error(`instanced_contexts: raid claim missing for pid ${pid}`);
  return { dungeonId: TEST_RAID_DUNGEON_ID, slot: info.slot, raiders };
}

export interface DelvePlacement {
  run: DelveRun;
}

/** Start a delve run. `delveRunForPlayer` (the gate's delve authority) is BOTH
 *  key-matched and position-gated, so the body must stay where enterDelve put
 *  it: moving the player out of the run box makes the arm answer null. */
export function placeInDelve(
  sim: Sim,
  pid: number = sim.playerId,
  delveId: string = TEST_DELVE_ID,
  tierId: string = TEST_DELVE_TIER,
): DelvePlacement {
  const delve = DELVES[delveId];
  if (!delve) throw new Error(`instanced_contexts: unknown delve ${delveId}`);
  const e = entityOf(sim, pid);
  if (e.level < delve.minLevel) sim.setPlayerLevel(delve.minLevel, pid);
  sim.enterDelve(delveId, tierId, pid);
  const run = sim.delveRunForPlayer(pid);
  if (!run) throw new Error(`instanced_contexts: no delve run for pid ${pid} after enterDelve`);
  return { run };
}

export interface RiftPlacement {
  instance: RiftInstance;
}

/** Enter a rift floor. The direct call takes no level gate (only the portal
 *  arm does), and it teleports the body onto the floor's entry, so the
 *  floor-region read is live on return. */
export function placeInRift(sim: Sim, pid: number = sim.playerId, seed = 4242): RiftPlacement {
  sim.enterRift(seed, RIFT_BASE_LEVEL, pid);
  const instance = riftInstanceAtPos(sim.ctx, entityOf(sim, pid).pos);
  if (!instance) throw new Error(`instanced_contexts: no rift instance for pid ${pid}`);
  return { instance };
}

export interface MatchPlacement<T> {
  match: T;
  /** The opponent the format needs. Seated in the same match, so it doubles as
   *  a second blocked player when a case wants one. */
  opponent: number;
}

/** Seat a 5v5-format battleground as a 1v1: `startBgMatch` is the same entry
 *  the matchmaker calls and takes no level, position or queue gate, so it is
 *  the honest minimum. It registers both pids in ctx.bgMatches (the gate's
 *  authority) and places both bodies in the band. */
export function placeInBattleground(sim: Sim, pid: number = sim.playerId): MatchPlacement<BgMatch> {
  const opponent = sim.addPlayer('mage', nameFor(sim, 'BgFoe'));
  startBgMatch(sim.ctx, [pid], [opponent]);
  const match = sim.bgMatchFor(pid);
  if (!match) throw new Error(`instanced_contexts: no bg match for pid ${pid}`);
  return { match, opponent };
}

/** Leave a battleground the way a disconnect does: the roster entry goes and
 *  the body is sent back to where it queued from. The only real flow that
 *  clears membership for ONE player mid-match, which is what a
 *  "same player, now outside" case needs. */
export function leaveBattleground(sim: Sim, pid: number): void {
  bgResolveDesertion(sim.ctx, pid);
  if (sim.ctx.bgMatches.has(pid)) {
    throw new Error(`instanced_contexts: pid ${pid} still seated after desertion`);
  }
}

/** Seat a 1v1 arena bout. `startArenaMatch` needs only resolvable entities and
 *  metas, and registers both pids in ctx.arenaMatches (the gate's authority).
 *  Arena is the deliberate sixth context: ranked bouts postdate the
 *  five-context ruling and inherit its competitive-parity rationale. */
export function placeInArena(sim: Sim, pid: number = sim.playerId): MatchPlacement<ArenaMatch> {
  const opponent = sim.addPlayer('mage', nameFor(sim, 'ArenaFoe'));
  startArenaMatch(sim.ctx, '1v1', [pid], [opponent]);
  const match = sim.arenaMatchFor(pid);
  if (!match) throw new Error(`instanced_contexts: no arena match for pid ${pid}`);
  return { match, opponent };
}

/** The open-world lane every "allowed here" case stands in: flat, authored
 *  terrain, and roughly 100k yards west of INSTANCE_X_BASE, so it is outside
 *  every band and outside the far-east void the geometry backstop covers. */
export function placeInOpenWorld(sim: Sim, pid: number = sim.playerId): void {
  placePlayerInOpenField(sim, pid);
}
