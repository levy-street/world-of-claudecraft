// Pending-target echo protection in the ONLINE mirror (ClientWorld, src/net/online.ts).
//
// The bug: `targetEntity` writes the optimistic targetId locally for snappy UI, then
// sends the 'target' wire command. At click time a snapshot the server generated
// BEFORE processing that command is nearly always already in flight; when it arrives
// it still carries the OLD target and clobbers the optimistic value, and the echo
// restores it a round trip later. The HUD derives both the target frame and the
// party-frames below-target push from this mirrored targetId, so the player sees the
// previous target come back for a moment (the select bounce). Same display-only-
// optimism idiom as `pendingQuestCommands` / src/net/quest_state_optimistic.ts: the
// server stays authoritative, this only changes which value the mirror DISPLAYS
// while the command is in flight.
//
// The release signal is the input ack: the 'target' command carries `seq` drawn
// from the same counter as the movement frames, server/game.ts folds it into the
// one `lastInputSeq` the self snapshot echoes as `self.ack`, and a snapshot whose
// ack covers the seq was built after the command (its target field is the verdict,
// echo or refusal). The pure decision core is src/net/target_echo.ts
// (tests/target_echo_core.test.ts); this suite pins the ClientWorld wiring.
//
// Wire shapes pinned here follow server/game.ts: the self record is a full
// wireEntity (which emits `tgt` only when the target is non-null) plus the precise
// `target` self field (always present, null when untargeted) and `ack`.

import { describe, expect, it, vi } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { TARGET_ECHO_SNAPSHOT_BUDGET } from '../src/net/target_echo';

// --- harness: a real ClientWorld, DOM/network-free (mirrors account_flair_client.test.ts) ---

// Every stub socket created in this file appends what it sends here, so a test can
// pin the wire shape of the command a call produced.
const sentFrames: Record<string, unknown>[] = [];

class StubWebSocket {
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = StubWebSocket.OPEN;
  bufferedAmount = 0;
  constructor(public readonly url: string) {}
  send(data: string): void {
    sentFrames.push(JSON.parse(data));
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
  sentFrames.length = 0;
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
// wireEntity `tgt` key rides only when non-null. `ack` is the server's input
// high-water at build time; a snapshot built BEFORE a command carries an ack
// below that command's seq (the stale in-flight case), one built after covers it.
function snap(
  serverTarget: number | null,
  ack: number | undefined = undefined,
  extraSelf: Record<string, unknown> = {},
): unknown {
  const self: Record<string, unknown> = { target: serverTarget, ...extraSelf };
  if (serverTarget !== null) self.tgt = serverTarget;
  if (ack !== undefined) self.ack = ack;
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

const targetCommands = (): Record<string, unknown>[] =>
  sentFrames.filter((f) => f.t === 'cmd' && f.cmd === 'target');

describe('ClientWorld pending-target echo protection', () => {
  it("the 'target' command carries a seq drawn from the input seq counter", () => {
    const { world } = seededWorld();
    world.targetEntity(77);
    world.targetEntity(null);
    expect(targetCommands()).toEqual([
      { t: 'cmd', cmd: 'target', id: 77, seq: 1 },
      { t: 'cmd', cmd: 'target', id: null, seq: 2 },
    ]);

    // Movement frames continue the same counter, so the server-side high-water
    // never sees a hole (server/input_seq.ts books a hole as a lost frame).
    world.setMoveInput({ forward: true });
    world.flushInput(1000);
    const input = sentFrames.find((f) => f.t === 'input');
    expect(input?.seq).toBe(3);
  });

  it('REPRODUCTION: a stale in-flight snapshot does not clobber the optimistic target', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77);
    expect(selfTarget(world)).toBe(77);

    // The snapshot the server generated before it processed the command: still
    // carries the old target (the explicit-null form selfWireJson emits) and an
    // ack that predates the command.
    wire.applySnapshot(snap(null, 0));
    expect(selfTarget(world)).toBe(77);
  });

  it('REPRODUCTION (the bounce): a long round trip never shows the PREVIOUS target again', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77);
    wire.applySnapshot(snap(77, 1)); // confirmed 77

    // The player clicks 88. With the server 300 ms away and self snapshots every
    // 50 ms, six pre-command snapshots still saying 77 arrive first. The old
    // three-snapshot budget adopted 77 on the third one: 88 -> 77 -> 88.
    world.targetEntity(88);
    expect(selfTarget(world)).toBe(88);
    for (let i = 0; i < 6; i++) {
      wire.applySnapshot(snap(77, 1));
      expect(selfTarget(world)).toBe(88);
    }

    // The first post-command snapshot (its ack covers seq 2) is the echo.
    wire.applySnapshot(snap(88, 2));
    expect(selfTarget(world)).toBe(88);
    // ...and normal mirroring has resumed.
    wire.applySnapshot(snap(null, 2));
    expect(selfTarget(world)).toBeNull();
  });

