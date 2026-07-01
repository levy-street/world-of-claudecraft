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
}));

vi.mock('../server/moderation_db', () => moderation);

import { saveCharacterState } from '../server/db';
import { type ClientSession, GameServer } from '../server/game';

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
      server.join(adminWs, 2, 102, 'Admin', 'mage', null, false, { isAdmin: true }),
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
      }),
    );
    command(server, admin, '/kick "Otheradmin" forbidden');
    await Promise.resolve();
    await Promise.resolve();
    expect(otherAdminWs.close).not.toHaveBeenCalled();
    expect(moderation.recordInGameAction).not.toHaveBeenCalled();
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
