import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519';

// Follow the repo's DB-test pattern: stub DATABASE_URL + mock the pg Pool so
// db.ts loads and every pool.query is a spy we control. This lets us drive the
// REAL handlers through every branch with REAL signatures and no live database.
const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  return { query: vi.fn() };
});
vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() { return { query: dbMock.query }; }),
}));

import { handleWalletChallenge, handleWalletLink, handleWalletGet, handleWalletUnlink } from '../server/wallet';
import { resetWalletLinkRateLimits, walletLinkRateLimited, WALLET_LINK_MAX_PER_MINUTE } from '../server/ratelimit';

// ── fakes for http.IncomingMessage / ServerResponse ─────────────────────────
function makeReq(body: unknown): any {
  const req: any = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.headers = { host: 'localhost:8787' };
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}
function makeUnreadableReq(): { req: any; wasRead: () => boolean } {
  let read = false;
  const req: any = new Readable({
    read() {
      read = true;
      this.destroy(new Error('body should not be read'));
    },
  });
  req.headers = { host: 'localhost:8787' };
  req.socket = { remoteAddress: '127.0.0.1' };
  return { req, wasRead: () => read };
}
function makeRes(): any {
  return {
    statusCode: 0,
    body: '',
    writeHead(status: number) { this.statusCode = status; return this; },
    end(data: string) { this.body = data ?? ''; return this; },
  };
}
async function call(handler: any, body: unknown, accountId = 1) {
  const res = makeRes();
  await handler(makeReq(body), res, accountId);
  return { status: res.statusCode, data: res.body ? JSON.parse(res.body) : {} };
}

// ── a real Solana-style wallet (ed25519) ────────────────────────────────────
function makeWallet() {
  const priv = ed25519.utils.randomPrivateKey();
  return { priv, address: bs58.encode(ed25519.getPublicKey(priv)) };
}
const sign = (message: string, priv: Uint8Array) =>
  bs58.encode(ed25519.sign(new TextEncoder().encode(message), priv));

// per-test control over what the mocked DB returns, routed by SQL
let challengeRows: any[] = [];
let ownerRows: any[] = [];
let walletRows: any[] = [];

beforeEach(() => {
  challengeRows = []; ownerRows = []; walletRows = [];
  resetWalletLinkRateLimits();
  dbMock.query.mockReset();
  dbMock.query.mockImplementation((sql: string) => {
    // The real queries are multi-line; collapse whitespace so routing is robust.
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.includes('DELETE FROM wallet_link_challenges WHERE nonce')) return Promise.resolve({ rows: challengeRows });
    if (s.includes('DELETE FROM wallet_link_challenges WHERE expires_at')) return Promise.resolve({ rows: [] }); // prune
    if (s.includes('INSERT INTO wallet_link_challenges')) return Promise.resolve({ rows: [] });
    if (s.includes('SELECT account_id FROM wallet_links WHERE pubkey')) return Promise.resolve({ rows: ownerRows });
    if (s.includes('INSERT INTO wallet_links')) return Promise.resolve({ rows: [] });
    if (s.includes('SELECT account_id, pubkey, linked_at FROM wallet_links')) return Promise.resolve({ rows: walletRows });
    if (s.includes('DELETE FROM wallet_links WHERE account_id')) return Promise.resolve({ rows: [] }); // unlink
    return Promise.resolve({ rows: [] });
  });
});

describe('POST /api/wallet/link/challenge', () => {
  it('issues a nonce + message that binds the wallet address', async () => {
    const w = makeWallet();
    const { status, data } = await call(handleWalletChallenge, { address: w.address });
    expect(status).toBe(200);
    expect(data.nonce).toMatch(/^[a-f0-9]{32}$/);
    expect(data.message).toContain(w.address);
    expect(data.message).toContain('World of ClaudeCraft');
    // the challenge is persisted with the account + address it was issued for
    const insert = dbMock.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO wallet_link_challenges'));
    expect(insert?.[1]).toEqual([data.nonce, 1, w.address, data.message, expect.any(String)]);
  });

  it('rejects a non-Solana address', async () => {
    const { status } = await call(handleWalletChallenge, { address: 'not-a-real-address' });
    expect(status).toBe(400);
  });

  it('rate-limits before reading the body or writing challenge rows', async () => {
    for (let i = 0; i < WALLET_LINK_MAX_PER_MINUTE; i++) {
      expect(walletLinkRateLimited(makeReq({}), 1)).toBe(false);
    }
    dbMock.query.mockClear();
    const { req, wasRead } = makeUnreadableReq();
    const res = makeRes();
    await handleWalletChallenge(req, res, 1);
    expect(res.statusCode).toBe(429);
    expect(JSON.parse(String(res.body)).error).toBe('rate limited');
    expect(wasRead()).toBe(false);
    expect(dbMock.query).not.toHaveBeenCalled();
  });
});

