// The stored-locale modulepreload (i18n Lazy Locales) - resolve each lazy locale chunk's content-hashed
// URL from Vite's post-build manifest and template a { locale: hashedChunkUrl }
// lookup into the emitted dist/index.html, where the inline boot <script> reads it
// to inject a high-priority <link rel="modulepreload"> for a stored non-en visitor's
// locale BEFORE the main module parses (kills the main-then-locale request waterfall).
//
// Pure, zero-dep helpers (unit-tested by tests/i18n_modulepreload.test.ts) plus a
// thin FS orchestrator (templateModulepreload) the Vite closeBundle plugin in
// vite.config.ts calls. The runtime selects the locale at runtime, so Vite cannot
// auto-inject a modulepreload hint for it - this build hook supplies the hashed name.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// The build templates the real map over this sentinel in index.html. It is a bare
// identifier reference, so a dev load (no build hook) throws a ReferenceError that the
// inline script's try/catch swallows -> no-op; the build replaces it with a JSON literal.
export const PLACEHOLDER = '__I18N_LOCALE_CHUNKS__';

// Root-relative directory of the generated game locale slices. Manifest keys are
// root-relative source paths, so the lazy chunk for `es` is keyed here as
// `${GENERATED_DIR}/es.ts`. The admin twin (src/admin/...) is deliberately NOT matched:
// admin stays statically imported so it has no per-locale chunks.
export const GENERATED_DIR = 'src/ui/i18n.resolved.generated';

// Join a Vite `base` ('/' here) with a manifest `file` ('assets/es-HASH.js') into an
// absolute, same-origin URL ('/assets/es-HASH.js').
function joinBase(base, file) {
  const b = base || '/';
  return b.endsWith('/') ? `${b}${file}` : `${b}/${file}`;
}

// Extract the non-English supported locale codes from the generated loaders.ts source
// (`export const SUPPORTED_LANGUAGES = ['en', 'es', ...] as const;`). These are exactly
// the codes that have a lazy chunk (LOCALE_LOADERS = SUPPORTED_LANGUAGES minus 'en'),
// so it is the authoritative set the manifest must cover. Parsing the source keeps the
// hook in lockstep with the generator without importing the .ts into this .mjs tool.
export function parseSupportedLocales(loadersSource) {
  const arrayMatch = /SUPPORTED_LANGUAGES\s*=\s*\[([^\]]*)\]/.exec(loadersSource);
  if (!arrayMatch) {
    throw new Error('i18n modulepreload: could not parse SUPPORTED_LANGUAGES from loaders source');
  }
  const codes = [...arrayMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const locales = codes.filter((code) => code !== 'en');
  if (locales.length === 0) {
    throw new Error('i18n modulepreload: parsed an empty non-en locale set from loaders source');
  }
  return locales;
}

// Build the { locale: hashedChunkUrl } lookup from a parsed Vite manifest. Every expected
// non-en locale MUST resolve to a real chunk file; a miss is a hard error (a stored visitor
// for that locale would otherwise get no preload), satisfying the stored-locale modulepreload STOP rule "the
// build hook cannot reliably resolve the hashed filename".
export function localeChunkMap(manifest, locales, base = '/', dir = GENERATED_DIR) {
  const map = {};
  const missing = [];
  for (const lang of locales) {
    const entry = manifest[`${dir}/${lang}.ts`];
    if (!entry || typeof entry.file !== 'string') {
      missing.push(lang);
      continue;
    }
    map[lang] = joinBase(base, entry.file);
  }
  if (missing.length > 0) {
    throw new Error(`i18n modulepreload: no manifest chunk for locale(s): ${missing.join(', ')}`);
  }
  return map;
}

// Replace the single sentinel occurrence in index.html with the JSON map literal.
// Absence of the sentinel is a hard error (the inline boot script would silently never
// preload), not a no-op.
export function injectLocaleChunkMap(html, map, placeholder = PLACEHOLDER) {
  if (!html.includes(placeholder)) {
    throw new Error(`i18n modulepreload: sentinel ${placeholder} not found in index.html`);
  }
  // Escape '<' so the JSON literal embedded in the inline <script> can never break out
  // via a '</script>' or '<!--' sequence (the values are build-fixed same-origin hashed
  // paths today, so this is defense-in-depth).
  const json = JSON.stringify(map).replace(/</g, '\\u003c');
  return html.split(placeholder).join(json);
}

// FS orchestrator the Vite closeBundle plugin calls: read the post-build manifest +
// loaders source, resolve the hashed locale chunks, and template the lookup into the
// emitted dist/index.html. Returns the resolved map for logging/tests.
export function templateModulepreload({ root, outDir, base = '/' }) {
  const manifestPath = path.join(outDir, '.vite', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const loadersSource = readFileSync(path.join(root, GENERATED_DIR, 'loaders.ts'), 'utf8');
  const locales = parseSupportedLocales(loadersSource);
  const map = localeChunkMap(manifest, locales, base);
  const htmlPath = path.join(outDir, 'index.html');
  const html = readFileSync(htmlPath, 'utf8');
  writeFileSync(htmlPath, injectLocaleChunkMap(html, map));
  return { map, htmlPath, manifestPath };
}
