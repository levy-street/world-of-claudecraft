// Direct tests for the extracted step-up flow (server/woc_market_stepup_flow.ts):
// the shape screens that must refuse BEFORE the store sees attacker strings,
// the directed arm's seller-scoped derivation, and the issue path's row
// composition. End-to-end behavior stays pinned by the routes/service suites
// and the step-up pg rig; these drive the module without a service.

import { describe, expect, it, vi } from 'vitest';
import type { WocDirectedOfferRow } from '../../server/woc_market';
import { stepUpBindingDigest, WOC_MARKET_STEPUP_TTL_MS } from '../../server/woc_market_stepup';
import {
  issueStepUpChallengeFlow,
  stepUpProofRefusal,
  type WocStepUpFlowCtx,
} from '../../server/woc_market_stepup_flow';
import { ITEMS } from '../../src/sim/data';

const NOW = 1_820_000_000_000;
const KNOWN_ITEM = Object.keys(ITEMS)[0];

function ctxOf(db: Partial<WocStepUpFlowCtx['db']> = {}, devSig = true): WocStepUpFlowCtx {
  return {
    db: db as WocStepUpFlowCtx['db'],
    realm: 'Claudemoon',
    devSig,
    now: () => NOW,
  };
}

describe('stepUpProofRefusal shape screens', () => {
  it('refuses a missing proof and an off-shape nonce or oversized signature WITHOUT a query', async () => {
    const consumeStepUpChallenge = vi.fn();
    const ctx = ctxOf({ consumeStepUpChallenge });
    const binding = { operation: 'create_listing', itemId: KNOWN_ITEM } as never;
    expect(await stepUpProofRefusal(ctx, 7, 'w', undefined, binding)).toBe('stepup_required');
    expect(
      await stepUpProofRefusal(ctx, 7, 'w', { nonce: 'NOT-HEX', signature: 's' }, binding),
    ).toBe('stepup_challenge_invalid');
    expect(
      await stepUpProofRefusal(
        ctx,
        7,
        'w',
        { nonce: 'a'.repeat(32), signature: 'x'.repeat(257) },
        binding,
      ),
    ).toBe('stepup_challenge_invalid');
    // The decided refusal never reached the store: the screen is what keeps
    // attacker-controlled strings out of the SQL layer.
    expect(consumeStepUpChallenge).not.toHaveBeenCalled();
  });
});

describe('issueStepUpChallengeFlow', () => {
  const offerRow = (over: Partial<WocDirectedOfferRow> = {}): WocDirectedOfferRow =>
    ({
      id: 5,
      sellerAccount: 7,
      buyerAccount: 8,
      status: 'pending',
      expiresAtMs: NOW + 60_000,
      itemId: KNOWN_ITEM,
      usdCents: 5000,
      ...over,
    }) as WocDirectedOfferRow;

  it('the directed arm is seller-scoped: anyone else reads not_found (anti-enumeration)', async () => {
    const ctx = ctxOf({ directedOfferById: async () => offerRow() });
    const request = { operation: 'accept_directed_offer', offerId: 5 } as const;
    expect(await issueStepUpChallengeFlow(ctx, 9, 'w', request)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    // A legacy pre-pin offer with no item mints no blank authorization.
    const noItem = ctxOf({
      directedOfferById: async () => offerRow({ itemId: null as unknown as string }),
    });
    expect(await issueStepUpChallengeFlow(noItem, 7, 'w', request)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('a free-text item id never mints a create_listing challenge', async () => {
    const createStepUpChallenge = vi.fn();
    const ctx = ctxOf({ createStepUpChallenge });
    const out = await issueStepUpChallengeFlow(ctx, 7, 'w', {
      operation: 'create_listing',
      itemId: 'forged\nline',
      format: 'auction',
      startCents: 100,
      reserveCents: null,
      buyNowCents: null,
      durationHours: 24,
      offerNext: false,
    } as never);
    expect(out).toEqual({ ok: false, reason: 'unknown_item' });
    expect(createStepUpChallenge).not.toHaveBeenCalled();
  });

  it('the issued row binds the AUTHORITATIVE offer figures with the ctx clock and dev flag', async () => {
    const created: unknown[] = [];
    const pruneStepUpChallenges = vi.fn(async () => 0);
    const ctx = ctxOf({
      directedOfferById: async () => offerRow(),
      pruneStepUpChallenges,
      createStepUpChallenge: async (row) => {
        created.push(row);
      },
    });
    const out = await issueStepUpChallengeFlow(ctx, 7, 'w', {
      operation: 'accept_directed_offer',
      offerId: 5,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.challenge.expiresAtMs).toBe(NOW + WOC_MARKET_STEPUP_TTL_MS);
    // devSig true means the wallet is skipped (the dev economy's switch).
    expect(out.challenge.signatureRequired).toBe(false);
    expect(pruneStepUpChallenges).toHaveBeenCalledWith('Claudemoon', NOW);
    const row = created[0] as { bindingDigest: string; operation: string; wallet: string };
    expect(row.operation).toBe('accept_directed_offer');
    expect(row.wallet).toBe('w');
    // The digest binds the figures the OFFER ROW carries, never the request:
    // the wallet popup shows what the deal actually says.
    expect(row.bindingDigest).toBe(
      stepUpBindingDigest({
        operation: 'accept_directed_offer',
        offerId: 5,
        itemId: KNOWN_ITEM,
        usdCents: 5000,
      }),
    );
  });
});
