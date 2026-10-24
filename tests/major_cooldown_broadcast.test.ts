// End to end through the real broadcast: a GameServer's snapshot pass carries a
// player's tracked cooldowns (`mcd`) on the stable aura channel, and a bare
// ClientWorld fed those exact snapshots mirrors them into the peer entity's
// cooldown map. Pins the wiring the unit pair (tests/major_cooldown_wire.test.ts)
// cannot: the game.ts splice, the online.ts decode on the aura channel only, the
// held set across lite records, the self skip, and the time-free spent-key wire.
import { describe, expect, it, vi } from 'vitest';

// Keep real join/broadcast/decode behavior while all persistence/social hooks use
// the same in-memory DB boundary as snapshots.test.ts. No PostgreSQL is needed.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => true),
  saveCharacterAndGuildBankState: vi.fn(async () => true),
  saveCharacterAndMarketState: vi.fn(async () => true),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  saveMailPartitions: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

import { GameServer } from '../server/game';
import { SPENT_COOLDOWN_UNKNOWN_REMAINING } from '../src/net/peer_major_cooldown_wire';
import { updateTimers } from '../src/sim/combat/auras';
import { STABLE_TIMER_WIRE_VERSION } from '../src/world_api';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

const MEDALLION = 'trinket:medallion_of_defiance';
const STABLE = { timerWireVersion: STABLE_TIMER_WIRE_VERSION };

// biome-ignore lint/suspicious/noExplicitAny: snapshot frames are untyped wire JSON
type Snap = any;

function setup() {
  const server = new GameServer();
  const viewerWs = fakeWs();
  const subjectWs = fakeWs();
  const viewer = joinServer(server, viewerWs, 1, 'Watcher', 'warrior', STABLE);
  const subject = joinServer(server, subjectWs, 2, 'Gravelmaw', 'warrior', STABLE);
  const subjectEntity = server.sim.entities.get(subject.pid);
  if (!subjectEntity) throw new Error('subject missing');
  const step = (): Snap => {
    server.sim.tick();
    viewerWs.sent.length = 0;
    broadcast(server);
    return lastSnap(viewerWs.sent);
  };
  const recordOf = (snap: Snap) =>
    (snap?.ents ?? []).find((e: { id: number }) => e.id === subject.pid);
  return { server, viewer, subject, subjectWs, subjectEntity, step, recordOf };
}

