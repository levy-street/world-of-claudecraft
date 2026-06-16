// STUB (RFC) — WoC wire types as seen by an external client.
// Mirrors the compact wire format produced by server/game.ts (snap/self/event).
// Kept as a hand-maintained mirror so the plugin never imports from src/sim or server.
// TODO(eliza): finalize against server/game.ts wireEntity()/selfWireJson().

/** Movement intent — booleans + absolute facing (radians). See src/sim/move_input.ts. */
export interface MoveInput {
  f?: 0 | 1; // forward
  b?: 0 | 1; // backward
  tl?: 0 | 1; // turn left
  tr?: 0 | 1; // turn right
  sl?: 0 | 1; // strafe left
  sr?: 0 | 1; // strafe right
  j?: 0 | 1; // jump
}

export type EntityKind = 'player' | 'mob' | 'npc' | 'object';

/** A nearby entity in the delta-merged world mirror (full + lite fields collapsed). */
export interface WireEntity {
  id: number;
  k?: EntityKind; // identity field — present only on "full" records
  tid?: string; // template id
  nm?: string; // name
  lv?: number; // level
  x: number;
  y: number;
  z: number;
  f?: number; // facing
  hp?: number;
  mhp?: number;
  dead?: 0 | 1;
  h?: 0 | 1; // hostile
  aggro?: number; // current aggro target id
  own?: number; // owner id (pet/familiar)
}

/** Self (the agent's own player) — the heavy, delta-encoded record. */
export interface WireSelf {
  id: number;
  nm: string;
  tid: string; // class
  lv: number;
  hp: number;
  mhp: number;
  res: number;
  mres: number;
  rtype: string; // 'mana' | 'rage' | 'energy'
  x: number;
  y: number;
  z: number;
  f: number;
  target?: number;
  copper?: number;
  // ...the full set lives in server/game.ts; add as the plugin needs them.
}

export type GameEvent =
  | { type: 'damage'; pid: number; fromPid?: number; amount: number; from?: string }
  | { type: 'heal'; pid: number; amount: number; from?: string }
  | { type: 'death'; pid: number; fromPid?: number; from?: string }
  | { type: 'xp'; pid: number; amount: number; from?: string }
  | { type: 'loot'; pid: number; item: { id: string; count: number } }
  | { type: 'chat'; channel: string; from: string; text: string }
  | { type: 'log'; text: string };

/** A high-level goal the deterministic control loop executes (set by an Action). */
export type Goal =
  | { kind: 'idle' }
  | { kind: 'waypoint'; x: number; z: number; stopRange: number }
  | { kind: 'follow'; targetId: number; stopRange: number };

export type ConnectMode = 'player' | 'familiar';
