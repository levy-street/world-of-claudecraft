// A GM hidden with /visible off must read as OFFLINE everywhere another player
// could otherwise learn they are on: the social graph (friends and guild rows,
// the once-a-second live position push, the public guild board, the "has gone
// offline" notice) and every chat name lookup (/inspect, /invite, /follow,
// /assist, /w, a targeted emote). The world half (snapshots, aggro, targeting)
// is pinned in tests/gm_presence.test.ts.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { type ClientSession, GameServer } from '../server/game';
import { type GmPresenceSocial, gmToolsHost } from '../server/gm_tools_host';
import type { ModerationSession } from '../server/moderation_service';
import { type PresenceSubject, presenceHiddenFrom } from '../server/presence_privacy';
import { canShowInWho } from '../server/who_roster';
import { Sim } from '../src/sim/sim';
import { findPlayerByName, resolveWhisperTarget } from '../src/sim/social/chat';

describe('the presence rule reads a hidden GM as offline', () => {
  it('hides from everyone but themselves, whatever their /presence setting', () => {
    for (const presenceMode of ['everyone', 'friends', 'none'] as const) {
      const gm: PresenceSubject = {
        characterId: 1,
        presenceMode,
        friendIds: new Set([2]),
        gmHidden: true,
      };
      expect(presenceHiddenFrom(gm, 2), presenceMode).toBe(true);
      expect(presenceHiddenFrom(gm, 1), 'never from self').toBe(false);
    }
    expect(presenceHiddenFrom({ characterId: 1, gmHidden: false }, 2)).toBe(false);
  });

  it('keeps a hidden GM out of /who and the live position push (canShowInWho)', () => {
    const viewer = { characterId: 2, blockListLoaded: true, blockedIds: new Set<number>() };
    const gm = { characterId: 1, blockListLoaded: true, blockedIds: new Set<number>() };
    expect(canShowInWho(viewer, gm)).toBe(true);
    expect(canShowInWho(viewer, { ...gm, gmHidden: true })).toBe(false);
  });
});

describe('the live position push on the authoritative server', () => {
  function fakeWs() {
    const sent: { t: string }[] = [];
    return { sent, ws: { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) } };
  }

  it('stops sending a hidden GM’s position to their friends, and resumes once visible', () => {
    const server = new GameServer();
    const wfc = fakeWs();
    const friend = server.join(wfc.ws as never, 1, 1, 'Friend', 'warrior', null) as ClientSession;
    const gm = server.join(fakeWs().ws as never, 2, 2, 'Gm', 'warrior', null) as ClientSession;
    friend.blockListLoaded = true;
    gm.blockListLoaded = true;
    friend.socialTrackedIds = [gm.characterId];
    const push = (): boolean => {
      wfc.sent.length = 0;
      (server as unknown as { broadcastSocialPositions(): void }).broadcastSocialPositions();
      return wfc.sent.some((f) => f.t === 'socialpos');
    };
    expect(push(), 'a visible GM is an ordinary friend').toBe(true);
    (gm as ClientSession & { gmHidden?: boolean }).gmHidden = true;
    expect(push()).toBe(false);
    delete (gm as ClientSession & { gmHidden?: boolean }).gmHidden;
    expect(push()).toBe(true);
  });
});

describe('gmToolsHost.setGmHidden', () => {
  type Session = ModerationSession & PresenceSubject;

  function rig() {
    const sim = new Sim({ seed: 7, playerClass: 'mage' });
    const session: Session = {
      pid: sim.player.id,
      accountId: 9,
      characterId: 9,
      name: 'Gm',
      isAdmin: true,
      adminPermissions: new Set(['moderation.spectate']),
      presenceMode: 'everyone',
    };
    const calls: { online: boolean; before?: PresenceSubject }[] = [];
    const social: GmPresenceSocial = {
      announcePresence: async (_actor, online, before) => {
        calls.push({ online, before });
      },
    };
    const host = gmToolsHost(sim, new Map([[session.pid, session]]), () => {}, social);
    return { sim, session, calls, host };
  }

  it('hides the session as well as the entity, and tells friends the GM went offline', () => {
    const { sim, session, calls, host } = rig();
    host.setGmHidden(session, true);
    expect(sim.player.gmHidden).toBe(true);
    expect(session.gmHidden).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].online).toBe(false);
    // The snapshot is from before the flip, so the "has gone offline" notice
    // still reaches the friends the GM was visible to.
    expect(calls[0].before?.gmHidden).toBeUndefined();
    expect(calls[0].before?.presenceMode).toBe('everyone');
  });

  it('showing again clears the session flag and announces the GM online', () => {
    const { sim, session, calls, host } = rig();
    host.setGmHidden(session, true);
    host.setGmHidden(session, false);
    expect(sim.player.gmHidden).toBeUndefined();
    expect(session.gmHidden).toBeUndefined();
    expect(calls[1]).toEqual({ online: true, before: undefined });
  });
});

describe('chat name lookups treat a hidden GM as offline', () => {
  function rig() {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const player = sim.addPlayer('warrior', 'Aleph');
    const gm = sim.addPlayer('mage', 'Gm');
    const gmEntity = sim.entities.get(gm);
    if (!gmEntity) throw new Error('gm missing');
    gmEntity.gmHidden = true;
    return { sim, player, gm };
  }

  function lastError(sim: Sim, pid: number): string | undefined {
    const errs = sim.events.filter(
      (e): e is Extract<typeof e, { type: 'error' }> =>
        e.type === 'error' && (e as { pid: number }).pid === pid,
    );
    return errs.at(-1)?.text;
  }

  it('/inspect, /invite and /follow say no such player is online', () => {
    const { sim, player } = rig();
    for (const line of ['/inspect Gm', '/invite Gm', '/follow Gm']) {
      sim.chat(line, player);
      expect(lastError(sim, player), line).toBe("There is no player named 'Gm' online.");
    }
  });

  it('a whisper fails like a logged-out player, unless it answers the GM’s own whisper', () => {
    const { sim, player, gm } = rig();
    const aleph = sim.meta(player);
    if (!aleph) throw new Error('meta missing');
    expect(resolveWhisperTarget(sim.ctx, 'Gm hello', aleph)).toEqual({
      error: "There is no player named 'Gm' online.",
    });
    sim.chat('/w Aleph Can I help?', gm);
    expect(aleph.lastWhisperFrom).toBe('Gm');
    const reply = resolveWhisperTarget(sim.ctx, 'Gm yes please', aleph);
    expect(reply && 'target' in reply ? reply.target.entityId : null).toBe(gm);
  });

  it('the GM still finds everyone, and lookups without a caller are unchanged', () => {
    const { sim, player, gm } = rig();
    const gmMeta = sim.meta(gm);
    const aleph = sim.meta(player);
    expect(findPlayerByName(sim.ctx, 'Aleph', gmMeta ?? undefined)?.entityId).toBe(player);
    expect(findPlayerByName(sim.ctx, 'Gm', aleph ?? undefined)).toBeNull();
    expect(findPlayerByName(sim.ctx, 'Gm')?.entityId, 'no caller: no filter').toBe(gm);
  });
});
