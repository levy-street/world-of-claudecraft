// The admin catalog is under the overlay + registry + release-gate model.
//
// This suite proves the admin-specific guarantees that the shared i18n tests do
// not: the admin two-tier t() gate (English-only legal at the PR tier, hard-fail
// at release), the admin bundle stays SEPARATE (no game locale table imported),
// every admin overlay key is a real admin `en` key, every admin.html static
// data-i18n key is a real admin `en` key (so localizeStatic never throws on an
// untracked key), and the generated dense admin table is committed + reproducible.
//
// The shared admin contracts (DICT density, classLabel, copied-English, registry
// universe coverage incl. admin) live in tests/localization_fixes.test.ts (H3 /
// L7 / H3b / A1) and tests/i18n_status_registry.test.ts.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en as adminEn } from '../src/admin/i18n.en';
import { cs_CZ } from '../src/admin/i18n.locales/cs_CZ';
import { de_DE } from '../src/admin/i18n.locales/de_DE';
import { en_CA } from '../src/admin/i18n.locales/en_CA';
import { es } from '../src/admin/i18n.locales/es';
import { es_ES } from '../src/admin/i18n.locales/es_ES';
import { fr_CA } from '../src/admin/i18n.locales/fr_CA';
import { fr_FR } from '../src/admin/i18n.locales/fr_FR';
import { it_IT } from '../src/admin/i18n.locales/it_IT';
import { ja_JP } from '../src/admin/i18n.locales/ja_JP';
import { ko_KR } from '../src/admin/i18n.locales/ko_KR';
import { pt_BR } from '../src/admin/i18n.locales/pt_BR';
import { ru_RU } from '../src/admin/i18n.locales/ru_RU';
import { zh_CN } from '../src/admin/i18n.locales/zh_CN';
import { zh_TW } from '../src/admin/i18n.locales/zh_TW';
import { assertDeterministic } from './helpers/i18n_determinism';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adminEnKeys = new Set(Object.keys(adminEn));

// --- The admin two-tier t() gate (mirrors tests/i18n_t_behavior.test.ts) --------
// The real admin `pending` set is non-empty (the chat-filter keys), but it
// is locale-specific, so to exercise the t() pending BRANCH deterministically we
// inject a synthetic pending key through the generated module - the same technique
// the game-client behavior test uses.
describe('admin t(): pending key (English-only legal at PR; hard-fail at release)', () => {
  const GEN = '../src/admin/i18n.resolved.generated';
  const SAMPLE = '__sampleAdminPendingKey';

  async function loadAdminWithPending() {
    vi.resetModules();
    vi.doMock(GEN, async () => {
      const actual =
        await vi.importActual<typeof import('../src/admin/i18n.resolved.generated')>(GEN);
      const FILL = 'English fill {name}';
      return {
        ...actual,
        translations: {
          ...actual.translations,
          es: { ...actual.translations.es, [SAMPLE]: FILL },
          en: { ...actual.translations.en, [SAMPLE]: FILL },
        },
        pending: { ...actual.pending, es: [...(actual.pending.es ?? []), SAMPLE] },
      };
    });
    return await import('../src/admin/i18n');
  }

  afterEach(() => {
    delete process.env.I18N_RELEASE;
    vi.doUnmock(GEN);
    vi.resetModules();
  });

  it('renders the English fill on a non-release build (PR tier is English-only legal)', async () => {
    delete process.env.I18N_RELEASE;
    const mod = await loadAdminWithPending();
    mod.setAdminLanguage('es');
    expect(mod.t(SAMPLE, { name: 'Aki' })).toBe('English fill Aki');
  });

  it('hard-fails on a release build (English must never ship to a translated operator)', async () => {
    process.env.I18N_RELEASE = '1';
    const mod = await loadAdminWithPending();
    mod.setAdminLanguage('es');
    expect(() => mod.t(SAMPLE)).toThrow(/pending/);
  });

  it('throws on an untracked key in dev/test (typo guard)', async () => {
    delete process.env.I18N_RELEASE;
    const mod = await loadAdminWithPending();
    mod.setAdminLanguage('en');
    expect(() => mod.t('totally.bogus.admin.key')).toThrow(/untracked key/);
    // a real key still resolves, so the guard is not blanket-throwing
    expect(mod.t('nav.overview')).toBe('Overview');
  });
});

// --- Bundle isolation: admin imports its OWN tables, never the game i18n ---------
describe('admin bundle stays separate from the game client', () => {
  const adminDir = path.join(root, 'src/admin');
  // Recurse: the per-locale overlays live in src/admin/i18n.locales/, so a flat
  // readdir would miss a game-table import smuggled into an overlay file. Walk the
  // whole admin tree and check every .ts.
  const walkTs = (dir: string, rel = ''): string[] => {
    const out: string[] = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) out.push(...walkTs(path.join(dir, ent.name), r));
      else if (ent.name.endsWith('.ts')) out.push(r);
    }
    return out;
  };
  const files = walkTs(adminDir);

  it('no admin source file imports from outside src/admin/ (no game locale table)', () => {
    // sanity: the scan must reach the i18n.locales/ overlays, not just the top level.
    expect(files.length, 'should recurse into i18n.locales/').toBeGreaterThan(15);
    expect(
      files.some((f) => f.startsWith('i18n.locales/')),
      'overlays must be scanned',
    ).toBe(true);
    const offenders: string[] = [];
    for (const f of files) {
      const fileDir = path.dirname(path.join(adminDir, f));
      const src = fs.readFileSync(path.join(adminDir, f), 'utf8');
      for (const m of src.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
        const spec = m[1];
        // Bare specifiers (node/npm) are fine. A relative import is an offender only
        // if it RESOLVES outside src/admin/ - resolve against the importing file's
        // own directory so a within-tree `../i18n.en` from the per-locale split dir
        // (i18n.resolved.generated/, the per-locale emit split) is allowed, but a
        // `../ui/...` escape into the game locale table is still caught.
        if (!spec.startsWith('.')) continue;
        const resolved = path.resolve(fileDir, spec);
        if (resolved !== adminDir && !resolved.startsWith(adminDir + path.sep)) {
          offenders.push(`${f}: ${spec}`);
        }
      }
    }
    expect(offenders, 'admin must import only its own modules (src/ CLAUDE.md)').toEqual([]);
  });
});

