// Partitioned Ravenpost mail backfill.
//
// Mail has always been realm-scoped (`mail:<realm>`, one JSONB blob per
// realm), but that one blob grows without bound and the 30 s autosave
// re-serializes and re-writes the WHOLE thing every cycle regardless of what
// changed (issue #3561): on prod this was measured as the recurring
// event-loop stall behind #3555. This module PARTITIONS a realm's legacy
// `mail:<realm>` blob per recipient, once, inside ensureSchema's
// pg_advisory_xact_lock transaction, so autosave can persist only the
// recipients that actually changed (`Sim.takeDirtyMailPartitions`). The
// legacy row is RETAINED (never deleted) as the rollback artifact, mirroring
// server/market_backfill.ts.
//
// This is a *_db-style module: SQL runs against an INJECTED client (type-only
// usage of pg shapes), and it never imports db.ts, mirroring
// market_backfill.ts/ratelimit_db.ts, so db.ts can import the constants and
// the runner without a cycle.
//
// Rollback is WEAKER than market's: market's legacy row was a dormant
// pre-scoping artifact the old code had already stopped writing by the time
// this repo added realm scoping, so reverting a binary never lost live
// writes. Mail's `mail:<realm>` was the LIVE, actively-written key right up
// to the instant this migration ran. Reverting to a pre-#3561 binary after
// ANY post-migration mail activity (a send, a take, a delete, a rename) is a
// ONE-WAY trapdoor: the old binary reads and writes only the frozen legacy
// blob, so every mutation since the migration becomes invisible to it (and
// a later roll-forward never re-adopts that window's mail either, since the
// migration marker makes the backfill a permanent no-op). Recovery after any
// such activity means a database restore, not a binary revert. Do not run
// this migration, then revert, expecting mail to still round-trip.
//
// A rolling deploy that runs an old and a new binary against the SAME realm
// concurrently has the same blind spot in miniature: the old process keeps
// reading/writing the whole legacy blob while the new one reads/writes only
// partitions, and neither observes the other's mutations for the overlap
// window. Deploys must stop the old process before starting the new one per
// realm, not overlap them.
import type { MailSave } from '../src/sim/sim';

// FROZEN CONTRACT: every exported name and signature in this file is shared
// between db.ts, the backfill tests, and the isolation tests. Keep the names
// and shapes exactly as written.

export const MAIL_RECIPIENT_KEY_INFIX = ':r:';
export const MAIL_PARTITION_MARKER_PREFIX = 'mail_partition_done:';

// The Ravenpost mail book: realm-scoped, one JSONB blob per realm under
// `mail:<realm>` (this is the LEGACY whole-book key: the backfill's read
// source and the retained rollback artifact). Canonical home for this
// builder, like marketStateKey lives in market_backfill.ts; db.ts imports and
// re-exports it so its pre-existing consumers keep importing from ./db
// unchanged.
export function mailStateKey(realm: string): string {
  return `mail:${realm}`;
}

// The partitioned per-recipient key: `mail:<realm>:r:<encoded recipientKey>`.
// recipientKey is URI-encoded because it is not always numeric (a returned
// parcel's homeKey can fall back to a display name, see post_office.ts), so it
// could in principle carry a character this key format's own delimiters use.
export function mailRecipientKey(realm: string, recipientKey: string): string {
  return `mail:${realm}${MAIL_RECIPIENT_KEY_INFIX}${encodeURIComponent(recipientKey)}`;
}

export function mailPartitionMarkerKey(realm: string): string {
  return `${MAIL_PARTITION_MARKER_PREFIX}${realm}`;
}

