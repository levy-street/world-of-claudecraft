// "Tumbler's Path", the delve lockpicking minigame core.
//
// Pure, deterministic, host-agnostic (no DOM/Three/net). The marker (pick tip)
// advances exactly one column per player input and chooses a discrete vertical
// delta; it must thread a partly-hidden channel of open rows, seat on each
// tumbler gate, and finish on the bolt seat. Because advancement is input-driven
// there is no timer and no tick loop, every step is a request/response, which
// makes the whole thing trivially server-authoritative.
//
// See docs/prd/DELVE_LOCKPICK_MINIGAME.md. All randomness flows through Rng
// (never Math.random); (seed, tier) fully determines a lock, so we store only
// the seed and regenerate server-side on demand.

import { Rng } from './rng';

export type PickAction = 'hardSet' | 'set' | 'steady' | 'ease' | 'drop' | 'abort';

/** Vertical delta applied to the pick row for each non-abort action. Row 0 is
 * the shallow/top row; +delta drives the pick deeper. */
export const ACTION_DELTA: Record<Exclude<PickAction, 'abort'>, number> = {
  hardSet: -2,
  set: -1,
  steady: 0,
  ease: +1,
  drop: +2,
};

/** The five depth actions, in display order (shallow→deep). */
export const PICK_ACTIONS: Exclude<PickAction, 'abort'>[] = [
  'hardSet',
  'set',
  'steady',
  'ease',
  'drop',
];

/** Lives the player commits up front. The ante IS the loot tier (see
 * ANTE_TO_TIER), fixing it at engage time removes the "burn lives to climb
 * tiers" exploit, since a slip is trivially self-inflicted. */
export type Ante = 1 | 2 | 3;
export type LootTier = 'premium' | 'medium' | 'low';

export const ANTE_TO_TIER: Record<Ante, LootTier> = {
  1: 'premium', // flawless, 3 pages
  2: 'medium', // flawless, 2 pages
  3: 'low', // flawless, 1 page
};

/** How many sequential lock "pages" each ante must clear back-to-back. The whole
 * run is flawless within a single try (any slip/bind/trap jams that try), so more
 * pages = strictly harder. Premium is the brutal 3-page gauntlet. */
export const ANTE_TO_PAGES: Record<Ante, number> = {
  1: 3,
  2: 2,
  3: 1,
};

/** How many tries (attempts) each difficulty grants before the chest jams for
 * good. Easy (modest/ante 3) is forgiving with 3 tries; hard (premium/ante 1)
 * is one-and-done. A failed try regenerates the board and restarts the timer. */
export const ANTE_TO_TRIES: Record<Ante, number> = {
  1: 1, // premium, hard: one try
  2: 2, // medium: two tries
  3: 3, // modest, easy: three tries
};

/** Per-MOVE time budget (ms) each difficulty grants, the lockpick clock's ONLY
 * axis: the clock is an ante/difficulty dial, not a delve-band dial. Hard
 * (premium/ante 1) is the tightest at 3s, medium 6s, easy (modest/ante 3) the
 * most forgiving at 9s. Server-authoritative, enforced on the sim tick
 * (Sim.armLockpickStep) and re-armed on every move; the client only renders the
 * remaining time. Tune the numbers HERE. */
export const ANTE_TO_STEP_TIMEOUT_MS: Record<Ante, number> = {
  1: 3000, // premium, hard
  2: 6000, // medium
  3: 9000, // modest, easy
};

/** Puzzle difficulty dials. Scales with the delve's level band; lives are the
 * player's ante, never a difficulty dial. */
export interface LockTierSpec {
  cols: number; // W, run length
  rows: number; // H, channel depth
  width: 1 | 2; // open-row band around the solution path (forgiveness)
  gateCount: number; // number of exact tumbler checkpoints
  visibilityWindow: number; // columns revealed ahead; >= cols means full reveal
  allowedActions: Exclude<PickAction, 'abort'>[];
  trapCount?: number; // ward-traps that look open but JAM instantly on contact (default 0)
  noiseThreshold?: number; // omit to disable the noise meter
}

/** Server-only full lock layout. Never serialized whole when fogged, only
 * visibleCells() inside the window is ever sent to a client. */
