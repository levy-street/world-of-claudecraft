import { beforeEach, describe, expect, it, vi } from 'vitest';

const moderation = vi.hoisted(() => ({
  recordInGameAction: vi.fn(async () => {}),
  muteAccountChat: vi.fn(async () => {}),
  moderateAccount: vi.fn(async () => {}),
  forceCharacterRename: vi.fn(async () => ({ accountId: 0 })),
}));

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
  })),
  grantAccountMechChroma: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
  })),
  revokeAccountMechChroma: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
  })),
  // Character load leases: leave() releases and the autosave loop heartbeats, so
  // these must exist on the mock or those paths throw on the undefined export.
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

vi.mock('../server/moderation_db', () => moderation);

import { saveCharacterState } from '../server/db';
import { type ClientSession, GameServer } from '../server/game';
import { isInJailCage, JAIL_GATE, JAIL_VISITOR_POS, jailGateTeleport } from '../src/sim/jail';

// In-game moderation now requires explicit permissions at join (no is_admin ->
// all-permissions fallback). These operators exercise both act and spectate.
const MOD_PERMS = ['moderation.act', 'moderation.spectate'] as const;

type FakeWs = {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

type TestFrame = {
  t?: string;
  name?: string | null;
  list?: { text?: string }[];
  self?: {
    id: number;
    nm: string;
    ack: number;
    party: { members: { pid: number; x: number; z: number }[] };
  };
};

type GameServerInternals = {
  broadcastSnapshots(): void;
  enforceJailStates(): void;
  routeEvents(events: ReturnType<GameServer['sim']['tick']>): void;
};

function fakeWs(): FakeWs & Parameters<GameServer['join']>[0] {
  const ws = {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
  };
  return ws as unknown as FakeWs & Parameters<GameServer['join']>[0];
}

function joined(result: ClientSession | { error: string }): ClientSession {
  if ('error' in result) throw new Error(result.error);
  result.blockListLoaded = true;
  return result;
}

function entity(server: GameServer, pid: number) {
  const found = server.sim.entities.get(pid);
  if (!found) throw new Error(`entity ${pid} missing`);
  return found;
}

function internals(server: GameServer): GameServerInternals {
  return server as unknown as GameServerInternals;
}

function frames(ws: FakeWs): TestFrame[] {
  return ws.send.mock.calls.map((call) => JSON.parse(String(call[0])) as TestFrame);
}

function eventTexts(ws: FakeWs): string[] {
  return frames(ws)
    .filter((frame) => frame.t === 'events')
    .flatMap((frame) => frame.list ?? [])
    .map((event: { text?: string }) => event.text)
    .filter((text): text is string => typeof text === 'string');
}

// Only 'log' events land in the chat log; 'error' events are a fading toast.
// The prisoner notices must ride the durable log path, so assert through this.
function logEventTexts(ws: FakeWs): string[] {
  return frames(ws)
    .filter((frame) => frame.t === 'events')
    .flatMap((frame) => frame.list ?? [])
    .filter((event: { type?: string; text?: string }) => event.type === 'log')
    .map((event: { type?: string; text?: string }) => event.text)
    .filter((text): text is string => typeof text === 'string');
}

function command(server: GameServer, session: ClientSession, text: string): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'chat', text }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveCharacterState).mockResolvedValue(undefined);
});

