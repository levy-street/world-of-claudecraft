import { describe, expect, it, vi } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

function clientRig(supported: boolean): {
  client: ClientWorld;
  sent: Array<Record<string, unknown>>;
} {
  const client = Object.create(ClientWorld.prototype) as ClientWorld;
  const harness = client as unknown as {
    playerId: number;
    petSpecialCommandsSupported: boolean;
    entities: Map<number, ReturnType<typeof createMob>>;
    cmd(payload: Record<string, unknown>): void;
  };
  const sent: Array<Record<string, unknown>> = [];
  harness.playerId = 1;
  harness.petSpecialCommandsSupported = supported;
  harness.entities = new Map();
  const pet = createMob(2, MOBS.gloomshade, 20, { x: 0, y: 0, z: 0 });
  pet.ownerId = 1;
  pet.petAutoSkill = true;
  harness.entities.set(pet.id, pet);
  harness.cmd = vi.fn((payload: Record<string, unknown>) => sent.push(payload));
  return { client, sent };
}

describe('ClientWorld Warlock pet-special commands', () => {
  it('sends the exact manual and boolean autocast payloads when negotiated', () => {
    const { client, sent } = clientRig(true);

    client.petSpecial();
    client.setPetAutoSpecial(false);
    client.setPetAutoSpecial(true);

    expect(sent).toEqual([
      { cmd: 'pet_special' },
      { cmd: 'pet_auto_special', enabled: false },
      { cmd: 'pet_auto_special', enabled: true },
    ]);
  });

  it('fails closed instead of sending inert commands to a legacy server', () => {
    const { client, sent } = clientRig(false);

    client.petSpecial();
    client.setPetAutoSpecial(false);

    expect(sent).toEqual([]);
  });

  it('clears the negotiated capability as soon as the transport closes', () => {
    const { client } = clientRig(true);
    const harness = client as unknown as {
      connected: boolean;
      sessionEnded: boolean;
      failPendingCommandOutcomes(): void;
      socketClosed(): void;
    };
    harness.connected = true;
    harness.sessionEnded = true;
    harness.failPendingCommandOutcomes = vi.fn();

    harness.socketClosed();

    expect(client.petSpecialCommandsSupported).toBe(false);
  });
});
