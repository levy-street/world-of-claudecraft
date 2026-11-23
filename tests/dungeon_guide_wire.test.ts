// The dungeon guide across the wire: the authoritative server dispatches the
// `dungeon_guide_answer` frame into the sim (malformed frames dropped), the
// guide's offer state rides his entity record as `gds`, and the online client
// mirrors it onto Entity.guideState (an unknown value decodes to nothing), so
// the gossip dialog reads the same state on both hosts.

import { describe, expect, it, vi } from 'vitest';
import { GameServer, wireEntity } from '../server/game';
import { CANTOR_NPC_ID, CANTOR_SPAWN } from '../src/sim/content/drowned_temple_cantor';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { claimedInstanceAt, enterDungeon } from '../src/sim/instances/dungeons';
import type { Entity } from '../src/sim/types';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

// biome-ignore lint/suspicious/noExplicitAny: the private dispatch seam (loot_roll_wire idiom)
function sendCmd(server: GameServer, session: any, frame: Record<string, unknown>): void {
  const raw = JSON.stringify({ t: 'cmd', ...frame });
  // biome-ignore lint/suspicious/noExplicitAny: dispatchMessage is private
  (server as any).dispatchMessage(session, JSON.parse(raw), raw, 0);
}

function npcWire(id: number, extra: Record<string, unknown> = {}): unknown {
  return {
    id,
    k: 'npc',
    tid: CANTOR_NPC_ID,
    nm: 'Laverock',
    lv: 10,
    x: 0,
    y: 0,
    z: 0,
    f: 0,
    hp: 500,
    mhp: 500,
    ...extra,
  };
}

describe('the guide on the wire', () => {
  it('the server answers a frame through the sim, and drops a malformed one', () => {
    const server = new GameServer();
    const session = joinServer(server, fakeWs(), 801, 'Cantorfriend');
    const spy = vi.spyOn(server.sim, 'answerDungeonGuide').mockImplementation(() => {});
    sendCmd(server, session, { cmd: 'dungeon_guide_answer', npcId: 42, accept: true });
    expect(spy).toHaveBeenCalledWith(42, true, session.pid);
    sendCmd(server, session, { cmd: 'dungeon_guide_answer', npcId: '42', accept: true });
    sendCmd(server, session, { cmd: 'dungeon_guide_answer', npcId: 42, accept: 'yes' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a real answer on the server joins the guide, and his record carries it', () => {
    const server = new GameServer();
    const session = joinServer(server, fakeWs(), 802, 'Steplight');
    const sim = server.sim;
    enterDungeon(sim.ctx, 'drowned_temple', session.pid);
    const me = sim.entities.get(session.pid) as Entity;
    const inst = claimedInstanceAt(sim.ctx, me.pos);
    expect(inst).not.toBeNull();
    if (!inst) return;
    const guide = inst.npcIds
      .map((id) => sim.entities.get(id))
      .find((e) => e?.templateId === CANTOR_NPC_ID) as Entity;
    sim.tick();
    expect(wireEntity(guide).gds).toBe('open');
    const o = instanceOrigin(DUNGEONS.drowned_temple.index, inst.slot);
    me.pos = sim.ctx.groundPos(o.x + CANTOR_SPAWN.x - 2, o.z + CANTOR_SPAWN.z);
    sendCmd(server, session, { cmd: 'dungeon_guide_answer', npcId: guide.id, accept: true });
    expect(guide.guideState).toBe('joined');
    expect(wireEntity(guide).gds).toBe('joined');
  });

  it('an answer re-sends the guide record to a member who already knows him', () => {
    const server = new GameServer();
    const watcher = fakeWs();
    const session = joinServer(server, watcher, 804, 'Watcher');
    const sim = server.sim;
    enterDungeon(sim.ctx, 'drowned_temple', session.pid);
    const me = sim.entities.get(session.pid) as Entity;
    const inst = claimedInstanceAt(sim.ctx, me.pos);
    if (!inst) throw new Error('no claim');
    const guide = inst.npcIds
      .map((id) => sim.entities.get(id))
      .find((e) => e?.templateId === CANTOR_NPC_ID) as Entity;
    const o = instanceOrigin(DUNGEONS.drowned_temple.index, inst.slot);
    me.pos = sim.ctx.groundPos(o.x + CANTOR_SPAWN.x - 2, o.z + CANTOR_SPAWN.z);
    sim.tick();
    broadcast(server);
    // biome-ignore lint/suspicious/noExplicitAny: wire JSON
    const recordOf = (snap: any) => (snap?.ents ?? []).find((w: any) => w.id === guide.id);
    expect(recordOf(lastSnap(watcher.sent))?.gds).toBe('open');
    watcher.sent.length = 0;
    sendCmd(server, session, { cmd: 'dungeon_guide_answer', npcId: guide.id, accept: true });
    sim.tick();
    broadcast(server);
    expect(recordOf(lastSnap(watcher.sent))?.gds).toBe('joined');
  });

  it('every other entity record leaves gds out', () => {
    const server = new GameServer();
    const session = joinServer(server, fakeWs(), 803, 'Plainfolk');
    expect('gds' in wireEntity(server.sim.entities.get(session.pid) as Entity)).toBe(false);
  });

  it('the online client mirrors the state, and drops an unknown one', () => {
    const client = bareClient(1);
    const internals = client as unknown as { applySnapshot(snapshot: unknown): void };
    const self = { id: 1, k: 'player', tid: 'warrior', nm: 'Me', lv: 12, x: 0, y: 0, z: 0, f: 0 };
    internals.applySnapshot({ t: 'snap', self, ents: [npcWire(9, { gds: 'declined' })] });
    expect(client.entities.get(9)?.guideState).toBe('declined');
    internals.applySnapshot({ t: 'snap', self, ents: [npcWire(9, { gds: 'singing' })] });
    expect(client.entities.get(9)?.guideState).toBe('singing');
    internals.applySnapshot({ t: 'snap', self, ents: [npcWire(9, { gds: 'dancing' })] });
    expect(client.entities.get(9)?.guideState).toBeUndefined();
    internals.applySnapshot({ t: 'snap', self, ents: [npcWire(9)] });
    expect(client.entities.get(9)?.guideState).toBeUndefined();
  });
});
