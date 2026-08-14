import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

// Full-line // comments are stripped first, the same rule its sibling
// tests/geared_arrival_roster.test.mjs applies: this script explains its own
// timeouts and teardown in prose right beside them, so a raw-text scan would be
// satisfied by a commented-out or merely described setting.
const SOURCE = codeWithoutLineComments(
  readFileSync(new URL('../scripts/geared_arrival_bench.mjs', import.meta.url), 'utf8'),
);

describe('geared arrival bench fixture bounds', () => {
  it('caps the crowd and bounds database operations', () => {
    expect(SOURCE).toContain(
      "throw new Error('BENCH_WAVES must contain positive integers totalling at most 40')",
    );
    expect(SOURCE).toContain('connectionTimeoutMillis: 5_000');
    expect(SOURCE).toContain('query_timeout: 15_000');
    expect(SOURCE).toContain('statement_timeout: 15_000');
    expect(SOURCE).toContain("options: '-c lock_timeout=5000'");
  });

  it('removes only the exact accounts created by the run', () => {
    expect(SOURCE).toContain('DELETE FROM accounts WHERE username = ANY($1::text[])');
    expect(SOURCE).toMatch(/gearcam_\$\{uniq\}/);
  });
});
