// End to end through the real broadcast: a GameServer's snapshot pass carries a
// player's tracked cooldowns (`mcd`) on the stable aura channel, and a bare
// ClientWorld fed those exact snapshots mirrors them into the peer entity's
// cooldown map. Pins the wiring the unit pair (tests/major_cooldown_wire.test.ts)
// cannot: the game.ts splice, the online.ts decode on the aura channel only, the
// snapshot-clock aging, and the self skip.
import { describe, expect, it } from 'vitest';
import { GameServer } from '../server/game';
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
  return { server, viewer, subject, subjectEntity, step, recordOf };
}

describe('enemy cooldowns through the broadcast', () => {
  it('ships mcd on the aura channel, and lite records of a moving player never repeat it', () => {
    const { subjectEntity, step, recordOf } = setup();
    subjectEntity.cooldowns.set('recklessness', 150);
    const first = recordOf(step());
    expect(first.mcd).toEqual({ recklessness: expect.any(Number) });
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
    expect(Object.keys(carried.mcd).sort()).toEqual(['die_by_sword', 'recklessness']);
  });

  it('mirrors the deadlines into the peer, keeps them across lite records, and leaves self alone', () => {
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
    const first = peer?.cooldowns.get('recklessness') ?? 0;
    expect(first).toBeGreaterThan(149);
    expect(first).toBeLessThanOrEqual(150);

    for (let i = 0; i < 20; i++) {
      subjectEntity.pos.x += 0.5;
      apply(step());
    }
    // Twenty ticks later the countdown has aged on the snapshot clock, not frozen
    // and not cleared by the lite records that omitted the channel.
    const later = client.entities.get(subject.pid)?.cooldowns.get('recklessness') ?? 0;
    expect(later).toBeLessThan(first - 0.5);
    expect(later).toBeGreaterThan(first - 2);

    // The viewer's own map is the self channel's, never a peer deadline.
    const self = client.entities.get(viewer.pid)?.cooldowns.get('recklessness') ?? 0;
    expect(self).toBeLessThanOrEqual(42);
  });

  it('never shows the medallion off an equip lockout, and shows it once used', () => {
    const lockout = setup();
    lockout.subjectEntity.cooldowns.set(MEDALLION, 30); // TRINKET_EQUIP_LOCKOUT on equip
    lockout.subjectEntity.cooldowns.set('recklessness', 150);
    expect(Object.keys(lockout.recordOf(lockout.step()).mcd)).toEqual(['recklessness']);

    const used = setup();
    used.subjectEntity.cooldowns.set(MEDALLION, 120);
    const record = used.recordOf(used.step());
    expect(Object.keys(record.mcd)).toEqual([MEDALLION]);
  });
});
