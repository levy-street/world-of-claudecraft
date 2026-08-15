// Cross-boundary drift guard for the perf-doctor suggestion-id catalog
// (packet 0 ruling R14). server/ cannot import src/game, so the server keeps a
// deliberate copy of the client catalog as its storage allowlist; this pin is
// the ONLY thing that keeps the two lists equal (the crowd-label and
// schema-version pins in tests/perf_report.test.ts are the same pattern). It
// lives in its own file because it is the one test that intentionally imports
// BOTH sides of the boundary.
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is
// unset; server/perf_report.ts imports it, so set a dummy URL. Nothing here
// ever touches the pool.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_suggestion_parity';

import { describe, expect, it } from 'vitest';
import { PERF_SUGGESTION_IDS } from '../src/game/perf_doctor';
import { PERF_NUDGE_ARM_IDS } from '../src/ui/perf_nudge_view';

describe('perf suggestion id parity', () => {
  it('keeps the server allowlist equal to the client catalog, order included', async () => {
    const { perfReportInternalsForTest } = await import('../server/perf_report');
    expect([...perfReportInternalsForTest.KNOWN_PERF_SUGGESTION_IDS]).toEqual([
      ...PERF_SUGGESTION_IDS,
    ]);
  });

  it('keeps every nudge arm id inside the analyzer catalog', () => {
    // The toast view keys off analyzer output; an arm id the analyzer can
    // never emit would make the nudge dead code silently.
    const catalog = new Set<string>(PERF_SUGGESTION_IDS);
    for (const id of PERF_NUDGE_ARM_IDS) expect(catalog.has(id)).toBe(true);
  });
});
