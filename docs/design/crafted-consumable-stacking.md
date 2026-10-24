# Crafted consumable stacking

Identical stackable food, drinks, potions, elixirs, flasks and scrolls may share
a bag slot despite different makers. `stackProvenanceItemIds` extends the existing
source composition algebra without changing material-only bag, vault or journal
membership. Only signatures are excluded from stack identity; recipe identity
and all other payload fields retain their existing compatibility rules.
Sorting consolidates existing partial stacks.

Each surviving unit retains its maker in `materialSources`. Consumption resolves
the actual unit's signature before awarding profession experience. Transfers,
partial sales, mail and guild operation replay carry exact source quantities.
Empty buckets disappear; attribution is not a historical log that grows forever.
Normal capped stacks cannot contain more source buckets than units. Legacy
oversized rows remain supported by the existing load policy.

## Deployment and rollback

This changes the accepted persisted JSONB format. Writer capability version 2
fences connections from binaries that only understand material provenance.
No new table, index or consumable journal baseline is introduced.

1. Flush and stop every realm and every background, admin or offline writer.
2. Take a consistent database backup and deploy the upgraded binary everywhere.
3. Start the new fleet. Under the schema advisory lock and boot transaction,
   `prepareMaterialSourceWriterUpgrade` verifies connection capabilities and
   replaces the guard function before schema backfills write guarded tables.
   The final guard installation still runs after all guarded tables exist.
4. Verify successful boot and capability 2 before reopening access.

Never start an older binary against the upgraded database. Old loaders reject
consumable source records and old replay paths can discard attribution. An old
schema boot can reinstall its own version-1 function; the guard protects against
lingering old connections, not an operator deliberately booting an old release.
After the first new-format save, rollback requires a coordinated restore of the
pre-cutover backup or a separately tested conversion of every persisted carrier.

Regression evidence lives in `tests/crafted_consumable_*.test.ts` and the
material-source writer, schema-wiring and PostgreSQL integration suites.
