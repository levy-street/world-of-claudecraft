// The ground-truth trajectory runners a simulated-latency movement scenario
// compares the online client against: given one per-tick MoveInput script, what
// pose does the AUTHORITY actually produce?
//
// Two runners, and the primary one is the twin GameServer:
//   runTwinServerTrajectory  - a second GameServer built exactly like the one
//     under test (same `new GameServer()` path, same join, same manual step
//     loop), so the ground truth comes out of the same world configuration the
//     harness's server runs.
//   runOfflineSimTrajectory  - a plain `new Sim(...)` in the tests/
//     player_motion.test.ts idiom. Cheap, but its Sim config is NOT the
//     server's: GameServer passes WORLD_SEED with noPlayer, compulsoryTutorial,
//     worldBossAtBoot, riftPortals and an idleMobTickRadius, none of which a
//     plain test Sim sets. Those knobs change what else lives in the world (and
//     therefore the shared rng draw order), which is why the twin server is the
//     primary runner and this one is a cross-check.
//
// A suite using the twin-server runner must mock Postgres itself, hoisted above
// its `server/game` import; copy the superset factory at the top of
// tests/unstuck_online.test.ts. vi.mock is hoisted, so the factory cannot be
// re-exported from this module without cycling back through server/db.

import { type ClientSession, GameServer } from '../../server/game';
import { Sim } from '../../src/sim/sim';
import { type Entity, emptyMoveInput, type MoveInput, type PlayerClass } from '../../src/sim/types';
import { terrainHeight } from '../../src/sim/world';
import { WORLD_SEED } from '../../src/sim/world_seed';

/** One scripted change of held input, applied BEFORE the tick of that index. */
export interface MoveScriptEntry {
  tick: number;
  mi: Partial<MoveInput>;
  /** Mouselook facing, stamped on the entity at that tick (radians). */
  facing?: number;
}

export type MoveScript = readonly MoveScriptEntry[];

export interface Pose {
  x: number;
  y: number;
  z: number;
  facing: number;
}

export interface TrajectoryOptions {
  script: MoveScript;
  ticks: number;
  /** Defaults to the collider-free lane below. */
  start?: { x: number; z: number };
  facing?: number;
  playerClass?: PlayerClass;
}

/**
 * The known collider-free straight-run lane, documented by tests/
 * self_motion.test.ts: open field, no props, so a run there measures movement
 * rather than collision response.
 */
export const COLLIDER_FREE_LANE = { x: 0, z: -1000 } as const;

export interface RawFakeClient {
  /** Every frame the server sent, as the raw JSON string it wrote. */
  sent: string[];
  // biome-ignore lint/suspicious/noExplicitAny: mirrors the `ws` field GameServer.join expects
  ws: any;
}

/**
 * bare_client's fakeWs JSON.parses on send, which is lossy for a latency
 * harness: the link carries the exact bytes the server wrote. This variant
 * keeps them.
 */
export function rawFakeWs(): RawFakeClient {
  const sent: string[] = [];
  return {
    sent,
    ws: { readyState: 1, send: (payload: string) => sent.push(payload) },
  };
}

export interface JoinedGroundTruth {
  server: GameServer;
  session: ClientSession;
  client: RawFakeClient;
  pid: number;
}

/** A GameServer with one warrior joined over a raw-preserving fake socket. */
export function joinGroundTruthCharacter(
  characterId = 1,
  playerClass: PlayerClass = 'warrior',
  movementWireVersion: 1 | 2 = 1,
): JoinedGroundTruth {
  const server = new GameServer();
  const client = rawFakeWs();
  const session = server.join(
    client.ws,
    characterId,
    characterId,
    `Ground${characterId}`,
    playerClass,
    null,
    false,
    { movementWireVersion },
  );
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return { server, session, client, pid: session.pid };
}

/** Place a body on the ground at (x, z) with its motion state cleared. */
export function teleportEntity(e: Entity, x: number, z: number, seed: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, seed);
  e.prevPos = { ...e.pos };
  e.fallStartY = e.pos.y;
  e.onGround = true;
  e.vx = 0;
  e.vz = 0;
  e.vy = 0;
}

