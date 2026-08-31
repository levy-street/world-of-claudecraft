// Environment truth for the $WOC market: every market env var the code reads
// is documented in .env.example, and every WOC_MARKET_* row documented there
// is actually read by code. The review found both failure directions live
// (WOC_MARKET_SERVICE_URL read but undocumented; the TOTP threshold knob
// documented but read by nothing), so this guard pins both.
//
// The corpus is an EXPLICIT file list, not a directory walk: these are the
// exact modules that read market configuration, and a new one must be added
// here deliberately (the test says so when a known name goes missing).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../helpers/strip_comments';

const read = (rel: string): string =>
  readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

// Every module that reads a market-relevant env name. require_internal_secret
// is here because it reads DASHBOARD_INTERNAL_SECRET through a NAMED CONSTANT
// (process.env[gate.envVar]), which the process.env regex alone cannot see.
const CORPUS = [
  'server/woc_market_proxy.ts',
  'server/woc_market_routes.ts',
  'server/main.ts',
  'server/http/config.ts',
  'server/http/middleware/require_internal_secret.ts',
  // The claudium proxy owns WOC_ECONOMY_SERVICE_URL; it is in scope because
  // the market shares the WOC_ECONOMY_* pair (the internal secret) and the
  // dead-knob direction sweeps that prefix.
  'server/claudium_proxy.ts',
];

// Prefixes that make a name market-relevant for the forward check (main.ts
// and config.ts read plenty of unrelated env).
const PREFIXES = ['WOC_MARKET_', 'WOC_ECONOMY_', 'DASHBOARD_'];

function readNames(): Set<string> {
  const names = new Set<string>();
  for (const rel of CORPUS) {
    const src = stripComments(read(rel));
    // \benv\. covers both process.env.NAME and config.ts's bound
    // env: NodeJS.ProcessEnv parameter (env.NAME).
    for (const m of src.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)) names.add(m[1]);
    // The bracket-literal form: process.env['NAME'] (none today, but a
    // refactor to it must not flip the forward check vacuous).
    for (const m of src.matchAll(/\benv\[\s*'([A-Z][A-Z0-9_]+)'\s*\]/g)) names.add(m[1]);
    // The named-constant indirection: const X_ENV = 'NAME' later read as
    // process.env[gate.envVar]. Capture the literal at its definition.
    for (const m of src.matchAll(/_ENV\s*=\s*'([A-Z][A-Z0-9_]+)'/g)) names.add(m[1]);
  }
  return new Set([...names].filter((n) => PREFIXES.some((p) => n.startsWith(p))));
}

