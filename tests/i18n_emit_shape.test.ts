import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Per-locale emit split surface contract. The build scripts now emit a
// DIRECTORY of per-locale modules + a barrel (index.ts) + loaders.ts + pending.ts.
// loaders.ts (LOCALE_LOADERS / SUPPORTED_LANGUAGES) is scaffolding for the later lazy
// flip and is imported by NOTHING in the runtime yet, so neither tsc nor any other
// test would catch it being emitted empty, with the wrong keys (e.g. an accidental
// `en`/`en_XA`), or with SUPPORTED_LANGUAGES out of sync with the barrel. This file
// pins that surface directly for BOTH the game (src/ui) and admin (src/admin) tables,
// and exercises the I18N_OUT_DIR override branch (determinism + orphan-sweep) that the
// build-script comments promise a test covers.

import {
  en_XA as adminEnXA,
  pending as adminPending,
  translations as adminTranslations,
} from '../src/admin/i18n.resolved.generated';
import {
  LOCALE_LOADERS as adminLoaders,
  SUPPORTED_LANGUAGES as adminSupported,
} from '../src/admin/i18n.resolved.generated/loaders';
import { supportedLanguages as uiRuntimeSupported } from '../src/ui/i18n';
import {
  en_XA as uiEnXA,
  pending as uiPending,
  translations as uiTranslations,
} from '../src/ui/i18n.resolved.generated';
import {
  LOCALE_LOADERS as uiLoaders,
  SUPPORTED_LANGUAGES as uiSupported,
} from '../src/ui/i18n.resolved.generated/loaders';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The authoritative ordered locale set both build scripts emit (LOCALES). en + 21.
const ALL_LOCALES = [
  'en',
  'es',
  'es_ES',
  'fr_FR',
  'fr_CA',
  'en_CA',
  'it_IT',
  'de_DE',
  'zh_CN',
  'zh_TW',
  'ko_KR',
  'ja_JP',
  'pt_BR',
  'ru_RU',
  'cs_CZ',
  'nl_NL',
  'pl_PL',
  'id_ID',
  'tr_TR',
  'sv_SE',
  'vi_VN',
  'da_DK',
];
// The lazy/pending set: every locale except `en` (and never the en_XA pseudo).
const NON_EN_LOCALES = ALL_LOCALES.filter((l) => l !== 'en');

// Reusable surface assertions over one generated table (game or admin).
function assertEmitSurface(
  label: string,
  translations: Record<string, unknown>,
  en_XA: unknown,
  pending: Record<string, readonly string[]>,
  loaders: Record<string, () => Promise<unknown>>,
  supported: readonly string[],
) {
  // Barrel translations map: exactly the 21 locales, in emit order, en_XA EXCLUDED.
  expect(Object.keys(translations), `${label}: translations key set`).toEqual(ALL_LOCALES);
  expect('en_XA' in translations, `${label}: en_XA must NOT be in translations`).toBe(false);
  expect(translations.en, `${label}: en present`).toBeTypeOf('object');
  // en_XA is re-exported by the barrel but lives outside the runtime locale set.
  expect(en_XA, `${label}: en_XA re-export`).toBeTypeOf('object');

  // loaders.ts: one dynamic-import thunk per non-en/non-en_XA locale; SUPPORTED is 14.
  expect(Object.keys(loaders), `${label}: LOCALE_LOADERS key set (no en, no en_XA)`).toEqual(
    NON_EN_LOCALES,
  );
  for (const [lang, thunk] of Object.entries(loaders)) {
    expect(thunk, `${label}: LOCALE_LOADERS.${lang} is a thunk`).toBeTypeOf('function');
  }
  expect([...supported], `${label}: SUPPORTED_LANGUAGES == translations key set`).toEqual(
    Object.keys(translations),
  );
  expect(supported.includes('en'), `${label}: SUPPORTED includes en`).toBe(true);
  expect(supported.includes('en_XA'), `${label}: SUPPORTED excludes en_XA`).toBe(false);

  // pending.ts: keyed by the same non-en set, every value an array.
  expect(Object.keys(pending), `${label}: pending key set`).toEqual(NON_EN_LOCALES);
  for (const [lang, list] of Object.entries(pending)) {
    expect(Array.isArray(list), `${label}: pending.${lang} is an array`).toBe(true);
  }
}