describe('enemy cooldowns through the broadcast', () => {
  it('ships mcd on the aura channel, and lite records of a moving player never repeat it', () => {
    const { subjectEntity, step, recordOf } = setup();
    subjectEntity.cooldowns.set('recklessness', 150);
    const first = recordOf(step());
    expect(first.mcd).toEqual(['recklessness']);
    expect(first.auras).toBeDefined();

    // The subject moves every tick: its lite records go out, without the channel.
    let liteWithoutChannel = 0;
    for (let i = 0; i < 12; i++) {
      subjectEntity.pos.x += 0.5;
      const record = recordOf(step());
      if (record && record.mcd === undefined && record.auras === undefined) liteWithoutChannel++;
      if (record) expect(record.mcd).toBeUndefined();
    }
    expect(liteWithoutChannel).toBeGreaterThan(0);

    // A newly armed cooldown changes the channel, so it rides the next record.
    subjectEntity.cooldowns.set('die_by_sword', 100);
    let carried: Snap = null;
    for (let i = 0; i < 6 && !carried; i++) {
      const record = recordOf(step());
      if (record?.mcd) carried = record;
    }
    expect(carried.mcd).toEqual(['die_by_sword', 'recklessness']);
  });

  it('mirrors the spent keys into the peer with no time, keeps them across lite records, and leaves self alone', () => {
    const { viewer, subject, subjectEntity, server, step } = setup();
    const viewerEntity = server.sim.entities.get(viewer.pid);
    if (!viewerEntity) throw new Error('viewer missing');
    subjectEntity.cooldowns.set('recklessness', 150);
    viewerEntity.cooldowns.set('recklessness', 42);
    const client = bareClient(viewer.pid);
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is the private decode entry
    const apply = (snap: Snap) => (client as any).applySnapshot(structuredClone(snap));

    apply(step());
    const peer = client.entities.get(subject.pid);
    expect(peer?.cooldowns.get('recklessness')).toBe(SPENT_COOLDOWN_UNKNOWN_REMAINING);

    for (let i = 0; i < 20; i++) {
      subjectEntity.pos.x += 0.5;
      apply(step());
    }
    // Still spent, still timeless: the lite records that omitted the channel
    // neither cleared it nor taught the client anything about when it returns.
    expect(client.entities.get(subject.pid)?.cooldowns.get('recklessness')).toBe(
      SPENT_COOLDOWN_UNKNOWN_REMAINING,
    );

    // Once it comes back on the server, the next channel record clears it.
    subjectEntity.cooldowns.delete('recklessness');
    for (let i = 0; i < 6; i++) apply(step());
    expect(client.entities.get(subject.pid)?.cooldowns.has('recklessness')).toBe(false);

    // The viewer's own map is the self channel's, never a peer key.
    const self = client.entities.get(viewer.pid)?.cooldowns.get('recklessness') ?? 0;
    expect(self).toBeLessThanOrEqual(42);
  });

  it('never broadcasts an unused medallion inheriting another real trinket use', () => {
    const { server, subject, subjectEntity, step, recordOf } = setup();
    server.sim.setPlayerLevel(20, subject.pid);
    server.sim.addItem('wayfarers_lodestone', 1, subject.pid);
    server.sim.equipItem('wayfarers_lodestone', subject.pid);
    for (let i = 0; i < 31 * 20; i++) updateTimers(subjectEntity);
    server.sim.useItem('wayfarers_lodestone', subject.pid);
    for (let i = 0; i < 30 * 20; i++) updateTimers(subjectEntity);
    server.sim.addItem('medallion_of_defiance', 1, subject.pid);
    server.sim.equipItem('medallion_of_defiance', subject.pid);
    expect(subjectEntity.cooldowns.get(MEDALLION)).toBeCloseTo(90);
    expect(recordOf(step()).mcd).toBeNull();
  });

  it('ships genuine late first sight below 30 seconds to peer and self, without movement spam', () => {
    const { server, viewer, subject, subjectWs, subjectEntity, step, recordOf } = setup();
    server.sim.setPlayerLevel(20, subject.pid);
    server.sim.addItem('medallion_of_defiance', 1, subject.pid);
    server.sim.equipItem('medallion_of_defiance', subject.pid);
    for (let i = 0; i < 31 * 20; i++) updateTimers(subjectEntity);
    server.sim.useItem('medallion_of_defiance', subject.pid);
    for (let i = 0; i < 100 * 20; i++) updateTimers(subjectEntity);
    // No broadcast/cache observation happened during the first 100 seconds.
    expect(subjectEntity.cooldowns.get(MEDALLION)).toBeCloseTo(20);
    const first = step();
    expect(recordOf(first).mcd).toEqual([MEDALLION]);
    const peerClient = bareClient(viewer.pid);
    const selfClient = bareClient(subject.pid);
    const apply = (client: typeof peerClient, snap: Snap) =>
      // biome-ignore lint/suspicious/noExplicitAny: exercise the real private snapshot decoder.
      (client as any).applySnapshot(structuredClone(snap));
    apply(peerClient, first);
    apply(selfClient, lastSnap(subjectWs.sent));
    expect(peerClient.entities.get(subject.pid)?.cooldowns.get('system_medallion_use')).toBe(
      SPENT_COOLDOWN_UNKNOWN_REMAINING,
    );
    expect(selfClient.entities.get(subject.pid)?.cooldowns.get('system_medallion_use')).toBeCloseTo(
      19.95,
    );
    for (let i = 0; i < 12; i++) {
      subjectEntity.pos.x += 0.5;
      const snap = step();
      expect(recordOf(snap)?.mcd).toBeUndefined();
      apply(peerClient, snap);
    }
    expect(peerClient.entities.get(subject.pid)?.cooldowns.get('system_medallion_use')).toBe(
      SPENT_COOLDOWN_UNKNOWN_REMAINING,
    );
    // A fresh client gets the fact from a new whole first-sight record too.
    const reconnectWs = fakeWs();
    const reconnect = joinServer(server, reconnectWs, 3, 'Reconnected', 'warrior', STABLE);
    broadcast(server);
    const reconnected = bareClient(reconnect.pid);
    apply(reconnected, lastSnap(reconnectWs.sent));
    expect(reconnected.entities.get(subject.pid)?.cooldowns.get('system_medallion_use')).toBe(
      SPENT_COOLDOWN_UNKNOWN_REMAINING,
    );
  });
});
