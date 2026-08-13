// The authored look on the wire: it has to REACH both audiences, and it has to
// cost the server almost nothing to keep sending.
//
// `app` is the heaviest identity field by an order of magnitude (~0.6 KB for a
// default look against a handful of bytes for everything else, and 1489 bytes
// at the shared sanitizer's hard bound) and the only one a session normally
// never changes: it is stamped at join from the character's own column, and the
// only thing that moves it is a paid redesign. Composing it into identityFields
// therefore meant
// JSON.stringify walking half a kilobyte per online player 20 times a second to
// produce the identical string, so it is serialized once per entity and spliced
// instead. These tests pin both halves: the bytes still arrive, and the memo is
// actually a memo.
//
// The self record is the subtle one. The broadcast loop SKIPS the viewer's own
// entity, so a player's own look can only reach them through bcastSelf, where it
// rides the same delta channel as the other heavy fields: sent once, omitted
// afterwards. That makes "absent" mean "unchanged" there and "no authored look"
// everywhere else, which is why the client decode takes a selfDelta flag.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { type ClientSession, GameServer } from '../server/game';
import type { PlayerClass } from '../src/sim/types';
import { bareClient } from './helpers/bare_client';

const LOOK = { gender: 'female', hair: 'highbun', skinLight: 0.4 };

interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) if (sent[i].t === 'snap') return sent[i];
  return null;
}

function joinServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: PlayerClass,
  appearance: Record<string, unknown> | null,
): ClientSession {
  const session = server.join(fc.ws, characterId, characterId, name, cls, null, false, {
    appearance,
  } as never);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function broadcast(server: GameServer): void {
  (server as any).broadcastSnapshots();
}

describe('authored look on the wire', () => {
  let server: GameServer;

  beforeEach(() => {
    server = new GameServer();
  });

  it('reaches a peer in the first full entity record it sees', () => {
    const a = fakeWs();
    const b = fakeWs();
    joinServer(server, a, 1, 'Watcher', 'warrior', null);
    const other = joinServer(server, b, 2, 'Designed', 'mage', LOOK);
    a.sent.length = 0;
    broadcast(server);

    const wire = lastSnap(a.sent).ents.find((e: any) => e.id === other.pid);
    expect(wire.k).toBe('player'); // a first-sight record is full
    expect(wire.app).toEqual(LOOK);
  });

  it('reaches the viewer own self record, which the entity list never carries', () => {
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Designed', 'mage', LOOK);
    broadcast(server);

    const snap = lastSnap(fc.sent);
    expect(snap.self.app).toEqual(LOOK);
    // The loop skips `e.id === anchorEntity.id`, so this is the ONLY copy.
    expect(snap.ents.some((e: any) => e.id === session.pid)).toBe(false);
  });

  it('ships the self look once, then omits it (the heavy-field delta channel)', () => {
    const fc = fakeWs();
    joinServer(server, fc, 1, 'Designed', 'mage', LOOK);
    broadcast(server);
    expect(lastSnap(fc.sent).self.app).toEqual(LOOK);
    fc.sent.length = 0;
    broadcast(server);
    // Unchanged, so not re-sent. The client treats absence on a self record as
    // "unchanged" rather than "cleared" (online.ts applyWire selfDelta).
    expect(lastSnap(fc.sent).self).not.toHaveProperty('app');
  });

  it('serializes the look ONCE per entity, not once per tick', () => {
    const a = fakeWs();
    const b = fakeWs();
    joinServer(server, a, 1, 'Watcher', 'warrior', null);
    const other = joinServer(server, b, 2, 'Designed', 'mage', LOOK);
    const entity = server.sim.entities.get(other.pid)!;
    // TICK, not just broadcast. wireCacheFor gates every identity stringify on
    // `cache.tick !== sim.tickCount`, so a loop of bare broadcasts enters the
    // serializing arm exactly once whatever the code underneath does: the
    // pre-memo version passes that loop too. Advancing the sim is what makes
    // this measure the memo instead of the per-tick cache.
    let serialized = 0;
    const original = (entity.modularAppearance as any).toJSON;
    Object.defineProperty(entity.modularAppearance, 'toJSON', {
      configurable: true,
      value() {
        serialized++;
        return { ...LOOK };
      },
    });
    const startTick = server.sim.tickCount;
    for (let i = 0; i < 20; i++) {
      server.sim.tick();
      broadcast(server);
    }
    if (original) (entity.modularAppearance as any).toJSON = original;
    expect(server.sim.tickCount).toBeGreaterThan(startTick + 18); // the loop really ticked
    expect(serialized).toBe(1);
  });

  it('keeps sending the look on every FULL record, memo or not', () => {
    // The other half, split out because it needs a full record to look at and
    // a settled entity emits lite ones: assert on first sight, where identity
    // always rides.
    const a = fakeWs();
    const b = fakeWs();
    joinServer(server, a, 1, 'Watcher', 'warrior', null);
    const other = joinServer(server, b, 2, 'Designed', 'mage', LOOK);
    a.sent.length = 0;
    broadcast(server);
    const first = lastSnap(a.sent).ents.find((e: any) => e.id === other.pid);
    expect(first.k).toBe('player');
    expect(first.app).toEqual(LOOK);

    // ...and an identity CHANGE re-emits it from the memo rather than dropping
    // it, since the splice runs inside the change arm.
    server.sim.entities.get(other.pid)!.level = 42;
    a.sent.length = 0;
    server.sim.tick();
    broadcast(server);
    const changed = lastSnap(a.sent).ents.find((e: any) => e.id === other.pid && e.k);
    expect(changed.lv).toBe(42);
    expect(changed.app).toEqual(LOOK);
  });

  it('CLIENT decode: an omitted app on a SELF record keeps the look', () => {
    // The other half of the wire contract, pinned on the DECODER rather than
    // the emitter: bcastSelf ships `app` once and then omits it, so the client
    // reading absence-as-cleared on a self record would erase the local
    // player's own body one tick after they entered the world. This is the
    // guard in applyWire's selfDelta arm; without it, this test reds.
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Designed', 'mage', LOOK);
    broadcast(server);
    const first = lastSnap(fc.sent);
    expect(first.self.app).toEqual(LOOK); // precondition: the look shipped

    const client = bareClient(session.pid, { playerClass: 'mage' });
    (client as any).applySnapshot(structuredClone(first));
    expect(client.entities.get(session.pid)?.modularAppearance).toEqual(LOOK);

    // The delta channel's steady state: the second self record has no `app`.
    server.sim.tick();
    fc.sent.length = 0;
    broadcast(server);
    const second = lastSnap(fc.sent);
    expect(second.self).not.toHaveProperty('app'); // precondition: really omitted
    (client as any).applySnapshot(structuredClone(second));
    // Absence on a SELF record means "unchanged", never "cleared".
    expect(client.entities.get(session.pid)?.modularAppearance).toEqual(LOOK);
  });

  it('CLIENT decode: an absent app on a full PEER record clears the look', () => {
    // ...and the same absence on a PEER's full record means the opposite: no
    // authored look, so the class rig. Both readings, one flag.
    const a = fakeWs();
    const b = fakeWs();
    const watcher = joinServer(server, a, 1, 'Watcher', 'warrior', null);
    const other = joinServer(server, b, 2, 'Designed', 'mage', LOOK);
    broadcast(server);
    const snap = lastSnap(a.sent);
    const peer = snap.ents.find((e: any) => e.id === other.pid);
    expect(peer.app).toEqual(LOOK);

    const client = bareClient(watcher.pid, { playerClass: 'warrior' });
    (client as any).applySnapshot(structuredClone(snap));
    expect(client.entities.get(other.pid)?.modularAppearance).toEqual(LOOK);

    // A full peer record WITHOUT app (a redesign cleared it, or a fresh look
    // never existed): the decode must clear, not keep serving the old body.
    const wiped = structuredClone(snap);
    const wipedPeer = wiped.ents.find((e: any) => e.id === other.pid);
    delete wipedPeer.app;
    (client as any).applySnapshot(wiped);
    expect(client.entities.get(other.pid)?.modularAppearance).toBeNull();
  });

  it('keeps the key off a PEER with no authored look, and sends null to the owner', () => {
    const a = fakeWs();
    const b = fakeWs();
    joinServer(server, a, 1, 'Watcher', 'warrior', null);
    const other = joinServer(server, b, 2, 'Legacy', 'mage', null);
    a.sent.length = 0;
    broadcast(server);

    // Absence on a peer record IS the "no authored look" signal.
    const wire = lastSnap(a.sent).ents.find((e: any) => e.id === other.pid);
    expect(wire).not.toHaveProperty('app');
    // On the SELF record absence means "unchanged", so nothing at all would
    // make a cleared look unclearable for its own owner. An explicit null costs
    // 11 bytes once per session and keeps the two readings symmetric.
    expect(lastSnap(a.sent).self.app).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A look that moves mid-session. The redesign route is allowed while the
// character is in world, so the look is not quite immutable after all, and the
// memo above is precisely what makes that hard: appJson is minted once per
// entity and the identity record only re-splices when the REST of the identity
// moves, so setting the entity field alone leaves every viewer (and the owner)
// looking at the old body until relog.
//
// Clearing appJson alone is not enough either, and that is the trap: the splice
// runs inside the identity CHANGE arm, so a memo that is empty but an identity
// that has not moved re-sends nothing. bustAppearanceWireMemo clears baseIdJson
// too, which forces the next tick to re-serialize, bump idVer, and ship the full
// record. These tests execute that path in both directions rather than reasoning
// about it.
// ---------------------------------------------------------------------------

const REDESIGNED = { gender: 'male', hair: 'mohawk', skinLight: 0.7 };

describe('a look pushed onto a live session', () => {
  let server: GameServer;

  beforeEach(() => {
    server = new GameServer();
  });

  it('reaches every peer in view on the next tick, in a FULL record', () => {
    const a = fakeWs();
    const b = fakeWs();
    joinServer(server, a, 1, 'Watcher', 'warrior', null);
    const other = joinServer(server, b, 2, 'Designed', 'mage', LOOK);
    broadcast(server);
    expect(lastSnap(a.sent).ents.find((e: any) => e.id === other.pid).app).toEqual(LOOK);

    // Settle, so the peer is emitting lite records and only a real identity
    // change can produce a full one. Without the baseIdJson half of the bust,
    // this is where the push dies.
    server.sim.tick();
    broadcast(server);
    a.sent.length = 0;

    expect(server.applyAppearanceForCharacter(2, REDESIGNED)).toBe(true);
    server.sim.tick();
    broadcast(server);

    const wire = lastSnap(a.sent).ents.find((e: any) => e.id === other.pid);
    expect(wire.k).toBe('player'); // a full record, so identity really moved
    expect(wire.app).toEqual(REDESIGNED);
  });

  it('reaches the owner own self record, which the entity list never carries', () => {
    const fc = fakeWs();
    joinServer(server, fc, 1, 'Designed', 'mage', LOOK);
    broadcast(server);
    expect(lastSnap(fc.sent).self.app).toEqual(LOOK);
    server.sim.tick();
    broadcast(server);
    expect(lastSnap(fc.sent).self).not.toHaveProperty('app'); // settled: omitted

    server.applyAppearanceForCharacter(1, REDESIGNED);
    fc.sent.length = 0;
    server.sim.tick();
    broadcast(server);
    // maybeRaw is a value diff, so the new look re-enters the delta channel.
    expect(lastSnap(fc.sent).self.app).toEqual(REDESIGNED);
  });

  it('re-mints the memo rather than re-sending the old string', () => {
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Designed', 'mage', LOOK);
    broadcast(server);
    const entityId = server.sim.entities.get(session.pid)!.id;
    const cache = (server as any).wireCache.get(entityId);
    expect(cache.appJson).toBe(JSON.stringify(LOOK)); // precondition: memoized

    server.applyAppearanceForCharacter(1, REDESIGNED);
    expect(cache.appJson).toBeNull(); // the memo is dropped...
    expect(cache.baseIdJson).toBe(''); // ...and so is the identity diff
    server.sim.tick();
    broadcast(server);
    expect(cache.appJson).toBe(JSON.stringify(REDESIGNED));
  });

  it('reports whether it found a live session at all', () => {
    // The route uses the return to decide whether the DB write is the whole
    // job: a character sitting on the roster has no session to push onto, and
    // that is not a failure.
    const fc = fakeWs();
    joinServer(server, fc, 1, 'Designed', 'mage', LOOK);
    expect(server.applyAppearanceForCharacter(1, REDESIGNED)).toBe(true);
    expect(server.applyAppearanceForCharacter(99, REDESIGNED)).toBe(false);
  });

  it('clears a look pushed to null, for peers AND for the owner', () => {
    const a = fakeWs();
    const b = fakeWs();
    joinServer(server, a, 1, 'Watcher', 'warrior', null);
    const other = joinServer(server, b, 2, 'Designed', 'mage', LOOK);
    broadcast(server);
    server.sim.tick();
    broadcast(server);
    b.sent.length = 0;
    a.sent.length = 0;

    server.applyAppearanceForCharacter(2, null);
    server.sim.tick();
    broadcast(server);

    // The peer reading: absence on a full record means no authored look.
    const wire = lastSnap(a.sent).ents.find((e: any) => e.id === other.pid);
    expect(wire.k).toBe('player');
    expect(wire).not.toHaveProperty('app');
    // The owner's: absence means "unchanged" there, so the clear has to be an
    // explicit null or the owner keeps wearing a body nobody is broadcasting.
    expect(lastSnap(b.sent).self.app).toBeNull();
  });
});

describe('a look saved during the linkdead grace window', () => {
  let server: GameServer;

  beforeEach(() => {
    server = new GameServer();
  });

  /** Drop the socket and reconnect the same character, the way ws_auth does:
   *  a fresh read of the row rides the resume meta. */
  function reconnect(
    characterId: number,
    session: ClientSession,
    meta: Record<string, unknown>,
  ): FakeClient {
    session.linkdead = true;
    const fc = fakeWs();
    const resumed = server.join(
      fc.ws,
      characterId,
      characterId,
      'Designed',
      'mage',
      null,
      false,
      meta as never,
    );
    if ('error' in resumed) throw new Error(resumed.error);
    resumed.blockListLoaded = true;
    return fc;
  }

  it('picks the new look up on resume, without waiting for a relog', () => {
    // The redesign route writes the row and pushes onto the live session, but a
    // player who is LINKDEAD has no session to push onto: the entity keeps the
    // join-time look, and the memo happily serves the stale string for the rest
    // of the session (wiping lastSent re-SENDS, but what it re-sends is the
    // memo). The resume arm is what closes that window.
    const fc = fakeWs();
    const session = joinServer(server, fc, 7, 'Designed', 'mage', LOOK);
    broadcast(server);
    const entityId = server.sim.entities.get(session.pid)!.id;

    const back = reconnect(7, session, { appearance: REDESIGNED });
    server.sim.tick();
    broadcast(server);

    expect(server.sim.entities.get(session.pid)!.modularAppearance).toEqual(REDESIGNED);
    expect((server as any).wireCache.get(entityId).appJson).toBe(JSON.stringify(REDESIGNED));
    expect(lastSnap(back.sent).self.app).toEqual(REDESIGNED);
  });

  it('keeps the session look when the caller supplies none (absent means keep)', () => {
    // ws_auth always supplies one, but an in-process or test caller passing
    // `{}` must not be read as "this character has no look".
    const fc = fakeWs();
    const session = joinServer(server, fc, 7, 'Designed', 'mage', LOOK);
    broadcast(server);

    reconnect(7, session, {});
    expect(server.sim.entities.get(session.pid)!.modularAppearance).toEqual(LOOK);
  });

  it('does not bust the memo for a look that only differs by object identity', () => {
    // The read is a fresh parse of a fresh row, so it is NEVER the same object
    // as the one on the entity: an identity check elided nothing and every
    // reconnect re-minted the string and re-shipped a full identity record to
    // everyone in view. The comparison is by value.
    const fc = fakeWs();
    const session = joinServer(server, fc, 7, 'Designed', 'mage', LOOK);
    broadcast(server);
    const entityId = server.sim.entities.get(session.pid)!.id;
    const memo = (server as any).wireCache.get(entityId).appJson;
    expect(memo).toBe(JSON.stringify(LOOK)); // precondition

    reconnect(7, session, { appearance: { ...LOOK } });
    expect((server as any).wireCache.get(entityId).appJson).toBe(memo);
  });
});