export interface LockSpec {
  seed: number;
  tier: LockTierSpec;
  open: number[][]; // open[col] = sorted open rows (gate/seat columns hold exactly one)
  gates: number[]; // gate column indices (exactly one open row each)
  traps: number[][]; // traps[col] = sorted rows that look open but jam on contact (never on the solution)
  startRow: number;
  seatRow: number;
}

export type LockSessionState = 'IN_PROGRESS' | 'SUCCESS' | 'FAILED' | 'ABANDONED';

/** Server-side live attempt. Lives in-memory on the DelveRun; never persisted.
 * Each try is FLAWLESS: any slip/bind/trap (or timeout) burns one try and resets
 * the board; the chest only jams once tries run out. */
export interface LockSession {
  sessionId: string;
  chestId: number;
  ownerId: number; // player entity id of the single interactor
  baseSeed: number; // seed the page set is derived from; varied per try so retries differ
  pages: LockSpec[]; // sequential locks; every page must be cleared to claim the cache
  pageIndex: number; // current page (0-based)
  ante: Ante;
  lootTier: LootTier; // = ANTE_TO_TIER[ante], immutable for the session
  col: number;
  row: number;
  triesLeft: number; // attempts remaining (this one included); chest jams at 0
  triesTotal: number; // = ANTE_TO_TRIES[ante]
  // Sim-tick deadline for the CURRENT step (server-authoritative clock). The sim
  // burns a try when tickCount reaches it; re-armed on every move. The per-move
  // budget is the ante's ANTE_TO_STEP_TIMEOUT_MS (hard 3s / medium 6s / easy 9s).
  // The client never reports a timeout; the HUD only renders the remaining time.
  // See Sim.armLockpickStep / tickLockpickTimeout.
  stepDeadlineTick: number;
  state: LockSessionState;
}

/** 'pageCleared' = current page seated, more pages remain; 'success' = last page
 * seated; 'retry' = the try failed but another remains (board reset). */
export type StepResult =
  | 'advanced'
  | 'slip'
  | 'bind'
  | 'trap'
  | 'pageCleared'
  | 'retry'
  | 'success'
  | 'fail';

export type CellKind = 'open' | 'gate' | 'seat' | 'trap';
export interface VisibleCell {
  col: number;
  row: number;
  kind: CellKind;
}

const NON_ABORT = (a: PickAction): a is Exclude<PickAction, 'abort'> => a !== 'abort';

/** Reverse the delta back to its action (used by solvers/tests). */
export function deltaToAction(delta: number): Exclude<PickAction, 'abort'> {
  for (const a of PICK_ACTIONS) if (ACTION_DELTA[a] === delta) return a;
  throw new Error(`no action for delta ${delta}`);
}

function legalDeltas(tier: LockTierSpec): number[] {
  return tier.allowedActions.map((a) => ACTION_DELTA[a]);
}

function sampleGates(rng: Rng, cols: number, count: number): number[] {
  // Candidate gate columns exclude column 0 (start) and the last column (seat).
  const candidates: number[] = [];
  for (let c = 1; c <= cols - 2; c++) candidates.push(c);
  // Fisher-Yates with the seeded rng.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = tmp;
  }
  return candidates.slice(0, Math.max(0, Math.min(count, candidates.length))).sort((a, b) => a - b);
}

/**
 * Reverse construction: carve a guaranteed solution path first (one row per
 * column, respecting allowed deltas + bounds), then wrap open-row bands around
 * it. This guarantees at least one solution exists, so an ante of 1 (flawless)
 * is always fair, the layout is always perfectly solvable; the ante only sets
 * the error budget.
 */
