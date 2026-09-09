// The BOOT steps that make this process a material-source-aware writer's host:
// proving THIS process actually announces the writer capability, installing the
// source audit's storage, and installing the writer guard that refuses every
// connection which does not announce it.
//
// server/material_source_journal_db.ts owns the storage DDL and
// server/material_source_writer.ts owns the guard DDL; both deliberately apply
// nothing themselves. This leaf is the caller half they leave open, kept out of
// server/db.ts so the coordinator carries two ordered call sites rather than
// the policy behind them. The connection-side half (composing the startup
// option) is server/material_source_connection.ts.
//
// THE GUARD IS NOT OPTIONAL AND HAS NO SWITCH. This binary writes new material
// compositions, so from its first save an un-migrated writer editing the same
// rows would silently produce unaudited or wrong composition state; the guard is
// the preventive floor against exactly that, and a floor that ships disarmed is
// not a floor. Stopping the old fleet first is a DEPLOYMENT PREREQUISITE (the
// contract's coordinated flush and stop), not a reason to leave the runtime
// defence off: after this boot, every writer without the capability aborts its
// whole transaction, which is the intended and stated effect.
//
// The capability assertion is the other half of the same decision: a process
// that installs the guard and cannot itself satisfy it would refuse its own
// saves at the first write, so boot REFUSES first, loudly, before the DDL. It
// also proves at runtime what no unit test can: that node-postgres's own
// connection-string resolution did not drop the composed `options` on the way
// to the server.
//
// None of these steps opens a connection: the caller passes its own
// advisory-locked schema transaction (and its pool, for the probe), so the DDL
// lands inside the boot transaction that already serializes schema setup across
// realm processes.

import {
  MATERIAL_SOURCE_JOURNAL_SCHEMA,
  MATERIAL_SOURCE_JOURNAL_TABLE,
} from './material_source_journal_db';
import {
  MATERIAL_SOURCE_WRITER_CAPABILITY,
  MATERIAL_SOURCE_WRITER_GUARD_SQL,
  MATERIAL_SOURCE_WRITER_VERSION,
} from './material_source_writer';

/** The boot client these steps run on: the caller's advisory-locked schema
 *  transaction (and, for the probe, its pool), never a connection of our own.
 *  The result is `unknown` because a pg Client, a Pool and a test double all
 *  answer differently shaped objects; the probe reads its one column
 *  defensively rather than demanding a driver type here. */
export interface MaterialSourceBootClient {
  query(text: string): Promise<unknown>;
}

/**
 * The source audit's storage (the container anchors plus their journal).
 * Additive and idempotent, and it references `characters`, so the caller must
 * have applied the core schema first. It must also run BEFORE the growth-budget
 * fragment, whose aggregate audit-row budget has to be able to count this table.
 */
export async function applyMaterialSourceSchema(client: MaterialSourceBootClient): Promise<void> {
  await client.query(MATERIAL_SOURCE_JOURNAL_SCHEMA);
}

/** What a connection reports as its announced writer capability. `true` makes
 *  an unset GUC NULL instead of an error, which is exactly the un-migrated
 *  case this asks about. Static text over code-owned constants; no caller input
 *  reaches it. */
export const MATERIAL_SOURCE_CAPABILITY_PROBE_SQL = `SELECT current_setting('${MATERIAL_SOURCE_WRITER_CAPABILITY}', true) AS capability`;

/** The fixed leading text of the startup refusal (the operator's first clue). */
export const MATERIAL_SOURCE_CAPABILITY_REFUSAL =
  'material source writer capability is not announced on this connection';

function announcedCapability(result: unknown): string | null {
  const rows = (result as { rows?: unknown[] } | null)?.rows;
  const row = Array.isArray(rows) ? (rows[0] as { capability?: unknown } | undefined) : undefined;
  const capability = row?.capability;
  return typeof capability === 'string' ? capability : null;
}

/**
 * Refuse to boot unless every connection this process writes through announces
 * the code-owned capability.
 *
 * This runs BEFORE the guard DDL on purpose. Installing the guard first and
 * discovering the problem at the first save would take the realm down through
 * a save failure instead of a boot failure, and would leave a database whose
 * guard nothing in this process can satisfy. Both the boot client and the pool
 * are probed because they are separate connections: they are built from one
 * composed configuration, but only asking the server proves the driver's own
 * resolution carried it (a connection string that re-supplies `options` is the
 * documented way that composition can be lost).
 *
 * @throws naming the connection that failed, never the connection string.
 */
export async function assertMaterialSourceWriterCapability(
  connections: readonly { readonly label: string; readonly client: MaterialSourceBootClient }[],
): Promise<void> {
  for (const { label, client } of connections) {
    const result = await client.query(MATERIAL_SOURCE_CAPABILITY_PROBE_SQL);
    const announced = announcedCapability(result);
    if (announced === MATERIAL_SOURCE_WRITER_VERSION) continue;
    throw new Error(
      `${MATERIAL_SOURCE_CAPABILITY_REFUSAL}: ${label} reports ` +
        `${announced === null ? 'nothing' : `version ${announced}`}, expected ` +
        `${MATERIAL_SOURCE_WRITER_VERSION}. The startup option was composed but did not reach ` +
        'the server; check the connection string for its own options parameter.',
    );
  }
}

/**
 * The writer guard: one BEFORE ... FOR EACH STATEMENT trigger per guarded
 * table, applied UNCONDITIONALLY on every boot, and only ever from a caller
 * that has already applied every table it guards.
 *
 * The capability assertion is folded in rather than left to the call site, and
 * runs FIRST: installing a guard this process cannot satisfy would take the
 * realm down at its first save instead of at boot, so the two are one step and
 * no caller can perform half of it. The pool is probed beside the boot client
 * because it is a different connection and it is the one production writes ride.
 *
 * Idempotent (CREATE OR REPLACE throughout), so every later boot re-applies it
 * harmlessly and a database restored from a pre-guard backup is re-armed by the
 * next boot rather than silently left open.
 */
export async function applyMaterialSourceWriterGuard(
  boot: MaterialSourceBootClient,
  pool: MaterialSourceBootClient,
): Promise<void> {
  await assertMaterialSourceWriterCapability([
    { label: 'schema boot client', client: boot },
    { label: 'pool', client: pool },
  ]);
  await boot.query(MATERIAL_SOURCE_WRITER_GUARD_SQL);
  console.log(
    `[material-source] writer capability guard applied; writers without the capability are ` +
      `refused, ${MATERIAL_SOURCE_JOURNAL_TABLE} is live`,
  );
}
