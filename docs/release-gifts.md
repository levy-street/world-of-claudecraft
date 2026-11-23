# v0.45.0 release gifts

This operator grants one available appearance redesign to every existing character
in one named realm, including characters that spent the earlier redesign. It clears
normal and heroic dungeon/raid keys from `state.raidLockouts`. World bosses, weekly
quests, unknown keys, inventory, membership items and other saved state are preserved.
An unspent legacy redesign does not stack with this grant.

## Before maintenance

- Ship the grant-aware consumer and bundled `dist-server/migrate_release_gifts.cjs`.
- Reconcile the canonical second-brain release and deployment procedures. Add these
  commands to the stopped migration window in woc-deploy before launching; do not
  improvise a live database reset or replace the normal countdown/backup sequence.
- Record an explicit UTC cutoff for the existing-character cohort. Use the same
  cutoff and limits for preview and apply. No default realm or cutoff is assumed.
- Confirm all target-realm writers and admission paths will be stopped, including
  workers outside the game container. Process exit is insufficient if shutdown logs
  report failed character saves. Check those logs before taking the backup.
- Verify database disk/WAL headroom and the PostgreSQL version. A local rehearsal
  on PostgreSQL 16.14 and pg 8.22 with all eight production character index shapes,
  100,000 synthetic characters / 282.6 MB logical state took about 17 seconds to
  apply, generated about 741 MB WAL, and grew the character relation by about
  316 MB, with dead-tuple space reusable after vacuum; ordinary vacuum does not
  promise filesystem shrink. Reserve at least 2 GiB additional headroom, separately
  accounting for the backup and retained/replicated WAL. These are local measurements,
  not production timing guarantees. Rehearse again if the cohort exceeds this size.

## Commands in the maintenance window

Run via the newly built game image with its production environment and network,
after stopping target writers, checking successful saves, and taking the backup.
Keep admissions closed until the grant-aware server is running.

1. Prepare additive schema, separately from the data transaction:

   `node dist-server/migrate_release_gifts.cjs --prepare-schema`

2. Preview (replace `CUTOFF` with an explicit ISO UTC timestamp ending in `Z`):

   `node dist-server/migrate_release_gifts.cjs --realm Claudemoon --created-before CUTOFF --max-characters 100000 --max-state-bytes 280000000`

3. Inspect aggregate counts; apply the same command with `--apply --writers-stopped`.
   The flag attests to physical shutdown; an empty lease table alone does not prove it.

The operation refuses malformed state, excess workload, live target-realm leases,
concurrent operators and an existing completion marker. It locks only the existing
cohort's rows. It preserves the original JSONB datum for characters with no matching
lockouts. Updates and the permanent marker
`v0.45.0-release-gifts:Claudemoon` commit atomically. Never remove the marker to rerun:
a replay would replenish spent redesigns and remove newly earned locks.

## Verification and recovery

Record aggregate counts, cutoff, image/ref, backup, duration and marker. Verify a
previously spent character can redesign once and then cannot repeat it; verify raid
and dungeon locks cleared while world-boss/weekly-quest progress remained.

A failed transaction rolls back both grants and marker. If apply reports an uncertain
connection failure, verify that its database backend has finished and inspect the
marker before restarting or retrying. The CLI deadline alone does not prove the
backend has stopped. A successful apply is a
forward-only operation: there is no automatic undo of player activity after reopening.
Before reopening, restoring the complete maintenance backup is the data rollback.

Older binaries do not understand the grant column and cannot offer the new redesign.
The migration marks the legacy entitlement spent, preventing an old consumer from
spending it and leaving the grant available for a second use after re-upgrade.
Code rollback still requires a grant-aware consumer or closed admissions. Separately,
the release's material-source v2 writer and membership save-format constraints apply;
this operator is not permission to bypass them or run v0.44.7 writers against v0.45 data.

Timeouts: connection 5 seconds, lock 5 seconds, statement 45 seconds, idle transaction
15 seconds, driver query 60 seconds, complete CLI operation 180 seconds. Errors stop
the operator; do not widen limits or skip refusal checks during deployment.
