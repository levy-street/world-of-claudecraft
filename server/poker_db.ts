export interface PokerTableRow {
  payload: unknown;
  revision: number;
}

export async function savePokerTable(
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>,
  tableId: string,
  payload: unknown,
  revision: number,
): Promise<void> {
  await query(
    `INSERT INTO poker_tables(table_id, payload, revision, updated_at)
     VALUES($1, $2, $3, now())
     ON CONFLICT (table_id) DO UPDATE SET payload = EXCLUDED.payload, revision = EXCLUDED.revision, updated_at = now()`,
    [tableId, JSON.stringify(payload), revision],
  );
}

export async function loadPokerTable(
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>,
  tableId: string,
): Promise<PokerTableRow | null> {
  const result = await query('SELECT payload, revision FROM poker_tables WHERE table_id = $1', [tableId]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    payload: JSON.parse(String(row.payload)),
    revision: Number(row.revision ?? 0),
  };
}