describe('i18n emit-split surface (game table)', () => {
  it('barrel, loaders, and pending expose the expected directory surface', () => {
    assertEmitSurface(
      'ui',
      uiTranslations as Record<string, unknown>,
      uiEnXA,
      uiPending,
      uiLoaders as Record<string, () => Promise<unknown>>,
      uiSupported,
    );
    // The runtime derives supportedLanguages from the barrel; the loaders constant
    // must agree with it (they will diverge silently otherwise once the stored-locale modulepreload consumes it).
    expect([...uiSupported]).toEqual(uiRuntimeSupported);
  });

  it('each LOCALE_LOADERS thunk lazily resolves its own dense slice', async () => {
    const es = (await uiLoaders.es()) as Record<string, unknown>;
    expect(es.es, 'ui loader resolves the es slice').toBeTypeOf('object');
    const ruRu = (await uiLoaders.ru_RU()) as Record<string, unknown>;
    expect(ruRu.ru_RU, 'ui loader resolves the ru_RU slice').toBeTypeOf('object');
  });
});

describe('i18n emit-split surface (admin table)', () => {
  it('barrel, loaders, and pending mirror the game directory surface', () => {
    assertEmitSurface(
      'admin',
      adminTranslations as Record<string, unknown>,
      adminEnXA,
      adminPending,
      adminLoaders as Record<string, () => Promise<unknown>>,
      adminSupported,
    );
  });

  it('each admin LOCALE_LOADERS thunk lazily resolves its own slice', async () => {
    const es = (await adminLoaders.es()) as Record<string, unknown>;
    expect(es.es, 'admin loader resolves the es slice').toBeTypeOf('object');
  });
});

// The build scripts emit ATOMICALLY (per-file temp + renameSync) and prune orphan
// *.ts, with an I18N_OUT_DIR override so a determinism/orphan test can emit into a
// throwaway dir without racing the committed artifact. Exercise that override branch
// (untested otherwise) plus the determinism + orphan-sweep guarantees the i18n.catalog domain split must keep.
describe('i18n emit determinism + orphan-sweep (I18N_OUT_DIR override)', () => {
  const EXPECTED_FILES = [
    ...ALL_LOCALES.map((l) => `${l}.ts`),
    'en_XA.ts',
    'index.ts',
    'loaders.ts',
    'pending.ts',
  ].sort();
  // The game build ALSO emits the flat TranslationKey union into the override dir
  // when I18N_OUT_DIR is set (its committed home, src/ui/i18n.catalog/, sits
  // outside the resolved directory, so the override redirect is what keeps this
  // test's scratch runs from touching the committed file). The admin build has no
  // key union.
  const EXPECTED_GAME_FILES = [...EXPECTED_FILES, 'translation_keys.generated.ts'].sort();

  function runBuild(scriptRel: string, outDir: string) {
    execFileSync(process.execPath, [path.join(root, scriptRel)], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, I18N_OUT_DIR: outDir },
    });
  }

  function snapshotTs(dir: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.ts')) out[f] = readFileSync(path.join(dir, f), 'utf8');
    }
    return out;
  }

  function checkEmit(scriptRel: string, prefix: string, expectedFiles: string[]) {
    const scratch = mkdtempSync(path.join(os.tmpdir(), prefix));
    try {
      runBuild(scriptRel, scratch);
      const first = snapshotTs(scratch);
      expect(Object.keys(first).sort(), 'emits exactly the expected module set').toEqual(
        expectedFiles,
      );
      expect(
        readdirSync(scratch).some((f) => f.endsWith('.tmp')),
        'no leftover .tmp',
      ).toBe(false);

      // Plant a stale slice from a (hypothetically) removed locale, then regenerate:
      // the sweep must delete it and the rest must be byte-identical (determinism).
      const orphan = path.join(scratch, 'orphan_zz.ts');
      writeFileSync(orphan, '// stale slice from a removed locale\n');
      runBuild(scriptRel, scratch);

      expect(existsSync(orphan), 'orphan *.ts is swept on regen').toBe(false);
      expect(snapshotTs(scratch), 'regeneration is byte-identical (deterministic)').toEqual(first);
      expect(
        readdirSync(scratch).some((f) => f.endsWith('.tmp')),
        'no leftover .tmp',
      ).toBe(false);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  it('game build is deterministic and prunes orphans', () => {
    checkEmit('scripts/i18n_build.mjs', 'i18n-emit-ui-', EXPECTED_GAME_FILES);
  }, 60_000);

  it('admin build is deterministic and prunes orphans', () => {
    checkEmit('scripts/i18n_admin_build.mjs', 'i18n-emit-admin-', EXPECTED_FILES);
  }, 60_000);
});
