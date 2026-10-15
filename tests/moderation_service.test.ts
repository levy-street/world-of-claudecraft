import { describe, expect, it, vi } from 'vitest';
import {
  canAttemptModerationCommands,
  type ModerationAudit,
  type ModerationHost,
  ModerationService,
  type ModerationSession,
  type ModerationWatchlist,
} from '../server/moderation_service';
import type { StaffWatchEntry } from '../server/staff_watchlist_db';

type Session = ModerationSession;

const admin = (pid: number, accountId: number, permissions?: readonly string[]): Session => ({
  pid,
  accountId,
  characterId: accountId + 500,
  isAdmin: true,
  adminPermissions: new Set(permissions ?? ['moderation.act', 'moderation.spectate']),
  name: `Admin${pid}`,
});
const player = (pid: number, accountId: number): Session => ({
  pid,
  accountId,
  characterId: accountId + 500,
  isAdmin: false,
  adminPermissions: new Set(),
  name: `Player${pid}`,
});

function setup(opts: { actor: Session; sessions?: Session[] }) {
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
  const jailVisits: Session[] = [];
  const jailVisitExits: Session[] = [];
  const jailed: { moderator: Session; target: Session; minutes: number }[] = [];
  const unjailed: { moderator: Session; target: Session }[] = [];
  const jailedPids = new Set<number>();
  const recordAction = vi.fn<ModerationAudit['recordAction']>(async () => {});
  const mute = vi.fn<ModerationAudit['mute']>(async () => {});
  const ban = vi.fn<ModerationAudit['ban']>(async () => {});
  const suspend = vi.fn<ModerationAudit['suspend']>(async () => {});
  const forceRename = vi.fn<ModerationAudit['forceRename']>(async () => ({ accountId: 0 }));
  const hiddenPids = new Set<number>();
  const announcements: { from: string; text: string }[] = [];
  // In-memory watchlist; `characters` is the offline name directory.
  const characters = new Map<string, { accountId: number; characterName: string }>();
  for (const session of byPid.values()) {
    characters.set(session.name.toLowerCase(), {
      accountId: session.accountId,
      characterName: session.name,
    });
  }
  const watches = new Map<number, StaffWatchEntry>();
  const watchlist: ModerationWatchlist = {
    findCharacter: async (name) => characters.get(name.toLowerCase()) ?? null,
    add: async (input) => {
      watches.set(input.accountId, {
        accountId: input.accountId,
        characterName: input.characterName,
        note: input.note,
        addedBy: null,
        createdAt: '2026-10-15T00:00:00.000Z',
      });
    },
    remove: async (accountId) => watches.delete(accountId),
    forAccount: async (accountId) => watches.get(accountId) ?? null,
    list: async () => ({ entries: [...watches.values()], total: watches.size }),
  };

  const host: ModerationHost<Session> = {
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
    enterJailVisit: (moderator) => jailVisits.push(moderator),
    exitJailVisit: (moderator) => jailVisitExits.push(moderator),
    isJailed: (session) => jailedPids.has(session.pid),
    jail: (moderator, target, minutes) => {
      jailedPids.add(target.pid);
      jailed.push({ moderator, target, minutes });
    },
    unjail: (moderator, target) => {
      jailedPids.delete(target.pid);
      unjailed.push({ moderator, target });
    },
    isGmHidden: (session) => hiddenPids.has(session.pid),
    setGmHidden: (session, hidden) => {
      if (hidden) hiddenPids.add(session.pid);
      else hiddenPids.delete(session.pid);
    },
    onlineStaff: () => [...byPid.values()].filter(canAttemptModerationCommands),
    announce: (from, text) => announcements.push({ from, text }),
  };

  const service = new ModerationService(host, watchlist, {
    recordAction,
    mute,
    ban,
    suspend,
    forceRename,
  });
  return {
    byPid,
    characters,
    watches,
    hiddenPids,
    announcements,
    service,
    kicked,
    killed,
    muted,
    disconnected,
    notices,
    systemNotices,
    spectated,
    unspectated,
    jailVisits,
    jailVisitExits,
    jailed,
    unjailed,
    jailedPids,
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
    const context = setup({ actor, sessions: [target] });

    expect(context.service.handleChatCommand(actor, '/kick "Player2" griefing')).toBe(true);
    expect(context.service.handleChatCommand(actor, '/kill "Player2" spawn camping')).toBe(true);

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
    const context = setup({ actor, sessions: [target] });
    context.recordAction.mockRejectedValueOnce(new Error('db down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    context.service.handleChatCommand(actor, '/kick "Player2" griefing');
    await Promise.resolve();
    await Promise.resolve();

    expect(context.kicked).toEqual([]);
    expect(context.systemNotices).toEqual([]);
    consoleError.mockRestore();
  });

  it('applies persistent actions only after their DB write succeeds', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-29T10:00:00Z'));
      const actor = admin(1, 11);
      const target = player(2, 22);
      const context = setup({ actor, sessions: [target] });

      context.service.handleChatCommand(actor, '/mute "Player2" 5 spamming');
      context.service.handleChatCommand(actor, '/suspend "Player2" 30 cheating');
      context.service.handleChatCommand(actor, '/forcerename "Player2" offensive name');
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
    } finally {
      vi.useRealTimers();
    }
  });

  it('bans permanently without an expiry and disconnects the account', async () => {
    const actor = admin(1, 11);
    const target = player(2, 22);
    const context = setup({ actor, sessions: [target] });

    context.service.handleChatCommand(actor, '/ban "Player2" repeat offender');
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

    expect(context.service.handleChatCommand(actor, '/mute "Missing" spamming')).toBe(true);
    expect(context.service.handleChatCommand(actor, '/suspend')).toBe(true);

    expect(context.notices.map((notice) => notice.text)).toEqual([
      'Usage: /mute "<name>" <minutes> [reason]',
      'Usage: /suspend "<name>" <minutes> [reason]',
    ]);
    expect(context.mute).not.toHaveBeenCalled();
    expect(context.suspend).not.toHaveBeenCalled();
  });

  it('refuses moderation commands from a non-admin actor', () => {
    const actor = player(1, 11);
    const target = player(2, 22);
    const context = setup({ actor, sessions: [target] });

    // Still claimed (swallowed) so it cannot leak into ordinary chat, but nothing runs.
    expect(context.service.handleChatCommand(actor, '/kick "Player2" griefing')).toBe(true);
    expect(context.service.handleChatCommand(actor, '/ban "Player2" cheating')).toBe(true);

    expect(context.recordAction).not.toHaveBeenCalled();
    expect(context.ban).not.toHaveBeenCalled();
    expect(context.notices).toEqual([]);
    expect(context.systemNotices).toEqual([]);
  });

  it('refuses commands outside the actor permission set, per command', async () => {
    const actorActOnly = admin(1, 11, ['moderation.act']);
    const actorSpectateOnly = admin(2, 22, ['moderation.spectate']);
    const target = player(3, 33);
    const actContext = setup({ actor: actorActOnly, sessions: [target] });
    const spectateContext = setup({ actor: actorSpectateOnly, sessions: [target] });

    expect(actContext.service.handleChatCommand(actorActOnly, '/spectate Player3')).toBe(true);
    expect(actContext.spectated).toEqual([]);
    expect(actContext.notices.map((notice) => notice.text)).toEqual([
      "You don't have permission to do that.",
    ]);
    expect(actContext.service.handleChatCommand(actorActOnly, '/kick "Player3" griefing')).toBe(
      true,
    );
    expect(actContext.recordAction).toHaveBeenCalledTimes(1);

    expect(
      spectateContext.service.handleChatCommand(actorSpectateOnly, '/ban "Player3" cheating'),
    ).toBe(true);
    expect(spectateContext.ban).not.toHaveBeenCalled();
    expect(spectateContext.notices.map((notice) => notice.text)).toEqual([
      "You don't have permission to do that.",
    ]);
    expect(spectateContext.service.handleChatCommand(actorSpectateOnly, '/spectate Player3')).toBe(
      true,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(spectateContext.spectated).toEqual([{ moderator: actorSpectateOnly, target }]);

    // /unspectate follows the spectate permission, not moderation.act.
    expect(spectateContext.service.handleChatCommand(actorSpectateOnly, '/unspectate')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(spectateContext.unspectated).toEqual([actorSpectateOnly]);
    expect(actContext.service.handleChatCommand(actorActOnly, '/unspectate')).toBe(true);
    expect(actContext.unspectated).toEqual([]);
  });

  it('gates the dispatch attempt on the moderation permissions', () => {
    expect(canAttemptModerationCommands(admin(1, 11))).toBe(true);
    expect(canAttemptModerationCommands(admin(1, 11, ['moderation.act']))).toBe(true);
    expect(canAttemptModerationCommands(admin(1, 11, ['moderation.spectate']))).toBe(true);
    expect(canAttemptModerationCommands(admin(1, 11, ['botdetector.read']))).toBe(false);
    expect(canAttemptModerationCommands(player(1, 11))).toBe(false);
  });

  it('audits spectate and unspectate before applying their live effect', async () => {
    const actor = admin(1, 11);
    const first = player(2, 22);
    const second = { ...player(3, 33), name: 'Mira Sun' };
    const context = setup({ actor, sessions: [first, second] });

    expect(context.service.handleChatCommand(actor, '/spectate player2')).toBe(true);
    // The audit write is awaited, so nothing is applied synchronously.
    expect(context.spectated).toEqual([]);
    await Promise.resolve();
    await Promise.resolve();

    expect(context.recordAction).toHaveBeenNthCalledWith(1, {
      action: 'spectate',
      accountId: 22,
      adminAccountId: 11,
      reason: 'Spectated via in-game moderator command',
    });
    expect(context.spectated).toEqual([{ moderator: actor, target: first }]);

    expect(context.service.handleChatCommand(actor, '/spectate "Mira Sun"')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(context.recordAction).toHaveBeenNthCalledWith(2, {
      action: 'spectate',
      accountId: 33,
      adminAccountId: 11,
      reason: 'Spectated via in-game moderator command',
    });
    expect(context.spectated).toEqual([
      { moderator: actor, target: first },
      { moderator: actor, target: second },
    ]);

    expect(context.service.handleChatCommand(actor, '/unspectate')).toBe(true);
    expect(context.unspectated).toEqual([]);
    await Promise.resolve();
    await Promise.resolve();

    expect(context.recordAction).toHaveBeenNthCalledWith(3, {
      action: 'unspectate',
      accountId: 11,
      adminAccountId: 11,
      reason: 'Stopped spectating via in-game moderator command',
    });
    expect(context.unspectated).toEqual([actor]);
  });

  it('does not apply spectate when the audit write fails', async () => {
    const actor = admin(1, 11);
    const target = player(2, 22);
    const context = setup({ actor, sessions: [target] });
    context.recordAction.mockRejectedValueOnce(new Error('db down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    context.service.handleChatCommand(actor, '/spectate Player2');
    await Promise.resolve();
    await Promise.resolve();

    expect(context.spectated).toEqual([]);
    consoleError.mockRestore();
  });

  it('drops a stale spectate audit completion that resolves after a later unspectate', async () => {
    const actor = admin(1, 11);
    const target = player(2, 22);
    const context = setup({ actor, sessions: [target] });

    // Make the /spectate audit write resolve AFTER the /unspectate one, even
    // though /spectate was issued first, to reproduce the out-of-order
    // completion the reviewer flagged.
    let resolveSpectateAudit!: () => void;
    context.recordAction.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSpectateAudit = resolve;
        }),
    );

    expect(context.service.handleChatCommand(actor, '/spectate Player2')).toBe(true);
    expect(context.service.handleChatCommand(actor, '/unspectate')).toBe(true);
    // /unspectate's own audit write resolves first.
    await Promise.resolve();
    await Promise.resolve();
    expect(context.unspectated).toEqual([actor]);
    expect(context.spectated).toEqual([]);

    // The stale /spectate audit write finally resolves. It must NOT re-enter
    // spectate mode, since /unspectate already superseded it.
    resolveSpectateAudit();
    await Promise.resolve();
    await Promise.resolve();
    expect(context.spectated).toEqual([]);
    expect(context.unspectated).toEqual([actor]);
  });

  it('drops a stale spectate audit completion when the target was switched', async () => {
    const actor = admin(1, 11);
    const first = player(2, 22);
    const second = { ...player(3, 33), name: 'Mira Sun' };
    const context = setup({ actor, sessions: [first, second] });

    let resolveFirstAudit!: () => void;
    context.recordAction.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstAudit = resolve;
        }),
    );

    expect(context.service.handleChatCommand(actor, '/spectate Player2')).toBe(true);
    expect(context.service.handleChatCommand(actor, '/spectate "Mira Sun"')).toBe(true);
    // The second /spectate's own audit write resolves first.
    await Promise.resolve();
    await Promise.resolve();
    expect(context.spectated).toEqual([{ moderator: actor, target: second }]);

    // The stale first /spectate audit write resolves afterwards. It must NOT
    // switch spectate back to the first target.
    resolveFirstAudit();
    await Promise.resolve();
    await Promise.resolve();
    expect(context.spectated).toEqual([{ moderator: actor, target: second }]);
  });

  it('visits and leaves jail without an audit write', () => {
    const actor = admin(1, 11);
    const context = setup({ actor });

    expect(context.service.handleChatCommand(actor, '/jail')).toBe(true);
    expect(context.service.handleChatCommand(actor, '/unjail')).toBe(true);

    expect(context.jailVisits).toEqual([actor]);
    expect(context.jailVisitExits).toEqual([actor]);
    expect(context.recordAction).not.toHaveBeenCalled();
  });

  it('audits jail and unjail before applying their live effect', async () => {
    const actor = admin(1, 11);
    const target = player(2, 22);
    const context = setup({ actor, sessions: [target] });

    expect(context.service.handleChatCommand(actor, '/jail "Player2" 5')).toBe(true);
    expect(context.jailed).toEqual([]);
    await Promise.resolve();
    await Promise.resolve();

    expect(context.recordAction).toHaveBeenCalledWith({
      action: 'jail',
      accountId: 22,
      adminAccountId: 11,
      reason: 'Jailed by in-game moderator command (5 minutes)',
    });
    expect(context.jailed).toEqual([{ moderator: actor, target, minutes: 5 }]);
    expect(context.systemNotices.map((notice) => notice.text)).toContain(
      'Jailed Player2 for 5 minutes.',
    );

    expect(context.service.handleChatCommand(actor, '/unjail "Player2"')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(context.recordAction).toHaveBeenCalledWith({
      action: 'unjail',
      accountId: 22,
      adminAccountId: 11,
      reason: 'Released by in-game moderator command',
    });
    expect(context.unjailed).toEqual([{ moderator: actor, target }]);
    expect(context.systemNotices.map((notice) => notice.text)).toContain(
      'Released Player2 from jail.',
    );
  });

  it('carries a custom reason into the audit record', async () => {
    const actor = admin(1, 11);
    const target = player(2, 22);
    const context = setup({ actor, sessions: [target] });

    expect(context.service.handleChatCommand(actor, '/jail "Player2" 10 being a nuisance')).toBe(
      true,
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(context.recordAction).toHaveBeenCalledWith({
      action: 'jail',
      accountId: 22,
      adminAccountId: 11,
      reason: 'being a nuisance (10 minutes)',
    });
    expect(context.jailed).toEqual([{ moderator: actor, target, minutes: 10 }]);
    expect(context.systemNotices.map((notice) => notice.text)).toContain(
      'Jailed Player2 for 10 minutes.',
    );
  });

  it('guards malformed jail commands and duplicate jail state', () => {
    const actor = admin(1, 11);
    const target = player(2, 22);
    const context = setup({ actor, sessions: [target] });
    context.jailedPids.add(target.pid);

    context.service.handleChatCommand(actor, '/jail Player2');
    context.service.handleChatCommand(actor, '/jail "Player2"');
    context.service.handleChatCommand(actor, '/jail "Player2" 5');
    context.service.handleChatCommand(actor, '/unjail Missing');
    context.jailedPids.delete(target.pid);
    context.service.handleChatCommand(actor, '/unjail "Player2"');

    expect(context.notices.map((notice) => notice.text)).toEqual([
      'Usage: /jail ["<name>" <minutes> [reason]]',
      'Usage: /jail ["<name>" <minutes> [reason]]',
      'Player2 is already jailed.',
      'Usage: /unjail ["<name>"]',
      'Player2 is not jailed.',
    ]);
    expect(context.recordAction).not.toHaveBeenCalled();
  });

  it('guards malformed, missing, self, own-account, and offline targets', () => {
    const actor = admin(1, 11);
    // A second character of the actor's own account, online at the same time.
    const ownAlt = { ...admin(2, 11), name: 'OwnAlt' };
    const context = setup({ actor, sessions: [ownAlt] });

    context.service.handleChatCommand(actor, '/spectate');
    context.service.handleChatCommand(actor, '/spectate Missing');
    context.service.handleChatCommand(actor, `/spectate ${actor.name}`);
    context.service.handleChatCommand(actor, `/spectate ${ownAlt.name}`);
    context.service.handleChatCommand(actor, '/kick test');
    context.service.handleChatCommand(actor, '/kill "Missing" test');

    expect(context.notices.map((notice) => notice.text)).toEqual([
      'Usage: /spectate <name>',
      "No online player named 'Missing'.",
      "You can't moderate that player.",
      "You can't moderate that player.",
      'Enclose the character name in double quotes.',
      "No online player named 'Missing'.",
    ]);
    expect(context.recordAction).not.toHaveBeenCalled();
    expect(context.spectated).toEqual([]);
    expect(context.kicked).toEqual([]);
  });

  it('lets staff spectate other staff while the sanction commands still refuse them', async () => {
    const actor = admin(1, 11);
    const otherAdmin = admin(2, 22);
    const context = setup({ actor, sessions: [otherAdmin] });

    expect(context.service.handleChatCommand(actor, `/spectate ${otherAdmin.name}`)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(context.recordAction).toHaveBeenCalledTimes(1);
    expect(context.recordAction).toHaveBeenCalledWith({
      action: 'spectate',
      accountId: 22,
      adminAccountId: 11,
      reason: 'Spectated via in-game moderator command',
    });
    expect(context.spectated).toEqual([{ moderator: actor, target: otherAdmin }]);
    expect(context.notices).toEqual([]);

    context.service.handleChatCommand(actor, `/kick "${otherAdmin.name}" test`);
    context.service.handleChatCommand(actor, `/kill "${otherAdmin.name}" test`);
    context.service.handleChatCommand(actor, `/mute "${otherAdmin.name}" 5 test`);
    context.service.handleChatCommand(actor, `/ban "${otherAdmin.name}" test`);
    context.service.handleChatCommand(actor, `/suspend "${otherAdmin.name}" 5 test`);
    context.service.handleChatCommand(actor, `/forcerename "${otherAdmin.name}" test`);
    context.service.handleChatCommand(actor, `/jail "${otherAdmin.name}" 5 test`);
    context.service.handleChatCommand(actor, `/unjail "${otherAdmin.name}"`);
    await Promise.resolve();
    await Promise.resolve();

    expect(context.notices.map((notice) => notice.text)).toEqual(
      Array(8).fill("You can't moderate that player."),
    );
    expect(context.recordAction).toHaveBeenCalledTimes(1);
    expect(context.mute).not.toHaveBeenCalled();
    expect(context.ban).not.toHaveBeenCalled();
    expect(context.suspend).not.toHaveBeenCalled();
    expect(context.forceRename).not.toHaveBeenCalled();
    expect(context.kicked).toEqual([]);
    expect(context.killed).toEqual([]);
    expect(context.jailed).toEqual([]);
  });
});

// Drains the promise chains the service fires (audit, then watchlist, then notice).
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ModerationService GM tools', () => {
  it('toggles invisibility only after the audit write, against the GM own account', async () => {
    const actor = admin(1, 11);
    const context = setup({ actor });

    expect(context.service.handleChatCommand(actor, '/visible off')).toBe(true);
    expect(context.hiddenPids.has(actor.pid)).toBe(false);
    await settle();
    expect(context.recordAction).toHaveBeenLastCalledWith({
      action: 'gm_invisible',
      accountId: 11,
      adminAccountId: 11,
      reason: 'Went invisible via in-game GM command',
    });
    expect(context.hiddenPids.has(actor.pid)).toBe(true);

    context.service.handleChatCommand(actor, '/VISIBLE ON');
    await settle();
    expect(context.recordAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'gm_visible', accountId: 11 }),
    );
    expect(context.hiddenPids.has(actor.pid)).toBe(false);
    expect(context.systemNotices.map((n) => n.text)).toEqual([
      'You are now invisible. Players and creatures can no longer see or target you.',
      'You are now visible.',
    ]);
  });

  it('answers usage and no-op toggles without an audit write', async () => {
    const actor = admin(1, 11);
    const context = setup({ actor });
    context.service.handleChatCommand(actor, '/visible');
    context.service.handleChatCommand(actor, '/visible maybe');
    context.service.handleChatCommand(actor, '/visible on');
    await settle();
    expect(context.recordAction).not.toHaveBeenCalled();
    expect(context.notices.map((n) => n.text)).toEqual([
      'Usage: /visible on|off',
      'Usage: /visible on|off',
      'You are already visible.',
    ]);
  });

  it('drops a stale visibility completion so the latest command wins', async () => {
    const actor = admin(1, 11);
    const context = setup({ actor });
    let releaseFirst: () => void = () => {};
    context.recordAction.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    context.service.handleChatCommand(actor, '/visible off'); // audit held open
    context.hiddenPids.add(actor.pid); // as if an earlier toggle already landed
    context.service.handleChatCommand(actor, '/visible on'); // newer command
    await settle();
    expect(context.hiddenPids.has(actor.pid)).toBe(false);
    releaseFirst();
    await settle();
    // The stale "off" completion must not re-hide the GM.
    expect(context.hiddenPids.has(actor.pid)).toBe(false);
  });

  it('lets a spectate-only role go invisible but refuses it /watch and /announce', async () => {
    const actor = admin(1, 11, ['moderation.spectate']);
    const target = player(2, 22);
    const context = setup({ actor, sessions: [target] });
    context.service.handleChatCommand(actor, '/visible off');
    context.service.handleChatCommand(actor, '/watch "Player2"');
    context.service.handleChatCommand(actor, '/announce hello');
    await settle();
    expect(context.hiddenPids.has(actor.pid)).toBe(true);
    expect(context.watches.size).toBe(0);
    expect(context.announcements).toEqual([]);
    expect(context.notices.map((n) => n.text)).toEqual([
      "You don't have permission to do that.",
      "You don't have permission to do that.",
    ]);
  });

  it('watches an offline player by account, lists, and unwatches with audit rows', async () => {
    const actor = admin(1, 11);
    const context = setup({ actor });
    context.characters.set('suspect', { accountId: 33, characterName: 'Suspect' });

    context.service.handleChatCommand(actor, '/watch "suspect" gold seller, check trades');
    await settle();
    expect(context.recordAction).toHaveBeenLastCalledWith({
      action: 'watch',
      accountId: 33,
      adminAccountId: 11,
      reason: 'gold seller, check trades',
    });
    expect(context.watches.get(33)).toMatchObject({
      characterName: 'Suspect',
      note: 'gold seller, check trades',
    });

    context.service.handleChatCommand(actor, '/watch');
    await settle();
    context.service.handleChatCommand(actor, '/unwatch "Suspect"');
    await settle();
    expect(context.recordAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'unwatch', accountId: 33 }),
    );
    expect(context.watches.size).toBe(0);
    context.service.handleChatCommand(actor, '/unwatch "Suspect"');
    await settle();
    context.service.handleChatCommand(actor, '/watch');
    await settle();

    expect(context.systemNotices.map((n) => n.text)).toEqual([
      'Added Suspect to the watchlist.',
      'Watchlist (1):',
      'Watched: Suspect (gold seller, check trades)',
      'Removed Suspect from the watchlist.',
    ]);
    expect(context.notices.map((n) => n.text)).toEqual([
      'Suspect is not on the watchlist.',
      'The watchlist is empty.',
    ]);
  });

  it('refuses malformed, unknown, own-account, and online staff watch targets', async () => {
    const actor = admin(1, 11);
    const otherStaff = admin(2, 22);
    const context = setup({ actor, sessions: [otherStaff] });
    context.service.handleChatCommand(actor, '/watch Bob');
    context.service.handleChatCommand(actor, '/unwatch');
    context.service.handleChatCommand(actor, '/watch "Nobody"');
    await settle();
    context.service.handleChatCommand(actor, '/watch "Admin1"');
    await settle();
    context.service.handleChatCommand(actor, '/watch "Admin2"');
    await settle();
    expect(context.recordAction).not.toHaveBeenCalled();
    expect(context.notices.map((n) => n.text)).toEqual([
      'Usage: /watch ["<name>" [note]]',
      'Usage: /unwatch "<name>"',
      "No character named 'Nobody'.",
      "You can't moderate that player.",
      "You can't moderate that player.",
    ]);
  });

  it('pings every online GM on each login of a watched account, alts included', async () => {
    const actor = admin(1, 11);
    const spectator = admin(3, 44, ['moderation.spectate']);
    const viewer = admin(4, 55, ['moderation.read']);
    const main = player(2, 22);
    const alt = { ...player(5, 22), name: 'AltOfMain' };
    const context = setup({ actor, sessions: [spectator, viewer, main] });
    context.watches.set(22, {
      accountId: 22,
      characterName: 'Player2',
      note: 'botting reports',
      addedBy: 'Admin1',
      createdAt: '2026-10-15T00:00:00.000Z',
    });

    await context.service.notifyWatchedLogin(main);
    await context.service.notifyWatchedLogin(main); // every login, not just the next
    context.byPid.set(alt.pid, alt);
    await context.service.notifyWatchedLogin(alt);

    const pinged = (session: Session) =>
      context.systemNotices.filter((n) => n.session === session).map((n) => n.text);
    const once = ['Watchlist: Player2 just logged in.', 'Watch note: botting reports'];
    expect(pinged(actor)).toEqual([
      ...once,
      ...once,
      'Watchlist: AltOfMain just logged in (watched as Player2).',
      'Watch note: botting reports',
    ]);
    expect(pinged(spectator)).toEqual(pinged(actor));
    // A read-only viewer cannot act on it, so it is not pinged; neither is the player.
    expect(pinged(viewer)).toEqual([]);
    expect(pinged(main)).toEqual([]);
  });

  it('skips the watchlist lookup when no GM is online and never pings for staff', async () => {
    const actor = admin(1, 11);
    const target = player(2, 22);
    const context = setup({ actor, sessions: [target] });
    const entry = (accountId: number, characterName: string): StaffWatchEntry => ({
      accountId,
      characterName,
      note: null,
      addedBy: null,
      createdAt: '2026-10-15T00:00:00.000Z',
    });
    // A watched staff account is never announced...
    context.watches.set(11, entry(11, 'Admin1'));
    await context.service.notifyWatchedLogin(actor);
    // ...and with no GM online there is nobody to ping.
    context.byPid.delete(actor.pid);
    context.watches.set(22, entry(22, 'Player2'));
    await context.service.notifyWatchedLogin(target);
    expect(context.systemNotices).toEqual([]);
  });

  it('broadcasts an announcement after auditing its text, and refuses an empty one', async () => {
    const actor = admin(1, 11);
    const context = setup({ actor });
    context.service.handleChatCommand(actor, '/announce');
    context.service.handleChatCommand(
      actor,
      '/announce   Restart in 10 minutes,\n  log out safely.',
    );
    expect(context.announcements).toEqual([]);
    await settle();
    expect(context.recordAction).toHaveBeenCalledTimes(1);
    expect(context.recordAction).toHaveBeenCalledWith({
      action: 'announce',
      accountId: 11,
      adminAccountId: 11,
      reason: 'Restart in 10 minutes, log out safely.',
    });
    expect(context.announcements).toEqual([
      { from: 'Admin1', text: 'Restart in 10 minutes, log out safely.' },
    ]);
    expect(context.notices.map((n) => n.text)).toEqual(['Usage: /announce <message>']);
  });

  it('swallows the GM commands for non-staff without acting', async () => {
    const actor = player(1, 11);
    const context = setup({ actor });
    expect(context.service.handleChatCommand(actor, '/visible off')).toBe(true);
    expect(context.service.handleChatCommand(actor, '/announce hi')).toBe(true);
    await settle();
    expect(context.hiddenPids.size).toBe(0);
    expect(context.announcements).toEqual([]);
  });
});
