// Character load leases, moved out of server/db.ts at the v0.42.0 database
// review (the monolith ratchet: db.ts pays for growth by extraction,
// server/CLAUDE.md module-first; server/character_create_db.ts and
// server/character_delete_db.ts are the same split for the other two ends of
// a character's life). The character_leases DDL stays in db.ts's core SCHEMA
// (server/CLAUDE.md: only core character/account/token/world-state DDL lives
// there); this is the query half, unchanged in behavior by the move.
//
// db.ts keeps the export so no caller re-points; the pool comes back from
// db.ts the way every other *_db.ts module takes it.
//
// The cross-process double-load dupe guard. At most one process may hold a
// character in-world at a time. A row in character_leases IS the lease; it
// self-releases via expiry after a crash, so no client checkout or advisory
// lock is pinned for the session's whole length (that would starve the pool
// this shares with HTTP). heartbeats ride the 30s autosave loop.

import { randomUUID } from 'node:crypto';
import { pool } from './db';
import { REALM } from './realm';

// Lease lifetime with no heartbeat before an expired lease is reclaimable. Set
// to three missed 30s autosave heartbeats so a brief GC pause or an autosave
// that runs long never lets a peer steal a live character; only a genuine crash
// (or a clean shutdown that deletes the lease) frees it early.
export const LEASE_TTL_SECONDS = 90;

// One value per process boot: realm name plus a per-boot UUID. Realm alone must
// NOT identify the holder, because two processes accidentally started on the
// SAME realm name is exactly the double-load accident this table guards; if they
// shared a holder the second would treat the first's lease as its own and load
// the character anyway. The UUID keeps every boot distinct.
export const PROCESS_LEASE_HOLDER = `${REALM}#${randomUUID()}`;

// Claim (or renew) the lease for one character. Returns true when this process
// now holds it, false when a live lease belongs to a foreign holder AND a foreign
// account (fail closed: the caller must refuse the join). The ON CONFLICT UPDATE
// fires when the existing lease has expired (crash reclaim) OR is already ours (a
// linkdead resume on the same process re-extends its own lease instead of refusing
// itself) OR belongs to the same account (the owner reclaiming a lease stranded by
// a dead or wedged process before its TTL expires). A live lease that is none of
// those matches no arm, so rowCount stays 0. Every acquire stamps a fresh nonce
// (the caller passes a per-join value): a later releaseCharacterLease matches on
// that nonce, so an older join's stale release cannot delete the row this acquire
// re-stamped, and a same-account reclaim rotates the nonce out from under any
// displaced session, whose fenced writes then fail. accountId is the authenticated
// owner (getCharacter gated the caller before this runs).
export async function acquireCharacterLease(
  characterId: number,
  accountId: number,
  nonce: string,
  holder = PROCESS_LEASE_HOLDER,
): Promise<boolean> {
  const res = await pool.query(
    // The nonce rotation needs no extra code: this ONE atomic statement already
    // re-stamps nonce = EXCLUDED.nonce, which IS the fence rotation. The account arm
    // uses PLAIN EQUALITY (never IS NOT DISTINCT FROM): SQL NULL semantics make a
    // NULL account_id row (a lease that predates this column) fail the account arm
    // and every arm except expiry, which is exactly the locked fail-closed behavior.
    `INSERT INTO character_leases (character_id, realm, holder, nonce, account_id, acquired_at, heartbeat_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, now(), now(), now() + make_interval(secs => $6))
     ON CONFLICT (character_id) DO UPDATE
       SET realm = EXCLUDED.realm,
           holder = EXCLUDED.holder,
           nonce = EXCLUDED.nonce,
           account_id = EXCLUDED.account_id,
           acquired_at = now(),
           heartbeat_at = now(),
           expires_at = EXCLUDED.expires_at
       WHERE character_leases.expires_at < now() OR character_leases.holder = EXCLUDED.holder OR character_leases.account_id = EXCLUDED.account_id`,
    [characterId, REALM, holder, nonce, accountId, LEASE_TTL_SECONDS],
  );
  return (res.rowCount ?? 0) > 0;
}

// Drop the lease for one character on a clean leave. Guarded on holder so this
// never deletes a lease that another process has already reclaimed (e.g. after
// our own lease expired and a peer took over). When a nonce is given it is also
// matched, the fence that makes a stale release a no-op: if a newer acquire has
// re-stamped the row with a different nonce (a reconnect that raced this leave),
// the DELETE finds nothing and the live session keeps its lease. The no-nonce
// arm is for callers that created a session without one (direct game.join in
// tests); it deletes on holder alone as before.
export async function releaseCharacterLease(
  characterId: number,
  nonce?: string,
  holder = PROCESS_LEASE_HOLDER,
): Promise<void> {
  if (nonce === undefined) {
    await pool.query('DELETE FROM character_leases WHERE character_id = $1 AND holder = $2', [
      characterId,
      holder,
    ]);
    return;
  }
  await pool.query(
    'DELETE FROM character_leases WHERE character_id = $1 AND holder = $2 AND nonce = $3',
    [characterId, holder, nonce],
  );
}

// Extend every lease this process holds in one statement, called from the
// autosave loop. A lease already reclaimed by another holder is not matched, so
// this can never steal one back.
export async function heartbeatCharacterLeases(holder = PROCESS_LEASE_HOLDER): Promise<void> {
  await pool.query(
    `UPDATE character_leases
        SET heartbeat_at = now(),
            expires_at = now() + make_interval(secs => $2)
      WHERE holder = $1`,
    [holder, LEASE_TTL_SECONDS],
  );
}

// Shutdown sweep: drop every lease this process holds so a clean restart never
// waits out the TTL before its characters can reload.
export async function releaseAllCharacterLeases(holder = PROCESS_LEASE_HOLDER): Promise<void> {
  await pool.query('DELETE FROM character_leases WHERE holder = $1', [holder]);
}
