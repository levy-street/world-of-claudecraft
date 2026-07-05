// Build the dense resolved translation table src/ui/i18n.resolved.generated/.
//
// The output is a DIRECTORY of per-locale modules (one dense `<lang>.ts` per locale
// + en_XA.ts), a back-compat barrel (index.ts) that re-exports every slice and
// assembles the runtime `translations` map, a loaders.ts (per-locale dynamic-import
// thunks + SUPPORTED_LANGUAGES, scaffolding for the later lazy flip), and pending.ts.
// The single-file resolved table was split into this directory in the per-locale
// emit split; the resolved-table SHA is invariant under the split (it hashes
// src/ui/i18n.ts EXPORTS via scripts/i18n_resolved_hash.mjs, not file bytes).
//
// This is the load-bearing tsc safety net for the i18n scaling refactor. `en`
// (src/ui/i18n.catalog) is the authoritative NESTED base; the 13 non-English
// locales are FLAT dotted-key overlays (`Record<string, string>`). Each
// overlay is unflattened back to a nested object and overlaid onto a deep copy of
// `en`, with any missing leaf filled from the English value, so every emitted
// locale is DENSE (no gaps). The generated file types each locale
// ": EnTranslations" (= typeof en), so tsc still red-fails any missing or renamed
// key. Client and admin read this generated table, never the raw per-locale
// overlays (which later become sparse).
//
// Zero runtime deps; bundles the TS source with esbuild (the same pattern as
// scripts/i18n_resolved_hash.mjs and scripts/export_loot_spreadsheet.mjs). Writes
// deterministically - key ordering is driven by `en`, indentation and quoting are
// fixed, and there are no timestamps / Date.now / Math.random anywhere - so two
// runs on the same input are byte-identical (reproducibility-checked like the
// media manifest).
//
// Usage:
//   node scripts/i18n_build.mjs   (re)generate src/ui/i18n.resolved.generated/
//   I18N_OUT_DIR=... node scripts/i18n_build.mjs   emit into a custom directory

import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { flatten, unflatten } from './i18n_flatten.mjs';
import { pseudoLocalize } from './i18n_pseudo.mjs';

const root = process.cwd();
// The generated output is a DIRECTORY of per-locale modules, not a single file.
// I18N_OUT_DIR overrides the destination (used by the determinism test to emit into
// a throwaway temp dir without touching the committed artifact).
const OUT_DIR = process.env.I18N_OUT_DIR
  ? path.resolve(root, process.env.I18N_OUT_DIR)
  : path.join(root, 'src/ui/i18n.resolved.generated');

// The authoritative ordered locale set. `en` is the nested base; the other 13 are
// the flat dotted-key overlay files (src/ui/i18n.locales/<lang>.ts). This list
// drives both the emit order and the runtime supportedLanguages (Object.keys of
// the generated `translations`). The generator reads these SOURCE modules directly
// and never imports src/ui/i18n.ts, so it never depends on the file it generates
// (no circular import at build time).
const LOCALES = [
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
  'nl_NL',
  'pl_PL',
  'id_ID',
  'tr_TR',
  'sv_SE',
  'vi_VN',
  'da_DK',
];

// Dialect locales declare a base locale. A dialect's (now
// divergence-only) overlay is applied ON TOP of its base locale's overlay, which
// is itself applied on top of nested `en`. So the resolve order for a dialect is
//   nested en -> base-locale overlay -> dialect overlay
// and any key the dialect omits falls through to the base, then to English. This
// is the single, data-driven declaration of the dialect graph; the resolver below
// reads it instead of branching on locale codes inline. A locale absent from this
// map has no base and is overlaid directly onto `en`, exactly as before.
const DIALECT_BASE = {
  es_ES: 'es',
  fr_CA: 'fr_FR',
  en_CA: 'en',
};

function sourceModule(lang) {
  return lang === 'en' ? './src/ui/i18n.catalog' : `./src/ui/i18n.locales/${lang}`;
}

