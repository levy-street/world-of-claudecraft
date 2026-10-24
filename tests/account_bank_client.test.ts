// ClientWorld's Other characters wiring: a plain bank visit lists the roster
// and reads no other character's bank; the tab's request opens the remembered
// (or first) one once; one roster read is in flight at a time; and a refusing
// remembered character stops being reopened.
import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';

class StubWebSocket {
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = StubWebSocket.OPEN;
  constructor(public readonly url: string) {}
  send(): void {
    /* sends are captured by patching cmd() below */
  }
  close(): void {
    /* no real socket */
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
  onMessage(raw: string): void;
  cmd(payload: { cmd: string } & Record<string, unknown>): void;
}

function makeWorld() {
  const world = withDomStubs(() => {
    const w = new ClientWorld('account-bank-token', 1, 'warrior', 'http://localhost');
    w.close();
    return w;
  });
  const wire = world as unknown as ClientInternals;
  const sent: Record<string, unknown>[] = [];
  wire.cmd = (payload) => {
    sent.push(payload);
  };
  return { world, wire, sent };
}

const characters = [
  { characterId: 2, name: 'Alice' },
  { characterId: 3, name: 'Bram' },
];
const reply = (info: Record<string, unknown>) =>
  JSON.stringify({
    t: 'account_bank',
    info: { characters, selectedCharacterId: null, bank: null, ...info },
  });

describe('ClientWorld other character banks', () => {
  it('reads no other bank on a plain visit and opens one only for the tab', () => {
    const { world, wire, sent } = makeWorld();
    world.requestAccountBanks();
    wire.onMessage(reply({}));
    expect(sent.map((p) => p.cmd)).toEqual(['account_bank_list']);
    world.requestAccountBanks(true);
    wire.onMessage(reply({}));
    expect(sent.slice(1)).toEqual([
      { cmd: 'account_bank_list' },
      { cmd: 'account_bank_select', characterId: 2 },
    ]);
    // The select's own reply names a selection: no second read.
    wire.onMessage(reply({ selectedCharacterId: 2, error: 'online' }));
    expect(sent).toHaveLength(3);
  });

  it('arms the in-flight roster read instead of sending a second one', () => {
    const { world, wire, sent } = makeWorld();
    world.requestAccountBanks();
    world.requestAccountBanks(true);
    expect(sent.map((p) => p.cmd)).toEqual(['account_bank_list']);
    wire.onMessage(reply({}));
    expect(sent.at(-1)).toEqual({ cmd: 'account_bank_select', characterId: 2 });
  });

  it('reopens the remembered bank, and forgets it once it refuses', () => {
    const { world, wire, sent } = makeWorld();
    world.selectAccountBank(3);
    world.requestAccountBanks(true);
    wire.onMessage(reply({}));
    expect(sent.at(-1)).toEqual({ cmd: 'account_bank_select', characterId: 3 });
    wire.onMessage(reply({ selectedCharacterId: 3, error: 'online' }));
    world.requestAccountBanks(true);
    wire.onMessage(reply({}));
    expect(sent.at(-1)).toEqual({ cmd: 'account_bank_select', characterId: 2 });
  });
});
