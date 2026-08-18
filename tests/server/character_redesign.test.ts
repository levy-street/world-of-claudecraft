// Unit coverage for the PAID character redesign endpoint
// (server/character_redesign.ts): POST /api/characters/:id/redesign, which spends
// one Stylist credit on a new authored look.
//
// Driven through the module's own `routes` + configureCharacterRedesignRuntime
// injection + the fakeCtx/FakeDb helpers, per the endpoint-test contract in
// server/CLAUDE.md: no pg mock, no sql.includes(), no Postgres.
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is
// unset; this module imports it, so set a dummy URL. The pool never connects:
// every db call under test is a fake supplied via setCharacterRedesignDbForTests.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_redesign_units';

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type CharacterRedesignRuntime,
  configureCharacterRedesignRuntime,
  resetCharacterRedesignDbForTests,
  resetCharacterRedesignRuntimeForTests,
  routes,
  setCharacterRedesignDbForTests,
} from '../../server/character_redesign';
import type { CharacterRow } from '../../server/db';
import type { Ctx } from '../../server/http/types';
import { type FakeRes, fakeCtx } from './helpers';

const REDESIGN_CHARACTER_RESOURCE = 'redesignCharacter';

/** A well-formed authored look: one known key with a bare style id, which is
 *  what sanitizeAppearance (the SHARED creation validator) accepts. */
const GOOD_LOOK = { hair: 'warriorbraid', face: { nose: 0.25 } };

function charRow(overrides: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 1,
    account_id: 7,
    name: 'Hero',
    class: 'warrior',
    level: 1,
    state: null,
    is_gm: false,
    force_rename: false,
    ...overrides,
  };
}

function fakeRuntime(overrides: Partial<CharacterRedesignRuntime> = {}) {
  const rt = {
    applyAppearanceForCharacter: vi.fn(() => true),
    setHelmHiddenForCharacter: vi.fn(() => true),
    spendRedesignCreditForCharacter: vi.fn(() => true),
    ...overrides,
  };
  configureCharacterRedesignRuntime(rt);
  return rt;
}

/** Drive the handler directly, with the owned row already preset on ctx.state
 *  (the ownership loader's job, exercised separately by the registry-wide
 *  deny-by-default sweep in tests/server/http/ownership_coverage.test.ts). */
async function callHandler(body: unknown, row: CharacterRow = charRow()) {
  const route = routes[0];
  const state = new Map<string, unknown>([[REDESIGN_CHARACTER_RESOURCE, row]]);
  const ctx: Ctx = fakeCtx({
    method: 'POST',
    url: '/api/characters/1/redesign',
    params: { id: '1' },
    account: { accountId: 7, scope: 'full' },
    body,
    state,
  });
  await route.handler(ctx);
  const res = ctx.res as unknown as FakeRes;
  return { status: res.statusCode, body: res.body === '' ? undefined : JSON.parse(res.body) };
}

afterEach(() => {
  resetCharacterRedesignDbForTests();
  resetCharacterRedesignRuntimeForTests();
  vi.restoreAllMocks();
});