interface TickInput {
  input: MoveInput;
  facing: number | null;
}

/**
 * Expand a script into one held-input record per tick. A scripted entry changes
 * the held input; between entries the input is HELD, which is what a live client
 * does (it re-sends at the 50 ms input cadence, so the server keeps seeing the
 * key down).
 */
function expandScript(script: MoveScript, ticks: number): TickInput[] {
  for (const entry of script) {
    if (!Number.isInteger(entry.tick) || entry.tick < 0 || entry.tick >= ticks) {
      throw new Error(`move script tick ${entry.tick} is outside 0..${ticks - 1}`);
    }
  }
  const held = emptyMoveInput();
  const out: TickInput[] = [];
  for (let i = 0; i < ticks; i++) {
    let facing: number | null = null;
    for (const entry of script) {
      if (entry.tick !== i) continue;
      Object.assign(held, entry.mi);
      if (entry.facing !== undefined) facing = entry.facing;
    }
    out.push({ input: { ...held }, facing });
  }
  return out;
}

function poseOf(e: Entity): Pose {
  return { x: e.pos.x, y: e.pos.y, z: e.pos.z, facing: e.facing };
}

/**
 * PRIMARY runner: a twin GameServer stepped by hand, one pose per tick.
 *
 * The per-tick meta write plus the lastInputAt refresh mirror the server's own
 * `input` message arm: without the refresh, clearStaleInputs would zero a held
 * key after STALE_INPUT_SECONDS and the trajectory would silently stop.
 */
export function runTwinServerTrajectory(opts: TrajectoryOptions): Pose[] {
  const { server, session, pid } = joinGroundTruthCharacter(1, opts.playerClass ?? 'warrior');
  const sim = server.sim;
  const e = sim.entities.get(pid);
  const meta = sim.meta(pid);
  if (!e || !meta) throw new Error('joined character is missing from the server sim');
  const start = opts.start ?? COLLIDER_FREE_LANE;
  teleportEntity(e, start.x, start.z, sim.cfg.seed);
  e.facing = opts.facing ?? 0;

  const perTick = expandScript(opts.script, opts.ticks);
  const out: Pose[] = [];
  for (const step of perTick) {
    if (step.facing !== null) e.facing = step.facing;
    Object.assign(meta.moveInput, step.input);
    session.lastInputAt = sim.time;
    // biome-ignore lint/suspicious/noExplicitAny: the server-loop internals a manual step drives
    const internals = server as any;
    internals.clearStaleInputs();
    const events = sim.tick();
    internals.routeEvents(events);
    internals.broadcastSnapshots();
    out.push(poseOf(e));
  }
  return out;
}

/**
 * SECONDARY runner: the offline Sim idiom (tests/player_motion.test.ts). Same
 * seed and lane as the twin server, but the plain Sim config noted in the module
 * header, so treat a divergence as information about that config rather than
 * something to force into agreement.
 */
export function runOfflineSimTrajectory(opts: TrajectoryOptions): Pose[] {
  const sim = new Sim({
    seed: WORLD_SEED,
    playerClass: opts.playerClass ?? 'warrior',
    autoEquip: true,
  });
  const p = sim.player;
  const start = opts.start ?? COLLIDER_FREE_LANE;
  teleportEntity(p, start.x, start.z, sim.cfg.seed);
  p.facing = opts.facing ?? 0;
  const meta = sim.players.get(p.id);
  if (!meta) throw new Error('offline sim is missing its player meta');

  const perTick = expandScript(opts.script, opts.ticks);
  const out: Pose[] = [];
  for (const step of perTick) {
    if (step.facing !== null) p.facing = step.facing;
    Object.assign(meta.moveInput, step.input);
    sim.tick();
    out.push(poseOf(p));
  }
  return out;
}

/** Ground distance between two poses (the y axis is terrain, not travel). */
export function groundDistance(a: Pose, b: Pose): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}