// --- Every admin overlay key is a real admin `en` key (no phantom keys) ----------
describe('admin overlay keys are members of the admin en base', () => {
  const overlays: Record<string, Record<string, string>> = {
    es,
    es_ES,
    fr_FR,
    fr_CA,
    en_CA,
    it_IT,
    de_DE,
    zh_CN,
    zh_TW,
    ko_KR,
    ja_JP,
    pt_BR,
    ru_RU,
    cs_CZ,
  };
  for (const [lang, overlay] of Object.entries(overlays)) {
    it(`${lang}: has no key outside the admin en base`, () => {
      const notInEn = Object.keys(overlay)
        .filter((k) => !adminEnKeys.has(k))
        .sort();
      expect(notInEn).toEqual([]);
    });
  }
});

// --- literal t() keys in the admin Svelte source are real admin en keys ----------
// The Svelte rewrite renders every operator-facing string with t('key') in
// components instead of static [data-i18n] attributes on admin.html. An untracked
// literal key would throw mid-render in dev (and the release backstop returns the
// raw key). Scan the admin source and pin every COMPLETE literal key. Dynamic keys
// (classLabel/zoneLabel/reasonLabel build `class.${id}` etc. inside i18n.ts) are out
// of scope here and covered by the DICT-density checks above; the regex only matches
// a literal whose whole argument is a dotted key, so a t('foo.' + x) concat is not
// mistaken for a (missing) key.
describe('admin source t() keys are all real admin en keys', () => {
  const SRC_DIR = path.join(root, 'src/admin');
  const SKIP =
    /(?:[\\/]i18n\.en\.ts$)|(?:[\\/]i18n\.ts$)|(?:[\\/]i18n\.locales[\\/])|(?:[\\/]i18n\.resolved\.generated[\\/])/;
  const sources = fs
    .readdirSync(SRC_DIR, { recursive: true, encoding: 'utf8' })
    .filter((rel) => /\.(svelte|ts)$/.test(rel))
    .map((rel) => path.join(SRC_DIR, rel))
    .filter((abs) => !SKIP.test(abs));

  it('scans at least one admin source file', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it('every literal t() key resolves (no untracked key)', () => {
    const keys = new Set<string>();
    const re = /\bt\(\s*['"]([a-zA-Z][\w.]*)['"]\s*[),]/g;
    for (const abs of sources) {
      const code = fs.readFileSync(abs, 'utf8');
      for (const match of code.matchAll(re)) keys.add(match[1]);
    }
    expect(keys.size, 'sanity: admin source should carry literal t() keys').toBeGreaterThan(0);
    const notKey = [...keys].filter((k) => !adminEnKeys.has(k)).sort();
    expect(notKey, 'admin t() keys not in the admin en base (would throw/leak)').toEqual([]);
  });
});

// --- The generated dense admin table is committed + reproducible -----------------
describe('admin resolved table reproducibility', () => {
  // The admin resolved table is a generated DIRECTORY of per-locale modules + a
  // barrel (the per-locale emit split), not a single file. A directory pathspec makes
  // both git checks cover every slice.
  const generatedRel = 'src/admin/i18n.resolved.generated';

  it('is committed (tracked by git) so the diff check below is meaningful', () => {
    expect(() =>
      execFileSync('git', ['ls-files', '--error-unmatch', '--', generatedRel], {
        cwd: root,
        encoding: 'utf8',
      }),
    ).not.toThrow();
  });

  it('regenerating src/admin/i18n.resolved.generated/ leaves the committed directory byte-identical', () => {
    execFileSync(process.execPath, [path.join(root, 'scripts/i18n_admin_build.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(() =>
      execFileSync('git', ['diff', '--exit-code', '--', generatedRel], {
        cwd: root,
        encoding: 'utf8',
      }),
    ).not.toThrow();
  });

  it('regenerates byte-identically across two perturbed-env runs (determinism)', () => {
    // Parity with the game generator's determinism gate (tests/i18n_resolved_equivalence.test.ts).
    // The committed-dir `git diff` above only surfaces a hidden TZ / locale / output-path dependency
    // if it happens to manifest on the CI host's own env; this double-generates the whole emitted
    // tree into two throwaway temp dirs under PERTURBED TZ / LC_ALL / temp-path and asserts byte
    // identity, so an intrinsic non-determinism in the admin generator surfaces regardless of CI env.
    // outFiles omitted => the whole emitted tree (every per-locale slice + barrel) is compared.
    expect(() =>
      assertDeterministic({ script: path.join(root, 'scripts/i18n_admin_build.mjs') }),
    ).not.toThrow();
  });
});