describe('in-game moderation actions', () => {
  it('kicks and kills quoted non-admin players by name with an audit record', async () => {
    const kickServer = new GameServer();
    const moderatorWs = fakeWs();
    const targetWs = fakeWs();
    const moderator = joined(
      kickServer.join(moderatorWs, 1, 101, 'Moderator', 'warrior', null, false, {
        isAdmin: true,
        adminPermissions: MOD_PERMS,
      }),
    );
    const target = joined(kickServer.join(targetWs, 2, 102, 'Trouble Maker', 'rogue', null));

    command(kickServer, moderator, '/kick "Trouble Maker" griefing');

    await vi.waitFor(() => expect(kickServer.clients.has(target.pid)).toBe(false));
    expect(moderation.recordInGameAction).toHaveBeenCalledWith({
      action: 'kick',
      accountId: 2,
      adminAccountId: 1,
      reason: 'griefing',
    });
    expect(targetWs.close).toHaveBeenCalled();
    expect(eventTexts(moderatorWs)).toContain('Kicked Trouble Maker.');

    const killServer = new GameServer();
    const killerWs = fakeWs();
    const victimWs = fakeWs();
    const killer = joined(
      killServer.join(killerWs, 3, 103, 'Killer', 'mage', null, false, {
        isAdmin: true,
        adminPermissions: MOD_PERMS,
      }),
    );
    const victim = joined(killServer.join(victimWs, 4, 104, 'Victim', 'priest', null));

    command(killServer, killer, '/kill "Victim" spawn camping');

    await vi.waitFor(() => expect(killServer.sim.entities.get(victim.pid)?.dead).toBe(true));
    expect(moderation.recordInGameAction).toHaveBeenCalledWith({
      action: 'kill',
      accountId: 4,
      adminAccountId: 3,
      reason: 'spawn camping',
    });
    expect(eventTexts(killerWs)).toContain('Killed Victim.');
  });

  it('persists mute, timed suspend, permanent ban, and force-rename before applying', async () => {
    const server = new GameServer();
    const moderatorWs = fakeWs();
    const targetWs = fakeWs();
    const moderator = joined(
      server.join(moderatorWs, 10, 110, 'Moderator', 'warrior', null, false, {
        isAdmin: true,
        adminPermissions: MOD_PERMS,
      }),
    );
    const target = joined(server.join(targetWs, 20, 120, 'Target', 'rogue', null));

    command(server, moderator, '/mute "Target" 5 spam');
    await vi.waitFor(() => expect(target.chatMutedUntil).not.toBeNull());
    expect(moderation.muteAccountChat).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 20,
        adminAccountId: 10,
        reason: 'spam',
      }),
    );
    expect(target.chatMuteReason).toBe('spam');

    command(server, moderator, '/suspend "Target" 30 cheating');
    await vi.waitFor(() => expect(targetWs.close).toHaveBeenCalled());
    expect(moderation.moderateAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 20,
        adminAccountId: 10,
        action: 'suspend',
        reason: 'cheating',
      }),
    );

    const banServer = new GameServer();
    const banModeratorWs = fakeWs();
    const banTargetWs = fakeWs();
    const banModerator = joined(
      banServer.join(banModeratorWs, 50, 150, 'BanMod', 'warrior', null, false, {
        isAdmin: true,
        adminPermissions: MOD_PERMS,
      }),
    );
    joined(banServer.join(banTargetWs, 60, 160, 'Repeat', 'rogue', null));
    command(banServer, banModerator, '/ban "Repeat" repeat offender');
    await vi.waitFor(() => expect(banTargetWs.close).toHaveBeenCalled());
    expect(moderation.moderateAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 60,
        adminAccountId: 50,
        action: 'ban',
        reason: 'repeat offender',
      }),
    );
    expect(eventTexts(banModeratorWs)).toContain('Banned Repeat.');

    const renameServer = new GameServer();
    const renameModeratorWs = fakeWs();
    const renameTargetWs = fakeWs();
    const renameModerator = joined(
      renameServer.join(renameModeratorWs, 30, 130, 'RenameMod', 'warrior', null, false, {
        isAdmin: true,
        adminPermissions: MOD_PERMS,
      }),
    );
    joined(renameServer.join(renameTargetWs, 40, 140, 'Badname', 'rogue', null));
    command(renameServer, renameModerator, '/forcerename "Badname" offensive');

    await vi.waitFor(() => expect(renameTargetWs.close).toHaveBeenCalled());
    expect(moderation.forceCharacterRename).toHaveBeenCalledWith({
      characterId: 140,
      adminAccountId: 30,
      reason: 'offensive',
    });
  });

  it('rejects old selected-target syntax and protected named targets', async () => {
    const server = new GameServer();
    const playerWs = fakeWs();
    const adminWs = fakeWs();
    const player = joined(server.join(playerWs, 1, 101, 'Player', 'warrior', null));
    const admin = joined(
      server.join(adminWs, 2, 102, 'Admin', 'mage', null, false, {
        isAdmin: true,
        adminPermissions: MOD_PERMS,
      }),
    );
    command(server, player, '/kick "Admin" forbidden');
    expect(adminWs.close).not.toHaveBeenCalled();

    const selectedWs = fakeWs();
    const selected = joined(server.join(selectedWs, 4, 104, 'Selected', 'rogue', null));
    entity(server, admin.pid).targetId = selected.pid;
    command(server, admin, '/kick old selected-target reason');
    await Promise.resolve();
    await Promise.resolve();
    expect(selectedWs.close).not.toHaveBeenCalled();

    const otherAdminWs = fakeWs();
    joined(
      server.join(otherAdminWs, 3, 103, 'Otheradmin', 'priest', null, false, {
        isAdmin: true,
        adminPermissions: MOD_PERMS,
      }),
    );
    command(server, admin, '/kick "Otheradmin" forbidden');
    await Promise.resolve();
    await Promise.resolve();
    expect(otherAdminWs.close).not.toHaveBeenCalled();
    expect(moderation.recordInGameAction).not.toHaveBeenCalled();
  });

  it('jails, persists, respawns, reconnects, and unjails online players', async () => {
    const server = new GameServer();
    const moderatorWs = fakeWs();
    const targetWs = fakeWs();
    const moderator = joined(
      server.join(moderatorWs, 10, 110, 'Jailer', 'warrior', null, false, {
        isAdmin: true,
        adminPermissions: MOD_PERMS,
      }),
    );
    const target = joined(server.join(targetWs, 20, 120, 'Cellmate', 'rogue', null));
    const original = { ...entity(server, target.pid).pos };

    command(server, moderator, '/jail "Cellmate" 120');
    await vi.waitFor(() =>
      expect(moderation.recordInGameAction).toHaveBeenCalledWith({
        action: 'jail',
        accountId: 20,
        adminAccountId: 10,
        reason: 'Jailed by in-game moderator command (2 hours)',
      }),
    );

    expect(target.jailed?.returnPos).toEqual({ x: original.x, z: original.z });
    expect(isInJailCage(entity(server, target.pid).pos)).toBe(true);
    expect(eventTexts(moderatorWs)).toContain('Jailed Cellmate for 2 hours.');
    expect(logEventTexts(targetWs)).toContain('A moderator has moved you to jail for 2 hours.');

    server.sim.dealDamage(
      null,
      entity(server, target.pid),
      entity(server, target.pid).maxHp + 1,
      false,
      'physical',
      null,
      'hit',
      true,
    );
    expect(entity(server, target.pid).dead).toBe(true);
    internals(server).enforceJailStates();
    expect(entity(server, target.pid).dead).toBe(false);
    expect(isInJailCage(entity(server, target.pid).pos)).toBe(true);

    await server.saveCharacter(target);
    const saved = vi
      .mocked(saveCharacterState)
      .mock.calls.find(([characterId]) => characterId === target.characterId)?.[2];
    expect(saved?.jail?.returnPos).toEqual({ x: original.x, z: original.z });
    expect(saved?.dead).toBe(false);
    expect(saved?.ghost).toBe(false);
    expect(saved?.corpsePos).toBeNull();
    expect(isInJailCage({ x: saved?.pos.x ?? 0, z: saved?.pos.z ?? 0 })).toBe(true);
    if (!saved) throw new Error('jailed state was not saved');

    const relogServer = new GameServer();
    const relogged = joined(relogServer.join(fakeWs(), 20, 120, 'Cellmate', 'rogue', saved));
    expect(relogged.jailed?.returnPos).toEqual({ x: original.x, z: original.z });
    expect(isInJailCage(entity(relogServer, relogged.pid).pos)).toBe(true);

    command(server, moderator, '/unjail "Cellmate"');
    await vi.waitFor(() =>
      expect(moderation.recordInGameAction).toHaveBeenCalledWith({
        action: 'unjail',
        accountId: 20,
        adminAccountId: 10,
        reason: 'Released by in-game moderator command',
      }),
    );
    expect(target.jailed).toBeNull();
    expect(entity(server, target.pid).pos.x).toBeCloseTo(original.x);
    expect(entity(server, target.pid).pos.z).toBeCloseTo(original.z);
    expect(eventTexts(moderatorWs)).toContain('Released Cellmate from jail.');
    expect(logEventTexts(targetWs)).toContain('A moderator has released you from jail.');
  });

  it('lets moderators visit jail and restores the visit position', () => {
    const server = new GameServer();
    const moderatorWs = fakeWs();
    const moderator = joined(
      server.join(moderatorWs, 30, 130, 'Visitor', 'mage', null, false, {
        isAdmin: true,
        adminPermissions: MOD_PERMS,
      }),
    );
    const original = { ...entity(server, moderator.pid).pos };

    command(server, moderator, '/jail');
    expect(moderator.jailVisit?.savedPos).toEqual(original);
    expect(entity(server, moderator.pid).pos.x).toBeCloseTo(JAIL_VISITOR_POS.x);
    expect(entity(server, moderator.pid).pos.z).toBeCloseTo(JAIL_VISITOR_POS.z);
    expect(eventTexts(moderatorWs)).toContain('Moved to jail visitor area.');

    command(server, moderator, '/unjail');
    expect(moderator.jailVisit).toBeNull();
    expect(entity(server, moderator.pid).pos.x).toBeCloseTo(original.x);
    expect(entity(server, moderator.pid).pos.z).toBeCloseTo(original.z);
    expect(eventTexts(moderatorWs)).toContain('Returned from jail visitor area.');

    command(server, moderator, '/jail');
    entity(server, moderator.pid).dead = true;
    internals(server).enforceJailStates();
    expect(moderator.jailVisit).toBeNull();
    expect(entity(server, moderator.pid).dead).toBe(false);
    expect(entity(server, moderator.pid).pos.x).toBeCloseTo(original.x);
    expect(entity(server, moderator.pid).pos.z).toBeCloseTo(original.z);
  });

  it('teleports moderators through the cage gate and blocks everyone else', () => {
    // Pure trigger math: inside the gate box it lands on the far side, past
    // the trigger depth; outside the box it does nothing.
    expect(jailGateTeleport({ x: JAIL_GATE.x + 0.9, z: JAIL_GATE.z })).toEqual({
      x: JAIL_GATE.x - 2.6,
      z: JAIL_GATE.z,
    });
    expect(jailGateTeleport({ x: JAIL_GATE.x - 0.9, z: JAIL_GATE.z })).toEqual({
      x: JAIL_GATE.x + 2.6,
      z: JAIL_GATE.z,
    });
    expect(jailGateTeleport({ x: JAIL_GATE.x + 0.9, z: JAIL_GATE.z + 2 })).toBeNull();
    expect(jailGateTeleport({ x: JAIL_GATE.x + 2, z: JAIL_GATE.z })).toBeNull();

    const server = new GameServer();
    const moderator = joined(
      server.join(fakeWs(), 40, 140, 'Gatekeeper', 'warrior', null, false, {
        isAdmin: true,
        adminPermissions: MOD_PERMS,
      }),
    );
    const bystander = joined(server.join(fakeWs(), 41, 141, 'Bystander', 'rogue', null));

    // A moderator pressed into the gate from the visitor side lands in the cage.
    const moderatorEntity = entity(server, moderator.pid);
    moderatorEntity.pos.x = JAIL_GATE.x + 0.9;
    moderatorEntity.pos.z = JAIL_GATE.z;
    internals(server).enforceJailStates();
    expect(entity(server, moderator.pid).pos.x).toBeCloseTo(JAIL_GATE.x - 2.6);
    expect(isInJailCage(entity(server, moderator.pid).pos)).toBe(true);

    // And back out from the inside.
    internals(server).enforceJailStates();
    expect(entity(server, moderator.pid).pos.x).toBeCloseTo(JAIL_GATE.x - 2.6);
    entity(server, moderator.pid).pos.x = JAIL_GATE.x - 0.9;
    entity(server, moderator.pid).pos.z = JAIL_GATE.z;
    internals(server).enforceJailStates();
    expect(entity(server, moderator.pid).pos.x).toBeCloseTo(JAIL_GATE.x + 2.6);
    expect(isInJailCage(entity(server, moderator.pid).pos)).toBe(false);

    // A non-moderator standing in the trigger never moves.
    const bystanderEntity = entity(server, bystander.pid);
    bystanderEntity.pos.x = JAIL_GATE.x + 0.9;
    bystanderEntity.pos.z = JAIL_GATE.z;
    internals(server).enforceJailStates();
    expect(entity(server, bystander.pid).pos.x).toBeCloseTo(JAIL_GATE.x + 0.9);

    // A jailed session never passes, even with moderator permissions, and it
    // is not teleported anywhere either: pressing into the gate (or hugging
    // any cage wall, inside the wall line at JAIL_CAGE_HALF minus the
    // collision standoff) just does nothing.
    const jailedModerator = joined(
      server.join(fakeWs(), 42, 142, 'Jailedmod', 'mage', null, false, {
        isAdmin: true,
        adminPermissions: MOD_PERMS,
      }),
    );
    jailedModerator.jailed = { returnPos: { x: 0, z: 0 }, returnFacing: 0 };
    const jailedEntity = entity(server, jailedModerator.pid);
    jailedEntity.pos.x = JAIL_GATE.x - 0.9;
    jailedEntity.pos.z = JAIL_GATE.z;
    internals(server).enforceJailStates();
    expect(entity(server, jailedModerator.pid).pos.x).toBeCloseTo(JAIL_GATE.x - 0.9);
    expect(entity(server, jailedModerator.pid).pos.z).toBeCloseTo(JAIL_GATE.z);

    // A genuine escape (beyond the wall line) still snaps back to the cell.
    jailedEntity.pos.x = JAIL_GATE.x + 1.5;
    internals(server).enforceJailStates();
    expect(isInJailCage(entity(server, jailedModerator.pid).pos)).toBe(true);
    expect(entity(server, jailedModerator.pid).pos.x).not.toBeCloseTo(JAIL_GATE.x + 1.5);
  });

  it('blocks jailed players from queueing into instanced content', async () => {
    const server = new GameServer();
    const moderator = joined(
      server.join(fakeWs(), 50, 150, 'Jailer', 'warrior', null, false, {
        isAdmin: true,
        adminPermissions: MOD_PERMS,
      }),
    );
    const inmateWs = fakeWs();
    const inmate = joined(server.join(inmateWs, 51, 151, 'Inmate', 'rogue', null));

    // Queued when the jail lands: the queue is drained on the spot.
    server.handleMessage(inmate, JSON.stringify({ t: 'cmd', cmd: 'arena_queue', format: '1v1' }));
    expect(server.sim.arenaQueue1v1).toContain(inmate.pid);
    command(server, moderator, '/jail "Inmate" 60');
    await vi.waitFor(() => expect(inmate.jailed).not.toBeNull());
    expect(server.sim.arenaQueue1v1).not.toContain(inmate.pid);

    // Queueing anew while jailed is refused with a notice, in every format.
    for (const format of ['1v1', '2v2', 'fiesta', 'yumi3', 'yumi5']) {
      server.handleMessage(inmate, JSON.stringify({ t: 'cmd', cmd: 'arena_queue', format }));
    }
    server.handleMessage(
      inmate,
      JSON.stringify({
        t: 'cmd',
        cmd: 'vcup_queue',
        bracket: 'open',
        nation: 'vale',
        role: 'striker',
      }),
    );
    server.handleMessage(
      inmate,
      JSON.stringify({ t: 'cmd', cmd: 'vcup_practice', bracket: 'open' }),
    );
    expect(server.sim.arenaQueue1v1).not.toContain(inmate.pid);
    expect(
      server.sim.arenaQueue2v2.some((u: { pids: number[] }) => u.pids.includes(inmate.pid)),
    ).toBe(false);
    expect(eventTexts(inmateWs)).toContain('You cannot do that while jailed.');

    // Released: the same command works again.
    command(server, moderator, '/unjail "Inmate"');
    await vi.waitFor(() => expect(inmate.jailed).toBeNull());
    server.handleMessage(inmate, JSON.stringify({ t: 'cmd', cmd: 'arena_queue', format: '1v1' }));
    expect(server.sim.arenaQueue1v1).toContain(inmate.pid);
  });

  it('serves timed sentences and releases them automatically', async () => {
    const server = new GameServer();
    const moderatorWs = fakeWs();
    const targetWs = fakeWs();
    const moderator = joined(
      server.join(moderatorWs, 80, 180, 'Sentencer', 'warrior', null, false, {
        isAdmin: true,
        adminPermissions: MOD_PERMS,
      }),
    );
    const target = joined(server.join(targetWs, 81, 181, 'Doingtime', 'rogue', null));
    const original = { ...entity(server, target.pid).pos };

    const before = Date.now();
    command(server, moderator, '/jail "Doingtime" 10');
    await vi.waitFor(() => expect(target.jailed).not.toBeNull());
    expect(target.jailed?.until).toBeGreaterThanOrEqual(before + 10 * 60_000);
    expect(target.jailed?.until).toBeLessThanOrEqual(Date.now() + 10 * 60_000);
    expect(isInJailCage(entity(server, target.pid).pos)).toBe(true);
    expect(logEventTexts(targetWs)).toContain('A moderator has moved you to jail for 10 minutes.');
    expect(eventTexts(moderatorWs)).toContain('Jailed Doingtime for 10 minutes.');

    // The sentence is still running: enforcement keeps them in the cage.
    internals(server).enforceJailStates();
    expect(target.jailed).not.toBeNull();

    // Sentence served: released back to the pre-jail position, prisoner flag
    // (the brawl hostility) cleared, with the dedicated notice.
    if (!target.jailed) throw new Error('expected a jailed session');
    target.jailed.until = Date.now() - 1;
    internals(server).enforceJailStates();
    expect(target.jailed).toBeNull();
    expect(entity(server, target.pid).pos.x).toBeCloseTo(original.x);
    expect(entity(server, target.pid).pos.z).toBeCloseTo(original.z);
    expect(entity(server, target.pid).jailed).toBe(false);
    expect(logEventTexts(targetWs)).toContain('Your jail sentence has ended.');

    // Jailing without a sentence length is no longer a thing: usage notice,
    // nobody moves.
    command(server, moderator, '/jail "Doingtime"');
    expect(target.jailed).toBeNull();
    expect(eventTexts(moderatorWs)).toContain('Usage: /jail ["<name>" <minutes> [reason]]');
  });

  it('lets jailed players brawl with each other but never touch a moderator', async () => {
    const server = new GameServer();
    const moderator = joined(
      server.join(fakeWs(), 70, 170, 'Warden', 'warrior', null, false, {
        isAdmin: true,
        adminPermissions: MOD_PERMS,
      }),
    );
    const brawlerA = joined(server.join(fakeWs(), 71, 171, 'Brawlerone', 'rogue', null));
    const brawlerB = joined(server.join(fakeWs(), 72, 172, 'Brawlertwo', 'mage', null));
    const entityA = entity(server, brawlerA.pid);
    const entityB = entity(server, brawlerB.pid);

    // Free players are never hostile to each other.
    expect(server.sim.isHostileTo(entityA, entityB)).toBe(false);

    // One prisoner alone still cannot fight a free player, in either direction.
    command(server, moderator, '/jail "Brawlerone" 60');
    await vi.waitFor(() => expect(brawlerA.jailed).not.toBeNull());
    expect(server.sim.isHostileTo(entityA, entityB)).toBe(false);
    expect(server.sim.isHostileTo(entityB, entityA)).toBe(false);

    // Two prisoners are mutually hostile: the jail brawl is on.
    command(server, moderator, '/jail "Brawlertwo" 60');
    await vi.waitFor(() => expect(brawlerB.jailed).not.toBeNull());
    expect(server.sim.isHostileTo(entityA, entityB)).toBe(true);
    expect(server.sim.isHostileTo(entityB, entityA)).toBe(true);

    // A visiting moderator is not a valid target, and even a forced damage
    // call bounces off GM invulnerability. The other direction is open: the
    // visiting warden (GM) may strike prisoners.
    command(server, moderator, '/jail');
    const moderatorEntity = entity(server, moderator.pid);
    expect(server.sim.isHostileTo(entityA, moderatorEntity)).toBe(false);
    expect(server.sim.isHostileTo(moderatorEntity, entityA)).toBe(true);
    const hpBefore = moderatorEntity.hp;
    server.sim.dealDamage(entityA, moderatorEntity, 500, false, 'physical', null, 'hit', true);
    expect(moderatorEntity.hp).toBe(hpBefore);

    // Release one: the brawl pairing dissolves immediately, and the freed
    // player is no longer a warden target either.
    command(server, moderator, '/unjail "Brawlerone"');
    await vi.waitFor(() => expect(brawlerA.jailed).toBeNull());
    expect(server.sim.isHostileTo(entityA, entityB)).toBe(false);
    expect(server.sim.isHostileTo(entityB, entityA)).toBe(false);
    expect(server.sim.isHostileTo(moderatorEntity, entityA)).toBe(false);
    expect(server.sim.isHostileTo(moderatorEntity, entityB)).toBe(true);
  });
});

