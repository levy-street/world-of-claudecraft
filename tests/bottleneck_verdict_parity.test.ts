// Cross-boundary drift guard for the bottleneck verdict catalog (the Windows
// bottleneck diagnostics, perf-report schema version 3). server/ cannot
// import src/render, so the server keeps a deliberate copy of the render
// catalog as its storage allowlist; this pin is the ONLY thing that keeps the
// two lists equal (tests/perf_suggestion_id_parity.test.ts is the same
// pattern for the perf-doctor suggestion ids). It lives in its own file
// because it is the one test that intentionally imports BOTH sides of the
// boundary.
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is
// unset; server/perf_report.ts imports it, so set a dummy URL. Nothing here
// ever touches the pool.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_bottleneck_parity';

import { describe, expect, it } from 'vitest';
import { BOTTLENECK_VERDICTS } from '../src/render/bottleneck_core';

describe('bottleneck verdict parity', () => {
  it('keeps the server allowlist equal to the render catalog, order included', async () => {
    const { perfReportInternalsForTest } = await import('../server/perf_report');
    expect([...perfReportInternalsForTest.KNOWN_BOTTLENECK_VERDICTS]).toEqual([
      ...BOTTLENECK_VERDICTS,
    ]);
  });
});
