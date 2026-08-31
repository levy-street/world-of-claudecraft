// Type surface for the offline bank ledger conservation audit (see
// bank_audit.mjs). Mirrors the scripts/*.d.mts convention so the test can import
// the .mjs under strict tsc without an implicit-any error. Numeric columns admit
// strings because pg returns BIGINT columns (id, copper_delta) as strings.

// One bank_ledger row as Postgres returns it (snake_case).
export interface BankLedgerAuditRow {
  id: number | string;
  realm: string;
  character_id: number;
  op: string;
  item_id: string | null;
  count: number | string | null;
  instance: unknown;
  copper_delta: number | string;
  purchased_slots_after: number | string;
  container: string;
  container_id: number | string | null;
  /** The COUNTERPARTY (payer/payee) side of a guild row: signed copper and
   *  signed item count the ACTING CHARACTER'S purse and bags moved under this
   *  op. Absent / null means NOT RECORDED (a pre-feature row, or a
   *  personal-container row, which never writes one), and the per-op balance
   *  check skips those rather than reading absence as balance. */
  counterparty_copper_delta?: number | string | null;
  counterparty_count?: number | string | null;
}

// One characters row projection ({ id, realm, state }); state arrives parsed
// (JSONB) from Postgres, or as a JSON string from a fixture. Two slices are
// read: `bank` (the personal container) and `vault` (the Materials Vault),
// each reconciled against its own container's ledger replay.
export interface BankAuditCharacter {
  id: number;
  realm: string;
  state: unknown;
}

// One guild_banks row projection ({ guild_id, realm, data }); data arrives
// parsed (JSONB) from Postgres, or as a JSON string from a fixture.
export interface BankAuditGuildBank {
  guild_id: number | string;
  realm: string;
  data: unknown;
}

export interface BankAuditFinding {
  container: string;
  realm: string;
  // Personal findings carry the character; guild findings carry the guild
  // (characterId null) because the guild bank is an anonymous exchange pipe.
  characterId: number | null;
  guildId?: number | null;
  kind: string;
  detail: string;
}

// The guild slot ladder's valid purchased_slots_after values, mirrored from
// src/sim/guild_bank.ts (the .mjs stays dependency-free of the TS sim;
// tests/bank_audit.test.ts pins the two declarations in lockstep).
export const OPEN_BANK_SLOTS_AFTER: number;
export const GUILD_BUY_POSITIONS: readonly number[];

// The vault ladder's top rung, mirrored from VAULT_UPGRADE_PRICES.length in
// src/sim/materials_vault.ts (same dependency-free rule as the ladder above);
// tests/bank_audit.test.ts pins the two in lockstep.
export const VAULT_MAX_RUNG: number;

// The bank bag-socket price ladder, mirrored from BANK_SOCKET_PRICES in
// src/sim/bank.ts (same dependency-free rule); tests/bank_audit.test.ts pins
// the two in lockstep. A legitimate per-character unlock history is a PREFIX
// of this list.
export const BANK_SOCKET_PRICES: readonly number[];

// Every container the reconciliation passes actually replay, mirrored from the
// BankLedgerRow.container union in server/db.ts (same dependency-free rule as
// the ladder above); tests/bank_audit.test.ts pins the two in lockstep.
export const KNOWN_CONTAINERS: ReadonlySet<string>;

// The op vocabulary the shape chain handles, mirrored from the
// BankLedgerRow.op union in server/db.ts (same dependency-free rule);
// tests/bank_audit.test.ts pins the two in lockstep BOTH ways and derives the
// known-op guard's fixture keys from it.
export const KNOWN_OPS: ReadonlySet<string>;

// The two anomaly op names, mirrored from server/bank_ledger.ts
// (GUILD_BANK_ESCROW_DEFICIT_OP / GUILD_BANK_COUNTERPARTY_ORPHAN_OP); pinned
// in lockstep by tests/bank_audit.test.ts.
export const ESCROW_DEFICIT_OP: string;
export const COUNTERPARTY_ORPHAN_OP: string;

// The characters read: the { id, realm, state } projection main() buffers,
// with state narrowed to the bank and vault slices the audit reconciles.
// Hoisted out of main() and exported so tests/bank_audit.test.ts can pin both
// extractions BY SOURCE TEXT (an assertion on the evaluated constant would be a
// self-comparison a rewritten projection satisfies just as well).
export const CHARACTERS_SQL: string;

// The counterparty half of the ledger SELECT list, given the columns the
// database actually has. A database that predates the counterparty columns
// selects typed NULLs instead, so the audit degrades into its "unbalanceable,
// skipped" path rather than dying on a restored pg_dump.
export function counterpartySelectList(presentColumns: Iterable<string>): string;

// The pure checker: replays the ledger against the persisted bank state and
// returns every shape or conservation anomaly, grouped by container. Guild
// reconciliation runs only when guildBanks is provided.
export function auditBank(input: {
  ledgerRows: BankLedgerAuditRow[];
  characters: BankAuditCharacter[];
  guildBanks?: BankAuditGuildBank[];
}): BankAuditFinding[];

// A one-line-per-finding report grouped by container, plus per-container counts.
export function formatReport(
  ledgerRows: BankLedgerAuditRow[],
  findings: BankAuditFinding[],
): string;

// One storage_purchases row as Postgres returns it (snake_case). Timestamps
// arrive as Date from pg and as a string from a fixture; both are read.
export interface StoragePurchaseAuditRow {
  id: number | string;
  realm: string;
  account_id: number | string | null;
  character_id: number | string | null;
  item_id: string | null;
  expected_cost_claudium: number | string | null;
  idempotency_key: string;
  status: string;
  created_at: Date | string | null;
  resolved_at: Date | string | null;
}

export interface StoragePurchaseAuditFinding {
  realm: string;
  characterId: number | null;
  accountId: number | null;
  key: string;
  status: string;
  kind: string;
  detail: string;
}

// A pending row younger than this is ordinary in-flight work rather than an
// incident; tests/bank_audit.test.ts pins the threshold and both sides of it.
export const STORAGE_PURCHASE_STRANDED_HOURS: number;

// How many open rows one report lists before it says it truncated.
export const STORAGE_PURCHASE_REPORT_LIMIT: number;

// The storage purchase status vocabulary, mirrored from StoragePurchaseStatus
// in server/storage_purchase_db.ts (the .mjs stays dependency-free of the TS
// server); tests/bank_audit.test.ts pins the two in lockstep.
export const STORAGE_PURCHASE_STATUSES: ReadonlySet<string>;

// The pure checker for the operator surface: every storage_purchases row a
// person should look at (unresolved cases, stranded pending rows, and any
// status outside the vocabulary). nowMs is injected so the age threshold is
// testable.
export function auditStoragePurchases(input: {
  rows: StoragePurchaseAuditRow[];
  nowMs: number;
}): StoragePurchaseAuditFinding[];

// The storage-purchase section printed under the ledger report, including what
// was read so a clean section cannot be mistaken for an unqueried one.
export function formatStoragePurchaseReport(
  rows: StoragePurchaseAuditRow[],
  findings: StoragePurchaseAuditFinding[],
  truncated?: boolean,
  /** Whole-table per-status counts. Passed by the CLI so a truncated read
   *  reports the incident's real size rather than the slice's own tally. */
  totals?: { status: string; n: number }[] | null,
): string;