describe('moderator spectate integration', () => {
  it('re-scopes snapshots and events, gates gameplay, and restores the moderator', () => {
    const server = new GameServer();
    const moderatorWs = fakeWs();
    const suspectWs = fakeWs();
    const correspondentWs = fakeWs();
    const moderator = joined(
      server.join(moderatorWs, 1, 101, 'Watcher', 'mage', null, false, {
        isAdmin: true,
        adminPermissions: MOD_PERMS,
      }),
    );
    const suspect = joined(server.join(suspectWs, 2, 102, 'Suspect', 'rogue', null));
    const correspondent = joined(
      server.join(correspondentWs, 3, 103, 'Correspondent', 'priest', null),
    );
    const moderatorEntity = entity(server, moderator.pid);
    const originalPos = { ...moderatorEntity.pos };
    const originalGm = !!moderatorEntity.gm;
    server.sim.partyInvite(suspect.pid, moderator.pid);
    server.sim.partyAccept(suspect.pid);

    command(server, moderator, '/spectate "Suspect"');

    expect(moderator.spectating?.characterId).toBe(suspect.characterId);
    expect(moderatorEntity.pos.x).toBe(-10_000);
    expect(moderatorEntity.pos.z).toBe(-10_000);
    expect(moderatorEntity.gm).toBe(true);
    expect(frames(moderatorWs)).toContainEqual({ t: 'spectate', name: 'Suspect' });

    moderatorWs.send.mockClear();
    internals(server).broadcastSnapshots();
    const snapshot = frames(moderatorWs).find((frame) => frame.t === 'snap');
    if (!snapshot?.self) throw new Error('spectator snapshot missing');
    expect(snapshot.self.id).toBe(suspect.pid);
    expect(snapshot.self.nm).toBe('Suspect');
    expect(snapshot.self.ack).toBe(0);
    const moderatorPartyRow = snapshot.self.party.members.find(
      (member: { pid: number }) => member.pid === moderator.pid,
    );
    if (!moderatorPartyRow) throw new Error('moderator party row missing');
    expect(moderatorPartyRow.x).toBe(originalPos.x);
    expect(moderatorPartyRow.z).toBe(originalPos.z);

    const suspectEntity = server.sim.entities.get(suspect.pid);
    if (!suspectEntity) throw new Error('suspect entity missing');
    const beforeTarget = suspectEntity.targetId;
    server.handleMessage(
      moderator,
      JSON.stringify({ t: 'cmd', cmd: 'target', id: correspondent.pid }),
    );
    expect(suspectEntity.targetId).toBe(beforeTarget);

    moderatorWs.send.mockClear();
    command(server, suspect, '/say visible local speech');
    internals(server).routeEvents(server.sim.tick());
    expect(eventTexts(moderatorWs)).toContain('visible local speech');

    moderatorWs.send.mockClear();
    command(server, correspondent, '/w Suspect private observed whisper');
    internals(server).routeEvents(server.sim.tick());
    expect(eventTexts(moderatorWs)).not.toContain('private observed whisper');

    moderatorWs.send.mockClear();
    command(server, correspondent, '/w Watcher moderator whisper');
    internals(server).routeEvents(server.sim.tick());
    expect(eventTexts(moderatorWs)).toContain('moderator whisper');
    expect(moderator.lastWhisperFrom).toBe('Correspondent');

    moderatorWs.send.mockClear();
    command(server, moderator, '/r reply remains available');
    internals(server).routeEvents(server.sim.tick());
    expect(eventTexts(correspondentWs)).toContain('reply remains available');

    moderatorWs.send.mockClear();
    command(server, moderator, '/say blocked local speech');
    expect(eventTexts(moderatorWs)).toContain('Local chat is unavailable while spectating.');

    command(server, moderator, '/unspectate');
    expect(moderator.spectating).toBeNull();
    expect(moderatorEntity.pos).toEqual(originalPos);
    expect(!!moderatorEntity.gm).toBe(originalGm);
    expect(frames(moderatorWs)).toContainEqual({ t: 'spectate', name: null });
  });

  it('switches targets without moving the saved return point', () => {
    const server = new GameServer();
    const moderator = joined(
      server.join(fakeWs(), 1, 101, 'Watcher', 'mage', null, false, {
        isAdmin: true,
        adminPermissions: MOD_PERMS,
      }),
    );
    joined(server.join(fakeWs(), 2, 102, 'First', 'rogue', null));
    const second = joined(server.join(fakeWs(), 3, 103, 'Second', 'warrior', null));
    const original = { ...entity(server, moderator.pid).pos };

    command(server, moderator, '/spectate First');
    if (!moderator.spectating) throw new Error('spectate did not start');
    const saved = { ...moderator.spectating.savedPos };
    command(server, moderator, '/spectate Second');

    expect(moderator.spectating?.characterId).toBe(second.characterId);
    expect(moderator.spectating?.savedPos).toEqual(saved);
    command(server, moderator, '/unspectate');
    expect(server.sim.entities.get(moderator.pid)?.pos).toEqual(original);
  });

  it('auto-ends when the suspect leaves and refuses non-admin spectate', async () => {
    const server = new GameServer();
    const moderatorWs = fakeWs();
    const moderator = joined(
      server.join(moderatorWs, 1, 101, 'Watcher', 'mage', null, false, {
        isAdmin: true,
        adminPermissions: MOD_PERMS,
      }),
    );
    const suspect = joined(server.join(fakeWs(), 2, 102, 'Goneplayer', 'rogue', null));
    command(server, moderator, '/spectate Goneplayer');
    moderatorWs.send.mockClear();

    await server.leave(suspect, 'test');
    internals(server).broadcastSnapshots();

    expect(moderator.spectating).toBeNull();
    expect(frames(moderatorWs)).toContainEqual({ t: 'spectate', name: null });
    expect(eventTexts(moderatorWs)).toContain('Goneplayer is no longer online; spectate ended.');

    const regularWs = fakeWs();
    const regular = joined(server.join(regularWs, 3, 103, 'Regular', 'warrior', null));
    joined(server.join(fakeWs(), 4, 104, 'Observed', 'rogue', null));
    const original = { ...entity(server, regular.pid).pos };
    command(server, regular, '/spectate Observed');
    expect(regular.spectating).toBeNull();
    expect(server.sim.entities.get(regular.pid)?.pos).toEqual(original);
  });

  it('saves the return position during spectate and restores a stowed pet', async () => {
    const server = new GameServer();
    const seedPid = server.sim.addPlayer('hunter', 'Petseed');
    const state = server.sim.serializeCharacter(seedPid);
    if (!state) throw new Error('seed character state missing');
    server.sim.removePlayer(seedPid);
    state.pet = {
      templateId: 'forest_wolf',
      name: 'Tracker',
      level: 1,
      hp: 20,
      dead: false,
      mode: 'defensive',
      autoTaunt: false,
    };
    const moderator = joined(
      server.join(fakeWs(), 1, 101, 'Petwatcher', 'hunter', state, false, {
        isAdmin: true,
        adminPermissions: MOD_PERMS,
      }),
    );
    joined(server.join(fakeWs(), 2, 102, 'Pettarget', 'warrior', null));
    const original = { ...entity(server, moderator.pid).pos };
    expect(server.sim.petOf(moderator.pid, true)?.name).toBe('Tracker');

    command(server, moderator, '/spectate Pettarget');
    expect(server.sim.petOf(moderator.pid, true)).toBeNull();
    await server.saveCharacter(moderator);

    const saved = vi
      .mocked(saveCharacterState)
      .mock.calls.find(([characterId]) => characterId === moderator.characterId)?.[2];
    expect(saved?.pos).toEqual({ x: original.x, z: original.z });
    expect(saved?.pet?.name).toBe('Tracker');
    expect(server.sim.entities.get(moderator.pid)?.pos.x).toBe(-10_000);

    command(server, moderator, '/unspectate');
    expect(server.sim.petOf(moderator.pid, true)?.name).toBe('Tracker');
  });
});
