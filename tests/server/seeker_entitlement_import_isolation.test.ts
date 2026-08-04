import { describe, expect, it, vi } from 'vitest';

// Regression pin for the import-time blast radius (release/v0.34.0, PR #2423).
//
// `server/seeker_entitlement.ts` builds its REAL_RUNTIME table at module scope. When the
// entries captured the imported bindings eagerly, loading the module read every one of
// them, so ANY suite whose `vi.mock('../server/db')` factory omitted a single export threw
// on import and failed to collect. Adding `walletForAccount` to db that way broke 37
// unrelated suites (xp, markers, ip_block_kick, playtime_grant, ...), none of which touch
// Seeker: the failures read as 37 broken features rather than one missing mock line.
//
// This file mocks db with a factory that deliberately omits EVERY seeker-related export,
// mimicking the ordinary server suite that has no idea this module exists, then imports
// the module. It passes only while the runtime defers its reads to call time.
//
// Deliberately NOT fixed by adding the export to this factory: doing that here would pin
// the opposite of the invariant. The point is that an unrelated suite must be able to
// under-specify the db mock and still load.
vi.mock('../../server/db', () => ({
  // The two exports a generic server suite actually mocks, and nothing else.
  accountAndScopeForToken: vi.fn(),
  moderationStatusForAccount: vi.fn(),
  pool: {},
}));

describe('seeker_entitlement import isolation', () => {
  it('loads under a db mock that omits its exports, without touching them', async () => {
    // A throw here is the regression: it means module scope read a binding the mock does
    // not define. The assertions after it are secondary to the import surviving at all.
    const mod = await import('../../server/seeker_entitlement');

    expect(typeof mod.handleSeekerEntitlementStatus).toBe('function');
    expect(typeof mod.setSeekerEntitlementRuntimeForTests).toBe('function');
  });

  it('survives the spread the test-override helper performs', async () => {
    // The other half of the design choice. `setSeekerEntitlementRuntimeForTests` does
    // `{ ...REAL_RUNTIME, ...overrides }`, and a spread READS every property: a
    // getter-based deferral would throw right here under this same under-specified mock,
    // which is why the entries are forwarding arrows instead. Forwarding itself is
    // already covered by the Seeker suites that call these paths for real.
    const mod = await import('../../server/seeker_entitlement');
    expect(() => mod.setSeekerEntitlementRuntimeForTests({})).not.toThrow();
    mod.resetSeekerEntitlementRuntimeForTests();
  });
});
