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
// (JSONB) from Postgres, or as a JSON string from a fixture.
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

// The two anomaly op names, mirrored from server/bank_ledger.ts
// (GUILD_BANK_ESCROW_DEFICIT_OP / GUILD_BANK_COUNTERPARTY_ORPHAN_OP); pinned
// in lockstep by tests/bank_audit.test.ts.
export const ESCROW_DEFICIT_OP: string;
export const COUNTERPARTY_ORPHAN_OP: string;

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
