// The shared loopback guard behind every script that mints accounts, grants
// roles, or drives /dev cheats (scripts/lib/loopback_guard.mjs). The reject
// cases are the phase 16 security review's verified bypass attempts; the
// DATABASE arm must agree with what node-postgres actually resolves,
// including the ?host= query override a WHATWG-hostname check misses.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from '../scripts/lib/loopback_guard.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('assertLoopbackUrl', () => {
  it('accepts the three loopback spellings, bracketed v6 and normalized shorthand included', () => {
    expect(assertLoopbackUrl('http://localhost:8787', 'SERVER_URL').hostname).toBe('localhost');
    expect(assertLoopbackUrl('http://127.0.0.1:8799/ws', 'SERVER_URL').port).toBe('8799');
    expect(assertLoopbackUrl('http://[::1]:8787', 'SERVER_URL').hostname).toBe('[::1]');
    // WHATWG URL normalizes IPv4 shorthand at parse time, so 127.1 reaches
    // the allowlist AS 127.0.0.1: genuinely loopback, correctly accepted.
    expect(assertLoopbackUrl('http://127.1', 'SERVER_URL').hostname).toBe('127.0.0.1');
  });

  it('rejects every verified bypass shape, naming only the hostname', () => {
    const rejects = [
      'http://127.0.0.1@evil.example.com', // userinfo trick: real host is evil
      'http://127.0.0.1.evil.example.com', // subdomain lookalike
      'http://localhost.evil.example.com',
      'http://localhost.', // trailing-dot FQDN
      'http://[::ffff:127.0.0.1]', // v4-mapped v6
      'http://evil.example.com',
      // SUFFIX lookalikes: an endsWith allowlist accepts both of these, an
      // exact-membership one refuses them. Neither hostname is loopback.
      'http://evil-localhost',
      'http://notlocalhost',
    ];
    for (const url of rejects) {
      expect(() => assertLoopbackUrl(url, 'SERVER_URL'), url).toThrow(/non-loopback SERVER_URL/);
    }
  });

  it('throws on an unparseable URL without echoing a value', () => {
    expect(() => assertLoopbackUrl('not a url', 'SERVER_URL')).toThrow(
      /invalid SERVER_URL \(not a parseable URL\)/,
    );
  });
});

describe('assertLoopbackDatabaseUrl', () => {
  it('accepts loopback connection strings', () => {
    expect(() => assertLoopbackDatabaseUrl('postgres://u:p@127.0.0.1:5434/db')).not.toThrow();
    expect(() => assertLoopbackDatabaseUrl('postgres://u:p@localhost/db')).not.toThrow();
  });

  it('returns the BARE host, brackets stripped and case folded', () => {
    // The return value is what mob_stall_repro.mjs prints as its "database
    // host ... is loopback: ok" line, so the strip and the fold are contract,
    // not incidental: dropping either leaves the ACCEPT arm broken (an
    // unstripped '[::1]' or an unfolded 'LOCALHOST' misses the allowlist and
    // the guard refuses a genuinely local target).
    expect(assertLoopbackDatabaseUrl('postgres://u:p@[::1]:5432/db')).toBe('::1');
    expect(assertLoopbackDatabaseUrl('postgres://u:p@LOCALHOST/db')).toBe('localhost');
    expect(assertLoopbackDatabaseUrl('postgres://u:p@127.0.0.1:5434/db')).toBe('127.0.0.1');
  });

  it('rejects the ?host= override node-postgres would actually honor', () => {
    expect(() =>
      assertLoopbackDatabaseUrl('postgres://u:p@127.0.0.1:5432/db?host=evil.example.com'),
    ).toThrow(/non-loopback DATABASE_URL/);
  });

  it('accepts a remote-looking URL whose ?host= override IS loopback', () => {
    // The deliberate other direction of the same rule: the EFFECTIVE host is
    // what node-postgres dials, so a loopback override passes even though the
    // URL authority reads remote. Pinned so the ?host= arm can never be
    // "fixed" into a plain authority check without this failing.
    expect(() =>
      assertLoopbackDatabaseUrl('postgres://u:p@db.example.com:5432/db?host=127.0.0.1'),
    ).not.toThrow();
  });

  it('rejects a hostaddr parameter outright, whatever the host says', () => {
    // hostaddr outranks host under libpq semantics. The pure-JS driver
    // ignores it today, so this is fail-closed insurance: a checkout that
    // grows native bindings would dial 203.0.113.9 while the host check
    // happily read 127.0.0.1.
    expect(() =>
      assertLoopbackDatabaseUrl('postgres://u:p@127.0.0.1:5432/db?hostaddr=203.0.113.9'),
    ).toThrow(/hostaddr/);
    // Refused even when the hostaddr itself is loopback: the guard does not
    // maintain a second allowlist for a parameter nothing here needs.
    expect(() =>
      assertLoopbackDatabaseUrl('postgres://u:p@127.0.0.1:5432/db?hostaddr=127.0.0.1'),
    ).toThrow(/hostaddr/);
  });

  it('rejects a remote host and the credentials-in-userinfo trick', () => {
    expect(() => assertLoopbackDatabaseUrl('postgres://u:p@db.example.com/db')).toThrow(
      /non-loopback/,
    );
    expect(() => assertLoopbackDatabaseUrl('postgres://localhost@evil.example.com/db')).toThrow(
      /non-loopback/,
    );
  });

  it('rejects prefix and suffix lookalikes of every loopback spelling', () => {
    // The DB twin of the URL arm's lookalike row: an endsWith allowlist
    // accepts evil-localhost, a startsWith one accepts localhost.evil, and
    // exact membership refuses both.
    for (const raw of [
      'postgres://u:p@evil-localhost/db',
      'postgres://u:p@notlocalhost/db',
      'postgres://u:p@localhost.evil.example.com/db',
      'postgres://u:p@127.0.0.1.evil.example.com/db',
    ]) {
      expect(() => assertLoopbackDatabaseUrl(raw), raw).toThrow(/non-loopback DATABASE_URL/);
    }
  });

  it('fails CLOSED on a connection string pg-connection-string cannot parse', () => {
    // The catch arm has to THROW: a mutant that fell back to a localhost
    // default there (or swallowed the error and carried on with an empty
    // host) is fail-OPEN, since whatever the operator typed still reaches
    // node-postgres afterwards.
    expect(() => assertLoopbackDatabaseUrl('postgres://u:p@[::1')).toThrow(
      /invalid DATABASE_URL \(not a parseable connection string\)/,
    );
    // and it never echoes the credential-bearing value it just refused: the
    // ANCHORED pattern is what proves that, a substring match would not.
    expect(() => assertLoopbackDatabaseUrl('postgres://u:secret@[::1')).toThrow(
      /^invalid DATABASE_URL \(not a parseable connection string\)$/,
    );
  });

  it('fails closed on a hostless or unset connection string, each with ITS message', () => {
    // Split arms (the fix-round review: an alternation pins neither): the
    // hostless string surfaces as the (none) refusal, the unset value as the
    // explicit missing arm, and neither echoes the raw value.
    expect(() => assertLoopbackDatabaseUrl('postgres:///db')).toThrow(
      /non-loopback DATABASE_URL host "\(none\)"/,
    );
    expect(() => assertLoopbackDatabaseUrl(undefined)).toThrow(/missing DATABASE_URL/);
    expect(() => assertLoopbackDatabaseUrl('')).toThrow(/missing DATABASE_URL/);
  });
});