function documentedNames(): Set<string> {
  const env = read('.env.example');
  const names = new Set<string>();
  for (const m of env.matchAll(/^#?([A-Z][A-Z0-9_]+)=/gm)) names.add(m[1]);
  return names;
}

describe('market env documentation matches the code', () => {
  it('the scanner really sees the names the review found missing (positive control)', () => {
    // Guards the guard: if the read-extraction regexes rot (a refactor to a
    // destructured read, a renamed constant), the two set comparisons below
    // would go vacuous instead of red. These two names are the exact original
    // misses, one per extraction form.
    const reads = readNames();
    expect(reads).toContain('WOC_MARKET_SERVICE_URL');
    expect(reads).toContain('DASHBOARD_INTERNAL_SECRET');
  });

  it('documents every market env name the code reads', () => {
    const docs = documentedNames();
    const undocumented = [...readNames()].filter((n) => !docs.has(n)).sort();
    expect(
      undocumented,
      'read by market code but missing from .env.example (document it there)',
    ).toEqual([]);
  });

  it('reads every market-prefixed name .env.example documents (no dead knobs)', () => {
    const reads = readNames();
    const dead = [...documentedNames()]
      .filter((n) => PREFIXES.some((p) => n.startsWith(p)) && !reads.has(n))
      .sort();
    expect(
      dead,
      'documented in .env.example but read by no market module (delete the row, or add its reader to CORPUS)',
    ).toEqual([]);
  });

  it('the corpus itself stays real: every listed file reads at least one market name', () => {
    // A renamed module would silently shrink the sweep; this fails the rename
    // toward updating CORPUS. The constant-form regex derives from PREFIXES
    // so a fourth prefix updates every check together, not two of three.
    const constantForm = new RegExp(`_ENV\\s*=\\s*'(?:${PREFIXES.join('|')})[A-Z0-9_]*'`);
    for (const rel of CORPUS) {
      const src = stripComments(read(rel));
      const hits =
        [...src.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)].some((m) =>
          PREFIXES.some((p) => m[1].startsWith(p)),
        ) || constantForm.test(src);
      expect(hits, `${rel} no longer reads any market env name; update CORPUS`).toBe(true);
    }
  });

  it('no market env reader exists OUTSIDE the corpus (the new-file drift signal)', () => {
    // The explicit CORPUS is the design, but without this walk a brand-new
    // module reading a brand-new WOC_MARKET_* name would be invisible to
    // BOTH directions above. The walk greps every server/src/headless source
    // for a market-prefixed literal in any env-read-capable position and
    // fails toward adding the file to CORPUS. Prefix LITERALS in source are
    // the net: even a renamed gate constant still names its env var.
    const { lstatSync, readdirSync } = require('node:fs') as typeof import('node:fs');
    const { fileURLToPath } = require('node:url') as typeof import('node:url');
    const path = require('node:path') as typeof import('node:path');
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const roots = ['server', 'src', 'headless'];
    const skipDirs = new Set(['node_modules', 'i18n.resolved.generated']);
    const files: string[] = [];
    // lstat plus a depth bound, the repo's scan-guard convention: statSync
    // follows symlinks, so a linked directory cycle would hang the suite.
    const walk = (dir: string, depth: number): void => {
      if (depth > 12) throw new Error(`walk too deep at ${dir}; raise the bound deliberately`);
      for (const entry of readdirSync(dir)) {
        if (skipDirs.has(entry)) continue;
        const full = path.join(dir, entry);
        const st = lstatSync(full);
        if (st.isDirectory()) walk(full, depth + 1);
        else if (st.isFile() && entry.endsWith('.ts')) files.push(full);
      }
    };
    for (const r of roots) walk(path.join(root, r), 0);
    // A reader is a file whose COMMENT-STRIPPED source both mentions a
    // market-prefixed name and touches the environment at all; prose-only
    // mentions (constants re-exported, wire fields) do not count. The
    // env-touch gate accepts the named-constant indirection form too (a
    // future require_internal_secret twin whose process.env read lives in
    // another module). KNOWN evasions, verified non-classifying and accepted:
    // a gate constant IMPORTED from a module that itself reads no env and
    // carries no market literal, and a template-built name
    // (process.env[`WOC_MARKET_${suffix}`]); both are outside this net.
    const prefixLiteral = new RegExp(`'(?:${PREFIXES.join('|')})[A-Z0-9_]*'`);
    const isMarketEnvReader = (src: string): boolean => {
      const readsEnv =
        /\bprocess\.env\b/.test(src) || /\benv\.[A-Z]/.test(src) || /_ENV\s*=\s*'/.test(src);
      if (!readsEnv) return false;
      return PREFIXES.some((p) => src.includes(`env.${p}`)) || prefixLiteral.test(src);
    };
    const outside: string[] = [];
    for (const full of files) {
      const rel = path.relative(root, full).replaceAll(path.sep, '/');
      if (CORPUS.includes(rel)) continue;
      if (isMarketEnvReader(stripComments(readFileSync(full, 'utf8')))) outside.push(rel);
    }
    // TWO positive controls: the walk visited the corpus files (a broken
    // root or extension filter fails here), and the CLASSIFIER itself
    // recognizes a known reader (a corpus file is exempted by the CORPUS
    // check above, not by the classifier, so this proves both detector
    // regexes still fire; without it a broken stripComments or regex would
    // leave `outside` empty forever and the guard would pass vacuously).
    expect(files.map((f) => path.relative(root, f).replaceAll(path.sep, '/'))).toContain(
      'server/woc_market_routes.ts',
    );
    expect(
      isMarketEnvReader(stripComments(read('server/woc_market_proxy.ts'))),
      'the classifier no longer recognizes a known market env reader',
    ).toBe(true);
    expect(
      outside,
      'market env readers outside CORPUS; add each file to CORPUS so both guard directions see it',
    ).toEqual([]);
  }, 60_000);
});

describe('compose passes through every operator-tunable market knob', () => {
  // The known drift class: a knob documented in .env.example but absent from
  // docker-compose.yml is silently discarded in the compose deployment (the
  // operator sets it, the code default wins). The dev pair is the ONE
  // sanctioned exception: compose is the production deployment and the dev
  // economy must be unreachable from it, the ALLOW_DEV_COMMANDS posture.
  const COMPOSE_EXEMPT = new Set(['WOC_MARKET_DEV_SERVICE', 'WOC_MARKET_DEV_PRICE_MICRO_USD']);

  it('forwards every read WOC_MARKET_ name, minus the sanctioned dev pair', () => {
    const compose = read('docker-compose.yml');
    const missing = [...readNames()]
      .filter((n) => n.startsWith('WOC_MARKET_') && !COMPOSE_EXEMPT.has(n))
      .filter((n) => !compose.includes(`${n}: \${${n}:-}`))
      .sort();
    expect(
      missing,
      'read by the server but not passed through docker-compose.yml; an operator override is silently discarded',
    ).toEqual([]);
  });

  it('keeps the dev pair OUT of compose (the exemption is a refusal, not a gap)', () => {
    const compose = read('docker-compose.yml');
    for (const name of COMPOSE_EXEMPT) {
      expect(compose.includes(`${name}: \${`), `${name} must not be passed through`).toBe(false);
    }
    // The exemption list stays honest: both names are really read by code.
    for (const name of COMPOSE_EXEMPT) expect(readNames()).toContain(name);
  });
});
