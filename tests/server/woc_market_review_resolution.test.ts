// The parked-review operator arm (server/woc_market_review_resolution.ts):
// the sanctioned surface for the one transition pair the sweep never drives,
// review -> confirmed (paid) / review -> failed (unpaid). These pins hold the
// arm to the CAS contract: realm-scoped on BOTH db calls (realms share one
// database, and a cross-realm ruling would walk around the other realm's kill
// switch), the from-set exactly ['review'], the unpaid provenance stamp, the
// kept park fingerprint on paid, and CAS-miss answers that tell a lost race
// (with the actual state) apart from a row this realm does not have.
import { describe, expect, it } from 'vitest';
import {
  REVIEW_UNPAID_FAIL_REASON,
  resolveReviewSettlement,
  type WocReviewResolutionDb,
} from '../../server/woc_market_review_resolution';
import {
  validSettlementTransition,
  WOC_MARKET_WIRE_FAIL_REASONS,
  type WocSettlementState,
} from '../../server/woc_market_rules';

interface TransitionCall {
  realm: string;
  id: number;
  from: WocSettlementState[];
  to: WocSettlementState;
  failReason: string | undefined;
}

function fakeDb(opts: { moved: boolean; row: { state: WocSettlementState } | null }): {
  db: WocReviewResolutionDb;
  calls: TransitionCall[];
  lookups: { realm: string; id: number }[];
} {
  const calls: TransitionCall[] = [];
  const lookups: { realm: string; id: number }[] = [];
  return {
    calls,
    lookups,
    db: {
      transitionSettlementInRealm: async (realm, id, from, to, failReason) => {
        calls.push({ realm, id, from, to, failReason });
        return opts.moved;
      },
      settlementStateInRealm: async (realm, id) => {
        lookups.push({ realm, id });
        return opts.row;
      },
    },
  };
}

describe('the parked-review settlement operator arm', () => {
  it('both operator arms are legal transitions in the rules table', () => {
    // The module and the state machine must agree; if the rules table ever
    // drops an arm, this fails here instead of as a silent CAS miss in ops.
    expect(validSettlementTransition('review', 'confirmed')).toBe(true);
    expect(validSettlementTransition('review', 'failed')).toBe(true);
  });

  it('paid rules review -> confirmed through the realm-scoped CAS, keeping the park fingerprint', async () => {
    const { db, calls, lookups } = fakeDb({ moved: true, row: null });
    const out = await resolveReviewSettlement(db, 'Claudemoon', 41, 'paid');
    expect(out).toEqual({ ok: true, to: 'confirmed' });
    expect(calls).toEqual([
      // failReason undefined: the CAS COALESCEs, so the row keeps
      // 'confirming_overdue' as its went-through-review provenance.
      { realm: 'Claudemoon', id: 41, from: ['review'], to: 'confirmed', failReason: undefined },
    ]);
    expect(lookups).toEqual([]);
  });

  it('unpaid rules review -> failed with the review_unpaid provenance stamp', async () => {
    const { db, calls } = fakeDb({ moved: true, row: null });
    const out = await resolveReviewSettlement(db, 'Claudemoon', 42, 'unpaid');
    expect(out).toEqual({ ok: true, to: 'failed' });
    expect(calls).toEqual([
      {
        realm: 'Claudemoon',
        id: 42,
        from: ['review'],
        to: 'failed',
        failReason: REVIEW_UNPAID_FAIL_REASON,
      },
    ]);
  });

  it('a CAS miss on a live row answers contended WITH the state actually hit', async () => {
    // A lost operator race lands on confirmed/failed; a mistyped id can land
    // on any live phase. Either way the operator sees what they hit instead
    // of a flat "already resolved" that would be wrong on a money path.
    const { db, lookups } = fakeDb({ moved: false, row: { state: 'delivering' } });
    const out = await resolveReviewSettlement(db, 'Claudemoon', 43, 'paid');
    expect(out).toEqual({ ok: false, reason: 'contended', state: 'delivering' });
    expect(lookups).toEqual([{ realm: 'Claudemoon', id: 43 }]);
  });

  it('a CAS miss with no row IN THIS REALM answers not_found', async () => {
    // The realm scoping makes another realm's settlement indistinguishable
    // from a missing one on purpose: a wrong-realm id must not leak state,
    // and must certainly not be rulable from here.
    const { db, lookups } = fakeDb({ moved: false, row: null });
    const out = await resolveReviewSettlement(db, 'Claudemoon', 44, 'unpaid');
    expect(out).toEqual({ ok: false, reason: 'not_found' });
    expect(lookups).toEqual([{ realm: 'Claudemoon', id: 44 }]);
  });

  it('review_unpaid stays OFF the wire fail-reason list, screening to other', () => {
    // The stored word is operator forensics; the wire deliberately screens it
    // (unknown words -> 'other'). Listing it would create client i18n copy
    // obligations, so a future addition must be a deliberate change here.
    expect(WOC_MARKET_WIRE_FAIL_REASONS).not.toContain(REVIEW_UNPAID_FAIL_REASON);
  });
});
