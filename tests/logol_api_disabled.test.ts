// The LOGOL_ENABLED=false (default) surface: quote refuses outright, info
// reports the feature off. Lives in its own file because logol_api.test.ts
// force-enables the flag at the module level; here woc_config loads for real
// with the env default (off).
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  loadAccountCosmetics: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    logolWareIds: [],
  })),
  grantAccountLogolWare: vi.fn(async () => ({})),
  walletForAccount: vi.fn(async () => null),
}));

vi.mock('../server/logol_db', () => ({
  insertWocQuote: vi.fn(async () => {}),
  getWocQuote: vi.fn(async () => null),
  deleteWocQuote: vi.fn(async () => {}),
  recordWocPayment: vi.fn(async () => true),
}));

import { logolConfirm, logolInfo, logolQuote } from '../server/logol';
import { LOGOL_FLAGSHIP_WARE_ID } from '../src/sim/content/logol';

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

describe('logol API with LOGOL_ENABLED unset (the shipped default)', () => {
  it('quote refuses with logol_disabled before touching any gate', async () => {
    const { res, out } = makeRes();
    await logolQuote(makeReq({ wareId: LOGOL_FLAGSHIP_WARE_ID }), res, 1);
    expect(out.status).toBe(404);
    expect(out.body.error).toBe('logol_disabled');
  });

  it('info reports enabled: false so clients can gate their UI', async () => {
    const { res, out } = makeRes();
    await logolInfo(res, 1);
    expect(out.status).toBe(200);
    expect(out.body.enabled).toBe(false);
  });

  it('confirm cannot settle anything (no quote can ever have been issued)', async () => {
    const { res, out } = makeRes();
    await logolConfirm(makeReq({ quoteId: 'q', signature: 's' }), res, 1);
    expect(out.status).toBe(404);
    expect(out.body.error).toBe('quote_not_found');
  });
});
