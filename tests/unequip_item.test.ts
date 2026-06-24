import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function logText(events: SimEvent[]): string | undefined {
  const e = events.find((ev) => ev.type === 'log');
  return e && e.type === 'log' ? e.text : undefined;
}

describe('Sim.unequipItem', () => {
  it('moves an equipped piece back to bags, empties the slot, and recalcs stats', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Aleph');
    const meta = sim.players.get(pid)!;
    sim.tick();
    // give + equip a helmet (a slot a fresh warrior leaves empty)
    sim.addItem('cryptbone_helm', 1, pid);
    sim.equipItem('cryptbone_helm', pid);
    sim.tick();
    expect(meta.equipment.helmet).toBe('cryptbone_helm');
    expect(sim.countItem('cryptbone_helm', pid)).toBe(0);
    const armorEquipped = sim.entities.get(pid)!.stats.armor;

    const ok = sim.unequipItem('helmet', pid);
    const text = logText(sim.tick());

    expect(ok).toBe(true);
    expect(meta.equipment.helmet).toBeUndefined();
    expect(sim.countItem('cryptbone_helm', pid)).toBe(1);
    expect(sim.entities.get(pid)!.stats.armor).toBeLessThan(armorEquipped);
    expect(text).toMatch(/Unequipped/);
  });

  it('is a no-op for an empty slot', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    expect(sim.unequipItem('legs', pid)).toBe(false);
  });
});

describe('ClientWorld.unequipItem', () => {
  it('sends the unequip_item command with the slot', () => {
    const sent: unknown[] = [];
    const client: ClientWorld = Object.create(ClientWorld.prototype);
    Object.assign(client, {
      connected: true,
      ws: { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) },
    });
    (globalThis as any).WebSocket = { OPEN: 1 };

    client.unequipItem('helmet');

    expect(sent).toEqual([{ t: 'cmd', cmd: 'unequip_item', slot: 'helmet' }]);
  });
});
