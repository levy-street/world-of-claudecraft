import { afterEach, describe, expect, it, vi } from 'vitest';

// The server self-wire test pulls in server/game.ts, which imports the db
// layer — mock it so no Postgres is required (vi.mock is hoisted).
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../server/game';
import { signChallenge, verifyChallenge } from '../src/sim/client_challenge';

describe('challenge helpers (shared, deterministic)', () => {
  it('signChallenge is deterministic and binds every field', () => {
    const base = signChallenge('nonce-1', 'answer-1', 'seed-1');
    expect(signChallenge('nonce-1', 'answer-1', 'seed-1')).toBe(base);
    // changing any one of (nonce, answer, seed) changes the signature
    expect(signChallenge('nonce-2', 'answer-1', 'seed-1')).not.toBe(base);
    expect(signChallenge('nonce-1', 'answer-2', 'seed-1')).not.toBe(base);
    expect(signChallenge('nonce-1', 'answer-1', 'seed-2')).not.toBe(base);
  });

  it('a different seed produces a different signature for the same challenge', () => {
    const nonce = 'n';
    const r = 'challengeResponse';
    expect(signChallenge(nonce, r, 'seedX')).not.toBe(signChallenge(nonce, r, 'seedY'));
  });

  it('verifyChallenge accepts a matching signature and rejects forgeries', () => {
    const nonce = 'nonce-xyz';
    const r = 'challengeResponse';
    const sig = signChallenge(nonce, r, 'browser-seed');
    expect(verifyChallenge(nonce, r, sig, 'browser-seed')).toBe(true);
    // wrong seed, tampered answer, or tampered sig all fail
    expect(verifyChallenge(nonce, r, sig, 'someone-elses-seed')).toBe(false);
    expect(verifyChallenge(nonce, 'tampered', sig, 'browser-seed')).toBe(false);
    expect(verifyChallenge(nonce, r, sig + 'x', 'browser-seed')).toBe(false);
  });
});

describe('challengeResponse server dispatch', () => {
  function fakeWs() {
    const sent: any[] = [];
    return { sent, ws: { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) } };
  }
  function join(server: GameServer, ws: any, id: number, seed: string) {
    const s = server.join(ws, id, id, `Player${id}`, 'warrior', null, false, { clientSeed: seed });
    if ('error' in s) throw new Error(s.error);
    return s;
  }
  function send(server: GameServer, session: unknown, payload: object) {
    server.handleMessage(session as never, JSON.stringify({ t: 'cmd', ...payload }));
  }

  // The case has no observable side effect yet (the answer is just
  // verified, not yet rewarded); these guard that it is wired and robust, i.e.
  // not falling through to the unknown-command path, and never throwing. The
  // verification logic itself is covered by the verifyChallenge unit test above.
  it('handles a correctly-signed answer without throwing', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = join(server, fc.ws, 1, 'browser-seed');
    const nonce = 'nonce-xyz';
    const r = 'challengeResponse';
    const sig = signChallenge(nonce, r, 'browser-seed');

    expect(() =>
      send(server, session, { cmd: 'challengeResponse', n: nonce, r, sig }),
    ).not.toThrow();
  });

  it('handles a forged signature and a malformed payload without throwing', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = join(server, fc.ws, 1, 'browser-seed');
    const forged = signChallenge('nonce-xyz', 'challengeResponse', 'someone-elses-seed');

    expect(() =>
      send(server, session, {
        cmd: 'challengeResponse',
        n: 'nonce-xyz',
        r: 'challengeResponse',
        sig: forged,
      }),
    ).not.toThrow();
    expect(() => send(server, session, { cmd: 'challengeResponse', n: 1, r: 2 })).not.toThrow();
  });
});

describe('getClientSeed (woc_seed)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('mints once, persists to woc_seed, and reuses it on reload', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    });

    vi.resetModules();
    const first = (await import('../src/game/client_seed')).getClientSeed();
    expect(first).toBeTruthy();
    expect(store.get('woc_seed')).toBe(first);

    // a fresh module load (new tab/session) reads the stored value, not a new mint
    vi.resetModules();
    const second = (await import('../src/game/client_seed')).getClientSeed();
    expect(second).toBe(first);
  });

  it('falls back to a stable per-load value when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });

    vi.resetModules();
    const { getClientSeed } = await import('../src/game/client_seed');
    const a = getClientSeed();
    expect(a).toBeTruthy();
    expect(getClientSeed()).toBe(a);
  });
});
