// Pending-target echo protection in the ONLINE mirror (ClientWorld, src/net/online.ts).
//
// The bug: `targetEntity` writes the optimistic targetId locally for snappy UI, then
// sends the 'target' wire command. At click time a snapshot the server generated
// BEFORE processing that command is nearly always already in flight; when it arrives
// it still carries the OLD target (usually null) and clobbers the optimistic value,
// and the next snapshot restores it. The HUD derives both the target frame and the
// party-frames below-target push from this mirrored targetId, so both blink
// on-off-on (the select flicker). Same display-only-optimism idiom as
// `pendingQuestCommands` / src/net/quest_state_optimistic.ts: the server stays
// authoritative, this only changes which value the mirror DISPLAYS while the
// command is in flight.
//
// Wire shapes pinned here follow server/game.ts: the self record is a full
// wireEntity (which emits `tgt` only when the target is non-null) plus the precise
// `target` self field (always present, null when untargeted).

import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';

// --- harness: a real ClientWorld, DOM/network-free (mirrors account_flair_client.test.ts) ---

class StubWebSocket {
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = StubWebSocket.OPEN;
  constructor(public readonly url: string) {}
  send(): void {
    /* no-op: these tests never assert on sends */
  }
  close(): void {
    /* no-op: there is no real socket */
  }
}

function withDomStubs<T>(fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const prevWebSocket = g.WebSocket;
  const prevWindow = g.window;
  g.WebSocket = StubWebSocket as unknown;
  g.window = { setInterval: () => 0, clearInterval: () => undefined };
  try {
    return fn();
  } finally {
    g.WebSocket = prevWebSocket;
    g.window = prevWindow;
  }
}

interface ClientInternals {
  applySnapshot(snap: unknown): void;
  onMessage(raw: string): void;
  reconnectAttempts: number;
}

function makeWorld(): { world: ClientWorld; wire: ClientInternals } {
  const world = withDomStubs(() => {
    const w = new ClientWorld('target-echo-token', 1, 'warrior', 'http://localhost');
    w.close();
    return w;
  });
  const wire = world as unknown as ClientInternals;
  // The production join flow: hello binds playerId (targetEntity's optimistic
  // write resolves the self entity through it) before the first snapshot.
  wire.onMessage(JSON.stringify({ t: 'hello', pid: 1, seed: 20061 }));
  return { world, wire };
}

// A full (identity-bearing) player record, the shape server/game.ts wireEntity emits.
function playerWire(id: number, nm: string, extra: Record<string, unknown> = {}): unknown {
  return {
    id,
    k: 'player',
    tid: 'mage',
    nm,
    lv: 12,
    x: 0,
    y: 0,
    z: 0,
    f: 0,
    hp: 100,
    mhp: 100,
    ...extra,
  };
}

// One snapshot as the server broadcasts it: a second player in interest plus the
// self record. `serverTarget` mirrors server/game.ts selfWireJson exactly: the
// precise `target` self field always rides (null when untargeted), and the
// wireEntity `tgt` key rides only when non-null.
function snap(serverTarget: number | null, extraSelf: Record<string, unknown> = {}): unknown {
  const self: Record<string, unknown> = { target: serverTarget, ...extraSelf };
  if (serverTarget !== null) self.tgt = serverTarget;
  return {
    t: 'snap',
    ents: [playerWire(77, 'Rival'), playerWire(88, 'Bystander')],
    self: playerWire(1, 'Me', self),
  };
}

// Seed the mirror: self plus two selectable players, nothing targeted.
function seededWorld(): { world: ClientWorld; wire: ClientInternals } {
  const { world, wire } = makeWorld();
  wire.applySnapshot(snap(null));
  expect(world.entities.get(1)?.targetId).toBeNull();
  return { world, wire };
}

const selfTarget = (world: ClientWorld): number | null => world.entities.get(1)?.targetId ?? null;