// Bundle the source locale objects via a tiny stub and import the result. We pull
// `en` and each locale export by its code; none of this touches the generated file.
async function loadLocales() {
  const stub = LOCALES.map((lang) => `export { ${lang} } from '${sourceModule(lang)}';`).join('\n');
  const build = await esbuild.build({
    stdin: {
      contents: stub,
      resolveDir: root,
      sourcefile: 'i18n-build-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  const dataUrl = `data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`;
  const mod = await import(dataUrl);
  const out = {};
  for (const lang of LOCALES) out[lang] = mod[lang];
  return out;
}

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

// Overlay `over` onto `base` (a fresh deep copy of en), in place: an object node
// recurses; any other leaf takes the overlay's value. Keys present only in `base`
// keep their English value (fill-from-English); keys present only in `over` are
// appended. Driving from a copy of `en` keeps the emitted key order stable.
function deepMerge(base, over) {
  for (const key of Object.keys(over)) {
    const overValue = over[key];
    const baseValue = base[key];
    const bothObjects =
      overValue &&
      typeof overValue === 'object' &&
      !Array.isArray(overValue) &&
      baseValue &&
      typeof baseValue === 'object' &&
      !Array.isArray(baseValue);
    if (bothObjects) {
      deepMerge(baseValue, overValue);
    } else {
      base[key] = overValue;
    }
  }
  return base;
}

// Per-file do-not-edit banner. Every module in the generated directory carries it.
function fileBanner() {
  return [
    '// Generated by scripts/i18n_build.mjs. Do not edit by hand.',
    '//',
    '// Part of the generated src/ui/i18n.resolved.generated/ directory: one dense',
    '// locale slice per file (each `: EnTranslations` = typeof en, so tsc red-fails a',
    '// missing or renamed key), a back-compat barrel (index.ts) that re-exports every',
    '// slice and assembles the runtime `translations` map, per-locale lazy loaders',
    '// (loaders.ts), and the pending set (pending.ts). Regenerate with',
    '// `npm run i18n:build` (also wired into `npm run build` and `pretest`).',
    '// Reproducibility is checked by tests/i18n_resolved_equivalence.test.ts.',
  ].join('\n');
}

// One dense locale slice. Typed `: EnTranslations` (= typeof en) so tsc red-fails a
// missing or renamed key PER FILE. The type import reaches up one level to i18n.catalog;
// it is `import type`, so it is erased at build time and adds no runtime dependency
// to the client bundle (exactly as the single-file table did).
function emitLocaleModule(lang, table) {
  return [
    fileBanner(),
    '',
    "import type { EnTranslations } from '../i18n.catalog';",
    '',
    `export const ${lang}: EnTranslations = ${JSON.stringify(table, null, 2)};`,
    '',
  ].join('\n');
}

// en_XA: the dev-only pseudo-locale. Every `en` leaf accent-pushed and bracketed with
// {placeholders} preserved (see scripts/i18n_pseudo.mjs). The barrel re-exports it,
// but it is DELIBERATELY absent from translations / LOCALE_LOADERS / SUPPORTED_LANGUAGES,
// so it never enters supportedLanguages, the language picker, hreflang, or the release
// gate. The runtime loads it ONLY behind a dev gate (?lang=en_XA on a non-release
// build) to surface hard-coded literals that never became t() keys, and a production
// build tree-shakes it out via the import.meta.env.PROD guard in src/ui/i18n.ts. Typed
// `: EnTranslations` because the transform preserves the `en` structure exactly.
function emitEnXaModule(enXA) {
  return [
    fileBanner(),
    '',
    "import type { EnTranslations } from '../i18n.catalog';",
    '',
    `export const en_XA: EnTranslations = ${JSON.stringify(enXA, null, 2)};`,
    '',
  ].join('\n');
}

// Per-locale dotted keys with NO real translation in the source overlay: the dense
// table carries the English FILL for each of them. t() renders that English on a
// non-release build and HARD-FAILS on a release build (the release gate asserts this
// set is empty, so the failure is a never-fires safety net). Computed from the
// overlays, dialect-aware, mirroring scripts/i18n_scan.mjs's `providedByLang`; `en` is
// the source and is never pending. EMPTY while the overlays stay dense.
function emitPendingModule(pending) {
  return [
    fileBanner(),
    '',
    'export const pending: Record<string, readonly string[]> = ' +
      JSON.stringify(pending, null, 2) +
      ';',
    '',
  ].join('\n');
}

// Per-locale dynamic-import thunks for the later lazy flip: each loads one dense
// locale slice as its own content-hashed chunk. `en` is the eager base and en_XA is
// the dev-only pseudo-locale, so neither gets a loader. SUPPORTED_LANGUAGES mirrors
// the runtime `translations` key set (en + the 13 non-en locales, NOT en_XA). Nothing
// imports this module yet - the runtime still static-imports every slice via the
// barrel for now, so the bundle is unchanged; the async loader wires these in later.
function emitLoadersModule(locales) {
  const lines = [fileBanner(), '', 'export const LOCALE_LOADERS = {'];
  for (const lang of locales) {
    if (lang === 'en') continue; // en is eager; en_XA is excluded by construction
    lines.push(`  ${lang}: () => import('./${lang}'),`);
  }
  lines.push('};');
  lines.push('');
  lines.push(
    `export const SUPPORTED_LANGUAGES = [${locales.map((l) => `'${l}'`).join(', ')}] as const;`,
  );
  lines.push('');
  return lines.join('\n');
}

// The back-compat barrel. Re-exports every dense locale slice + en_XA + pending and
// assembles the runtime `translations` map. The key order is the LOCALES list, so
// Object.keys(translations) - and therefore supportedLanguages - is unchanged. This
// preserves the EXACT import surface src/ui/i18n.ts and the tests/hash harness expect:
// directory-index resolution of './i18n.resolved.generated' -> index.ts under the
// project's moduleResolution "Bundler".
function emitBarrel(locales) {
  const lines = [fileBanner(), ''];
  for (const lang of locales) lines.push(`import { ${lang} } from './${lang}';`);
  lines.push('');
  lines.push(`export { ${locales.join(', ')} };`);
  lines.push("export { en_XA } from './en_XA';");
  lines.push("export { pending } from './pending';");
  lines.push('');
  lines.push('export const translations = {');
  for (const lang of locales) lines.push(`  ${lang},`);
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

// A locale "provides" a key when its own overlay (or, for a dialect, its base
// chain) carries a non-empty value for it. The complement against `en`'s leaves is
// the per-locale `pending` set: untranslated keys the resolved table English-fills.
// This is the exact same rule as scripts/i18n_scan.mjs `providedByLang`, kept in
// lockstep so the build's runtime `pending` and the registry's `pending` agree.
const isPresent = (v) => typeof v === 'string' && v.trim().length > 0;

function computePending(en, locales) {
  const enFlatKeys = Object.keys(flatten(en));
  const pending = {};
  for (const lang of LOCALES) {
    if (lang === 'en') continue; // en is the authoritative source, never pending
    const provided = new Set();
    const own = locales[lang] || {};
    for (const k of Object.keys(own)) if (isPresent(own[k])) provided.add(k);
    const base = DIALECT_BASE[lang];
    if (base === 'en') {
      for (const k of enFlatKeys) provided.add(k); // English dialect inherits every leaf
    } else if (base) {
      const baseOverlay = locales[base] || {};
      for (const k of Object.keys(baseOverlay)) if (isPresent(baseOverlay[k])) provided.add(k);
    }
    pending[lang] = enFlatKeys.filter((k) => !provided.has(k)).sort();
  }
  return pending;
}

// Write a { filename -> contents } map into `dir` ATOMICALLY and prune orphans:
//   - mkdir -p the dir
//   - write each file to `<name>.tmp` then renameSync it over `<name>` (an atomic
//     same-dir replace: the destination path is never momentarily absent and never
//     half-written). A bare rmSync(dir)+recreate would make every slice vanish for a
//     window, and a concurrent reader resolving './en_XA' through the barrel during
//     that gap fails with "Cannot find module" (the reproducibility tests regenerate
//     this directory while other Vitest workers import it). It is also crash-safer:
//     every expected path always holds valid (old or new) content.
//   - delete any pre-existing *.ts not in the map (so a removed locale leaves no
//     orphan) AND any stale *.ts.tmp left by a run that crashed between writeFileSync
//     and renameSync (it never ends in plain ".ts", so it would otherwise survive and
//     could be committed by accident). By emit time every live tmp has been renamed
//     away, so this only sweeps leftovers, never an in-flight write.
// Returns the total bytes written.
function writeModuleDir(dir, modules) {
  mkdirSync(dir, { recursive: true });
  let totalBytes = 0;
  for (const [name, text] of Object.entries(modules)) {
    const dest = path.join(dir, name);
    const tmp = `${dest}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, dest);
    totalBytes += Buffer.byteLength(text, 'utf8');
  }
  const keep = new Set(Object.keys(modules));
  for (const entry of readdirSync(dir)) {
    if ((entry.endsWith('.ts') || entry.endsWith('.ts.tmp')) && !keep.has(entry)) {
      rmSync(path.join(dir, entry), { force: true });
    }
  }
  return totalBytes;
}

async function main() {
  const locales = await loadLocales();
  const en = locales.en;
  const resolved = {};
  for (const lang of LOCALES) {
    // `en` is nested and authoritative; every other locale is a flat dotted-key
    // overlay that we unflatten before overlaying onto a copy of `en`.
    // A dialect (DIALECT_BASE) additionally has its base locale's overlay applied
    // first, so its own overlay need only carry the keys that diverge from the base.
    const out = deepCopy(en);
    if (lang !== 'en') {
      const baseLocale = DIALECT_BASE[lang];
      // The base is `en` for en_CA (already the starting point, nothing to merge);
      // for es_ES/fr_CA it is another flat overlay applied before the dialect's.
      if (baseLocale && baseLocale !== 'en') {
        deepMerge(out, unflatten(locales[baseLocale]));
      }
      deepMerge(out, unflatten(locales[lang]));
    }
    resolved[lang] = out;
  }
  const pending = computePending(en, locales);
  // Generate en_XA from the resolved (dense) `en` so the pseudo table carries every
  // leaf, then emit it as a separate dev-only export (never in `translations`).
  const enXA = pseudoLocalize(resolved.en);

  // Compute every module fully in memory FIRST, then write the directory atomically
  // (see writeModuleDir). JSON.stringify(.., null, 2) formatting is unchanged, so each
  // slice is byte-identical to its old section in the single file.
  const modules = {};
  for (const lang of LOCALES) modules[`${lang}.ts`] = emitLocaleModule(lang, resolved[lang]);
  modules['en_XA.ts'] = emitEnXaModule(enXA);
  modules['pending.ts'] = emitPendingModule(pending);
  modules['loaders.ts'] = emitLoadersModule(LOCALES);
  modules['index.ts'] = emitBarrel(LOCALES);

  const totalBytes = writeModuleDir(OUT_DIR, modules);
  console.log(
    `generated ${path.relative(root, OUT_DIR)}/ ` +
      `(${LOCALES.length} locales + en_XA pseudo + barrel + loaders + pending, ${totalBytes} bytes)`,
  );
}

await main();
