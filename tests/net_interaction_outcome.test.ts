import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientWorld } from '../src/net/online';

function rig(connected = true) {
  const sent: string[] = [];
  const world: any = Object.create(ClientWorld.prototype);
  world.connected = connected;
  world.spectating = null;
  world.ws = {
    readyState: connected ? WebSocket.OPEN : WebSocket.CLOSED,
    send: (payload: string) => sent.push(payload),
  };
  world.moveInput = {};
  world.pendingInputSeqSentAt = new Map();
  world.inputEchoSamples = [];
  world.reconnectAttempts = 0;
  world.sessionEnded = false;
  return { world, sent };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ClientWorld interaction outcomes', () => {
  it('resolves an interaction from the matching server outcome', async () => {
    const { world, sent } = rig();

    const outcome = world.pickUpObject(7);
    const command = JSON.parse(sent[0]) as { t: string; cmd: string; id: number; rid: number };
    expect(command).toMatchObject({ t: 'cmd', cmd: 'pickup', id: 7 });
    expect(Number.isSafeInteger(command.rid)).toBe(true);

    world.onMessage(JSON.stringify({ t: 'commandOutcome', rid: command.rid, ok: false }));

    await expect(outcome).resolves.toBe(false);
  });

  it('rejects locally when the command cannot be sent', async () => {
    const { world, sent } = rig(false);

    await expect(world.harvestNode('ore_1')).resolves.toBe(false);
    expect(sent).toEqual([]);
  });

  it('rejects locally while spectating', async () => {
    const { world, sent } = rig();
    world.spectating = 'Someone Else';

    await expect(world.delveInteract(9)).resolves.toBe(false);
    expect(sent).toEqual([]);
  });

  it('rejects an already pending interaction when the socket closes', async () => {
    const { world } = rig();
    const outcome = world.pickUpObject(7);
    world.sessionEnded = true;

    world.socketClosed();

    await expect(outcome).resolves.toBe(false);
  });

  it('rejects an already pending interaction when spectate starts', async () => {
    const { world } = rig();
    const outcome = world.harvestNode('ore_1');

    world.onMessage(JSON.stringify({ t: 'spectate', name: 'Someone Else' }));

    await expect(outcome).resolves.toBe(false);
  });

  it('rejects an interaction whose server outcome times out', async () => {
    vi.useFakeTimers();
    const { world } = rig();
    const outcome = world.delveInteract(9);

    await vi.advanceTimersByTimeAsync(5000);

    await expect(outcome).resolves.toBe(false);
  });
});
