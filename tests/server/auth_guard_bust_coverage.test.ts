// Bust-site completeness for the marketplace auth-guard cache, by DISCOVERY.
// A hand-enumerated bust list is exactly the class that rots (the escrow
// round's routing pin went blind to a hoisted-SQL writer; the hand-kept
// narrowing sibling list missed 11 of 16 modules), so this scan walks EVERY
// server/*.ts file, finds every SQL statement that writes what the two guard
// reads project (auth_tokens rows; the accounts moderation columns; the
// chat-quota POLICY columns), attributes each to its enclosing top-level
// function, and requires that function to call the matching bust. The
// classifier is COLUMN-precise on purpose: the chat-quota consume machinery
// (the stored procedure DDL in general_chat_quota_schema.ts) writes only
// window_started_at/message_count, which the guard read never projects, so
// it classifies OUT structurally instead of by hand exemption. The one
// reasoned exemption is the federated provision-race account DELETE, exact
// count 1 (it removes only fresh, unused accounts that cannot hold live
// tokens or cached moderation rows).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../helpers/strip_comments';

const SERVER_DIR = fileURLToPath(new URL('../../server', import.meta.url));

/** Recursive .ts walk (the shared-walk rule: subdirectories are in scope so a
 *  writer moved under server/http/ or a new domain dir cannot escape). */
