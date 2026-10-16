import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { t } from '../src/ui/i18n';

// A key that is in the hand-written catalog but NOT in the generated tables
// throws at render time ("i18n: untracked key"). Inspector panels append their
// section on their LAST line, so one such key silently erased the whole Paint
// panel and its sliders until it was chased down by hand (SPACEY, 2026-09-22:
// "the tool only lets change brush size nothing else").
//
// The gap it slips through: `tsc` catches a bad key against the generated
// TranslationKey union, and CI diffs the generated tables for freshness, but
// neither runs on a maker's machine between `npm run dev` and looking at the
// screen. This does, in under a second.
//
// src/admin/* is deliberately out of scope: it has its OWN catalog and loader
// (scripts/i18n_admin_build.mjs), so its keys are absent from this union by
// design.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'admin' || p.includes('generated')) continue;
      out.push(...tsFilesUnder(p));
    } else if (e.name.endsWith('.ts') && !e.name.includes('generated')) {
      out.push(p);
    }
  }
  return out;
}

describe('every literal t() key resolves', () => {
  it('has no untracked keys anywhere in the app', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of tsFilesUnder(path.join(ROOT, 'src'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        const key = m[1];
        checked++;
        try {
          t(key as Parameters<typeof t>[0]);
        } catch {
          missing.push(`${path.relative(ROOT, file)}: ${key}`);
        }
      }
    }
    // Anti-vacuity: if the walk or the regex ever stops finding call sites
    // this test would pass on an empty set and guard nothing.
    expect(checked).toBeGreaterThan(2000);
    // The fix is `npm run i18n:gen` (build + admin + scan). `i18n:build` alone
    // leaves the status registry behind.
    expect(missing).toEqual([]);
  });
});
