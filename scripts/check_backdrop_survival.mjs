// Blocking build-time guard for the Lightning CSS backdrop-filter drop
// (Vite #21954 / lightningcss #695): when a rule declares both `backdrop-filter`
// and `-webkit-backdrop-filter` with the standard one FIRST, Lightning's minifier
// can silently drop the unprefixed `backdrop-filter`, leaving only the -webkit-
// form. That kills the frosted-glass HUD on engines that honor only the standard
// property (e.g. Firefox) - in production, not in dev. We keep the twin alive by
// authoring -webkit- first (see src/styles/*.css), and this check fails the build
// if any minified rule lost a twin anyway.
//
// Run by `npm run build` after `vite build`, over EVERY emitted dist CSS file
// (today the index and play chunks built from src/styles plus the guide chunk from
// src/guide/styles.css; admin ships an inline <style> and emits no separate CSS, so
// it has nothing to scan). Pure logic lives in scanBackdropSurvival() so
// tests/backdrop_filter_survival.test.ts can prove the teeth without a full build.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Scan one stylesheet's text and return a list of rules whose backdrop-filter
 * twin did not survive. A rule passes only when it carries BOTH the standard
 * `backdrop-filter` and the `-webkit-backdrop-filter` form with matching values.
 * Walks innermost declaration blocks only, so an @supports/@media wrapper or a
 * `@supports (backdrop-filter: ...)` feature query is never miscounted.
 *
 * @param {string} css stylesheet text (minified or source)
 * @param {string} label file label for reporting
 * @returns {Array<{label:string, selector:string, standard:string[], webkit:string[]}>}
 */
export function scanBackdropSurvival(css, label = 'css') {
  const violations = [];
  // Strip CSS comments first so a commented-out `backdrop-filter` (or a stray brace
  // inside a comment) cannot skew the brace walk. Minified dist has no comments, so
  // this only hardens the function if it is ever pointed at unminified source.
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Compare twin values whitespace-insensitively (minify already removes the spaces;
  // this keeps `blur( 2px )` and `blur(2px)` from looking different on raw input).
  const normValue = (value) => value.replace(/\s+/g, '');
  const openStack = [];
  for (let p = 0; p < css.length; p++) {
    const ch = css[p];
    if (ch === '{') {
      openStack.push(p);
    } else if (ch === '}') {
      const open = openStack.pop();
      if (open === undefined) continue;
      const body = css.slice(open + 1, p);
      if (body.includes('{')) continue; // not an innermost declaration block
      if (!body.includes('backdrop-filter')) continue;
      const standard = [];
      const webkit = [];
      for (const rawDecl of body.split(';')) {
        const decl = rawDecl.trim();
        if (/^-webkit-backdrop-filter\s*:/.test(decl)) {
          webkit.push(normValue(decl.replace(/^-webkit-backdrop-filter\s*:\s*/, '')));
        } else if (/^backdrop-filter\s*:/.test(decl)) {
          standard.push(normValue(decl.replace(/^backdrop-filter\s*:\s*/, '')));
        }
      }
      // The body.includes('backdrop-filter') prefilter above also matches a block whose
      // only occurrence is a custom property (--foo-backdrop-filter:) or a content: string
      // that merely mentions the token but declares no real backdrop-filter. With both
      // lists empty there is nothing to pair, so skip rather than flag a phantom violation.
      if (standard.length === 0 && webkit.length === 0) continue;
      const std = standard.slice().sort();
      const wk = webkit.slice().sort();
      const paired = std.length > 0 && wk.length === std.length && std.every((v, i) => v === wk[i]);
      if (!paired) {
        const selStart =
          Math.max(css.lastIndexOf('}', open - 1), css.lastIndexOf('{', open - 1)) + 1;
        violations.push({
          label,
          selector: css.slice(selStart, open).trim().slice(-100),
          standard: std,
          webkit: wk,
        });
      }
    }
  }
  return violations;
}

/** Collect every *.css file under a built dist directory. */
function distCssFiles(distDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.css')) out.push(full);
    }
  };
  walk(distDir);
  return out;
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const distDir = path.join(root, 'dist');
  if (!existsSync(distDir)) {
    console.error('[backdrop-survival] dist/ not found - run `vite build` first.');
    process.exit(1);
  }
  const files = distCssFiles(distDir);
  if (files.length === 0) {
    console.error('[backdrop-survival] no CSS emitted in dist/ - nothing to check (unexpected).');
    process.exit(1);
  }
  const violations = [];
  let backdropRules = 0;
  for (const file of files) {
    const css = readFileSync(file, 'utf8');
    const rel = path.relative(root, file);
    backdropRules += (css.match(/-webkit-backdrop-filter\s*:/g) || []).length;
    violations.push(...scanBackdropSurvival(css, rel));
  }
  if (violations.length > 0) {
    console.error(
      `[backdrop-survival] FAIL: ${violations.length} rule(s) lost a backdrop-filter twin after minify ` +
        '(Lightning CSS dropped the standard or -webkit- form; HUD glass breaks in production):',
    );
    for (const v of violations) {
      console.error(
        `  ${v.label}: { ${v.selector} } standard=[${v.standard.join(', ')}] webkit=[${v.webkit.join(', ')}]`,
      );
    }
    process.exit(1);
  }
  console.log(
    `[backdrop-survival] OK: ${backdropRules} -webkit-backdrop-filter declaration(s) across ${files.length} CSS file(s); every backdrop-filter keeps both twins.`,
  );
}

// Run as CLI when invoked directly; stay importable for the unit test.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
