// The UA conversion-event shell (server/ua_capi.ts): level-milestone routing,
// email enrichment, the D7 claim gate, and the never-throw guarantee, all
// through the injected deps seam (no Postgres, no network).

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
  accountMailTarget: vi.fn(async () => null),
}));

import {
  maybeTrackDay7Retained,
  trackLevelMilestoneCapi,
  type UaCapiDeps,
} from '../../server/ua_capi';

const session = {
  accountId: 7,
  characterId: 42,
  ip: '203.0.113.9',
  userAgent: 'UA',
  fbp: 'fb.1.1.1',
  fbc: 'fb.1.1.click',
  sourceUrl: 'https://worldofclaudecraft.com/',
};

function fakeDeps(over: Partial<UaCapiDeps> = {}) {
  const sent: Array<{ kind: string; id: number; userData: Record<string, unknown> }> = [];
  const deps: UaCapiDeps = {
    enabled: () => true,
    emailForAccount: async () => 'player@example.com',
    claimDay7: async () => true,
    sendLevel2: async (id, userData) => {
      sent.push({ kind: 'l2', id, userData: userData as Record<string, unknown> });
    },
    sendLevel5: async (id, userData) => {
      sent.push({ kind: 'l5', id, userData: userData as Record<string, unknown> });
    },
    sendDay7: async (id, userData) => {
      sent.push({ kind: 'd7', id, userData: userData as Record<string, unknown> });
    },
    ...over,
  };
  return { sent, deps };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('trackLevelMilestoneCapi', () => {
  it('routes level 2 and level 5 to their events with the enriched email', async () => {
    const { sent, deps } = fakeDeps();
    trackLevelMilestoneCapi(session, 2, deps);
    trackLevelMilestoneCapi(session, 5, deps);
    await flush();
    expect(sent.map((s) => s.kind)).toEqual(['l2', 'l5']);
    expect(sent[0].id).toBe(42);
    expect(sent[0].userData).toMatchObject({
      email: 'player@example.com',
      clientIp: '203.0.113.9',
      fbp: 'fb.1.1.1',
      fbc: 'fb.1.1.click',
    });
  });

  it('ignores non-milestone levels', async () => {
    const { sent, deps } = fakeDeps();
    trackLevelMilestoneCapi(session, 3, deps);
    trackLevelMilestoneCapi(session, 20, deps);
    await flush();
    expect(sent).toEqual([]);
  });

  it('still sends when email enrichment fails', async () => {
    const { sent, deps } = fakeDeps({
      emailForAccount: async () => {
        throw new Error('db down');
      },
    });
    trackLevelMilestoneCapi(session, 5, deps);
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].userData.email).toBeNull();
  });

  it('never throws when the send itself rejects', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps } = fakeDeps({
      sendLevel5: async () => {
        throw new Error('capi down');
      },
    });
    expect(() => trackLevelMilestoneCapi(session, 5, deps)).not.toThrow();
    await flush();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('capi-dark gate', () => {
  it('level milestones skip all work (no email read, no send) when disabled', async () => {
    const emailReads: number[] = [];
    const { sent, deps } = fakeDeps({
      enabled: () => false,
      emailForAccount: async (id) => {
        emailReads.push(id);
        return null;
      },
    });
    trackLevelMilestoneCapi(session, 2, deps);
    trackLevelMilestoneCapi(session, 5, deps);
    await flush();
    expect(sent).toEqual([]);
    expect(emailReads).toEqual([]);
  });

  it('D7 never consumes the once-guard claim when disabled', async () => {
    const claims: number[] = [];
    const { sent, deps } = fakeDeps({
      enabled: () => false,
      claimDay7: async (id) => {
        claims.push(id);
        return true;
      },
    });
    maybeTrackDay7Retained(session, deps);
    await flush();
    expect(sent).toEqual([]);
    expect(claims).toEqual([]);
  });
});

describe('maybeTrackDay7Retained', () => {
  it('sends exactly when the claim wins', async () => {
    const { sent, deps } = fakeDeps();
    maybeTrackDay7Retained(session, deps);
    await flush();
    expect(sent.map((s) => s.kind)).toEqual(['d7']);
    expect(sent[0].id).toBe(7);
  });

  it('stays silent when the claim loses (already sent or outside day 7)', async () => {
    const { sent, deps } = fakeDeps({ claimDay7: async () => false });
    maybeTrackDay7Retained(session, deps);
    await flush();
    expect(sent).toEqual([]);
  });

  it('never throws when the claim itself rejects', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps } = fakeDeps({
      claimDay7: async () => {
        throw new Error('db down');
      },
    });
    expect(() => maybeTrackDay7Retained(session, deps)).not.toThrow();
    await flush();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