describe('POST /api/characters/:id/redesign', () => {
  it('spends a credit and saves the look on the happy path', async () => {
    const consumeRedesignCredit = vi.fn(async () => true);
    setCharacterRedesignDbForTests({ consumeRedesignCredit });
    const rt = fakeRuntime();

    const res = await callHandler({ appearance: GOOD_LOOK, helmHidden: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, appearance: GOOD_LOOK, helmHidden: true });
    // The account id comes from the authenticated ctx, never the body.
    expect(consumeRedesignCredit).toHaveBeenCalledWith(7, 1, GOOD_LOOK, true);
    // All three live-session mirrors fire. The credit one is the load-bearing
    // mirror: without it an online character's autosave refunds the spend.
    expect(rt.spendRedesignCreditForCharacter).toHaveBeenCalledWith(1);
    expect(rt.setHelmHiddenForCharacter).toHaveBeenCalledWith(1, true);
    expect(rt.applyAppearanceForCharacter).toHaveBeenCalledWith(1, GOOD_LOOK);
  });

  it('400s with a stable code when no credit is held, and writes nothing', async () => {
    // The conditional UPDATE matched no row: credits were 0.
    setCharacterRedesignDbForTests({ consumeRedesignCredit: async () => false });
    const rt = fakeRuntime();

    const res = await callHandler({ appearance: GOOD_LOOK });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'no redesign credit available for this character',
      code: 'character.no_redesign_credit',
    });
    // No live push on the refusal path: the row was never changed.
    expect(rt.spendRedesignCreditForCharacter).not.toHaveBeenCalled();
    expect(rt.applyAppearanceForCharacter).not.toHaveBeenCalled();
  });

  it('a concurrent double-submit yields ONE redesign from one credit', async () => {
    // The conditional decrement is the whole defense: the first submit matches
    // the row, the second finds credits already at 0 and matches nothing. Both
    // requests are in flight against the same credit.
    let creditsLeft = 1;
    const consumeRedesignCredit = vi.fn(async () => {
      if (creditsLeft < 1) return false;
      creditsLeft -= 1;
      return true;
    });
    setCharacterRedesignDbForTests({ consumeRedesignCredit });
    const rt = fakeRuntime();

    const [first, second] = await Promise.all([
      callHandler({ appearance: GOOD_LOOK }),
      callHandler({ appearance: { hair: 'longcenterpart' } }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 400]);
    expect(creditsLeft).toBe(0);
    // Exactly one redesign was applied, not two.
    expect(rt.applyAppearanceForCharacter).toHaveBeenCalledTimes(1);
    expect(rt.spendRedesignCreditForCharacter).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed look with the shared creation validator, spending nothing', async () => {
    const consumeRedesignCredit = vi.fn(async () => true);
    setCharacterRedesignDbForTests({ consumeRedesignCredit });
    fakeRuntime();

    // Each of these fails sanitizeAppearance, the SAME bounds validator initial
    // character creation runs: a look renders to every player in view, so the
    // editor client is never trusted.
    const malformed = [
      { appearance: {} }, // authored nothing
      { appearance: { hair: '<script>alert(1)</script>' } }, // not a bare style id
      { appearance: { unknownKey: 'x' } }, // no known key survives
      { appearance: 'not-an-object' },
      { appearance: null }, // absent counts as malformed here, not "clear the look"
      {}, // no appearance field at all
    ];
    for (const body of malformed) {
      const res = await callHandler(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body).toEqual({
        error: 'invalid appearance payload',
        code: 'character.invalid_appearance',
      });
    }
    // Not one credit was touched by any of them.
    expect(consumeRedesignCredit).not.toHaveBeenCalled();
  });

  it('drops unknown keys rather than storing attacker-chosen text', async () => {
    const consumeRedesignCredit = vi.fn(async () => true);
    setCharacterRedesignDbForTests({ consumeRedesignCredit });
    fakeRuntime();

    await callHandler({ appearance: { hair: 'warriorbraid', evil: 'free text here' } });

    // The stored document carries only the allowlisted key.
    expect(consumeRedesignCredit).toHaveBeenCalledWith(7, 1, { hair: 'warriorbraid' }, null);
  });

  it('omitted helmHidden is NULL, so it never un-hides a helm hidden in world', async () => {
    const consumeRedesignCredit = vi.fn(async () => true);
    setCharacterRedesignDbForTests({ consumeRedesignCredit });
    const rt = fakeRuntime();

    await callHandler({ appearance: GOOD_LOOK });

    expect(consumeRedesignCredit).toHaveBeenCalledWith(7, 1, GOOD_LOOK, null);
    // Nothing to mirror when the client did not offer the toggle.
    expect(rt.setHelmHiddenForCharacter).not.toHaveBeenCalled();
  });

  it('is registered as an owner-gated POST behind the registry', () => {
    const route = routes[0];
    expect(route.method).toBe('POST');
    expect(route.path).toBe('/api/characters/:id/redesign');
    expect(route.surface).toBe('api');
    // BOLA meta: the registry shadow guard and the deny-by-default sweep both
    // key off this.
    expect(route.meta?.requireOwned).toEqual({
      kind: REDESIGN_CHARACTER_RESOURCE,
      ownerScope: 'account',
    });
  });
});
