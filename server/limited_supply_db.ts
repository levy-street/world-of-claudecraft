// Cross-realm serial ledger for limited-supply relic drops (the true-scarcity
// feature; sim side: src/sim/loot/limited_gate.ts + content/limited_drops.ts).
// One shared Postgres backs every realm process, so a relic's global supply is
// enforced across the whole cluster: a serial is unique per (item_id, serial),
// and next_serial never advances past supply.
//
// SQL lives ONLY here (server/CLAUDE.md); the logic + in-memory lease pool lives
// in server/limited_supply.ts, which talks to the LimitedSupplyDb interface so
// tests drive it with an in-memory fake. The DDL is applied by ensureSchema
// (server/db.ts) under the boot advisory lock, idempotent like every other
// *_SCHEMA module.
//
// Serial lifecycle: leased -> minted (confirmed in a player's possession) or
// leased -> released (a graceful shutdown returned an unclaimed buffer serial to
// the pool for dense reuse). A serial is NEVER re-adopted on boot: once leased it
// is treated as issued/in-flight, so an ungraceful crash can only LOSE a serial
// (it stays orphaned as 'leased', reducing effective supply by the small buffer
// size), never DOUBLE-ISSUE it. That keeps the hard cap inviolable across crashes.

import type { Pool } from 'pg';
import { ITEMS } from '../src/sim/data';

export const LIMITED_SUPPLY_SCHEMA = `
-- Per-item cap and the monotonic fresh-serial cursor. Seeded from content at
-- boot (idempotent); supply is frozen once set (a later cap change is an ops
-- migration, not a silent overwrite).
CREATE TABLE IF NOT EXISTS limited_item_supply (
  item_id TEXT PRIMARY KEY,
  supply INT NOT NULL,
  next_serial INT NOT NULL DEFAULT 1
);
-- Every serial ever handed out, one row per (item_id, serial). The PRIMARY KEY
-- makes a duplicate serial physically impossible; state tracks its lifecycle.
CREATE TABLE IF NOT EXISTS limited_serials (
  item_id TEXT NOT NULL,
  serial INT NOT NULL,
  state TEXT NOT NULL DEFAULT 'leased',
  realm TEXT NOT NULL,
  character_id INT,
  character_name TEXT,
  boss_id TEXT,
  leased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  minted_at TIMESTAMPTZ,
  PRIMARY KEY (item_id, serial)
);
-- Reclaim the lowest released serial first (dense reuse), and count by state
-- cheaply for the public read.
CREATE INDEX IF NOT EXISTS limited_serials_reclaim ON limited_serials(item_id, state, serial);
`;

// Winner attribution recorded when a leased serial is confirmed minted.
export interface LimitedMintAttribution {
  characterId: number | null;
  characterName: string;
  bossId: string | null;
}

// One confirmed mint, for the public ledger read.
export interface LimitedMintRecord {
  itemId: string;
  serial: number;
  characterName: string | null;
  realm: string;
  mintedAt: string;
}

// Aggregate counts per item, for the public ledger read.
export interface LimitedSupplyRow {
  itemId: string;
  supply: number;
  minted: number;
  leased: number;
}

// The full public snapshot the REST endpoint serves (raw, before enrichment
// with the item's display name/quality from the content catalog).
export interface LimitedMintsSnapshot {
  supplies: LimitedSupplyRow[];
  mints: LimitedMintRecord[];
}

// The persistence seam the service depends on. PgLimitedSupplyDb is the real
// implementation; tests inject an in-memory fake with identical semantics.
export interface LimitedSupplyDb {
  // Idempotent: create a supply row per item if absent. Never lowers an existing
  // cap (supply is frozen once shipped).
  seedSupply(items: { itemId: string; supply: number }[]): Promise<void>;
  // Atomically hand out one serial for `itemId` to `realm`: reclaim the lowest
  // released serial, else allocate the next fresh one if the cap is not spent,
  // else return null (exhausted). The row is left in state 'leased'.
  leaseSerial(itemId: string, realm: string): Promise<number | null>;
  // Confirm a leased serial as minted with its winner attribution. A no-op if the
  // serial is not currently 'leased' (already minted / released), so a retried
  // observer write never double-attributes.
  markMinted(itemId: string, serial: number, attr: LimitedMintAttribution): Promise<void>;
  // Return this realm's still-leased buffer serials to the pool (graceful
  // shutdown), so a clean restart reuses them instead of burning them.
  releaseSerials(itemId: string, serials: number[], realm: string): Promise<void>;
  // The public ledger snapshot: per-item counts plus every confirmed mint.
  readMints(): Promise<LimitedMintsSnapshot>;
}

