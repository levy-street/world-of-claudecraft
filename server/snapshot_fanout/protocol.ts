// Shared-memory layout and message contracts between the main thread's
// snapshot-fanout pool (pool.ts) and its worker threads (worker_main.ts).
//
// Data split, chosen so the sim never leaves the main thread and the workers
// never see a live Entity:
// - Numeric per-entity facts the interest scan needs (position, kind flags,
//   aggro, wire-fragment versions) ride SharedArrayBuffer MIRRORS. The set is
//   DOUBLE-BUFFERED with ownership: a dispatched tick pins its buffer until
//   every worker holding a job on it replies, and the main thread only ever
//   writes a buffer with no in-flight readers, so a worker that runs long can
//   never observe a torn (partially overwritten) mirror. postMessage of the
//   tick job is the happens-before edge for the chosen buffer's contents, so
//   workers still read without atomics.
// - The wire-fragment STRINGS (fullJson/liteJson built by wireCacheFor, the
//   single serializer both paths share) cannot ride shared memory; they ship
//   inside the tick message as deltas keyed by version, so an unchanged
//   fragment is never re-copied.
// - Per-session results return as ready-to-splice JSON strings.

export const MIRROR_CAPACITY = 8192; // entity slots; over capacity => fanout skips the tick
export const F64_PER_SLOT = 2; // x, z
export const I32_PER_SLOT = 5; // id, flags, aggroTargetId, idVer, dynVer

export const HEADER_I32 = 2; // [0] entityCount, [1] tick

export const FLAG_NPC = 1;
export const FLAG_STEALTHED_PLAYER = 2;
export const FLAG_VALE_BALL = 4;

export interface MirrorBuffers {
  header: SharedArrayBuffer;
  f64: SharedArrayBuffer;
  i32: SharedArrayBuffer;
}

// Two buffers cover the steady state (workers reply within the tick, so the
// other buffer is always free); when BOTH are pinned by slow workers the pool
// skips the fanout tick rather than tear a read.
export const MIRROR_BUFFER_COUNT = 2;

export function createMirrorBuffers(): MirrorBuffers {
  return {
    header: new SharedArrayBuffer(HEADER_I32 * 4),
    f64: new SharedArrayBuffer(MIRROR_CAPACITY * F64_PER_SLOT * 8),
    i32: new SharedArrayBuffer(MIRROR_CAPACITY * I32_PER_SLOT * 4),
  };
}

// One changed wire fragment: [id, idVer, dynVer, fullJson, liteJson].
export type FragmentDelta = [number, number, number, string, string];

export interface SessionJob {
  sid: number;
  anchorId: number;
  anchorX: number;
  anchorZ: number;
  anchorTargetId: number; // -1 when none
  // ids of stealthed player entities this session must NOT see, resolved on
  // the main thread against live sim social state (party/duel/hostility/
  // detection radius). Omitted when nothing is stealthed (the common case).
  denied?: number[];
}

export interface InitMessage {
  t: 'init';
  mirrors: MirrorBuffers[];
}

export interface TickMessage {
  t: 'tick';
  tick: number;
  // which mirror buffer this tick was written into; pinned until the reply
  buffer: number;
  changed: FragmentDelta[];
  removed: number[];
  sessions: SessionJob[];
}

export interface SessionResetMessage {
  t: 'session-reset';
  sid: number;
}

export interface SessionDropMessage {
  t: 'session-drop';
  sid: number;
}

export type MainToWorker = InitMessage | TickMessage | SessionResetMessage | SessionDropMessage;

// One built session block: [sid, entsJoined, keepJoined]; keepJoined is ''
// when the keep list is empty so the main thread reproduces the legacy
// formatting exactly.
export type SessionFrame = [number, string, string];

export interface FramesMessage {
  t: 'frames';
  tick: number;
  frames: SessionFrame[];
  buildMs: number;
}

export type WorkerToMain = FramesMessage;
