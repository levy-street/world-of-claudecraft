import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BANK_EXPANSION_PRICES, BANK_SOCKET_PRICES } from '../src/sim/bank';
import { GUILD_BANK_RUNG_PRICES } from '../src/sim/guild_bank';
import { VAULT_UPGRADE_PRICES } from '../src/sim/materials_vault';

// The storage-price authority guard (Bank Storage phase 09): clients RENDER
// wire prices (BankInfo.nextExpansionCost / nextSocketCost,
// VaultInfo.nextUpgradeCost, GuildBankInfo.nextExpansionPrice) and never
// decide a cost themselves, so a server-side price retune (the
// SimConfig.storagePrices override) reaches every client without a bundle
// update and no stale client can quote a price the server no longer charges.
// This suite keeps src/ui, src/render, src/net, and src/game
// storage-price-free FOREVER, on top of the complementary seven-file scan in
// tests/bank_view.test.ts (which stays):
//
// - WALK, never a file list: a fixed list only guards the files someone
//   remembered to register, so a NEW client file with a hardcoded price
//   would ship unguarded. The recursive walk makes every present and future
//   .ts file under all four trees a scan target automatically. src/net joined
//   in QA 09: ClientWorld mirrors the very wire prices this guard protects,
//   so a decode-time fallback constant there is the exact bug class the
//   phase's guild_bank_view fix removed; src/game rides along because the
//   walk is free and both trees measured clean.
// - Comment stripping runs LINE comments FIRST, then block comments: a `/*`
//   sitting inside a `//` comment must be consumed as line-comment text, not
//   open a bogus block that swallows live code to the next `*/` elsewhere in
//   the file (the ordering bug that once exempted most of data.ts from the
//   architecture scans). The (^|[^:]) guard keeps protocol strings
//   (https://...) intact.
// - The banned VALUES are derived from the LIVE sim tables imported above, so
//   a price retune moves the ban set automatically instead of leaving the
//   guard hunting stale numbers.
// - Numeric spellings are NORMALIZED before matching (hex evaluated,
//   underscores dropped); the deliberate residue is recorded at
//   normalizeNumerics below so nobody re-litigates it blind.
// - Every allowance (tree-wide AND family) is LINE-ANCHORED on the named
//   constant sharing the line, so an allowance can never mask a REAL price
//   that lands elsewhere in an allowed file (QA 09).

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const uiRoot = join(repoRoot, 'src', 'ui');
const renderRoot = join(repoRoot, 'src', 'render');
const netRoot = join(repoRoot, 'src', 'net');
const gameRoot = join(repoRoot, 'src', 'game');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

