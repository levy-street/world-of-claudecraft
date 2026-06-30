import { describe, expect, it, vi } from 'vitest';
import {
  type ModerationAudit,
  type ModerationHost,
  ModerationService,
  type ModerationSession,
} from '../server/moderation_service';

type Session = ModerationSession;

const admin = (pid: number, accountId: number): Session => ({
  pid,
  accountId,
  characterId: accountId + 500,
  isAdmin: true,
  name: `Admin${pid}`,
});
const player = (pid: number, accountId: number): Session => ({
  pid,
  accountId,
  characterId: accountId + 500,
  isAdmin: false,
  name: `Player${pid}`,
});

function setup(opts: { actor: Session; selectedTargetId?: number | null; sessions?: Session[] }) {
  const byPid = new Map<number, Session>();
  for (const session of opts.sessions ?? []) byPid.set(session.pid, session);
  byPid.set(opts.actor.pid, opts.actor);

  const kicked: Session[] = [];
  const killed: number[] = [];
  const muted: { accountId: number; untilISO: string; reason: string }[] = [];
  const disconnected: { accountId: number; reason: string }[] = [];
  const notices: { session: Session; text: string }[] = [];
  const systemNotices: { session: Session; text: string }[] = [];
  const spectated: { moderator: Session; target: Session }[] = [];
  const unspectated: Session[] = [];
  const recordAction = vi.fn<ModerationAudit['recordAction']>(async () => {});
  const mute = vi.fn<ModerationAudit['mute']>(async () => {});
  const ban = vi.fn<ModerationAudit['ban']>(async () => {});
  const suspend = vi.fn<ModerationAudit['suspend']>(async () => {});
  const forceRename = vi.fn<ModerationAudit['forceRename']>(async () => ({ accountId: 0 }));

  const host: ModerationHost<Session> = {
    selectedTargetId: () => opts.selectedTargetId ?? null,
    sessionByPid: (pid) => byPid.get(pid) ?? null,
    sessionByName: (name) =>
      [...byPid.values()].find((session) => session.name.toLowerCase() === name.toLowerCase()) ??
      null,
    notice: (session, text) => notices.push({ session, text }),
    systemNotice: (session, text) => systemNotices.push({ session, text }),
    kick: (session) => kicked.push(session),
    muteLive: (accountId, untilISO, reason) => muted.push({ accountId, untilISO, reason }),
    disconnect: (accountId, reason) => disconnected.push({ accountId, reason }),
    killEntity: (entityId) => killed.push(entityId),
    enterSpectate: (moderator, target) => spectated.push({ moderator, target }),
    exitSpectate: (moderator) => unspectated.push(moderator),
  };

  const service = new ModerationService(host, { recordAction, mute, ban, suspend, forceRename });
  return {
    service,
    kicked,
    killed,
    muted,
    disconnected,
    notices,
    systemNotices,
    spectated,
    unspectated,
    recordAction,
    mute,
    ban,
    suspend,
    forceRename,
  };
}