// Minimal query surface of a pg PoolClient inside the ensureSchema
// transaction; tests fake this with a plain object.
export interface MailBackfillClient {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

export interface MailBackfillResult {
  // true when this call performed the partition work; false when the marker
  // row already existed and the call was a no-op.
  ran: boolean;
  legacyRowFound: boolean;
  recipientCount: number;
  letterCount: number;
  // Letters whose recipientKey was not a string (a corrupt row): counted so
  // the marker can distinguish an intentional drop from a partitioning bug,
  // matching PostOffice.loadMail's own tolerance for the same corruption.
  droppedCount: number;
}

export interface MailTotals {
  letterCount: number;
  escrowCopper: number;
  escrowItemCount: number;
}

function numberOr0(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

export function computeMailTotals(mail: MailSave['mail']): MailTotals {
  let escrowCopper = 0;
  let escrowItemCount = 0;
  for (const m of mail) {
    escrowCopper += numberOr0(m.copper);
    for (const s of m.items ?? []) escrowItemCount += numberOr0(s.count);
  }
  return { letterCount: mail.length, escrowCopper, escrowItemCount };
}

// Compares the letters actually kept (post recipientKey-corruption filter,
// the same set partitionMailByRecipient itself groups) against the union of
// every partition bucket. Grouping is the only transformation between the
// two, so this is a defensive floor against a future regression there, the
// same discipline market_backfill.ts's verifyPartitionConservation applies
// before its own writes.
export function verifyMailPartitionConservation(
  kept: MailSave['mail'],
  byRecipient: ReadonlyMap<string, MailSave['mail']>,
): { ok: boolean; expected: MailTotals; actual: MailTotals } {
  const expected = computeMailTotals(kept);
  const actual = computeMailTotals([...byRecipient.values()].flat());
  const ok =
    actual.letterCount === expected.letterCount &&
    actual.escrowCopper === expected.escrowCopper &&
    actual.escrowItemCount === expected.escrowItemCount;
  return { ok, expected, actual };
}

// The exact saveWorldState upsert (server/db.ts). Kept as a literal here so
// the backfill never imports db.ts; the pinning test asserts the shared
// fragment (same discipline as market_backfill.ts's WORLD_STATE_UPSERT_SQL).
const WORLD_STATE_UPSERT_SQL = `INSERT INTO world_state (key, data, updated_at) VALUES ($1, $2, now())
ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;

async function upsertWorldState(
  client: MailBackfillClient,
  key: string,
  data: unknown,
): Promise<void> {
  await client.query(WORLD_STATE_UPSERT_SQL, [key, JSON.stringify(data)]);
}

export interface MailPartitionPlan {
  byRecipient: Map<string, MailSave['mail']>;
  // Every letter that was actually grouped (post-drop): the input the
  // conservation check compares byRecipient's union against.
  kept: MailSave['mail'];
  droppedCount: number;
}

// Split a realm's legacy mail array by recipientKey. Letters with a
// non-string recipientKey (a corrupt row) are dropped, the same tolerance
// PostOffice.loadMail already applies on the legacy whole-blob path.
export function partitionMailByRecipient(mail: MailSave['mail']): MailPartitionPlan {
  const byRecipient = new Map<string, MailSave['mail']>();
  const kept: MailSave['mail'] = [];
  let droppedCount = 0;
  for (const m of mail ?? []) {
    if (!m || typeof m.recipientKey !== 'string') {
      droppedCount++;
      continue;
    }
    kept.push(m);
    const bucket = byRecipient.get(m.recipientKey);
    if (bucket) bucket.push(m);
    else byRecipient.set(m.recipientKey, [m]);
  }
  return { byRecipient, kept, droppedCount };
}

// Run once per realm, inside ensureSchema's advisory-lock transaction:
// 1. If this realm's marker row exists: return { ran: false } issuing no
//    other SQL.
// 2. SELECT the realm's legacy `mail:<realm>` row FOR UPDATE (serializes
//    against a not-yet-upgraded process racing the same realm's autosave).
// 3. Partition by recipientKey (no cross-realm resolution needed: the source
//    blob is already this realm's data, unlike the market's pre-scoping
//    global row), write each partition to `mailRecipientKey(realm, k)`,
//    then INSERT the per-realm marker row with
//    { legacyRowFound, recipientCount, letterCount }. The legacy row is
//    NEVER deleted or modified.
export async function runMailPartitionBackfill(opts: {
  client: MailBackfillClient;
  realm: string;
  log?: (line: string) => void;
}): Promise<MailBackfillResult> {
  const { client, realm } = opts;
  const log = opts.log ?? ((line: string) => console.log(line));
  const markerKey = mailPartitionMarkerKey(realm);

  // 1. Marker already present: this migration ran on an earlier boot for this
  // realm. No-op, issuing no other SQL. Operator note: the marker row is the
  // ONLY recovery lever this design offers, and deleting it to force a
  // re-run is UNSAFE once any post-migration mail activity has landed. A
  // re-run blind-upserts only the recipients present in the legacy blob
  // (unchanged since the original migration) while leaving every
  // `mail:<realm>:r:*` row written since then in place; loadMail does not
  // de-duplicate by letter id, so the union on next load can contain the
  // same letter (and its escrow) twice. Never delete this marker on a realm
  // with live mail traffic.
  const markerRes = await client.query('SELECT data FROM world_state WHERE key = $1', [markerKey]);
  if (markerRes.rows.length > 0) {
    return {
      ran: false,
      legacyRowFound: false,
      recipientCount: 0,
      letterCount: 0,
      droppedCount: 0,
    };
  }

  // 2. Claim this realm's legacy row FOR UPDATE. The row lock serializes
  // against a racing autosave on an older binary still writing the whole
  // blob.
  const legacyKey = mailStateKey(realm);
  const legacyRes = await client.query('SELECT data FROM world_state WHERE key = $1 FOR UPDATE', [
    legacyKey,
  ]);
  const legacyRow = legacyRes.rows[0];
  if (!legacyRow) {
    // Nothing to partition (a fresh realm, or mail predates any letter ever
    // being sent). Record the marker so a later legacy row can never be
    // re-adopted after this migration has been declared complete.
    await upsertWorldState(client, markerKey, {
      legacyRowFound: false,
      recipientCount: 0,
      letterCount: 0,
      droppedCount: 0,
    });
    return { ran: true, legacyRowFound: false, recipientCount: 0, letterCount: 0, droppedCount: 0 };
  }

  const legacy = legacyRow.data as MailSave;
  const plan = partitionMailByRecipient(legacy.mail ?? []);

  // 3. Verify conservation BEFORE any write: the grouping above is the only
  // transformation between the legacy blob and the partition rows, so a
  // mismatch here is a bug in that transformation, never legitimate data
  // (the corrupt-row drop is already accounted for in `plan.kept`).
  const conservation = verifyMailPartitionConservation(plan.kept, plan.byRecipient);
  if (!conservation.ok) {
    throw new Error(
      `mail partition backfill conservation check failed: expected ${JSON.stringify(
        conservation.expected,
      )} got ${JSON.stringify(conservation.actual)}`,
    );
  }

  // 4. Write every partition in ONE batched multi-row UPSERT (mirrors
  // server/mail_db.ts's writeMailPartitions; duplicated rather than imported
  // to keep this file's no-db.ts-family-imports discipline: mail_db.ts
  // itself imports FROM this file), then record the completion marker. The
  // legacy row is left untouched.
  const recipientKeys = [...plan.byRecipient.keys()];
  if (recipientKeys.length > 0) {
    const keys = recipientKeys.map((k) => mailRecipientKey(realm, k));
    const datas = recipientKeys.map((k) => JSON.stringify({ mail: plan.byRecipient.get(k) }));
    await client.query(
      `INSERT INTO world_state (key, data, updated_at)
       SELECT k, d::jsonb, now() FROM UNNEST($1::text[], $2::text[]) AS t(k, d)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [keys, datas],
    );
  }
  const letterCount = plan.kept.length;
  await upsertWorldState(client, markerKey, {
    legacyRowFound: true,
    recipientCount: plan.byRecipient.size,
    letterCount,
    droppedCount: plan.droppedCount,
  });
  log(
    `mail partition backfill: realm ${realm} partitioned ${letterCount} letter(s) into ${plan.byRecipient.size} recipient row(s)${plan.droppedCount > 0 ? `, dropped ${plan.droppedCount} corrupt row(s)` : ''}`,
  );
  return {
    ran: true,
    legacyRowFound: true,
    recipientCount: plan.byRecipient.size,
    letterCount,
    droppedCount: plan.droppedCount,
  };
}