// LINE comments first, then block comments (see the header). Both replacements
// preserve line structure so violation reports carry real line numbers.
function stripComments(src: string): string {
  return src
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

// Numeric spellings that dodge or fake a decimal match. Hex literals are
// EVALUATED into their decimal spelling (QA 09; they were blanked before):
// evaluation both keeps the battleground *_core hash mixers clean (0x1000000
// becomes 16777216, not a digit soup the 1000000 ban matches inside) AND
// closes the hex-spelled-price dodge (0x249F0 becomes 150000 and reds).
// Numeric-separator underscores drop so 150_000 cannot dodge the 150000 ban.
// DELIBERATE residue, judged in QA 09 against measured false positives, so
// do not "fix" these without re-measuring: exponent literals stay unevaluated
// (src/render legitimately spells sentinels 1e5/1e6, which evaluate INTO
// banned values), comma-grouped digits stay unjoined (reviewed locale prose
// legitimately quotes XP/damage totals like '1,000,000' that collide with
// table values), and computed arithmetic (150 * 1000) is statically
// invisible to any literal scan; the token bans and review remain the net
// under those spellings.
function normalizeNumerics(code: string): string {
  return code
    .replace(/0[xX][0-9a-fA-F_]+/g, (m) => {
      const v = Number(m.replace(/_/g, ''));
      return Number.isSafeInteger(v) ? String(v) : '0';
    })
    .replace(/(?<=[0-9])_(?=[0-9])/g, '');
}

const prepare = (src: string): string => normalizeNumerics(stripComments(src));

// Digit-bounded both sides, with '.' joining the bound so a decimal fraction
// (0.500, 500.25) is not read as the integer price it contains.
const valueRe = (value: number): RegExp => new RegExp(`(?<![0-9.])${value}(?![0-9.])`);

const relPath = (file: string): string => relative(repoRoot, file).split(sep).join('/');

const uiFiles = walk(uiRoot);
const renderFiles = walk(renderRoot);
const netFiles = walk(netRoot);
const gameFiles = walk(gameRoot);
const allFiles = [...uiFiles, ...renderFiles, ...netFiles, ...gameFiles];
const familyFiles = allFiles.filter((f) => /(bank|vault|bags|guild_bank)/.test(basename(f)));

// The live ban set: every value of the four price tables, CONCATENATED (the
// exact-size pin below counts table entries, not distinct values; four values
// repeat across tables).
const banList: readonly number[] = [
  ...BANK_EXPANSION_PRICES,
  ...BANK_SOCKET_PRICES,
  ...VAULT_UPGRADE_PRICES,
  ...GUILD_BANK_RUNG_PRICES,
];
const banValues = [...new Set(banList)];

// ---- arm (b)/(c) scanners ------------------------------------------------

type AllowFn = (rel: string, value: number, line: string) => boolean;

/** Scan ONE prepared code string; exposed so the positive-control arms below
 *  can exercise the exact operator the file loop uses. */
function scanCode(
  code: string,
  values: readonly number[],
  rel: string,
  allowed: AllowFn | null,
  usedAllowances: Set<string>,
): string[] {
  const hits: string[] = [];
  const lines = code.split('\n');
  for (const value of values) {
    const re = valueRe(value);
    lines.forEach((line, i) => {
      if (!re.test(line)) return;
      if (allowed?.(rel, value, line)) {
        usedAllowances.add(`${rel}:${value}`);
        return;
      }
      hits.push(`${rel}:${i + 1} [${value}] ${line.trim()}`);
    });
  }
  return hits;
}

function scanFiles(
  files: string[],
  values: readonly number[],
  allowed: AllowFn | null,
  usedAllowances: Set<string>,
): string[] {
  return files.flatMap((file) =>
    scanCode(prepare(readFileSync(file, 'utf8')), values, relPath(file), allowed, usedAllowances),
  );
}

// Family-file (arm b) allowances, LINE-ANCHORED: file + value + a substring
// that must share the LINE, so a real hardcoded price elsewhere in the same
// file still fails. Entry one is the coin DENOMINATION (10000 copper per
// gold, the market_view / mailbox_window constant family), which happens to
// equal bank expansion rung 5; entry two joined when the walk gained src/net
// (QA 09): the guild-bank log request TTL in milliseconds, not money.
const FAMILY_ALLOWANCES: ReadonlyArray<[file: string, value: number, anchor: string]> = [
  ['src/ui/guild_bank_view.ts', 10000, 'COPPER_PER_GOLD'],
  ['src/net/guild_bank_log_wire.ts', 10000, 'GUILD_BANK_LOG_TTL_MS'],
];
// One factory builds every anchored allow fn, so the positive control below
// exercises the exact operator the real scans use while recording into its
// own set (never pre-satisfying the exercised-anchor pins).
const anchoredAllow = (
  table: ReadonlyArray<[file: string, value: number, anchor: string]>,
  record: Set<string>,
): AllowFn => {
  return (rel, value, line) => {
    const hit = table.find(
      ([file, v, anchor]) => file === rel && v === value && line.includes(anchor),
    );
    if (hit) record.add(hit.join(':'));
    return hit !== undefined;
  };
};

const usedFamilyAnchors = new Set<string>();
const familyAllowed: AllowFn = anchoredAllow(FAMILY_ALLOWANCES, usedFamilyAnchors);

// Tree-wide (arm c) allowances, LINE-ANCHORED the same way (QA 09; they were
// file+value only, which let an allowance mask a REAL price landing anywhere
// else in an allowed file): unrelated constants that happen to equal a
// distinctive price value, each anchored on the named constant sharing its
// line. The exercised-allowance arm below reds if one goes stale.
const TREE_ALLOWANCES: ReadonlyArray<[file: string, value: number, anchor: string]> = [
  // Five minutes in milliseconds, twice: neither is money.
  ['src/ui/daily_rewards_launcher_core.ts', 300000, 'DAILY_REWARDS_LAUNCHER_THROTTLE_MS'],
  ['src/ui/hud/loot/loot_roll_controller.ts', 300000, 'MASTER_LOOT_DURATION_MS'],
  // The /dev gold prompt's input bound (dev-gated tooling, not a price render).
  ['src/ui/dev_command_view.ts', 100000, 'boundedInteger'],
  // The millions threshold and divisor of the meter number formatter.
  ['src/ui/meters.ts', 1000000, 'v >= 1000000'],
  ['src/ui/meters.ts', 1000000, 'v / 1000000'],
  // The census millions divisor.
  ['src/render/scene_census_core.ts', 1000000, 'const M = 1000000'],
  // A memo-size cap, not money.
  ['src/render/shore_water_gate_core.ts', 400000, 'PROBE_MEMO_LIMIT'],
  // The WIRE-BOUNDARY cap on a client-declared cost, not a price and not from
  // any price table: it mirrors STORAGE_MAX_EXPECTED_COST_CLAUDIUM
  // (server/storage_purchases.ts), which is deliberately far ABOVE every real
  // catalog price so a silly declared cost refuses as invalid_request instead of
  // reaching the int4 insert. The durable purchase record refuses a stored cost
  // above it on READ for the same reason (Bank Storage phase 16), and
  // tests/purchase_intent_durability.test.ts pins the two equal, so this
  // allowance cannot hide a drift.
  ['src/ui/purchase_intent_record.ts', 1000000, 'PURCHASE_INTENT_MAX_COST_CLAUDIUM'],
];
const usedTreeAnchors = new Set<string>();
const treeAllowed: AllowFn = anchoredAllow(TREE_ALLOWANCES, usedTreeAnchors);

// ---- arm (a): token/import ban -------------------------------------------

const BANNED_TOKENS = [
  'BANK_EXPANSION_PRICES',
  'BANK_SOCKET_PRICES',
  'VAULT_UPGRADE_PRICES',
  'GUILD_BANK_RUNG_PRICES',
  'DEFAULT_STORAGE_PRICES',
  'resolveStoragePrices',
] as const;
// Word-bounded so the sanctioned GEOMETRY names (BANK_EXPANSION_SLOTS,
// VAULT_BASE_CAP, VAULT_UPGRADE_STEP, BANK_BAG_SOCKETS) can never be caught
// by a partial match; the self-test below proves it.
const tokenRes = BANNED_TOKENS.map((t) => new RegExp(`\\b${t}\\b`));
// Any module path reaching the resolver module, import or dynamic import alike.
const STORAGE_PRICES_PATH_RE = /\/storage_prices\b/;

/** Scan ONE source string; exposed (like scanCode) so the positive control
 *  below exercises the exact operator the file loop uses, comment strip and
 *  hit push included, not just the bare regexes. */
function tokenHitsInSource(src: string, rel: string): string[] {
  const hits: string[] = [];
  stripComments(src)
    .split('\n')
    .forEach((line, i) => {
      for (const re of tokenRes) {
        if (re.test(line)) hits.push(`${rel}:${i + 1} [${re.source}] ${line.trim()}`);
      }
      if (STORAGE_PRICES_PATH_RE.test(line)) {
        hits.push(`${rel}:${i + 1} [/storage_prices] ${line.trim()}`);
      }
    });
  return hits;
}

function tokenHits(files: string[]): string[] {
  return files.flatMap((file) => tokenHitsInSource(readFileSync(file, 'utf8'), relPath(file)));
}

describe('the comment stripper (line comments first, then blocks)', () => {
  it('keeps exactly the code half of a mixed fixture, protocol slashes intact', () => {
    const fixture = [
      'const keep = 1; // dropLine 111111',
      "/* dropBlock 222222 */ const url = 'https://example.com/x';",
      'const alsoKeep = 3;',
    ].join('\n');
    const stripped = stripComments(fixture);
    expect(stripped).toContain('const keep = 1;');
    expect(stripped).toContain("const url = 'https://example.com/x';");
    expect(stripped).toContain('const alsoKeep = 3;');
    expect(stripped).not.toContain('dropLine');
    expect(stripped).not.toContain('dropBlock');
    expect(stripped).not.toContain('111111');
    expect(stripped).not.toContain('222222');
    // Line structure survives, so violation reports carry real line numbers.
    expect(stripped.split('\n')).toHaveLength(3);
  });

  it('a /* inside a line comment does not open a block that swallows live code', () => {
    // The ordering trap the mandated line-first order exists for: with blocks
    // stripped first, the bogus block would run to the */ on line 3 and erase
    // the live line between.
    const fixture = [
      '// note: /* not a block',
      'const live = 150000;',
      '/* real */ const x = 1;',
    ].join('\n');
    const stripped = stripComments(fixture);
    expect(stripped).toContain('const live = 150000;');
    expect(stripped).not.toContain('note:');
  });
});

describe('the literal scanner (positive controls through the real operator)', () => {
  const none = new Set<string>();

  it('catches a planted price in code, in both plain and underscore spellings', () => {
    expect(
      scanCode(prepare('const a = 150000;'), banValues, 'fixture.ts', null, none),
    ).toHaveLength(1);
    expect(
      scanCode(prepare('const a = 150_000;'), banValues, 'fixture.ts', null, none),
    ).toHaveLength(1);
  });

  it('drops a commented-out price but keeps the code hit on a mixed line', () => {
    const hits = scanCode(
      prepare('const a = 150000; // was 300000\n// const b = 600000;'),
      banValues,
      'fixture.ts',
      null,
      none,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('[150000]');
  });

  it('is digit-bounded: embedded digits, hex non-prices, and decimal fractions do not match', () => {
    // 0x1000000 EVALUATES to 16777216 (the battleground hash-mixer case): not
    // a table value, so it stays clean even though its hex digits contain the
    // 1000000 socket price.
    for (const clean of ['const a = 21200000;', 'const b = 0x1000000;', 'const c = 500.25;']) {
      expect(scanCode(prepare(clean), banValues, 'fixture.ts', null, none)).toEqual([]);
    }
  });

  it('catches a HEX-spelled price: evaluation, not blanking (QA 09)', () => {
    // 0x249F0 is 150000 (bank expansion rung 8): blanking hex to 0 (the old
    // normalizer) let this dodge; evaluation reds it, underscores included.
    const hits = scanCode(prepare('const a = 0x249F0;'), banValues, 'fixture.ts', null, none);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('[150000]');
    expect(
      scanCode(prepare('const a = 0x2_49F0;'), banValues, 'fixture.ts', null, none),
    ).toHaveLength(1);
  });

  it('a line-anchored allowance spares ONLY its anchored line (QA 09)', () => {
    // The same file+value WITHOUT the anchor on the line must still hit: an
    // allowance can never mask a real price landing elsewhere in the file.
    // Built through the same anchoredAllow factory the real scans use, but
    // recording into a probe set so this control can never pre-satisfy the
    // exercised-anchor pins in arms (b)/(c).
    const probeUsed = new Set<string>();
    const probeAllow = anchoredAllow(TREE_ALLOWANCES, probeUsed);
    const anchored = 'const DAILY_REWARDS_LAUNCHER_THROTTLE_MS = 300000;';
    const bare = 'const price = 300000;';
    const rel = 'src/ui/daily_rewards_launcher_core.ts';
    expect(scanCode(prepare(anchored), banValues, rel, probeAllow, none)).toEqual([]);
    expect(probeUsed.size).toBe(1);
    const hits = scanCode(prepare(bare), banValues, rel, probeAllow, none);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('[300000]');
  });
});

describe('arm (a): no price token or resolver import anywhere in the four walked trees', () => {
  it('finds no banned token', () => {
    const hits = tokenHits(allFiles);
    expect(hits, `client code must not name a price table:\n${hits.join('\n')}`).toEqual([]);
  });

  it('the token regexes do not partial-match the sanctioned geometry names', () => {
    const sanctioned = [
      "import { BANK_EXPANSION_SLOTS, BANK_BAG_SOCKETS } from '../sim/bank';",
      "import { VAULT_BASE_CAP, VAULT_UPGRADE_STEP } from '../sim/materials_vault';",
    ];
    for (const line of sanctioned) {
      for (const re of tokenRes) expect(re.test(line)).toBe(false);
    }
    // ...while the real tokens ARE caught (the ban is not vacuously narrow).
    expect(tokenRes.some((re) => re.test('const p = GUILD_BANK_RUNG_PRICES[0];'))).toBe(true);
    expect(STORAGE_PRICES_PATH_RE.test("import { x } from '../sim/storage_prices';")).toBe(true);
  });

  it('the FULL token scanner catches a fixture through the real operator (QA 09)', () => {
    // The regex self-test above cannot see a wiring defect in the scanner
    // itself (the line loop, its stripComments call, the hits push); this
    // control runs tokenHitsInSource, the exact function the file loop
    // flatMaps, against a mixed fixture: one aliased import (the token still
    // sits on the line), one dynamic resolver import, and one commented
    // mention that must NOT count.
    const fixture = [
      "import { BANK_SOCKET_PRICES as GEO } from '../sim/bank';",
      '// BANK_EXPANSION_PRICES named in a comment only',
      "void import('../sim/storage_prices');",
    ].join('\n');
    const hits = tokenHitsInSource(fixture, 'fixture.ts');
    expect(hits).toHaveLength(2);
    expect(hits[0]).toContain('fixture.ts:1');
    expect(hits[0]).toContain('BANK_SOCKET_PRICES');
    expect(hits[1]).toContain('fixture.ts:3');
    expect(hits[1]).toContain('[/storage_prices]');
  });
});

describe('arm (b): the bank/vault/bags/guild_bank family renders no table value', () => {
  it('finds no live-table literal in a family file', () => {
    const used = new Set<string>();
    const hits = scanFiles(familyFiles, banValues, familyAllowed, used);
    expect(hits, `family files must render wire prices only:\n${hits.join('\n')}`).toEqual([]);
    // Every allowance is real code, not a stale exception: guild_bank_view's
    // COPPER_PER_GOLD denomination still collides with expansion rung 5 and
    // the net log wire still declares its TTL. If this reds because a
    // constant moved or was renamed, delete its allowance rather than
    // loosening it. The ANCHOR set is pinned exactly, so a stale anchor
    // cannot linger as a silent hole either.
    expect([...used].sort()).toEqual([
      'src/net/guild_bank_log_wire.ts:10000',
      'src/ui/guild_bank_view.ts:10000',
    ]);
    expect([...usedFamilyAnchors].sort()).toEqual(
      FAMILY_ALLOWANCES.map((entry) => entry.join(':')).sort(),
    );
  });
});

describe('arm (c): distinctive table values (>= 100000) appear nowhere in any walked tree', () => {
  it('finds no distinctive literal outside the named allowances', () => {
    const distinctive = banValues.filter((v) => v >= 100000);
    // 13 distinct values at authoring; a floor so a filter typo cannot empty
    // the arm silently.
    expect(distinctive.length).toBeGreaterThanOrEqual(10);
    const used = new Set<string>();
    const hits = scanFiles(allFiles, distinctive, treeAllowed, used);
    expect(hits, `no client file may carry a distinctive price value:\n${hits.join('\n')}`).toEqual(
      [],
    );
    // Every allowance is exercised: a stale entry (the constant moved, was
    // renamed, or changed value) reds here and gets deleted instead of
    // lingering as a silent hole. The file:value keys dedupe (meters.ts
    // carries two anchored lines for one value); the ANCHOR set is pinned
    // exactly, per entry.
    expect([...used].sort()).toEqual(
      [...new Set(TREE_ALLOWANCES.map(([file, v]) => `${file}:${v}`))].sort(),
    );
    expect([...usedTreeAnchors].sort()).toEqual(
      TREE_ALLOWANCES.map((entry) => entry.join(':')).sort(),
    );
  });
});

describe('arm (d): liveness anchors, one per banned name', () => {
  // Without these the bans are never-present-token pins: a sim-side rename
  // would silently disarm the guard (it would hunt names nothing declares).
  // A rename now reds HERE, forcing the ban list to move with it.
  const simSource = (rel: string): string =>
    stripComments(readFileSync(join(repoRoot, rel), 'utf8'));

  it('src/sim/bank.ts still exports both bank price tables', () => {
    const src = simSource('src/sim/bank.ts');
    expect(src).toMatch(/export const BANK_EXPANSION_PRICES\b/);
    expect(src).toMatch(/export const BANK_SOCKET_PRICES\b/);
  });

  it('src/sim/materials_vault.ts still exports the vault ladder', () => {
    expect(simSource('src/sim/materials_vault.ts')).toMatch(/export const VAULT_UPGRADE_PRICES\b/);
  });

  it('src/sim/guild_bank.ts still exports the guild rung ladder', () => {
    expect(simSource('src/sim/guild_bank.ts')).toMatch(/export const GUILD_BANK_RUNG_PRICES\b/);
  });

  it('src/sim/storage_prices.ts still exports the defaults and the resolver', () => {
    const src = simSource('src/sim/storage_prices.ts');
    expect(src).toMatch(/export const DEFAULT_STORAGE_PRICES\b/);
    expect(src).toMatch(/export function resolveStoragePrices\b/);
  });
});

describe('arm (e): the scan can never pass vacuously', () => {
  it('walks all four trees (recursion floors for ui/render, presence floors for net/game)', () => {
    // At authoring: src/ui walks 661 files (445 flat top-level), src/render
    // walks 489 (409 flat). Each floor sits ABOVE the flat count, so a walk
    // that silently stopped recursing fails, while staying far enough under
    // the real count that ordinary file churn does not. src/net (36 files)
    // and src/game (127) are flat today, so their floors prove the trees are
    // genuinely on the walk, and will start proving recursion the day either
    // grows a subdirectory.
    expect(uiFiles.length).toBeGreaterThan(500);
    expect(renderFiles.length).toBeGreaterThan(430);
    expect(netFiles.length).toBeGreaterThan(25);
    expect(gameFiles.length).toBeGreaterThan(100);
  });

  it('the family subset is populated and holds the three storefront files', () => {
    // 15 family files at authoring.
    expect(familyFiles.length).toBeGreaterThanOrEqual(8);
    expect(familyFiles.some((f) => f.endsWith(join('src', 'ui', 'bank_view.ts')))).toBe(true);
    expect(familyFiles.some((f) => f.endsWith(join('src', 'ui', 'vault_window.ts')))).toBe(true);
    expect(familyFiles.some((f) => f.endsWith(join('src', 'ui', 'guild_bank_view.ts')))).toBe(true);
  });

  it('the derived ban set has exactly the four live tables in it', () => {
    // 12 bank expansions + 4 sockets + 5 vault rungs + 7 guild rungs. A table
    // that grows or shrinks moves this pin: acknowledge the retune here.
    expect(banList.length).toBe(28);
  });
});