  it('holds the optimistic target through a stale snapshot whose target field is absent', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77);

    wire.applySnapshot({ t: 'snap', ents: [playerWire(77, 'Rival')], self: playerWire(1, 'Me') });
    expect(selfTarget(world)).toBe(77);
  });

  it('echo confirm: the acked snapshot clears the hold, and a LATER null applies normally', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77);

    wire.applySnapshot(snap(77, 1));
    expect(selfTarget(world)).toBe(77);

    // Server-initiated clear after confirmation (target died, out of interest):
    // must apply from this very snapshot, no lingering hold.
    wire.applySnapshot(snap(null, 1));
    expect(selfTarget(world)).toBeNull();
  });

  it('refusal: the first acked snapshot wins for the server at once, no budget wait', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77);
    wire.applySnapshot(snap(77, 1)); // confirmed 77

    // The click on 88 is refused server-side (dead, invalid, out of interest):
    // the post-command snapshot still says 77, and that is what shows.
    world.targetEntity(88);
    wire.applySnapshot(snap(77, 1));
    expect(selfTarget(world)).toBe(88);
    wire.applySnapshot(snap(77, 2));
    expect(selfTarget(world)).toBe(77);
  });

  it('reconcile valve: a command nothing ever acks yields to the server after the budget', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77);

    // No ack ever covers seq 1 (the command never reached a folding server).
    // The valve is the only release left, and it is sized in seconds, not in
    // round trips, so it never fires under a slow but live link.
    for (let i = 1; i < TARGET_ECHO_SNAPSHOT_BUDGET; i++) {
      wire.applySnapshot(snap(null, 0));
      expect(selfTarget(world)).toBe(77);
    }
    wire.applySnapshot(snap(null, 0));
    expect(selfTarget(world)).toBeNull();
  });

  it('deselect: a stale snapshot cannot resurrect the old target, and the acked null confirms', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77);
    wire.applySnapshot(snap(77, 1)); // confirmed

    world.targetEntity(null);
    expect(selfTarget(world)).toBeNull();

    // Stale in-flight snapshot still carrying 77: must not resurrect it.
    wire.applySnapshot(snap(77, 1));
    expect(selfTarget(world)).toBeNull();

    // The acked null echo confirms the deselect...
    wire.applySnapshot(snap(null, 2));
    expect(selfTarget(world)).toBeNull();

    // ...and normal mirroring resumes: a later server-set target applies.
    wire.applySnapshot(snap(77, 2));
    expect(selfTarget(world)).toBe(77);
  });

  it('supersede: a newer targetEntity call wins; the older echo must not confirm', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77);
    world.targetEntity(88);
    expect(selfTarget(world)).toBe(88);

    // The echo of the SUPERSEDED command (ack covers seq 1 only): not a
    // confirmation, the optimistic 88 stays.
    wire.applySnapshot(snap(77, 1));
    expect(selfTarget(world)).toBe(88);

    // The echo of the live command confirms.
    wire.applySnapshot(snap(88, 2));
    expect(selfTarget(world)).toBe(88);

    // And normal mirroring has resumed.
    wire.applySnapshot(snap(null, 2));
    expect(selfTarget(world)).toBeNull();
  });

  it('supersede back to the same id: the intermediate echo never shows through', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77);
    wire.applySnapshot(snap(77, 1)); // confirmed 77

    // 77 -> 88 -> 77 in quick succession. The snapshot built between the two
    // commands says 88; it must not bounce the frame off 77.
    world.targetEntity(88);
    world.targetEntity(77);
    expect(selfTarget(world)).toBe(77);
    wire.applySnapshot(snap(77, 1)); // pre-both (same id as the live optimistic value)
    expect(selfTarget(world)).toBe(77);
    wire.applySnapshot(snap(88, 2)); // between the two
    expect(selfTarget(world)).toBe(77);
    wire.applySnapshot(snap(77, 3)); // the live command's echo
    expect(selfTarget(world)).toBe(77);
    wire.applySnapshot(snap(null, 3));
    expect(selfTarget(world)).toBeNull();
  });

  for (const retarget of [
    'tabTarget',
    'tabTargetPrev',
    'targetNearestFriendly',
    'friendlyTabTarget',
  ] as const) {
    it(`server-resolved retarget (${retarget}) clears the hold: its result applies from the next snapshot`, () => {
      const { world, wire } = seededWorld();
      world.targetEntity(77);
      world[retarget]();

      // The server resolves the retarget to 88; even though the stale pending 77
      // was never acked, it must apply immediately (pending was cleared).
      wire.applySnapshot(snap(88, 0));
      expect(selfTarget(world)).toBe(88);
    });
  }

  // The count pins in command_schema re-derive the send set from source, which
  // cannot say WHICH method emits a token. Pin the backward cycle's own send so
  // a swapped or copy-pasted token on this method reds here.
  it('tabTargetPrev sends the tabPrev token, distinct from tabTarget', () => {
    const { world } = seededWorld();
    const cmd = vi.spyOn(world as unknown as { cmd: (m: unknown) => void }, 'cmd');

    world.tabTargetPrev();
    expect(cmd).toHaveBeenCalledWith({ cmd: 'tabPrev' });

    cmd.mockClear();
    world.tabTarget();
    expect(cmd).toHaveBeenCalledWith({ cmd: 'tab' });
  });

  it('a refused local pre-check (unknown entity) arms no hold: the next snapshot applies as before', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77);
    wire.applySnapshot(snap(77, 1)); // confirmed 77

    // Unknown id: the optimistic write is refused (display keeps 77), the command
    // still goes out (with its seq), and NO pending echo is armed for it.
    world.targetEntity(999);
    expect(selfTarget(world)).toBe(77);
    expect(targetCommands().at(-1)).toEqual({ t: 'cmd', cmd: 'target', id: 999, seq: 2 });

    // So the very next snapshot applies unconditionally, stale ack or not.
    wire.applySnapshot(snap(null, 1));
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
    wire.applySnapshot(snap(null, 0));
    expect(selfTarget(world)).toBeNull();

    // The seq counter restarted with the transport, in step with the server's
    // zeroed high-water.
    sentFrames.length = 0;
    world.targetEntity(77);
    expect(targetCommands().at(-1)).toEqual({ t: 'cmd', cmd: 'target', id: 77, seq: 1 });
  });

  it('spectate: targetEntity arms no hold and draws no seq (cmd() drops the command)', () => {
    const { world, wire } = seededWorld();
    wire.onMessage(JSON.stringify({ t: 'spectate', name: 'Watched' }));
    // While spectating, the mirrored "self" is the spectated player (playerId
    // rebinds from snap.self); their record must stay server-authoritative.
    wire.applySnapshot(snap(null, 0));
    sentFrames.length = 0;

    world.targetEntity(77);
    expect(targetCommands()).toEqual([]);

    // No hold was armed, so the spectated player's authoritative (null) target
    // applies from the very next snapshot, no shadow.
    wire.applySnapshot(snap(null, 0));
    expect(selfTarget(world)).toBeNull();
  });

  it('spectate: the spectate swap drops a hold armed for the previous identity', () => {
    const { world, wire } = seededWorld();
    world.targetEntity(77); // hold armed pre-swap

    wire.onMessage(JSON.stringify({ t: 'spectate', name: 'Watched' }));

    // The next snapshot's value applies immediately: the pre-swap hold must not
    // shadow the spectated player's target for the budget window.
    wire.applySnapshot(snap(null, 0));
    expect(selfTarget(world)).toBeNull();
  });
});
