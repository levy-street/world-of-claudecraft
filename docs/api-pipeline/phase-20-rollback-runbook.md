# Phase 20: World Market backfill dry-run and data-rollback runbook

Operator runbook for the Phase 20 World Market realm-scope fix. Read this before
you first boot Phase 20 code against a production database that has live market
listings. The change is persistence-only (it does not touch the routing pipeline
or the `API_DISPATCH` flag), so the dispatch-flag rollback does NOT revert it; the
rollback here is a data operation on the `world_state` table.

## What the backfill does

Before realm scoping, every realm process on one `DATABASE_URL` persisted the
World Market to a single bare `world_state` row keyed `'market'`, so two realms
clobbered each other last-writer-wins. Phase 20 scopes the key per realm
(`market:<realm>`) and migrates the surviving global blob once, at boot:

- It partitions the pre-scoping `'market'` row per SELLER realm. Seller keys are
  resolved through the `characters` table: a numeric seller key by character id,
  otherwise by character name. A seller that cannot be resolved (unknown id,
  unknown name, a name that matches characters on more than one realm, or the
  house key) is NOT dropped: it is routed to the realm of the process that ran
  the backfill and counted in an `unresolvedCount`.
- It runs one-shot inside `ensureSchema`'s `pg_advisory_xact_lock` transaction at
  boot (`server/market_backfill.ts`, wired in `server/db.ts`), so a concurrent
  realm boot cannot race it.
- On success it records a completion marker row, `world_state` key
  `'market_backfill_done'`. Every later boot sees the marker and is a no-op.
- It RETAINS the legacy `'market'` row unchanged as the rollback artifact. The
  backfill never deletes or rewrites it, and `saveWorldState` hard-rejects any
  write to `'market'`, so it stays a frozen pre-partition snapshot.

The realm-scoped write path is gated: `saveMarketState` (and the escrow-txn
market write) refuse to run until `ensureSchema` has confirmed the marker and
called `openMarketWriteGate` after its transaction COMMITs. This is what stops a
30 second autosave from overtaking the backfill across N realms.

## Dry run, then apply

Preview the partition plan before writing anything:

1. Set `MARKET_BACKFILL_DRY_RUN=1` and boot ONE realm process.
2. The runner logs the per-realm plan (per-realm listing counts, escrow copper,
   and the unresolved-seller count) and then halts boot deliberately with an
   error stating that `MARKET_BACKFILL_DRY_RUN` stopped the boot after computing
   the plan and wrote NOTHING (no partitions, no marker row).
3. Review the logged plan. Confirm the per-realm listing counts and escrow sums
   add up to the pre-partition global totals and that the unresolved count is
   what you expect.
4. Unset `MARKET_BACKFILL_DRY_RUN` and boot normally to apply. The apply path
   verifies conservation (post-partition per-realm listing count and escrow
   copper equal the pre-partition global totals) and throws before writing if
   they diverge.

## Data rollback

The legacy `'market'` row still holds the exact pre-partition blob, so a rollback
is: remove the per-realm rows the partition wrote plus the marker row, then boot
pre-Phase-20 code (which reads the bare `'market'` row again), or re-run the
backfill after fixing whatever was wrong.

Run these against the shared database with every Phase 20 realm process stopped:

```sql
-- 1. Confirm the retained pre-partition snapshot is still present.
SELECT key, updated_at FROM world_state WHERE key = 'market';

-- 2. Delete the per-realm partitions the backfill created.
DELETE FROM world_state WHERE key LIKE 'market:%';

-- 3. Delete the completion marker so a later boot re-runs the backfill.
DELETE FROM world_state WHERE key = 'market_backfill_done';
```

Step 2's `LIKE 'market:%'` matches only the realm-scoped keys; it never matches
the bare `'market'` row or the `'market_backfill_done'` marker.

NEVER delete the legacy row itself. `DELETE FROM world_state WHERE key = 'market'`
destroys the only pre-partition snapshot and makes rollback impossible. If you
need to inspect it, SELECT it; do not remove it.

## Caveats

1. A database that already booted the EARLIER hotfix's lazy migration no longer
   has a legacy row to roll back to. That migration claimed the whole `'market'`
   blob into the first booting realm's key and DELETED the bare row. For such a
   database there is nothing to partition and rollback-from-legacy is
   unavailable: the claimed realm row IS the live data. Phase 20's backfill finds
   no legacy row, writes only the marker, and is otherwise a no-op.
2. Mixed-version fleets corrupt or lose market data. Which failure you get
   depends on which OLD code the not-yet-upgraded realm process is running:

   - Pre-scoping code (before the v0.19.0 lazy-migration hotfix) keeps writing
     the bare `'market'` row through its 30 second autosave AFTER the backfill
     has run. Upgraded code reads the marker and never serves the legacy row
     again, so every listing, sale, and escrowed copper a player creates on
     that old realm after the backfill is STRANDED in the bare row and silently
     disappears the moment that realm upgrades. This is data loss for that
     realm's players, not cosmetic drift.
   - The v0.19.0 hotfix's lazy-migration code is WORSE. It writes realm-scoped
     keys, but on its first market load with no `market:<realm>` row of its own
     (a realm the backfill resolved no sellers to, so no partition was written
     for it) it claims the retained legacy row `FOR UPDATE`, adopts the ENTIRE
     pre-partition blob into its one realm key (duplicating every listing the
     backfill already partitioned to other realms), and DELETES the bare row,
     destroying the rollback artifact this runbook depends on. The row lock
     serializes it against the backfill transaction, so there is no torn read;
     the damage is the adoption itself.

   Mitigation for both: treat the migration as one maintenance window. Stop
   EVERY realm process, deploy Phase 20 everywhere, then boot them; do not run
   a mixed fleet against a live market. After the window, verify no old
   process interfered:

   ```sql
   SELECT (SELECT updated_at FROM world_state WHERE key = 'market') AS legacy,
          (SELECT updated_at FROM world_state WHERE key = 'market_backfill_done') AS marker;
   ```

   If `legacy` is NEWER than `marker`, a pre-scoping process wrote after the
   backfill ran: diff that blob against the per-realm rows and reconcile the
   stranded listings and copper by hand (the bare row still stays in place as
   the rollback artifact). If `legacy` is NULL, a hotfix-era process adopted
   and deleted the retained row: find the realm row holding the duplicated
   global blob, remove the listings the backfill already partitioned to other
   realms from it, and restore the bare `'market'` row from backup if you
   still need the rollback option.
3. The backfill runs inside the realm processes' shared `pg_advisory_xact_lock`
   critical section, so concurrent boots serialize: exactly one process runs the
   partition and the rest observe the marker and no-op.
4. Failures are fail-closed by design. A conservation mismatch or a malformed
   legacy blob throws inside the boot transaction: everything rolls back, the
   write gate never opens, and the realm process exits instead of proceeding on
   partial market data. The realm stays down until an operator repairs the
   `'market'` row (or restores it from backup) and boots again; down beats
   silent data loss here.
5. The marker is one-way. On a database with no legacy row at all (a fresh DB,
   or caveat 1's already-claimed DB) the backfill still writes the marker
   (recording `legacyRowFound: false`), and once the marker exists upgraded
   code never reads the bare `'market'` row again, so a legacy row restored
   later (for example from backup) is NEVER re-adopted on its own. To make a
   restored legacy row take effect, run the Data rollback steps above (delete
   the partitions and the marker) so the next boot re-runs the backfill
   against it.
