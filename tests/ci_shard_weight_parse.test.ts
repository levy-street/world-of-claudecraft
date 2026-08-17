import { describe, expect, it } from 'vitest';
import { parseWeightLines, SKIPPED_FILE_WEIGHT_MS } from '../scripts/lib/ci_shard_weight_parse.mjs';

const ESC = String.fromCharCode(27);

describe('ci shard weight log parser', () => {
  it('parses both ANSI encodings, both duration units, and skip-count lines', () => {
    const log = [
      `${ESC}[32m\u2713${ESC}[39m tests/a.test.ts ${ESC}[2m(${ESC}[22m12 tests${ESC}[2m)${ESC}[22m 159${ESC}[2mms${ESC}[22m`,
      '^[[32m\u2713^[[39m tests/b.test.ts ^[[2m(^[[22m3 tests | 2 skipped^[[2m)^[[22m 2.5^[[2ms^[[22m',
      'not a reporter line at all',
    ].join('\n');
    expect(parseWeightLines(log)).toEqual({ 'tests/a.test.ts': 159, 'tests/b.test.ts': 2500 });
  });

  it('keeps the MAX across repeated occurrences', () => {
    const into = parseWeightLines('\u2713 tests/a.test.ts (1 tests) 100ms');
    parseWeightLines('\u2713 tests/a.test.ts (1 tests) 90ms', into);
    parseWeightLines('\u2713 tests/a.test.ts (1 tests) 140ms', into);
    expect(into['tests/a.test.ts']).toBe(140);
  });

  it('records a small floor for fully-skipped files instead of omitting them', () => {
    // Permanently-skipped suites (no-database integration files) previously
    // never entered the table and fell to the unknown-file fallback forever.
    const into = parseWeightLines('\u2193 tests/db_integration.test.ts (9 tests | 9 skipped)');
    expect(into['tests/db_integration.test.ts']).toBe(SKIPPED_FILE_WEIGHT_MS);
    // A later RAN occurrence still wins over the skip floor.
    parseWeightLines('\u2713 tests/db_integration.test.ts (9 tests) 800ms', into);
    expect(into['tests/db_integration.test.ts']).toBe(800);
  });
});
