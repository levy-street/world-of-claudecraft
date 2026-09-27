// The guild RANK command dispatch (server/guild_rank_cmd.ts,
// docs/prd/guild-custom-ranks.md): guild_promote / guild_demote /
// guild_set_ranks shape checks, driven directly and then end to end through
// GameServer.handleMessage (the stacked case labels in server/game.ts) with
// the db mocked. SocialService's own rules are covered by
// tests/social_system.test.ts.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
  insertBankLedgerRows: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { GameServer } from '../server/game';
import { dispatchGuildRankCommand, type GuildRankCommandTarget } from '../server/guild_rank_cmd';
import { defaultGuildRankLadder, GUILD_RANK_MAX } from '../src/sim/guild_ranks';

const ACTOR = { characterId: 7, name: 'Lead' };

function fakeTarget() {
  return {
    guildPromote: vi.fn(async () => {}),
    guildDemote: vi.fn(async () => {}),
    guildSetRanks: vi.fn(async () => {}),
  } satisfies GuildRankCommandTarget;
}

describe('dispatchGuildRankCommand (shape checks)', () => {
  it('routes promote and demote by name', async () => {
    const t = fakeTarget();
    await dispatchGuildRankCommand(t, ACTOR, 'guild_promote', { name: 'Bet' }, vi.fn());
    await dispatchGuildRankCommand(t, ACTOR, 'guild_demote', { name: 'Bet' }, vi.fn());
    expect(t.guildPromote).toHaveBeenCalledWith(ACTOR, 'Bet');
    expect(t.guildDemote).toHaveBeenCalledWith(ACTOR, 'Bet');
    expect(t.guildSetRanks).not.toHaveBeenCalled();
  });

  it('routes a bounded ladder array untouched (the service sanitizes it)', async () => {
    const t = fakeTarget();
    const ranks = defaultGuildRankLadder();
    await dispatchGuildRankCommand(t, ACTOR, 'guild_set_ranks', { ranks }, vi.fn());
    expect(t.guildSetRanks).toHaveBeenCalledWith(ACTOR, ranks);
  });

  it('drops malformed frames without touching the service', () => {
    const t = fakeTarget();
    const frames: [Parameters<typeof dispatchGuildRankCommand>[2], Record<string, unknown>][] = [
      ['guild_promote', {}],
      ['guild_promote', { name: 5 }],
      ['guild_demote', { name: null }],
      ['guild_set_ranks', {}],
      ['guild_set_ranks', { ranks: 'leader,member' }],
      ['guild_set_ranks', { ranks: { 0: 'x' } }],
      // Bounded BEFORE the service: an oversized array costs one length check.
      ['guild_set_ranks', { ranks: Array.from({ length: GUILD_RANK_MAX + 1 }, () => ({})) }],
    ];
    for (const [cmd, msg] of frames) {
      expect(dispatchGuildRankCommand(t, ACTOR, cmd, msg, vi.fn())).toBeNull();
    }
    expect(t.guildPromote).not.toHaveBeenCalled();
    expect(t.guildDemote).not.toHaveBeenCalled();
    expect(t.guildSetRanks).not.toHaveBeenCalled();
  });

  it('routes a service rejection to the error sink instead of throwing', async () => {
    const t = fakeTarget();
    const boom = new Error('db down');
    t.guildSetRanks.mockRejectedValueOnce(boom);
    const onError = vi.fn();
    await dispatchGuildRankCommand(
      t,
      ACTOR,
      'guild_set_ranks',
      { ranks: defaultGuildRankLadder() },
      onError,
    );
    expect(onError).toHaveBeenCalledWith(boom);
  });
});

describe('the rank commands through GameServer.handleMessage', () => {
  function joined() {
    const server = new GameServer();
    const sent: unknown[] = [];
    const ws = { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) };
    const session = server.join(ws as never, 7, 7, 'Lead', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;
    const social = (server as unknown as { social: GuildRankCommandTarget }).social;
    const spies = {
      guildPromote: vi.fn(async () => {}),
      guildDemote: vi.fn(async () => {}),
      guildSetRanks: vi.fn(async () => {}),
    };
    Object.assign(social, spies);
    const send = (msg: Record<string, unknown>) =>
      server.handleMessage(session, JSON.stringify({ t: 'cmd', ...msg }));
    return { spies, send };
  }

  it('guild_set_ranks reaches the service with the acting character and the ladder', () => {
    const { spies, send } = joined();
    const ranks = defaultGuildRankLadder();
    send({ cmd: 'guild_set_ranks', ranks });
    expect(spies.guildSetRanks).toHaveBeenCalledTimes(1);
    const [actor, ladder] = spies.guildSetRanks.mock.calls[0] as unknown as [
      { characterId: number; name: string },
      unknown,
    ];
    expect(actor).toMatchObject({ characterId: 7, name: 'Lead' });
    expect(ladder).toEqual(ranks);
  });

  it('guild_promote / guild_demote keep their wire shape (name only)', () => {
    const { spies, send } = joined();
    send({ cmd: 'guild_promote', name: 'Bet' });
    send({ cmd: 'guild_demote', name: 'Bet' });
    send({ cmd: 'guild_promote', name: 42 });
    expect(spies.guildPromote).toHaveBeenCalledTimes(1);
    expect(spies.guildDemote).toHaveBeenCalledTimes(1);
  });
});
