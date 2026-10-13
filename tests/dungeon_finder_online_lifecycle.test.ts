import { describe, expect, it, vi } from 'vitest';

// Only persistence and boot content are fixtures. Commands, admission, delta
// snapshots and ClientWorld decoding execute the actual production pipeline.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndGuildBankState: vi.fn(async () => true),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  saveMailPartitions: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  releaseCharacterLease: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));
vi.mock('../server/sim_boot_config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/sim_boot_config')>();
  const { EMPTY_TEST_WORLD } = await import('./sim_shared');
  return {
    buildRealmSimConfig: (...args: Parameters<typeof actual.buildRealmSimConfig>) => ({
      ...actual.buildRealmSimConfig(...args),
      world: EMPTY_TEST_WORLD,
      worldBossAtBoot: false,
      compulsoryTutorial: false,
      riftPortals: false,
    }),
  };
});

import { GameServer } from '../server/game';
import { type Role, TALENTS } from '../src/sim/content/talents';
import type { PlayerClass } from '../src/sim/types';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

function harness() {
  const server = new GameServer();
  let characterId = 1000;
  const connect = (name: string, cls: PlayerClass, role: Role) => {
    const socket = fakeWs();
    const session = joinServer(server, socket, characterId++, name, cls);
    server.sim.setPlayerLevel(20, session.pid);
    server.sim.setSpec(TALENTS[cls].specs.find((spec) => spec.role === role)!.id, session.pid);
    const client = bareClient(session.pid, {
      playerClass: cls,
      cmd: (command: Record<string, unknown>) =>
        server.handleMessage(session, JSON.stringify({ t: 'cmd', ...command })),
    });
    client.dungeonFinderSetRoles([role]);
    return { socket, session, client };
  };
  const sync = (...players: ReturnType<typeof connect>[]) => {
    // Advance the finder readout cadence without running ambient combat.
    server.sim.tickCount += 10;
    broadcast(server);
    for (const { client, socket } of players) {
      const snap = lastSnap(socket.sent);
      expect(snap).not.toBeNull();
      (client as unknown as { applySnapshot(snapshot: unknown): void }).applySnapshot(snap);
    }
  };
  return { server, connect, sync };
}

function publish(player: ReturnType<ReturnType<typeof harness>['connect']>, role: Role) {
  player.client.dungeonFinderExpeditionConfigure({
    kind: 'recruit',
    activityId: 'nythraxis_boss_arena_normal',
    role,
    details: { purpose: 'relaxed', note: 'Raid recruitment' },
  });
}

describe('Groups authoritative online lifecycle', () => {
  it('publishes, mirrors fourteen applicants, accepts the chosen role, and joins another group after leaving', async () => {
    const { server, connect, sync } = harness();
    const leader = connect('RaidLeader', 'warrior', 'tank');
    const other = connect('OtherLeader', 'priest', 'healer');
    const applicants = Array.from({ length: 14 }, (_, i) => {
      const role = i < 3 ? 'tank' : i < 7 ? 'healer' : 'dps';
      return connect(`Applicant${i}`, role === 'healer' ? 'priest' : 'warrior', role);
    });
    publish(leader, 'tank');
    publish(other, 'healer');
    sync(leader, other, ...applicants);
    const listing = leader.client.dungeonFinderInfo!.myListing!;
    const otherListing = other.client.dungeonFinderInfo!.myListing!;
    expect(listing.activityId).toBe('nythraxis_boss_arena_normal');
    expect(applicants[0].client.dungeonFinderBoard?.map((row) => row.id)).toContain(listing.id);
    expect(
      applicants[0].client.dungeonFinderBoard?.find((row) => row.id === listing.id)?.members,
    ).toEqual([{ cls: 'warrior', level: 20, role: 'tank' }]);
    for (let i = 0; i < applicants.length; i++) applicants[i].client.dungeonFinderApply(listing.id);
    sync(leader, ...applicants);
    expect(leader.client.dungeonFinderInfo?.myListing?.applicants).toHaveLength(14);
    expect(leader.client.dungeonFinderInfo?.myListing?.applicants.map((row) => row.roles)).toEqual([
      ...Array.from({ length: 3 }, () => ['tank']),
      ...Array.from({ length: 4 }, () => ['healer']),
      ...Array.from({ length: 7 }, () => ['dps']),
    ]);
    expect(leader.client.dungeonFinderInfo?.myListing?.applicants.map((row) => row.pid)).toEqual(
      applicants.map((p) => p.session.pid),
    );
    const member = applicants[7];
    const tankSpec = TALENTS.warrior.specs.find((spec) => spec.role === 'tank')!.id;
    server.sim.setSpec(tankSpec, member.session.pid);
    sync(leader, member);
    expect(
      leader.client.dungeonFinderInfo?.myListing?.applicants.find(
        (row) => row.pid === member.session.pid,
      ),
    ).toMatchObject({ spec: tankSpec, roles: ['dps'] });
    leader.client.dungeonFinderApplicationRespond(member.session.pid, true);
    sync(leader, member);
    expect(member.client.partyInfo).toMatchObject({ leader: leader.session.pid, raid: true });
    expect(member.client.dungeonFinderInfo?.roles).toEqual(['dps']);
    expect(
      member.client.dungeonFinderBoard
        ?.find((row) => row.id === listing.id)
        ?.members.map((row) => row.role),
    ).toEqual(['tank', 'dps']);
    expect(member.client.dungeonFinderInfo?.myApplications).toEqual([]);
    expect(leader.client.dungeonFinderInfo?.myListing?.applicants).toHaveLength(13);
    member.client.partyLeave();
    sync(leader, member);
    expect(member.client.partyInfo).toBeNull();
    member.client.dungeonFinderApply(otherListing.id);
    sync(other, member);
    expect(other.client.dungeonFinderInfo?.myListing?.applicants).toHaveLength(1);
    other.client.dungeonFinderApplicationRespond(member.session.pid, true);
    sync(other, member);
    expect(member.client.partyInfo?.leader).toBe(other.session.pid);
    expect(member.client.dungeonFinderInfo?.myApplications).toEqual([]);
    await server.leave(applicants[0].session, 'test disconnect');
    sync(leader);
    expect(leader.client.dungeonFinderInfo?.myListing?.applicants).toHaveLength(12);
    await server.leave(leader.session, 'test disconnect');
    sync(applicants[1]);
    expect(applicants[1].client.dungeonFinderBoard?.some((row) => row.id === listing.id)).toBe(
      false,
    );
    expect(applicants[1].client.dungeonFinderInfo?.myApplications).toEqual([]);
  });
});
