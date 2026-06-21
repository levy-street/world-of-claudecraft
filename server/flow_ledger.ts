// The shared $WOC GameFi FLOW LEDGER — the mechanism that makes "buy pressure >
// sell pressure" a HARD invariant rather than a hope.
//
// Every $WOC movement across the GameFi features is recorded here against a
// season as either an `in` (a SINK: tokens bought, locked, or burned — buy/lock
// pressure) or an `out` (an EMISSION: tokens paid to a player — sell pressure).
// Before ANY emission is recorded, the ledger asserts that emissions can never
// exceed the verified sinks for that season. Net supply change per season is
// therefore structurally >= 0: the system can only ever pay out what it first
// took in (stakes that stayed in-system, burns, and on-market buybacks).
//
//   #478 GambleFi:    in  gamblefi_stake (x2) + gamblefi_burn_rake
//                     out gamblefi_payout (bounded by the two stakes)
//   #479 Championship: in  championship_entry + championship_burn_rake (+ buyback)
//                     out championship_prize (bounded by entries − burn)
//   #480 Leaderboard: in  recirculated_rake + marketplace_buyback + identity_treasury
//                     out leaderboard_payout (can ONLY draw on prior verified in)
//
// This module is PURE LOGIC + an injected `FlowLedgerDb` seam (all SQL lives in
// flow_ledger_db.ts, per the server SQL-only-in-*_db.ts invariant). The
// load-bearing atomicity — serialize concurrent payouts so two cannot both spend
// the same headroom — is the DB implementation's job (a per-season advisory lock
// inside one transaction); the production impl provides it and the in-memory fake
// models it for unit tests.

export type FlowDirection = 'in' | 'out';

// Every kind of $WOC movement we account for. Inflows are buy/lock/burn pressure
// that funds emissions; outflows are the only thing that can release supply.
export type FlowSource =
  // ---- inflows (sinks: buy / lock / burn pressure) ----
  | 'gamblefi_stake' //          #478 a player's stake locked into the match escrow
  | 'gamblefi_burn_rake' //      #478 rake permanently burned on settle
  | 'championship_entry' //      #479 season entry fee paid in
  | 'championship_burn_rake' //  #479 rake burned on season finalize
  | 'arena_rake' //              rake routed into a reward pool (not burned)
  | 'recirculated_rake' //       rake explicitly recirculated to fund #480
  | 'marketplace_buyback' //     protocol revenue bought $WOC on-market (real buy pressure)
  | 'identity_treasury' //       identity-fee treasury split swept in
  // ---- outflows (emissions: sell pressure) ----
  | 'gamblefi_payout' //         #478 winner take (<= the two stakes, minus burn)
  | 'championship_prize' //      #479 graduated top-N prize
  | 'leaderboard_payout'; //     #480 seasonal reward

const OUTFLOW_SOURCES: ReadonlySet<FlowSource> = new Set<FlowSource>([
  'gamblefi_payout',
  'championship_prize',
  'leaderboard_payout',
]);

/** Which side of the ledger a source belongs to (pure). */
export function directionOf(source: FlowSource): FlowDirection {
  return OUTFLOW_SOURCES.has(source) ? 'out' : 'in';
}

// Why an emission was allowed or refused. `budget_exceeded` is the invariant
// firing: the requested payout would push season emissions above verified sinks.
export type FlowReason = 'budget_exceeded' | 'duplicate' | 'bad_amount' | 'wrong_direction' | 'season_closed';

/**
 * THE invariant, as a pure decision over base-unit integers. Allow an emission
 * iff it is a positive amount that fits within the season's current headroom
 * (sum of verified inflows − sum of prior outflows). Both the production DB impl
 * and the in-memory fake call this under their serialization guard so the
 * decision and the insert are atomic.
 */
