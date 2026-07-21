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
}

// One characters row projection ({ id, realm, state }); state arrives parsed
// (JSONB) from Postgres, or as a JSON string from a fixture.
export interface BankAuditCharacter {
  id: number;
  realm: string;
  state: unknown;
}

export interface BankAuditFinding {
  container: string;
  realm: string;
  characterId: number;
  kind: string;
  detail: string;
}

// The pure checker: replays the ledger against the persisted bank state and
// returns every shape or conservation anomaly, grouped by container.
export function auditBank(input: {
  ledgerRows: BankLedgerAuditRow[];
  characters: BankAuditCharacter[];
}): BankAuditFinding[];

// A one-line-per-finding report grouped by container, plus per-container counts.
export function formatReport(
  ledgerRows: BankLedgerAuditRow[],
  findings: BankAuditFinding[],
): string;
