import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';

// The spectate EXIT frame reaches the client before the snapshot that rebuilds
// the moderator's own ability presentation. IWorld.spectating is the HUD's
// "this self view is mine" signal (the action bar freezes on it), so the
// ClientWorld holds the exit until its own self-decode has run.

class StubWebSocket {
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = StubWebSocket.OPEN;
  constructor(public readonly url: string) {}
  send(): void {}
  close(): void {}
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

function playerWire(id: number, nm: string, tid: string): Record<string, unknown> {
  return { id, k: 'player', tid, nm, lv: 20, x: 0, y: 0, z: 0, f: 0, hp: 100, mhp: 100 };
}

function makeWorld(): { world: ClientWorld; wire: ClientInternals } {
  const world = withDomStubs(() => {
    const w = new ClientWorld('spectate-hold-token', 1, 'warrior', 'http://localhost');
    w.close();
    return w;
  });
  const wire = world as unknown as ClientInternals;
  wire.onMessage(JSON.stringify({ t: 'hello', pid: 1, seed: 20061 }));
  wire.applySnapshot({ t: 'snap', ents: [], self: playerWire(1, 'Me', 'warrior') });
  return { world, wire };
}

const knownIds = (world: ClientWorld): string[] => world.known.map((k) => k.def.id);

describe('ClientWorld spectate exit hold', () => {
  it('enters spectate on the frame itself and mirrors the watched kit from the next snapshot', () => {
    const { world, wire } = makeWorld();
    const ownKit = knownIds(world);
    expect(ownKit).toContain('heroic_strike');

    wire.onMessage(JSON.stringify({ t: 'spectate', name: 'Watched' }));
    expect(world.spectating).toBe('Watched');

    wire.applySnapshot({ t: 'snap', ents: [], self: playerWire(2, 'Watched', 'mage') });
    expect(world.playerId).toBe(2);
    expect(world.cfg.playerClass).toBe('mage');
    expect(knownIds(world)).not.toContain('heroic_strike');
  });

  it('holds spectating through the exit frame until the own presentation is rebuilt', () => {
    const { world, wire } = makeWorld();
    wire.onMessage(JSON.stringify({ t: 'spectate', name: 'Watched' }));
    wire.applySnapshot({ t: 'snap', ents: [], self: playerWire(2, 'Watched', 'mage') });

    wire.onMessage(JSON.stringify({ t: 'spectate', name: null }));
    // The body and class are back, but known still describes the mage: the
    // HUD must keep reading this frame as "not my view".
    expect(world.playerId).toBe(1);
    expect(world.cfg.playerClass).toBe('warrior');
    expect(knownIds(world)).not.toContain('heroic_strike');
    expect(world.spectating).toBe('Watched');

    wire.applySnapshot({ t: 'snap', ents: [], self: playerWire(1, 'Me', 'warrior') });
    expect(world.spectating).toBeNull();
    expect(knownIds(world)).toContain('heroic_strike');
  });

  it('a reconnect hello clears the hold with the rest of the spectate swap', () => {
    const { world, wire } = makeWorld();
    wire.onMessage(JSON.stringify({ t: 'spectate', name: 'Watched' }));
    wire.applySnapshot({ t: 'snap', ents: [], self: playerWire(2, 'Watched', 'mage') });
    wire.onMessage(JSON.stringify({ t: 'spectate', name: null }));

    wire.reconnectAttempts = 1;
    wire.onMessage(JSON.stringify({ t: 'hello', pid: 1, seed: 20061 }));
    expect(world.spectating).toBeNull();
    wire.applySnapshot({ t: 'snap', ents: [], self: playerWire(1, 'Me', 'warrior') });
    expect(world.spectating).toBeNull();
  });
});