describe('POST /api/wallet/link', () => {
  it('links a wallet when the signature over the stored challenge is valid', async () => {
    const w = makeWallet();
    const message = 'link challenge message';
    challengeRows = [{ address: w.address, message }];
    ownerRows = []; // wallet not yet owned by anyone
    const { status, data } = await call(handleWalletLink, { address: w.address, signature: sign(message, w.priv), nonce: 'n1' });
    expect(status).toBe(200);
    expect(data).toEqual({ pubkey: w.address, linked: true });
    const insert = dbMock.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO wallet_links'));
    expect(insert?.[1]).toEqual([1, w.address]);
  });

  it('rejects an expired / already-used challenge with 400', async () => {
    const w = makeWallet();
    challengeRows = []; // consume returns nothing
    const { status } = await call(handleWalletLink, { address: w.address, signature: sign('x', w.priv), nonce: 'n1' });
    expect(status).toBe(400);
  });

  it('rejects when the submitted address does not match the challenge with 400', async () => {
    const w = makeWallet();
    const other = makeWallet();
    const message = 'm';
    challengeRows = [{ address: other.address, message }]; // challenge was for a different wallet
    const { status } = await call(handleWalletLink, { address: w.address, signature: sign(message, w.priv), nonce: 'n1' });
    expect(status).toBe(400);
  });

  it('rejects a forged signature with 401', async () => {
    const w = makeWallet();
    const message = 'the real message';
    challengeRows = [{ address: w.address, message }];
    const forged = sign('a different message', w.priv); // valid sig, wrong payload
    const { status } = await call(handleWalletLink, { address: w.address, signature: forged, nonce: 'n1' });
    expect(status).toBe(401);
  });

  it('returns 409 when the wallet is already linked to another account', async () => {
    const w = makeWallet();
    const message = 'm';
    challengeRows = [{ address: w.address, message }];
    ownerRows = [{ account_id: 999 }]; // owned by a different account
    const { status, data } = await call(handleWalletLink, { address: w.address, signature: sign(message, w.priv), nonce: 'n1' }, 1);
    expect(status).toBe(409);
    expect(data.error).toMatch(/another account/i);
    // must NOT have attempted the upsert
    expect(dbMock.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO wallet_links'))).toBe(false);
  });

  it('returns 409 (not 500) on the TOCTOU race: pre-check passes but the INSERT hits a unique violation', async () => {
    // The ownership pre-check (SELECT ... WHERE pubkey) passes with no row, but
    // between that read and the INSERT another account claims the pubkey, so the
    // UNIQUE index races to a Postgres 23505. linkWalletToAccount must swallow
    // that into `false`, and the handler must surface 409, never a 500.
    const w = makeWallet();
    const message = 'm';
    challengeRows = [{ address: w.address, message }];
    // Re-route only the INSERT branch to reject; keep the rest of the default
    // routing (notably the pubkey pre-check returning NO rows ⇒ check passes).
    dbMock.query.mockImplementation((sql: string) => {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      if (s.includes('DELETE FROM wallet_link_challenges WHERE nonce')) return Promise.resolve({ rows: challengeRows });
      if (s.includes('DELETE FROM wallet_link_challenges WHERE expires_at')) return Promise.resolve({ rows: [] });
      if (s.includes('INSERT INTO wallet_link_challenges')) return Promise.resolve({ rows: [] });
      if (s.includes('SELECT account_id FROM wallet_links WHERE pubkey')) return Promise.resolve({ rows: [] }); // pre-check passes
      if (s.includes('INSERT INTO wallet_links')) return Promise.reject(Object.assign(new Error('duplicate key value violates unique constraint "wallet_links_pubkey_key"'), { code: '23505' }));
      if (s.includes('SELECT account_id, pubkey, linked_at FROM wallet_links')) return Promise.resolve({ rows: walletRows });
      if (s.includes('DELETE FROM wallet_links WHERE account_id')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const { status, data } = await call(handleWalletLink, { address: w.address, signature: sign(message, w.priv), nonce: 'n1' }, 1);
    expect(status).toBe(409);
    expect(data.error).toMatch(/another account/i);
    // the pre-check found nothing, so the INSERT was genuinely attempted (the race path)
    expect(dbMock.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO wallet_links'))).toBe(true);
  });

  it('trims surrounding whitespace on the address and still links', async () => {
    const w = makeWallet();
    const message = 'link challenge message';
    challengeRows = [{ address: w.address, message }]; // challenge stored the canonical (trimmed) address
    ownerRows = [];
    const { status, data } = await call(
      handleWalletLink,
      { address: `  ${w.address}\n`, signature: sign(message, w.priv), nonce: 'n1' },
      1,
    );
    expect(status).toBe(200);
    expect(data).toEqual({ pubkey: w.address, linked: true });
    // the trimmed address, not the padded input, is what gets persisted
    const insert = dbMock.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO wallet_links'));
    expect(insert?.[1]).toEqual([1, w.address]);
  });

  it('rejects a valid signature scoped to another account (consume returns null) with 400', async () => {
    // The signature is valid, but the nonce belongs to a different account, so
    // consumeWalletChallenge (DELETE ... WHERE nonce = $1 AND account_id = $2)
    // matches no row, returns null, and the handler must 400 without linking.
    const w = makeWallet();
    const message = 'm';
    challengeRows = []; // account-scoped consume finds nothing for this caller
    const { status, data } = await call(
      handleWalletLink,
      { address: w.address, signature: sign(message, w.priv), nonce: 'n1' },
      7,
    );
    expect(status).toBe(400);
    expect(data.error).toMatch(/expired or already used/i);
    expect(dbMock.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO wallet_links'))).toBe(false);
  });

  it('rejects missing fields with 400', async () => {
    const { status } = await call(handleWalletLink, { address: '', signature: '', nonce: '' });
    expect(status).toBe(400);
  });

  it('rate-limits before reading the body or consuming challenge rows', async () => {
    for (let i = 0; i < WALLET_LINK_MAX_PER_MINUTE; i++) {
      expect(walletLinkRateLimited(makeReq({}), 1)).toBe(false);
    }
    dbMock.query.mockClear();
    const { req, wasRead } = makeUnreadableReq();
    const res = makeRes();
    await handleWalletLink(req, res, 1);
    expect(res.statusCode).toBe(429);
    expect(JSON.parse(String(res.body)).error).toBe('rate limited');
    expect(wasRead()).toBe(false);
    expect(dbMock.query).not.toHaveBeenCalled();
  });
});

describe('GET /api/wallet', () => {
  it('returns the linked wallet', async () => {
    walletRows = [{ account_id: 1, pubkey: 'PUBKEY', linked_at: '2026-06-16T00:00:00.000Z' }];
    const { status, data } = await call(handleWalletGet, {});
    expect(status).toBe(200);
    expect(data.wallet).toEqual({ pubkey: 'PUBKEY', linkedAt: '2026-06-16T00:00:00.000Z' });
  });

  it('returns null when no wallet is linked', async () => {
    walletRows = [];
    const { status, data } = await call(handleWalletGet, {});
    expect(status).toBe(200);
    expect(data.wallet).toBeNull();
  });
});

describe('DELETE /api/wallet/link', () => {
  it('unlinks the account wallet', async () => {
    const { status, data } = await call(handleWalletUnlink, {});
    expect(status).toBe(200);
    expect(data).toEqual({ unlinked: true });
    const del = dbMock.query.mock.calls.find((c) => String(c[0]).includes('DELETE FROM wallet_links WHERE account_id'));
    expect(del?.[1]).toEqual([1]);
  });
});
