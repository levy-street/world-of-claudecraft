import type { Pool } from 'pg';

// One atomic consumption for the grant and legacy entitlement; never stacks.
export async function consumeAppearanceRerollOn(
  db: Pick<Pool, 'query'>,
  realm: string,
  accountId: number,
  characterId: number,
  appearance: Record<string, unknown>,
  helmHidden: boolean | null,
  createdBefore: Date,
): Promise<boolean> {
  const res = await db.query(
    `UPDATE characters
        SET appearance = $3::jsonb,
            appearance_reroll_used = TRUE,
            appearance_reroll_granted = FALSE,
            state = CASE
                      WHEN state IS NULL OR $5::boolean IS NULL THEN state
                      WHEN $5::boolean AND state->'helmHidden' IS DISTINCT FROM 'true'::jsonb
                        THEN jsonb_set(state, '{helmHidden}', 'true'::jsonb, true)
                      WHEN NOT $5::boolean AND state ? 'helmHidden'
                        THEN state - 'helmHidden'
                      ELSE state
                    END,
            updated_at = now()
      WHERE id = $1 AND account_id = $2 AND realm = $4
        AND (appearance_reroll_granted OR
             (appearance_reroll_used = FALSE AND (created_at < $6 OR appearance IS NULL)))`,
    [characterId, accountId, JSON.stringify(appearance), realm, helmHidden, createdBefore],
  );
  return (res.rowCount ?? 0) > 0;
}