export function emissionDecision(
  headroomBase: bigint,
  requestedBase: bigint,
): { allow: boolean; reason?: FlowReason } {
  if (requestedBase <= 0n) return { allow: false, reason: 'bad_amount' };
  if (requestedBase > headroomBase) return { allow: false, reason: 'budget_exceeded' };
  return { allow: true };
}

export interface FlowEntryInput {
  seasonId: number;
  source: FlowSource;
  amountBase: bigint; // strictly > 0, base units
  // On-chain replay guard. Required for on-chain-verified movements; the DB
  // enforces UNIQUE so a replayed tx can never double-credit or double-pay.
  txSig?: string | null;
  recipient?: string | null; // payout recipient pubkey (outflows)
  memo?: string | null;
}

export interface InflowResult {
  ok: boolean;
  reason?: FlowReason;
  entryId?: number;
}

export interface EmitResult {
  ok: boolean;
  reason?: FlowReason;
  // Season headroom AFTER this emission on success, or the current headroom that
  // was too small on a `budget_exceeded` rejection.
  headroomBase: bigint;
  entryId?: number;
  payoutId?: number;
}

// The persistence seam. Implemented by flow_ledger_db.ts (Postgres) in
// production and by an in-memory fake in tests. The two budget-sensitive methods
// MUST be internally atomic+serialized per season.
export interface FlowLedgerDb {
  /** Idempotently ensure a season row exists (active). */
  ensureSeason(seasonId: number, label?: string): Promise<void>;
  /** Sum(in) − Sum(out) for a season, in base units. */
  seasonHeadroom(seasonId: number): Promise<bigint>;
  /** Whether a season is open to new movements. */
  seasonIsOpen(seasonId: number): Promise<boolean>;
  /**
   * Record a sink. Idempotent on a non-null txSig (a replayed tx is a no-op that
   * reports reason 'duplicate'). Inflows never gate on budget.
   */
  recordInflow(input: FlowEntryInput): Promise<InflowResult>;
  /**
   * Atomically, under a per-season lock: recompute headroom, apply
   * emissionDecision, and insert the `out` entry + a woc_payouts row ONLY if the
   * amount fits. Idempotent on txSig. Concurrent callers serialize so two
   * payouts can never both spend the same headroom.
   */
  recordOutflowWithinBudget(input: FlowEntryInput): Promise<EmitResult>;
}

/**
 * Thin service over a FlowLedgerDb. Validates direction + amount before touching
 * the DB; the budget invariant itself is enforced atomically in the DB layer.
 */
export class FlowLedger {
  constructor(private readonly db: FlowLedgerDb) {}

  ensureSeason(seasonId: number, label?: string): Promise<void> {
    return this.db.ensureSeason(seasonId, label);
  }

  headroom(seasonId: number): Promise<bigint> {
    return this.db.seasonHeadroom(seasonId);
  }

  /** Credit a verified sink (buy/lock/burn pressure) to a season. */
  async creditInflow(input: FlowEntryInput): Promise<InflowResult> {
    if (directionOf(input.source) !== 'in') return { ok: false, reason: 'wrong_direction' };
    if (input.amountBase <= 0n) return { ok: false, reason: 'bad_amount' };
    if (!(await this.db.seasonIsOpen(input.seasonId))) return { ok: false, reason: 'season_closed' };
    return this.db.recordInflow(input);
  }

  /**
   * Attempt an emission. Returns ok=false reason='budget_exceeded' when the
   * payout would exceed verified sinks — the buy>sell invariant refusing to
   * over-emit. Never throws on a budget rejection; callers must check `.ok`.
   */
  async emit(input: FlowEntryInput): Promise<EmitResult> {
    if (directionOf(input.source) !== 'out') {
      return { ok: false, reason: 'wrong_direction', headroomBase: 0n };
    }
    if (input.amountBase <= 0n) return { ok: false, reason: 'bad_amount', headroomBase: 0n };
    return this.db.recordOutflowWithinBudget(input);
  }
}
