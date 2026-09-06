// The one SQL read behind server/mail_recipient.ts: which account owns a
// character row. Kept in a *_db module per server/CLAUDE.md (logic modules
// carry no raw SQL); parameterized, realm-agnostic (character ids are global).

/** The slice of a pg Pool this module needs (a Vitest fakes it). */
export interface AccountLookupPool {
  query(text: string, params: unknown[]): Promise<{ rows: { account_id: number }[] }>;
}

/** The account id that owns `characterId`, or null when no such row exists. */
export async function characterAccountId(
  pool: AccountLookupPool,
  characterId: number,
): Promise<number | null> {
  const res = await pool.query('SELECT account_id FROM characters WHERE id = $1', [characterId]);
  const row = res.rows[0];
  return row === undefined ? null : Number(row.account_id);
}