describe('ModerationService', () => {
  it('audits kick and kill before applying their live effect', async () => {
    const actor = admin(1, 11);
    const target = player(2, 22);
    const context = setup({ actor, selectedTargetId: target.pid, sessions: [target] });

    expect(context.service.handleChatCommand(actor, '/kick griefing')).toBe(true);
    expect(context.service.handleChatCommand(actor, '/kill spawn camping')).toBe(true);

    // The audit write is awaited, so nothing is applied synchronously.
    expect(context.kicked).toEqual([]);
    expect(context.killed).toEqual([]);
    await Promise.resolve();
    await Promise.resolve();

    expect(context.recordAction).toHaveBeenNthCalledWith(1, {
      action: 'kick',
      accountId: 22,
      adminAccountId: 11,
      reason: 'griefing',
    });
    expect(context.recordAction).toHaveBeenNthCalledWith(2, {
      action: 'kill',
      accountId: 22,
      adminAccountId: 11,
      reason: 'spawn camping',
    });
    expect(context.kicked).toEqual([target]);
    expect(context.killed).toEqual([target.pid]);
    expect(context.systemNotices.map((notice) => notice.text)).toEqual([
      'Kicked Player2.',
      'Killed Player2.',
    ]);
  });

  it('does not apply kick when the audit write fails', async () => {
    const actor = admin(1, 11);
    const target = player(2, 22);
    const context = setup({ actor, selectedTargetId: target.pid, sessions: [target] });
    context.recordAction.mockRejectedValueOnce(new Error('db down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    context.service.handleChatCommand(actor, '/kick griefing');
    await Promise.resolve();
    await Promise.resolve();

    expect(context.kicked).toEqual([]);
    expect(context.systemNotices).toEqual([]);
    consoleError.mockRestore();
  });

  it('applies persistent actions only after their DB write succeeds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T10:00:00Z'));
    const actor = admin(1, 11);
    const target = player(2, 22);
    const context = setup({ actor, selectedTargetId: target.pid, sessions: [target] });

    context.service.handleChatCommand(actor, '/mute 5 spamming');
    context.service.handleChatCommand(actor, '/suspend 30 cheating');
    context.service.handleChatCommand(actor, '/forcerename offensive name');
    await Promise.resolve();
    await Promise.resolve();

    expect(context.muted).toEqual([
      {
        accountId: 22,
        untilISO: '2026-06-29T10:05:00.000Z',
        reason: 'spamming',
      },
    ]);
    expect(context.suspend).toHaveBeenCalledWith({
      accountId: 22,
      adminAccountId: 11,
      reason: 'cheating',
      expiresAt: '2026-06-29T10:30:00.000Z',
    });
    expect(context.disconnected).toEqual([
      { accountId: 22, reason: 'This account is suspended.' },
      {
        accountId: 22,
        reason: 'A moderator requires one of your characters to be renamed.',
      },
    ]);
    expect(context.forceRename).toHaveBeenCalledWith({
      characterId: 522,
      adminAccountId: 11,
      reason: 'offensive name',
    });
    expect(context.systemNotices.map((notice) => notice.text)).toEqual([
      'Muted Player2 for 5 minutes.',
      'Suspended Player2 for 30 minutes.',
      'Required Player2 to rename.',
    ]);
    vi.useRealTimers();
  });

  it('bans permanently without an expiry and disconnects the account', async () => {
    const actor = admin(1, 11);
    const target = player(2, 22);
    const context = setup({ actor, selectedTargetId: target.pid, sessions: [target] });

    context.service.handleChatCommand(actor, '/ban repeat offender');
    await Promise.resolve();
    await Promise.resolve();

    expect(context.ban).toHaveBeenCalledWith({
      accountId: 22,
      adminAccountId: 11,
      reason: 'repeat offender',
    });
    expect(context.suspend).not.toHaveBeenCalled();
    expect(context.disconnected).toEqual([
      { accountId: 22, reason: 'This account has been banned.' },
    ]);
    expect(context.systemNotices.map((notice) => notice.text)).toEqual(['Banned Player2.']);
  });

  it('rejects bad durations before resolving a target', () => {
    const actor = admin(1, 11);
    const context = setup({ actor });

    expect(context.service.handleChatCommand(actor, '/mute spamming')).toBe(true);
    expect(context.service.handleChatCommand(actor, '/suspend')).toBe(true);

    expect(context.notices.map((notice) => notice.text)).toEqual([
      'Usage: /mute <minutes> <reason>',
      'Usage: /suspend <minutes> <reason>',
    ]);
    expect(context.mute).not.toHaveBeenCalled();
    expect(context.suspend).not.toHaveBeenCalled();
  });

  it('refuses moderation commands from a non-admin actor', () => {
    const actor = player(1, 11);
    const target = player(2, 22);
    const context = setup({ actor, selectedTargetId: target.pid, sessions: [target] });

    // Still claimed (swallowed) so it cannot leak into ordinary chat, but nothing runs.
    expect(context.service.handleChatCommand(actor, '/kick griefing')).toBe(true);
    expect(context.service.handleChatCommand(actor, '/ban cheating')).toBe(true);

    expect(context.recordAction).not.toHaveBeenCalled();
    expect(context.ban).not.toHaveBeenCalled();
    expect(context.notices).toEqual([]);
    expect(context.systemNotices).toEqual([]);
  });

  it('starts, switches, and stops spectating without an audit write', () => {
    const actor = admin(1, 11);
    const first = player(2, 22);
    const second = { ...player(3, 33), name: 'Mira Sun' };
    const context = setup({ actor, sessions: [first, second] });

    context.service.handleChatCommand(actor, '/spectate player2');
    context.service.handleChatCommand(actor, '/spectate Mira Sun');
    context.service.handleChatCommand(actor, '/unspectate');

    expect(context.spectated).toEqual([
      { moderator: actor, target: first },
      { moderator: actor, target: second },
    ]);
    expect(context.unspectated).toEqual([actor]);
    expect(context.recordAction).not.toHaveBeenCalled();
  });

  it('guards missing, self, admin, offline, and unselected targets', () => {
    const actor = admin(1, 11);
    const otherAdmin = admin(2, 22);
    const context = setup({ actor, sessions: [otherAdmin] });

    context.service.handleChatCommand(actor, '/spectate');
    context.service.handleChatCommand(actor, '/spectate Missing');
    context.service.handleChatCommand(actor, `/spectate ${actor.name}`);
    context.service.handleChatCommand(actor, `/spectate ${otherAdmin.name}`);
    context.service.handleChatCommand(actor, '/kick test');

    expect(context.notices.map((notice) => notice.text)).toEqual([
      'Usage: /spectate <name>',
      "No online player named 'Missing'.",
      "You can't moderate that player.",
      "You can't moderate that player.",
      'Select a player to moderate first.',
    ]);
    expect(context.spectated).toEqual([]);
    expect(context.kicked).toEqual([]);
  });
});