// The content-declared supply caps, derived from the item catalog (every item
// with ItemDef.limitedSupply). The single source of truth the service seeds from,
// so adding a relic in content/limited_drops.ts is all it takes to register it.
export function limitedSupplyCaps(): { itemId: string; supply: number }[] {
  const caps: { itemId: string; supply: number }[] = [];
  for (const item of Object.values(ITEMS))
    if (item.limitedSupply !== undefined)
      caps.push({ itemId: item.id, supply: item.limitedSupply });
  return caps;
}

// The shared-pool implementation the server uses. Tests inject a fake instead.
export function createLimitedSupplyDb(pool: Pool): LimitedSupplyDb {
  return new PgLimitedSupplyDb(pool);
}

export class PgLimitedSupplyDb implements LimitedSupplyDb {
  constructor(private readonly pool: Pool) {}

  async seedSupply(items: { itemId: string; supply: number }[]): Promise<void> {
    for (const { itemId, supply } of items) {
      await this.pool.query(
        `INSERT INTO limited_item_supply (item_id, supply) VALUES ($1, $2)
         ON CONFLICT (item_id) DO NOTHING`,
        [itemId, supply],
      );
    }
  }

  async leaseSerial(itemId: string, realm: string): Promise<number | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // 1. Reclaim the lowest released serial (dense reuse). SKIP LOCKED so two
      //    realms leasing the same item concurrently never block each other.
      const reclaimed = await client.query(
        `UPDATE limited_serials s
           SET state = 'leased', realm = $2, leased_at = now(),
               character_id = NULL, character_name = NULL, boss_id = NULL, minted_at = NULL
         WHERE (s.item_id, s.serial) = (
           SELECT item_id, serial FROM limited_serials
           WHERE item_id = $1 AND state = 'released'
           ORDER BY serial LIMIT 1 FOR UPDATE SKIP LOCKED
         )
         RETURNING s.serial`,
        [itemId, realm],
      );
      if ((reclaimed.rowCount ?? 0) > 0) {
        await client.query('COMMIT');
        return reclaimed.rows[0].serial as number;
      }
      // 2. Allocate a fresh serial if the cap is not spent. The UPDATE advances
      //    the cursor only while next_serial <= supply, and returns the serial it
      //    just consumed; an exhausted item returns no row.
      const fresh = await client.query(
        `UPDATE limited_item_supply
           SET next_serial = next_serial + 1
         WHERE item_id = $1 AND next_serial <= supply
         RETURNING next_serial - 1 AS serial`,
        [itemId],
      );
      if ((fresh.rowCount ?? 0) === 0) {
        await client.query('COMMIT');
        return null; // supply exhausted (or unseeded item)
      }
      const serial = fresh.rows[0].serial as number;
      await client.query(
        `INSERT INTO limited_serials (item_id, serial, state, realm) VALUES ($1, $2, 'leased', $3)`,
        [itemId, serial, realm],
      );
      await client.query('COMMIT');
      return serial;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async markMinted(itemId: string, serial: number, attr: LimitedMintAttribution): Promise<void> {
    await this.pool.query(
      `UPDATE limited_serials
         SET state = 'minted', character_id = $3, character_name = $4, boss_id = $5, minted_at = now()
       WHERE item_id = $1 AND serial = $2 AND state = 'leased'`,
      [itemId, serial, attr.characterId, attr.characterName, attr.bossId],
    );
  }

  async releaseSerials(itemId: string, serials: number[], realm: string): Promise<void> {
    if (serials.length === 0) return;
    await this.pool.query(
      `UPDATE limited_serials
         SET state = 'released', character_id = NULL, character_name = NULL, boss_id = NULL
       WHERE item_id = $1 AND serial = ANY($2::int[]) AND state = 'leased' AND realm = $3`,
      [itemId, serials, realm],
    );
  }

  async readMints(): Promise<LimitedMintsSnapshot> {
    const supplyRows = await this.pool.query(
      `SELECT s.item_id,
              s.supply,
              COALESCE(m.minted, 0) AS minted,
              COALESCE(m.leased, 0) AS leased
       FROM limited_item_supply s
       LEFT JOIN (
         SELECT item_id,
                COUNT(*) FILTER (WHERE state = 'minted') AS minted,
                COUNT(*) FILTER (WHERE state = 'leased') AS leased
         FROM limited_serials GROUP BY item_id
       ) m ON m.item_id = s.item_id`,
    );
    const mintRows = await this.pool.query(
      `SELECT item_id, serial, character_name, realm, minted_at
       FROM limited_serials WHERE state = 'minted'
       ORDER BY item_id, serial`,
    );
    return {
      supplies: supplyRows.rows.map((r) => ({
        itemId: r.item_id as string,
        supply: Number(r.supply),
        minted: Number(r.minted),
        leased: Number(r.leased),
      })),
      mints: mintRows.rows.map((r) => ({
        itemId: r.item_id as string,
        serial: Number(r.serial),
        characterName: (r.character_name as string | null) ?? null,
        realm: r.realm as string,
        mintedAt: new Date(r.minted_at as string | Date).toISOString(),
      })),
    };
  }
}