describe('ClientWorld pending-target echo protection', () => {
  it('REPRODUCTION: a stale in-flight snapshot does not clobber the optimistic target', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77);
    expect(selfTarget(world)).toBe(77);

    // The snapshot the server generated before it processed the command: still
    // carries the old target (the explicit-null form selfWireJson emits).
    wire.applySnapshot(snap(null));
    expect(selfTarget(world)).toBe(77);
  });

  it('holds the optimistic target through a stale snapshot whose target field is absent', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77);

    wire.applySnapshot({ t: 'snap', ents: [playerWire(77, 'Rival')], self: playerWire(1, 'Me') });
    expect(selfTarget(world)).toBe(77);
  });

  it('echo confirm: the matching snapshot clears the hold, and a LATER null applies normally', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77);

    wire.applySnapshot(snap(77));
    expect(selfTarget(world)).toBe(77);

    // Server-initiated clear after confirmation (target died, out of interest):
    // must apply from this very snapshot, no lingering hold.
    wire.applySnapshot(snap(null));
    expect(selfTarget(world)).toBeNull();
  });

  it('reconcile valve: a never-echoed command yields to the server after 3 self snapshots', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77);

    // Budget is 3 self snapshots (pinned): the first two stale snapshots hold
    // the optimistic value, the third adopts the server value. This is how a
    // server REFUSAL (invalid, dead, out-of-interest target) still wins.
    wire.applySnapshot(snap(null));
    expect(selfTarget(world)).toBe(77);
    wire.applySnapshot(snap(null));
    expect(selfTarget(world)).toBe(77);
    wire.applySnapshot(snap(null));
    expect(selfTarget(world)).toBeNull();
  });

  it('deselect: a stale snapshot cannot resurrect the old target, and a null echo confirms', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77);
    wire.applySnapshot(snap(77)); // confirmed

    world.targetEntity(null);
    expect(selfTarget(world)).toBeNull();

    // Stale in-flight snapshot still carrying 77: must not resurrect it.
    wire.applySnapshot(snap(77));
    expect(selfTarget(world)).toBeNull();

    // The null echo confirms the deselect...
    wire.applySnapshot(snap(null));
    expect(selfTarget(world)).toBeNull();

    // ...and normal mirroring resumes: a later server-set target applies.
    wire.applySnapshot(snap(77));
    expect(selfTarget(world)).toBe(77);
  });

  it('supersede: a newer targetEntity call wins; the older echo must not confirm', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77);
    world.targetEntity(88);
    expect(selfTarget(world)).toBe(88);

    // The echo of the SUPERSEDED command: not a confirmation, the optimistic 88 stays.
    wire.applySnapshot(snap(77));
    expect(selfTarget(world)).toBe(88);

    // The echo of the live command confirms.
    wire.applySnapshot(snap(88));
    expect(selfTarget(world)).toBe(88);

    // And normal mirroring has resumed.
    wire.applySnapshot(snap(null));
    expect(selfTarget(world)).toBeNull();
  });

  for (const retarget of ['tabTarget', 'targetNearestFriendly', 'friendlyTabTarget'] as const) {
    it(`server-resolved retarget (${retarget}) clears the hold: its result applies from the next snapshot`, () => {
      const { world, wire } = seededWorld();
      world.targetEntity(77);
      world[retarget]();

      // The server resolves the retarget to 88; even though it does not match
      // the stale pending 77, it must apply immediately (pending was cleared).
      wire.applySnapshot(snap(88));
      expect(selfTarget(world)).toBe(88);
    });
  }

  it('a refused local pre-check (unknown entity) arms no hold: the next snapshot applies as before', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77);
    wire.applySnapshot(snap(77)); // confirmed 77

    // Unknown id: the optimistic write is refused (display keeps 77), the command
    // still goes out, and NO pending echo is armed for it.
    world.targetEntity(999);
    expect(selfTarget(world)).toBe(77);

    // So the very next snapshot applies unconditionally, no 3-snapshot hold.
    wire.applySnapshot(snap(null));
    expect(selfTarget(world)).toBeNull();
  });

  it('reconnect: the post-reconnect hello drops any in-flight hold with the other transient state', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77);

    // Simulate the auto-reconnect arm: hello with reconnectAttempts > 0 runs the
    // per-session transient reset (input acking, interest, and this hold).
    wire.reconnectAttempts = 1;
    wire.onMessage(JSON.stringify({ t: 'hello', pid: 1, seed: 20061 }));

    // The server resends the world from scratch; its value applies immediately.
    wire.applySnapshot(snap(null));
    expect(selfTarget(world)).toBeNull();
  });

  it('spectate: targetEntity arms no hold (cmd() drops the command, no echo could release it)', () => {
    const { world, wire } = seededWorld();
    wire.onMessage(JSON.stringify({ t: 'spectate', name: 'Watched' }));
    // While spectating, the mirrored "self" is the spectated player (playerId
    // rebinds from snap.self); their record must stay server-authoritative.
    wire.applySnapshot(snap(null));

    world.targetEntity(77);

    // No hold was armed, so the spectated player's authoritative (null) target
    // applies from the very next snapshot, no 3-snapshot shadow.
    wire.applySnapshot(snap(null));
    expect(selfTarget(world)).toBeNull();
  });

  it('spectate: the spectate swap drops a hold armed for the previous identity', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77); // hold armed pre-swap

    wire.onMessage(JSON.stringify({ t: 'spectate', name: 'Watched' }));

    // The next snapshot's value applies immediately: the pre-swap hold must not
    // shadow the spectated player's target for the budget window.
    wire.applySnapshot(snap(null));
    expect(selfTarget(world)).toBeNull();
  });
});