export function generateLock(seed: number, tier: LockTierSpec): LockSpec {
  const rng = new Rng(seed >>> 0);
  const H = tier.rows;
  const W = tier.cols;
  const deltas = legalDeltas(tier);

  // 1. Carve the solution path.
  const path: number[] = new Array(W);
  path[0] = rng.int(0, H - 1);
  for (let c = 1; c < W; c++) {
    const legal = deltas.filter((d) => path[c - 1] + d >= 0 && path[c - 1] + d <= H - 1);
    // `steady` (delta 0) is always in every tier's allowedActions, so legal is
    // never empty; pick defensively anyway.
    path[c] = path[c - 1] + (legal.length ? rng.pick(legal) : 0);
  }

  // 2. Choose tumbler gate columns.
  const gates = sampleGates(rng, W, tier.gateCount);
  const gateSet = new Set(gates);

  // 3. Build open-row bands around the path; gates + bolt seat are exact.
  const open: number[][] = new Array(W);
  for (let c = 0; c < W; c++) {
    if (c === W - 1 || gateSet.has(c)) {
      open[c] = [path[c]];
    } else {
      const band: number[] = [];
      for (let r = path[c] - tier.width; r <= path[c] + tier.width; r++) {
        if (r >= 0 && r <= H - 1) band.push(r);
      }
      open[c] = band;
    }
  }

  // 4. Trim unreachable "open" cells (can't be entered from any open cell in the
  //    previous column given allowed deltas). The path cell is always retained
  //    because path[c]-path[c-1] is a legal delta and path[c-1] is always kept
  //    (by induction), so solvability is preserved.
  for (let c = 1; c < W; c++) {
    const prev = open[c - 1];
    open[c] = open[c].filter((r) => prev.some((pr) => deltas.includes(r - pr)));
  }

  // 4b. Forward trim: drop any open cell that cannot legally reach a retained
  //     open cell in the NEXT column. Processed right-to-left so each column sees
  //     its finalized successor. This removes dead ends and, crucially, the unfair
  //     "stranded before a gate" case: a legal move into the forgiveness band must
  //     never leave the single open row of a gate/bolt-seat column (open[c+1] of
  //     length 1) physically unreachable. The carved path is always retained
  //     because path[c] -> path[c+1] is a legal delta and path[c+1] survives by
  //     induction from the seat, so solvability is preserved.
  for (let c = W - 2; c >= 0; c--) {
    const next = open[c + 1];
    open[c] = open[c].filter((r) => next.some((nr) => deltas.includes(nr - r)));
  }

  // 5. Sprinkle ward-traps: open-looking rows that JAM instantly on contact.
  //    Never on the solution path (path[c] is always safe), never in a gate/seat
  //    column (those hold a single open row = the path). They shrink the
  //    forgiveness band so the player must read and thread the true path, not just
  //    any open cell, the heart of the puzzle.
  const traps: number[][] = open.map(() => []);
  const trapBudget = Math.max(0, tier.trapCount ?? 0);
  if (trapBudget > 0) {
    const candidates: Array<[number, number]> = [];
    for (let c = 1; c < W - 1; c++) {
      if (gateSet.has(c)) continue;
      for (const r of open[c]) {
        if (r !== path[c]) candidates.push([c, r]);
      }
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }
    for (const [c, r] of candidates.slice(0, Math.min(trapBudget, candidates.length))) {
      traps[c].push(r);
    }
    for (const t of traps) t.sort((a, b) => a - b);
  }

  return { seed: seed >>> 0, tier, open, gates, traps, startRow: path[0], seatRow: path[W - 1] };
}

/** Generate the full sequence of lock pages for a session. Each page is an
 * independent board with a per-page derived seed; clearing all pages wins. */
export function generateLockPages(seed: number, tier: LockTierSpec, pageCount: number): LockSpec[] {
  const pages: LockSpec[] = [];
  const n = Math.max(1, pageCount);
  for (let i = 0; i < n; i++) {
    pages.push(generateLock((seed ^ ((i + 1) * 0x9e3779b1)) >>> 0, tier));
  }
  return pages;
}

/** BFS reachability from (0, startRow) to the bolt seat. Used by tests to verify
 * solvability; true for every well-formed spec. Solvability is guaranteed
 * structurally by generateLock (the carved path cell is always retained through
 * the trim and never trapped), not by a runtime assertion in the generator. */
export function solveLock(spec: LockSpec): boolean {
  return solveLockPath(spec) !== null;
}

/** Return a concrete solution: the row index per column, or null if unsolvable.
 * BFS with parent tracking. */
