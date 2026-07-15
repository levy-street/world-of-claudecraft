import { describe, expect, it, vi } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { emptyAllocation, rowForLevel } from '../src/sim/content/talents';

function bareClient(): ClientWorld {
  const client = Object.create(ClientWorld.prototype) as ClientWorld;
  client.talents = emptyAllocation();
  client.loadouts = [];
  client.activeLoadout = -1;
  (client as any).cmd = vi.fn();
  return client;
}

function snapshotClient(): any {
  const client: any = bareClient();
  client.cfg = { seed: 20061, playerClass: 'warrior' };
  client.entities = new Map();
  client.playerId = 1;
  client.moveInput = {};
  client.inventory = [];
  client.equipment = {};
  client.copper = 0;
  client.xp = 0;
  client.known = [];
  client.questLog = new Map();
  client.questsDone = new Set();
  client.lastSnapAt = 0;
  client.snapInterval = 50;
  client.pendingFacingDelta = 0;
  client.connected = true;
  client.eventQueue = [];
  client.mouselookFacing = null;
  return client;
}

function selfWire(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    k: 'player',
    tid: 'warrior',
    nm: 'Tank',
    lv: 20,
    x: 0,
    y: 0,
    z: 0,
    f: 0,
    hp: 100,
    mhp: 100,
    res: 0,
    mres: 100,
    rtype: 'rage',
    xp: 0,
    copper: 0,
    inv: [],
    equip: {},
    qlog: [],
    qdone: [],
    cds: {},
    gcd: 0,
    stats: { str: 1, agi: 1, sta: 1, int: 1, spi: 1, armor: 0 },
    weapon: { min: 1, max: 2, speed: 2 },
    ...over,
  };
}

describe('ClientWorld Talent V2 authority boundary', () => {
  it('sends canonical row selection without mutating the mirrored allocation', () => {
    const client = bareClient();
    const optionId = rowForLevel('warrior', 5)!.options[0].id;

    client.selectTalentRow(5, optionId);

    expect((client as any).cmd).toHaveBeenCalledWith({
      cmd: 'selectTalentRow',
      level: 5,
      optionId,
    });
    expect(client.talents).toEqual({ spec: null, rows: {} });
  });

  it('does not optimistically save or delete loadouts before a server snapshot', () => {
    const client = bareClient();
    const mirrored = {
      name: 'Server build',
      alloc: { spec: 'arms', rows: {} },
      bar: ['charge'],
    };
    client.loadouts = [mirrored];
    client.activeLoadout = 0;

    client.saveLoadout('New build', [], { spec: 'fury', rows: {} });
    client.deleteLoadout(0);

    expect(client.loadouts).toEqual([mirrored]);
    expect(client.activeLoadout).toBe(0);
    expect(client.talents).toEqual({ spec: null, rows: {} });
    expect((client as any).cmd).toHaveBeenNthCalledWith(1, {
      cmd: 'saveLoadout',
      name: 'New build',
      bar: [],
      alloc: { spec: 'fury', rows: {} },
    });
    expect((client as any).cmd).toHaveBeenNthCalledWith(2, {
      cmd: 'deleteLoadout',
      index: 0,
    });
  });

  it('normalizes only canonical allocation snapshots and derives spec and role from them', () => {
    const client = snapshotClient();
    const optionId = rowForLevel('warrior', 5)!.options[0].id;

    client.applySnapshot({
      t: 'snap',
      tick: 1,
      time: 0,
      ents: [],
      self: selfWire({
        tal: {
          alloc: { spec: 'fury', rows: { 5: optionId } },
          loadouts: [{ name: 'Fury', alloc: { spec: 'fury', rows: { 5: optionId } }, bar: [] }],
          activeLoadout: 0,
        },
      }),
    });

    expect(client.talents).toEqual({ spec: 'fury', rows: { 5: optionId } });
    expect(client.talentSpec).toBe('fury');
    expect(client.talentRole).toBe('dps');
    expect(client.activeLoadout).toBe(0);

    client.applySnapshot({
      t: 'snap',
      tick: 2,
      time: 0.05,
      ents: [],
      self: selfWire({ tal: { alloc: { spec: 'arms', ranks: {}, choices: {} } } }),
    });
    expect(client.talents).toEqual({ spec: 'fury', rows: { 5: optionId } });
  });
});
