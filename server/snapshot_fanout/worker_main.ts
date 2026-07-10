// Snapshot-fanout worker: builds the per-session ents/keep blocks of the
// interest-scoped snapshot off the main thread.
//
// Inputs per tick (see protocol.ts): the SharedArrayBuffer entity mirror
// (positions, kind flags, aggro, fragment versions) plus fragment-string
// deltas. State owned here: the fragment string cache and each assigned
// session's SentEntityVersions map (what that client already knows). The
// decision logic is the SAME pure module the in-thread path uses
// (interest_rules.ts), so the two paths cannot drift; the spatial walk
// mirrors src/sim/spatial.ts SpatialGrid.forEachInRadius over mirror slots.
//
// Record ORDER within one snapshot can differ from the in-thread path (the
// grid there buckets by live insertion/swap-pop order; here by mirror slot
// order). The client applies ents into a per-id map, so order carries no
// meaning; tests/server/snapshot_fanout_equivalence.test.ts compares
// canonically (sorted by id) and the sim/self bytes exactly.
import { parentPort } from 'node:worker_threads';
import {
  decideKnownRecord,
  INTEREST_QUERY_RADIUS,
  type SentEntityVersions,
  withinInterest,
} from './interest_rules';
import {
  F64_PER_SLOT,
  FLAG_NPC,
  FLAG_STEALTHED_PLAYER,
  FLAG_VALE_BALL,
  type FramesMessage,
  I32_PER_SLOT,
  type MainToWorker,
  type MirrorBuffers,
  type SessionFrame,
  type SessionJob,
} from './protocol';

interface Fragment {
  idVer: number;
  dynVer: number;
  fullJson: string;
  liteJson: string;
}

const CELL = 32; // yards; matches src/sim/spatial.ts so scan windows agree
const CELL_OFFSET = 32768;

interface BoundMirror {
  headerI32: Int32Array;
  f64: Float64Array;
  i32: Int32Array;
}

// Double-buffered (see protocol.ts): each tick message names the buffer it
// was written into, pinned by the pool until this worker replies.
let boundMirrors: BoundMirror[] = [];

const fragments = new Map<number, Fragment>();
const sessions = new Map<number, Map<number, SentEntityVersions>>();

// Per-tick grid over mirror slot indices, rebuilt each tick (entity counts
// are a few hundred to a few thousand; rebuild is microseconds and dodges
// incremental-consistency bugs).
const cells = new Map<number, number[]>();

function bindMirrors(mirrors: MirrorBuffers[]): void {
  boundMirrors = mirrors.map((m) => ({
    headerI32: new Int32Array(m.header),
    f64: new Float64Array(m.f64),
    i32: new Int32Array(m.i32),
  }));
}

function rebuildGrid(count: number, f64: Float64Array): void {
  cells.clear();
  for (let slot = 0; slot < count; slot++) {
    const x = f64[slot * F64_PER_SLOT];
    const z = f64[slot * F64_PER_SLOT + 1];
    const key = (Math.floor(x / CELL) + CELL_OFFSET) * 65536 + (Math.floor(z / CELL) + CELL_OFFSET);
    const list = cells.get(key);
    if (list) list.push(slot);
    else cells.set(key, [slot]);
  }
}

function buildSession(
  job: SessionJob,
  tick: number,
  f64: Float64Array,
  i32: Int32Array,
  ents: string[],
  keep: number[],
  present: Set<number>,
): SessionFrame {
  ents.length = 0;
  keep.length = 0;
  present.clear();
  let known = sessions.get(job.sid);
  if (!known) {
    known = new Map();
    sessions.set(job.sid, known);
  }
  const denied = job.denied;
  const r = INTEREST_QUERY_RADIUS;
  const r2 = r * r;
  const minCx = Math.floor((job.anchorX - r - 1) / CELL) + CELL_OFFSET;
  const maxCx = Math.floor((job.anchorX + r + 1) / CELL) + CELL_OFFSET;
  const minCz = Math.floor((job.anchorZ - r - 1) / CELL) + CELL_OFFSET;
  const maxCz = Math.floor((job.anchorZ + r + 1) / CELL) + CELL_OFFSET;
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cz = minCz; cz <= maxCz; cz++) {
      const list = cells.get(cx * 65536 + cz);
      if (!list) continue;
      for (const slot of list) {
        const dx = f64[slot * F64_PER_SLOT] - job.anchorX;
        const dz = f64[slot * F64_PER_SLOT + 1] - job.anchorZ;
        const d2 = dx * dx + dz * dz;
        if (d2 > r2) continue;
        const base = slot * I32_PER_SLOT;
        const id = i32[base];
        if (id === job.anchorId) continue;
        const flags = i32[base + 1];
        if (flags & FLAG_STEALTHED_PLAYER && denied !== undefined && denied.includes(id)) continue;
        const k = known.get(id);
        const targeted = job.anchorTargetId === id;
        if (!withinInterest(d2, (flags & FLAG_NPC) !== 0, k !== undefined, targeted)) continue;
        present.add(id);
        const frag = fragments.get(id);
        if (frag === undefined) continue; // spawned-this-instant race; next tick carries it
        if (k === undefined) {
          ents.push(frag.fullJson);
          known.set(id, {
            idVer: frag.idVer,
            dynVer: frag.dynVer,
            sentAtTick: tick,
            settled: true,
          });
          continue;
        }
        const action = decideKnownRecord(
          tick,
          d2,
          k,
          frag.idVer,
          frag.dynVer,
          (flags & FLAG_VALE_BALL) !== 0,
          targeted,
          i32[base + 2] === job.anchorId,
        );
        if (action === 'keep') keep.push(id);
        else ents.push(action === 'full' ? frag.fullJson : frag.liteJson);
      }
    }
  }
  // forget entities that left interest, so a re-entry sends identity again
  for (const id of known.keys()) {
    if (!present.has(id)) known.delete(id);
  }
  return [job.sid, ents.join(','), keep.length > 0 ? keep.join(',') : ''];
}

function onMessage(msg: MainToWorker): void {
  if (msg.t === 'tick') {
    const t0 = performance.now();
    for (const [id, idVer, dynVer, fullJson, liteJson] of msg.changed) {
      fragments.set(id, { idVer, dynVer, fullJson, liteJson });
    }
    for (const id of msg.removed) fragments.delete(id);
    const mirror = boundMirrors[msg.buffer];
    if (!mirror || !parentPort) return;
    const { headerI32: header, f64, i32 } = mirror;
    rebuildGrid(header[0], f64);
    const ents: string[] = [];
    const keep: number[] = [];
    const present = new Set<number>();
    const frames: SessionFrame[] = [];
    for (const job of msg.sessions) {
      frames.push(buildSession(job, msg.tick, f64, i32, ents, keep, present));
    }
    const reply: FramesMessage = {
      t: 'frames',
      tick: msg.tick,
      frames,
      buildMs: performance.now() - t0,
    };
    parentPort.postMessage(reply);
    return;
  }
  if (msg.t === 'session-reset') {
    sessions.get(msg.sid)?.clear();
    return;
  }
  if (msg.t === 'session-drop') {
    sessions.delete(msg.sid);
    return;
  }
  if (msg.t === 'init') {
    bindMirrors(msg.mirrors);
  }
}

parentPort?.on('message', onMessage);