function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkTsFiles(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** The accounts columns the moderation guard read projects. chat_mute_reason,
 *  cheater_mark_*, password/email/locale and friends are NOT here: writes
 *  touching only those change nothing the cache serves. */
const PROJECTION_COLUMNS = [
  'banned_at',
  'suspended_until',
  'moderation_reason',
  'chat_muted_until',
  'chat_strikes',
  'deactivated_at',
];

interface Site {
  file: string;
  index: number;
  kind: string;
}

/** A writer whose TABLE NAME arrives by interpolation is invisible to every
 *  verb+table regex below, so that shape is banned across all of server/:
 *  the sweep reds on any INSERT INTO / DELETE FROM / UPDATE followed by an
 *  interpolation opener, forcing a literal spelling the classifier can see.
 *  (An interpolated fragment INSIDE a guard-table statement is handled
 *  separately: the window check below sends it to the unclassifiable arm,
 *  because the column classifier cannot read columns it cannot see. An
 *  interpolated SET list on a non-guard table, e.g. woc_market_db.ts's
 *  directed-offer acceptance column, is out of this scan's scope.) */
const INTERPOLATED_TABLE = /\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE)\s+(?:\w+\.)?\$\{/i;

/** Every in-scope write site in one stripped source, by the column-precise
 *  classifier described in the header. Every table regex accepts an optional
 *  schema qualifier and matches case-insensitively: a public.auth_tokens or
 *  lowercase-keyword spelling must be a discovered site, never an evasion
 *  (both shapes proved to slip an earlier, narrower scan). */
function discoverSites(
  file: string,
  src: string,
): { inScope: Site[]; accountDeletes: Site[]; unclassifiable: Site[] } {
  const inScope: Site[] = [];
  const accountDeletes: Site[] = [];
  const unclassifiable: Site[] = [];
  for (const m of src.matchAll(
    /\b(INSERT\s+INTO|DELETE\s+FROM|UPDATE)\s+(?:\w+\.)?auth_tokens\b/gi,
  )) {
    inScope.push({ file, index: m.index ?? 0, kind: 'auth_tokens' });
  }
  // UPDATE accounts (schema-qualified spellings included) and the upsert
  // shape INSERT INTO accounts ... ON CONFLICT ... DO UPDATE SET, which is a
  // second door into the same columns. The scan window is STATEMENT-bounded:
  // it ends at the first backtick or semicolon (the template-literal close
  // or the DDL statement end), so neighboring source text can never bleed a
  // projection-column mention into a statement that does not write one. The
  // SET-list split at WHERE then classifies by written column. Known,
  // recorded limit: a WHERE inside a SET-list subquery would end the split
  // early and could hide a later projected column; no such statement shape
  // exists in server/, and a new one lands as a NEW site the reconciliation
  // map reds on, at which point this classifier gets taught the shape.
  for (const m of src.matchAll(/\b(?:UPDATE|INSERT\s+INTO)\s+(?:\w+\.)?accounts\b/gi)) {
    let window = src.slice(m.index, (m.index ?? 0) + 2000);
    const delim = window.slice(1).search(/[;\u0060]/);
    if (delim >= 0) window = window.slice(0, delim + 1);
    if (window.includes('${')) {
      // An interpolated fragment inside a guard-table statement defeats the
      // column classifier: red loudly instead of guessing.
      unclassifiable.push({ file, index: m.index ?? 0, kind: 'accounts_interpolated' });
      continue;
    }
    const isInsert = /^INSERT/i.test(m[0]);
    if (isInsert) {
      // A plain INSERT INTO accounts creates a row no token can reference
      // yet (registration): out of scope BY RULE. The upsert arm's DO
      // UPDATE SET list is the second door and classifies by column.
      const doUpdate = window.match(/\bDO\s+UPDATE\b([\s\S]*)$/i);
      if (!doUpdate) continue;
      const upsertSet = doUpdate[1].split(/\bWHERE\b/i)[0].toLowerCase();
      if (PROJECTION_COLUMNS.some((c) => upsertSet.includes(c))) {
        inScope.push({ file, index: m.index ?? 0, kind: 'accounts_update' });
      }
      continue;
    }
    if (!/\bWHERE\b/i.test(window)) {
      // No WHERE inside the statement bound: either a truncated giant SET
      // list or an unconditional whole-table write; both must red loudly.
      unclassifiable.push({ file, index: m.index ?? 0, kind: 'accounts_update_unbounded' });
      continue;
    }
    const setClause = window.split(/\bWHERE\b/i)[0].toLowerCase();
    if (PROJECTION_COLUMNS.some((c) => setClause.includes(c))) {
      inScope.push({ file, index: m.index ?? 0, kind: 'accounts_update' });
    }
  }
  for (const m of src.matchAll(
    /\b(INSERT\s+INTO|DELETE\s+FROM|UPDATE)\s+(?:\w+\.)?account_general_chat_rate_limits\b/gi,
  )) {
    const verb = m[1].split(/\s/)[0].toUpperCase();
    const head = src.slice(m.index, (m.index ?? 0) + 700).split(/\bWHERE\b|\bVALUES\b/i)[0];
    if (head.includes('${')) {
      unclassifiable.push({ file, index: m.index ?? 0, kind: 'quota_interpolated' });
      continue;
    }
    // A row DELETE removes the policy (the read's LEFT JOIN goes null): in
    // scope. INSERT/UPDATE are in scope only when they touch the projected
    // policy columns; the consume machinery's window/counter churn is not.
    const policy = verb === 'DELETE' || /\bmessages\b|\bwindow_minutes\b/i.test(head);
    if (policy) inScope.push({ file, index: m.index ?? 0, kind: 'quota_policy' });
  }
  for (const m of src.matchAll(/\bDELETE\s+FROM\s+(?:\w+\.)?accounts\b/gi)) {
    accountDeletes.push({ file, index: m.index ?? 0, kind: 'accounts_delete' });
  }
  return { inScope, accountDeletes, unclassifiable };
}

/** Top-level function spans (exported or not): [header index, next header
 *  index). An in-scope site landing OUTSIDE every span (module scope, a
 *  hoisted SQL const, a class method above the first function) fails the
 *  totality assert loudly instead of escaping attribution. Known limit: a
 *  class METHOD or an arrow-const body below a top-level function is
 *  bracketed by that function's span, so its attribution would name the
 *  wrong function; the deep-equal reconciliation map still reds on the new
 *  site itself, which is the fail-loud backstop (no class or arrow const in
 *  server/ writes the projection today). Scope limit, stated on purpose:
 *  the walk covers server/ only; every writer outside it is another PROCESS
 *  against the shared database and falls under the recorded cross-process
 *  TTL bound, not this same-process bust contract. */
function functionSpans(src: string): { name: string; start: number; end: number }[] {
  const headers = [...src.matchAll(/^(?:export )?(?:async )?function (\w+)/gm)].map((m) => ({
    name: m[1],
    start: m.index ?? 0,
  }));
  return headers.map((h, i) => ({
    name: h.name,
    start: h.start,
    end: i + 1 < headers.length ? headers[i + 1].start : src.length,
  }));
}

describe('auth-guard bust coverage (discovered, never hand-enumerated)', () => {
  const files = walkTsFiles(SERVER_DIR).sort();
  const sources = new Map(files.map((f) => [f, stripComments(readFileSync(f, 'utf8'))]));

  it('every discovered writer function calls the matching bust (exact reconciliation)', () => {
    // file (relative) -> function -> { sites, bust kinds present }
    const discovered: Record<string, Record<string, { sites: string[]; busts: string[] }>> = {};
    let totalInScope = 0;
    for (const file of files) {
      const src = sources.get(file) ?? '';
      const { inScope, unclassifiable } = discoverSites(file, src);
      expect(
        unclassifiable,
        `${file}: guard-table statements the column classifier cannot read (a SET list outrunning the scan window, or an interpolated fragment inside the statement)`,
      ).toEqual([]);
      if (inScope.length === 0) continue;
      const spans = functionSpans(src);
      const rel = file.slice(SERVER_DIR.length + 1);
      for (const site of inScope) {
        totalInScope += 1;
        const span = spans.find((s) => site.index >= s.start && site.index < s.end);
        // Classification totality: an in-scope write outside every exported
        // top-level function (module scope, hoisted const, class method) has
        // no attributable bust and must red here, not slip through.
        expect(
          span,
          `${rel}: in-scope ${site.kind} write at index ${site.index} sits outside every exported top-level function`,
        ).toBeDefined();
        if (!span) continue;
        const body = src.slice(span.start, span.end);
        const busts = [
          body.includes('bustWocAuthGuardToken(') ? 'token' : null,
          body.includes('bustWocAuthGuardAccount(') ? 'account' : null,
        ].filter((b): b is string => b !== null);
        expect(
          busts.length,
          `${rel}: ${span.name} writes the guard projection (${site.kind}) but calls no bust`,
        ).toBeGreaterThan(0);
        // Post-COMMIT discipline, structurally: in a transactional writer the
        // bust must sit AFTER the last COMMIT, or a concurrent read could
        // re-prime the cache with pre-commit state between bust and commit.
        const lastCommit = body.lastIndexOf("'COMMIT'");
        if (lastCommit >= 0) {
          const lastBust = Math.max(
            body.lastIndexOf('bustWocAuthGuardToken('),
            body.lastIndexOf('bustWocAuthGuardAccount('),
          );
          expect(lastBust, `${rel}: ${span.name} busts BEFORE its final COMMIT`).toBeGreaterThan(
            lastCommit,
          );
        }
        if (discovered[rel] === undefined) discovered[rel] = {};
        const perFile = discovered[rel];
        if (perFile[span.name] === undefined) perFile[span.name] = { sites: [], busts };
        perFile[span.name].sites.push(site.kind);
      }
    }
    // The reconciliation table: DISCOVERED map, pinned exactly. A new writer
    // (new statement, new function, new file) changes this map and reds the
    // deep-equal, forcing the bust decision to be made in the same change.
    expect(discovered).toEqual({
      'chat_filter_db.ts': {
        applyChatStrike: { sites: ['accounts_update'], busts: ['account'] },
        resetChatStrikes: { sites: ['accounts_update'], busts: ['account'] },
      },
      'db.ts': {
        saveToken: { sites: ['auth_tokens'], busts: ['token'] },
        revokeTokensExcept: { sites: ['auth_tokens', 'auth_tokens'], busts: ['account'] },
        revokeToken: { sites: ['auth_tokens'], busts: ['token'] },
        revokeReadToken: { sites: ['auth_tokens'], busts: ['token'] },
        revokeCompanionToken: { sites: ['auth_tokens'], busts: ['account'] },
        consumePasswordResetRequest: { sites: ['auth_tokens'], busts: ['account'] },
        setAccountDeactivated: { sites: ['accounts_update'], busts: ['account'] },
      },
      'general_chat_quota_db.ts': {
        setGeneralChatRateLimit: {
          sites: ['quota_policy', 'quota_policy'],
          busts: ['account'],
        },
      },
      'moderation_db.ts': {
        moderateAccount: {
          sites: ['accounts_update', 'accounts_update', 'accounts_update', 'accounts_update'],
          busts: ['account'],
        },
        muteAccountChat: { sites: ['accounts_update'], busts: ['account'] },
        liftAccountChatMute: { sites: ['accounts_update'], busts: ['account'] },
        reactivateAccountAudited: { sites: ['accounts_update'], busts: ['account'] },
        resetChatStrikesAudited: { sites: ['accounts_update'], busts: ['account'] },
      },
    });
    // Non-vacuity floor: the scan that discovered nothing would satisfy every
    // absence check above. Twenty in-scope statements at the rider.
    expect(totalInScope).toBe(20);
  });

  it('classifies the quota CONSUME machinery out by COLUMN, not by hand', () => {
    // The stored-procedure DDL writes account_general_chat_rate_limits but
    // touches only window_started_at/message_count: it must be discovered by
    // the raw table regex AND rejected by the column classifier, proving the
    // classifier (not a file exemption) is what excludes it.
    const schema = sources.get(join(SERVER_DIR, 'general_chat_quota_schema.ts')) ?? '';
    const raw = [...schema.matchAll(/\bUPDATE\s+account_general_chat_rate_limits\b/g)];
    expect(raw.length).toBeGreaterThanOrEqual(2);
    const { inScope } = discoverSites('general_chat_quota_schema.ts', schema);
    expect(inScope).toEqual([]);
  });

  it('carries exactly ONE reasoned accounts-DELETE exemption (the federated race loser)', () => {
    const deletes: Site[] = [];
    for (const file of files) {
      deletes.push(...discoverSites(file, sources.get(file) ?? '').accountDeletes);
    }
    // deleteUnusedFederatedProvision removes only a freshly provisioned,
    // never-used account (the provision race loser): it cannot hold a live
    // token or a cached moderation row, so no bust is owed. Any SECOND hard
    // delete of accounts rows must land here and make its own case.
    expect(deletes.map((d) => d.file.slice(SERVER_DIR.length + 1))).toEqual([
      'federated_auth_db.ts',
    ]);
  });

  it('bans interpolated table names, and reds guard-table statements with interpolated fragments', () => {
    // Positive controls first: each arm must actually see the banned shape,
    // or the clean pass below is theatre.
    expect(INTERPOLATED_TABLE.test('await pool.query(`DELETE FROM ${TOKENS_TABLE} WHERE 1`)')).toBe(
      true,
    );
    expect(INTERPOLATED_TABLE.test('`update ${t} set x = 1`')).toBe(true);
    expect(INTERPOLATED_TABLE.test("pool.query('UPDATE accounts SET locale = $2')")).toBe(false);
    const interpolatedSet = discoverSites(
      'probe.ts',
      'export async function f() { await pool.query(`UPDATE accounts SET ${MOD_SET} WHERE id = $1`, [id]); }',
    );
    expect(interpolatedSet.unclassifiable.map((s) => s.kind)).toEqual(['accounts_interpolated']);
    const interpolatedQuota = discoverSites(
      'probe.ts',
      'export async function f() { await pool.query(`UPDATE account_general_chat_rate_limits SET ${COLS} WHERE account_id = $1`, [id]); }',
    );
    expect(interpolatedQuota.unclassifiable.map((s) => s.kind)).toEqual(['quota_interpolated']);
    for (const file of files) {
      const src = sources.get(file) ?? '';
      expect(
        INTERPOLATED_TABLE.test(src),
        `${file}: a write statement builds its table name by interpolation; the discovery scan cannot classify that shape, spell it literally`,
      ).toBe(false);
    }
  });

  it('classifies schema-qualified and lowercase spellings as sites (synthetic probes)', () => {
    // Both shapes evaded the narrower first-cut regexes (proven by planted
    // writers in a scratch tree during the rider QA); these probes pin the
    // widened classifier so it cannot regress to the evadable form.
    const qualified = discoverSites(
      'probe.ts',
      "export async function f() { await pool.query('DELETE FROM public.auth_tokens WHERE token = $1', [t]); }",
    );
    expect(qualified.inScope.map((s) => s.kind)).toEqual(['auth_tokens']);
    const lowercase = discoverSites(
      'probe.ts',
      "export async function f() { await pool.query('delete from auth_tokens where token = $1', [t]); }",
    );
    expect(lowercase.inScope.map((s) => s.kind)).toEqual(['auth_tokens']);
    const lowerUpdate = discoverSites(
      'probe.ts',
      "export async function f() { await pool.query('update accounts set banned_at = now() where id = $1', [id]); }",
    );
    expect(lowerUpdate.inScope.map((s) => s.kind)).toEqual(['accounts_update']);
    const lowerDelete = discoverSites(
      'probe.ts',
      "export async function f() { await pool.query('delete from public.accounts where id = $1', [id]); }",
    );
    expect(lowerDelete.accountDeletes).toHaveLength(1);
    const qualifiedPolicy = discoverSites(
      'probe.ts',
      "export async function f() { await pool.query('DELETE FROM public.account_general_chat_rate_limits WHERE account_id = $1', [id]); }",
    );
    expect(qualifiedPolicy.inScope.map((s) => s.kind)).toEqual(['quota_policy']);
    // Negative control: a lowercase accounts write touching NO projection
    // column still classifies out (the widening must not blunt the column
    // precision).
    const benign = discoverSites(
      'probe.ts',
      "export async function f() { await pool.query('update accounts set locale = $2 where id = $1', [id, l]); }",
    );
    expect(benign.inScope).toEqual([]);
  });

  it('scopes the cache to the marketplace: the import boundary is exact', () => {
    // The admin surface stays uncached BY WIRING: the only server files that
    // may touch the cache module are the writers above (bust calls) and
    // main.ts (boot construction, the runtime injection into the marketplace
    // routes, and the ops readout). The routes file itself consumes the
    // bundle through the WocMarketRuntime injection and so never imports the
    // module; require_admin, admin.ts, every other guard bundle, and ws_auth
    // must never appear here.
    const importers = files
      .filter((f) => /from '\.{1,2}\/woc_auth_guard_cache'/.test(sources.get(f) ?? ''))
      .map((f) => f.slice(SERVER_DIR.length + 1))
      .sort();
    expect(importers).toEqual([
      'chat_filter_db.ts',
      'db.ts',
      'general_chat_quota_db.ts',
      'http/game_metrics.ts',
      'main.ts',
      'moderation_db.ts',
    ]);
    // The same boundary from the other side: no relative-path variant of the
    // import escapes the equality above.
    for (const file of files) {
      const src = sources.get(file) ?? '';
      if (
        src.includes('woc_auth_guard_cache') &&
        !importers.includes(file.slice(SERVER_DIR.length + 1))
      ) {
        expect.fail(`${file} references woc_auth_guard_cache outside the pinned import set`);
      }
    }
  });
});