export function solveLockPath(spec: LockSpec): number[] | null {
  const deltas = legalDeltas(spec.tier);
  const W = spec.open.length;
  // A trap row is reachable but jams, never route a solution through one.
  const safe = (c: number, r: number): boolean =>
    spec.open[c].includes(r) && !spec.traps?.[c]?.includes(r);
  if (!safe(0, spec.startRow)) return null;
  // parents[col] maps a reachable row -> the row it came from in col-1.
  const parents: Map<number, number>[] = [];
  let reach = new Set<number>([spec.startRow]);
  parents[0] = new Map();
  for (let c = 1; c < W; c++) {
    const next = new Set<number>();
    const par = new Map<number, number>();
    for (const r of reach) {
      for (const d of deltas) {
        const nr = r + d;
        if (safe(c, nr) && !par.has(nr)) {
          par.set(nr, r);
          next.add(nr);
        }
      }
    }
    parents[c] = par;
    reach = next;
    if (reach.size === 0) return null;
  }
  if (!reach.has(spec.seatRow)) return null;
  // Walk parents back from the seat.
  const path: number[] = new Array(W);
  path[W - 1] = spec.seatRow;
  for (let c = W - 1; c > 0; c--) path[c - 1] = parents[c].get(path[c])!;
  return path;
}

/** The action sequence (one per advancing step) that solves the lock, or null. */
export function solveLockActions(spec: LockSpec): Exclude<PickAction, 'abort'>[] | null {
  const path = solveLockPath(spec);
  if (!path) return null;
  const actions: Exclude<PickAction, 'abort'>[] = [];
  for (let c = 1; c < path.length; c++) actions.push(deltaToAction(path[c] - path[c - 1]));
  return actions;
}

/**
 * Authoritative single step. Given the current pick position and an action,
 * returns the outcome and resulting position. Caller owns the lives economy:
 * a 'slip' or 'bind' does NOT advance the pick (position unchanged) and should
 * consume a life; 'advanced'/'success' move the pick.
 */
export function stepLock(
  spec: LockSpec,
  col: number,
  row: number,
  action: Exclude<PickAction, 'abort'>,
): { result: StepResult; col: number; row: number } {
  const H = spec.tier.rows;
  const newRow = Math.max(0, Math.min(H - 1, row + ACTION_DELTA[action]));
  const newCol = col + 1;
  const colOpen = spec.open[newCol];
  if (!colOpen?.includes(newRow)) {
    // Gate columns hold exactly one open row: missing it is a bind; any other
    // blocked cell is a ward slip. Either way the pick does not advance.
    const isGate = spec.gates.includes(newCol);
    return { result: isGate ? 'bind' : 'slip', col, row };
  }
  // A ward-trap looks open but jams the lock the instant the pick touches it.
  if (spec.traps?.[newCol]?.includes(newRow)) {
    return { result: 'trap', col, row };
  }
  if (newCol === spec.open.length - 1 && newRow === spec.seatRow) {
    return { result: 'success', col: newCol, row: newRow };
  }
  return { result: 'advanced', col: newCol, row: newRow };
}

/**
 * The render-safe slice: every open cell in columns [0, col + window]. This is
 * the single source of truth for fog AND the anti-cheat boundary, the server
 * never serializes anything beyond what this returns. A window >= tier.cols
 * reveals the whole board (full-visibility easy locks).
 *
 * Ward-traps are revealed as `kind: 'trap'` so the player can SEE and thread
 * around them. An open-looking notch that jams on contact is pure RNG death when
 * it is invisible: the pick has no way to read the safe path, so a "correct"
 * looking press can jam a 1-try lock through no fault of the player. Painting
 * traps as a distinct hazard notch makes the lock solvable by sight, with the
 * forgiveness band and gates as the real challenge. stepLock() still enforces the
 * jam server-side; revealing trap POSITIONS grants no exploit (loot stays
 * server-authoritative), it only lets the player play fairly. A trap-free
 * solution always exists (the carved path is never trapped), so the revealed
 * board is always winnable.
 */
export function visibleCells(spec: LockSpec, col: number, window: number): VisibleCell[] {
  const last = spec.open.length - 1;
  const maxCol = window >= spec.tier.cols ? last : Math.min(last, col + window);
  const cells: VisibleCell[] = [];
  for (let c = 0; c <= maxCol; c++) {
    const trapRows = spec.traps[c];
    for (const r of spec.open[c]) {
      const kind: CellKind =
        c === last
          ? 'seat'
          : spec.gates.includes(c)
            ? 'gate'
            : trapRows?.includes(r)
              ? 'trap'
              : 'open';
      cells.push({ col: c, row: r, kind });
    }
  }
  return cells;
}

export { NON_ABORT };
