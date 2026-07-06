// Postgres queries for the featured-talent checkout (docs/prd/woc/
// talent-checkout.md). The quote side reuses the shared woc_quotes ledger via
// server/logol_db.ts (kind='talent'); this module owns only the settled-sale
// insert into talent_sales, with the tx_sig UNIQUE constraint as the
// double-spend replay guard. All SQL for this feature lives here, none in
// server/talent.ts (the server SQL invariant, server/CLAUDE.md).
import { pool } from './db';
import type { TalentCurrency } from './talent_config';

export interface TalentSaleRecord {
  accountId: number;
  txSig: string;
  wareId: string;
  talentId: string;
  currency: TalentCurrency;
  amountBase: bigint;
  talentBase: bigint;
  treasuryBase: bigint;
}

/**
 * Record a settled talent sale. Returns false (no row) if this signature was
 * already recorded (the tx_sig UNIQUE guard), so a double-confirm never
 * double-grants. The 80/20 split is stored per sale (talent_base + treasury_base
 * === amount_base).
 */
export async function recordTalentSale(sale: TalentSaleRecord): Promise<boolean> {
  const res = await pool.query(
    `INSERT INTO talent_sales
       (account_id, tx_sig, ware_id, talent_id, currency, amount_base, talent_base, treasury_base)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tx_sig) DO NOTHING
     RETURNING id`,
    [
      sale.accountId,
      sale.txSig,
      sale.wareId,
      sale.talentId,
      sale.currency,
      sale.amountBase.toString(),
      sale.talentBase.toString(),
      sale.treasuryBase.toString(),
    ],
  );
  return res.rows.length > 0;
}
