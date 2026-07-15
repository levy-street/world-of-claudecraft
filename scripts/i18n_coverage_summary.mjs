// Post the i18n coverage counts to the CI job summary as the out-of-band audit trail.
//
// src/ui/i18n.status.summary.json (the small gitignored rollup emitted by
// scripts/i18n_scan.mjs alongside the gitignored full registry) is not committed,
// so it has no committed-bytes `git diff` trail. This script provides the audit
// trail instead: it reads the summary and appends a compact markdown
// block (headline totals + a per-locale rollup) to the file named by
// GITHUB_STEP_SUMMARY, so every CI run records the counts in its job summary.
//
// Zero runtime deps (node: builtins only) and deterministic: a pure function of
// the generated summary, with no timestamps, Date.now, or Math.random.
//
// Usage:
//   node scripts/i18n_coverage_summary.mjs
//     Append the coverage markdown to $GITHUB_STEP_SUMMARY when set (CI), else
//     print it to stdout as a local diagnostic. Exit 1 with a legible one-line
//     error (naming `npm run i18n:gen`) if the summary file is missing.

import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
export const SUMMARY_PATH = path.join(root, 'src/ui/i18n.status.summary.json');

// Friendly labels for the known `counts` fields; an unrecognized field falls back
// to its raw key, so the table adapts to whatever totals the summary carries.
const COUNT_LABELS = {
  keys: 'Keys',
  rows: 'Rows',
  translated: 'Translated',
  pending: 'Pending',
  blocked: 'Blocked',
  blockedSource: 'Blocked source',
};

// Group an integer's digits into en-US thousands groups ("152939" -> "152,939"),
// matching the reader-friendly grouping formatNumber applies. Deterministic and
// independent of the ambient locale (does not read LC_ALL / ICU).
export function formatInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const sign = n < 0 ? '-' : '';
  const digits = Math.abs(Math.trunc(n)).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Render the parsed summary object as a compact GitHub-flavored markdown block:
// an h2 heading, a totals table over `counts`, and a per-locale rollup table.
// Pure: same input gives the same output, no I/O, no clock.
export function formatCoverageSummary(summary) {
  if (!summary || typeof summary !== 'object' || !summary.counts || !summary.perLocale) {
    throw new Error('i18n coverage: summary is missing its counts / perLocale rollup.');
  }
  const counts = summary.counts;
  const perLocale = summary.perLocale;
  const locales = Array.isArray(summary.locales) ? summary.locales : Object.keys(perLocale);

  const lines = [];
  lines.push('## i18n coverage');
  lines.push('');
  lines.push(
    'Audit trail for the gitignored `src/ui/i18n.status.summary.json` (headline counts ' +
      'plus per-locale rollup).',
  );
  if (typeof summary.universeHash === 'string') {
    lines.push('');
    lines.push(`Universe hash: \`${summary.universeHash}\``);
  }

  lines.push('');
  lines.push('### Totals');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('| --- | ---: |');
  for (const key of Object.keys(counts)) {
    const label = COUNT_LABELS[key] ?? key;
    lines.push(`| ${label} | ${formatInt(counts[key])} |`);
  }

  // Column set derived from the first locale's row so the table adapts if the
  // scanner ever adds a state; falls back to the documented three states.
  const firstRow = locales.length > 0 ? perLocale[locales[0]] : undefined;
  const stateColumns =
    firstRow && typeof firstRow === 'object'
      ? Object.keys(firstRow)
      : ['translated', 'pending', 'blocked'];

  lines.push('');
  lines.push('### Per-locale coverage');
  lines.push('');
  lines.push(`| Locale | ${stateColumns.map((c) => COUNT_LABELS[c] ?? c).join(' | ')} |`);
  lines.push(`| --- | ${stateColumns.map(() => '---:').join(' | ')} |`);
  for (const locale of locales) {
    const row = perLocale[locale] ?? {};
    const cells = stateColumns.map((c) => formatInt(row[c] ?? 0));
    lines.push(`| ${locale} | ${cells.join(' | ')} |`);
  }

  return `${lines.join('\n')}\n`;
}

function readSummary() {
  let text;
  try {
    text = readFileSync(SUMMARY_PATH, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      console.error(
        `i18n coverage: ${path.relative(root, SUMMARY_PATH)} is missing - run \`npm run i18n:gen\` first.`,
      );
      process.exit(1);
    }
    throw err;
  }
  return JSON.parse(text);
}

// Run as a CLI only when invoked directly (not when imported by the test).
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const markdown = formatCoverageSummary(readSummary());
  const stepSummary = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummary) {
    appendFileSync(stepSummary, markdown);
    console.log(`i18n coverage: appended the rollup to $GITHUB_STEP_SUMMARY.`);
  } else {
    process.stdout.write(markdown);
  }
}
