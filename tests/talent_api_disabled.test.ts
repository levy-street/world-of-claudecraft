// The TALENT_PROGRAM_ENABLED=false (default) surface: quote refuses outright and
// the storefront reports the feature off with no wares. Separate file because
// talent_api.test.ts force-enables the flag at the module level; here
// talent_config loads for real with the env default (off), so the fail-closed
// behavior is exercised as shipped.
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  loadAccountCosmetics: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    logolWareIds: [],
    talentWareIds: [],
  })),
  grantAccountTalentWare: vi.fn(async () => ({})),
  walletForAccount: vi.fn(async () => null),
}));

vi.mock('../server/logol_db', () => ({
  insertWocQuote: vi.fn(async () => {}),
  getWocQuote: vi.fn(async () => null),
  deleteWocQuote: vi.fn(async () => {}),
}));

vi.mock('../server/talent_db', () => ({
  recordTalentSale: vi.fn(async () => true),
}));

import { talentConfirm, talentQuote, talentStorefront } from '../server/talent';
import { TALENT_WARES } from '../src/sim/content/talent';

function makeReq(body: unknown) {
  return Readable.from([JSON.stringify(body)]) as unknown as import('node:http').IncomingMessage;
}

function makeRes() {
  const out = { status: 0, body: undefined as any };
  const res = {
    writeHead: (status: number) => {
      out.status = status;
      return res;
    },
    end: (data?: string) => {
      if (data !== undefined) out.body = JSON.parse(data);
    },
  } as unknown as import('node:http').ServerResponse;
  return { res, out };
}

describe('talent API with TALENT_PROGRAM_ENABLED unset (the shipped default)', () => {
  it('quote refuses with talent_disabled before touching any gate', async () => {
    const { res, out } = makeRes();
    await talentQuote(makeReq({ wareId: TALENT_WARES[0].id, currency: 'usdc' }), res, 1);
    expect(out.status).toBe(404);
    expect(out.body.error).toBe('talent_disabled');
  });

  it('storefront reports enabled: false with no live wares', async () => {
    const { res, out } = makeRes();
    await talentStorefront(res, 1);
    expect(out.status).toBe(200);
    expect(out.body.enabled).toBe(false);
    expect(out.body.wares).toEqual([]);
  });

  it('confirm cannot settle anything (no quote can ever have been issued)', async () => {
    const { res, out } = makeRes();
    await talentConfirm(makeReq({ quoteId: 'q', signature: 's' }), res, 1);
    expect(out.status).toBe(404);
    expect(out.body.error).toBe('quote_not_found');
  });
});