// Every script that mints accounts straight into Postgres, grants roles, or
// drives /dev cheats. Extracting the guard into a shared module left it one
// deleted import away from silently vanishing from a call site while the unit
// tests above stayed green, so the call sites are pinned too.
const GUARDED_SCRIPTS = [
  'scripts/admin_guild_bank_shot.mjs',
  'scripts/admin_professions_shot.mjs',
  'scripts/load_players.mjs',
  'scripts/load_professions.mjs',
  'scripts/mob_stall_repro.mjs',
] as const;

// Full-line // comments are stripped before the scan: this file's own subject
// matter means the phrase "assertLoopbackUrl" appears in prose inside these
// scripts, and a commented-out call must never satisfy the pin.
function codeWithoutLineComments(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

function scriptSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...scriptSources(path));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) found.push(relative(ROOT, path));
  }
  return found;
}

describe('loopback guard call sites', () => {
  it.each(GUARDED_SCRIPTS)('%s imports the shared guard and calls BOTH arms', (relPath) => {
    const code = codeWithoutLineComments(relPath);
    expect(code).toContain("from './lib/loopback_guard.mjs'");
    // The two call literals are distinct substrings (the import line carries
    // neither, because it has no open paren), so each proves its own arm.
    expect(code).toContain('assertLoopbackUrl(');
    expect(code).toContain('assertLoopbackDatabaseUrl(');
  });

  it('pins the guarded set exhaustively so a new adopter joins the scan', () => {
    const importers = scriptSources(join(ROOT, 'scripts'))
      .filter((relPath) => codeWithoutLineComments(relPath).includes('loopback_guard.mjs'))
      .sort();
    expect(importers).toEqual([...GUARDED_SCRIPTS].sort());
  });

  it('classifies every script that talks to Postgres (the discovery arm)', () => {
    // The exhaustive arm above pins which scripts IMPORT the guard, not which
    // scripts NEED it: a new script minting rows straight into Postgres and
    // never importing the guard is invisible to both (the fix-round audit).
    // Discovery keys on what a script DOES (the pg import), so a new database
    // touchpoint must either adopt the guard or be classified here on
    // purpose. The exempt list is operator/admin tooling that predates the
    // guard: adopting it there is a recorded follow-up, and removing an entry
    // from this list without adopting the guard reddens the run.
    const PG_EXEMPT_OPERATOR_TOOLS = [
      'scripts/armory_skins_e2e.mjs',
      'scripts/armory_visual_e2e.mjs',
      'scripts/bank_audit.mjs',
      'scripts/chat_log_persistence.mjs',
      'scripts/create_gm.mjs',
      'scripts/grant_admin.mjs',
    ] as const;
    const pgImporters = scriptSources(join(ROOT, 'scripts'))
      .filter((relPath) => {
        const code = codeWithoutLineComments(relPath);
        return code.includes("from 'pg'") || code.includes("require('pg')");
      })
      .sort();
    const guardedPgUsers = pgImporters.filter((p) =>
      (GUARDED_SCRIPTS as readonly string[]).includes(p),
    );
    const classified = [...guardedPgUsers, ...PG_EXEMPT_OPERATOR_TOOLS].sort();
    expect(pgImporters).toEqual(classified);
  });
});
