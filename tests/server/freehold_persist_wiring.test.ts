// Guards: the realm composition root's three housing decisions that are not a
// port binding (server/freehold_persist_wiring.ts): which held claims the realm
// still WANTS (each of the four arms on its own, against a control), the
// recovery pass's admission (no gate admits, a gate without an immediate
// permit skips), and the renewer's synchronous launch reaching the save
// observer that bills the Tick Profiler. The nearest suite,
// tests/server/freehold_mutation.test.ts, drives renewFreeholdClaims with its
// own injected `wanted` and never reaches the realm's predicate.
//
// Cost: 5 ms
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({
  // The wiring reads only these two; no statement runs in this suite.
  pool: {
    connect: vi.fn(async () => {
      throw new Error('no statement may run in this suite');
    }),
  },
  runWithStatementTimeout: vi.fn(),
}));

import { createFreeholdClaimRegistry } from '../../server/freehold_claim_registry';
import { FREEHOLD_PERSIST_LOGIN_BUDGET_MS } from '../../server/freehold_persist';
import {
  freeholdRecoveryPermitPort,
  gameFreeholdClaimWanted,
  renewGameFreeholdClaims,
} from '../../server/freehold_persist_wiring';

const claim = { plotId: 'plot:a', accountId: 7, generation: '2', acquiredAtMs: 100_000 };
const OWNER = 'account:7';

describe('gameFreeholdClaimWanted', () => {
  const sources = (over: { store?: boolean; sim?: boolean; inFlight?: boolean } = {}) => ({
    sim: { ctx: { freeholds: new Map(over.sim ? [[OWNER, {}]] : []) } } as never,
    store: { wantsClaim: (key: string) => over.store === true && key === OWNER },
    claims: { inFlight: (plotId: string) => over.inFlight === true && plotId === 'plot:a' },
  });
  const wantedWith = (over: Parameters<typeof sources>[0], nowMs: number) => {
    const s = sources(over);
    return gameFreeholdClaimWanted(s.sim, s.store, s.claims)(claim, nowMs);
  };
  // Past the login grace, so only the arm under test can keep the claim.
  const late = claim.acquiredAtMs + FREEHOLD_PERSIST_LOGIN_BUDGET_MS;

  it('keeps a claim for each live source on its own, and releases it with none', () => {
    expect(FREEHOLD_PERSIST_LOGIN_BUDGET_MS).toBe(10_000);
    expect(wantedWith({}, late)).toBe(false);
    expect(wantedWith({ store: true }, late)).toBe(true);
    expect(wantedWith({ sim: true }, late)).toBe(true);
    expect(wantedWith({ inFlight: true }, late)).toBe(true);
  });

  it('keeps a young claim through the login grace, and not one millisecond past it', () => {
    expect(wantedWith({}, late - 1)).toBe(true);
    expect(wantedWith({}, late)).toBe(false);
  });

  it("asks each source about THIS claim's owner and plot, never another's", () => {
    const s = sources({ store: true, sim: true, inFlight: true });
    const wanted = gameFreeholdClaimWanted(s.sim, s.store, s.claims);
    expect(wanted({ ...claim, accountId: 8, plotId: 'plot:b' }, late)).toBe(false);
  });
});

describe('freeholdRecoveryPermitPort', () => {
  it('admits with no gate at all, and with a gate takes only an immediate permit', () => {
    const none = freeholdRecoveryPermitPort();
    expect(none()).not.toBeNull();
    const permit = { release: vi.fn() };
    expect(freeholdRecoveryPermitPort({ tryAcquire: () => permit })()).toBe(permit);
    // A busy gate, and a gate with no immediate admission, both skip the pass.
    expect(freeholdRecoveryPermitPort({ tryAcquire: () => null })()).toBeNull();
    expect(freeholdRecoveryPermitPort({})()).toBeNull();
  });
});

describe('renewGameFreeholdClaims', () => {
  it('reports its synchronous launch to the save observer once, and never touches the pool with nothing held', async () => {
    const registry = createFreeholdClaimRegistry();
    const billed: number[] = [];
    const sim = { ctx: { freeholds: new Map() } } as never;
    const pass = renewGameFreeholdClaims(sim, { wantsClaim: () => false }, registry, (ms) =>
      billed.push(ms),
    );
    // Billed before the pass resolves: the launch is the synchronous part.
    expect(billed).toHaveLength(1);
    expect(Number.isFinite(billed[0])).toBe(true);
    expect(billed[0]).toBeGreaterThanOrEqual(0);
    await pass;
    expect(registry.counters.renewPasses).toBe(1);
    // Control: without an observer it still runs.
    await renewGameFreeholdClaims(sim, { wantsClaim: () => false }, registry);
    expect(registry.counters.renewPasses).toBe(2);
  });
});
