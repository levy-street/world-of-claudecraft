import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import {
  snapshotTimerWireMode,
  stableCooldownRemaining,
  stableDeadlineRemaining,
} from '../src/net/snapshot_timer_wire';
import type { PlayerClass } from '../src/sim/types';

function bareClient(pid: number, playerClass: PlayerClass = 'warrior'): ClientWorld {
  const client: any = Object.create(ClientWorld.prototype);
  client.cfg = { seed: 20061, playerClass };
  client.entities = new Map();
  client.playerId = pid;
  client.ownPlayerId = pid;
  client.ownPlayerClass = playerClass;
  client.spectating = null;
  client.cupInfo = null;
  client.sportRole = null;
  client.moveInput = {};
  client.inventory = [];
  client.vendorBuyback = [];
  client.equipment = {};
  client.accountCosmetics = { completedQuestIds: [], mechChromaIds: [] };
  client.copper = 0;
  client.honor = 0;
  client.lifetimeHonor = 0;
  client.xp = 0;
  client.known = [];
  client.questLog = new Map();
  client.questsDone = new Set();
  client.pendingQuestCommands = new Map();
  client.partyInfo = null;
  client.selectedDungeonDifficulty = 'normal';
  client.tradeInfo = null;
  client.duelInfo = null;
  client.lastSnapAt = 0;
  client.snapInterval = 50;
  client.serverTickHz = null;
  client.missingSince = new Map();
  client.pendingFacingDelta = 0;
  client.connected = true;
  client.eventQueue = [];
  client.mouselookFacing = null;
  client.lastInputSentAt = 0;
  client.lastInputSig = '';
  client.inputSeq = 0;
  client.pendingInputSeqSentAt = new Map();
  client.ackedInputSeq = 0;
  client.inputEchoSamples = [];
  client.spectateFacingPending = false;
  client.pendingSpectateFacing = null;
  client.nodeCooldowns = new Map();
  return client;
}

function playerWire(id: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    k: 'player',
    tid: 'warrior',
    nm: `Player${id}`,
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
    ...extra,
  };
}

function apply(client: ClientWorld, snapshot: Record<string, unknown>): void {
  (client as unknown as { applySnapshot(value: unknown): void }).applySnapshot({
    t: 'snap',
    tick: 1,
    ents: [],
    ...snapshot,
  });
}

const aura = (id: string, timer: Record<string, number>): Record<string, unknown> => ({
  id,
  name: id,
  kind: 'buff_ap',
  dur: 10,
  ...timer,
});

describe('stable snapshot timer protocol', () => {
  it('negotiates exact v2 only and decodes named cooldown schedules', () => {
    expect(snapshotTimerWireMode(undefined)).toBe('legacy');
    expect(snapshotTimerWireMode(2)).toBe('stable');
    expect(snapshotTimerWireMode('2')).toBe('unsupported');
    expect(snapshotTimerWireMode(3)).toBe('unsupported');

    const accelerated = [3, 3, 1];
    expect(stableCooldownRemaining(accelerated, 0)).toBe(5);
    expect(stableCooldownRemaining(accelerated, 0.5)).toBe(3.5);
    expect(stableCooldownRemaining(accelerated, 1)).toBe(2);
    expect(stableCooldownRemaining(accelerated, 3)).toBe(0);
    expect(stableCooldownRemaining([3, 0, 1], 0)).toBeNull();
    expect(stableDeadlineRemaining(-1, 0)).toBeNull();
    expect(stableDeadlineRemaining(1, -1)).toBeNull();
    expect(stableDeadlineRemaining(Number.MAX_VALUE, -Number.MAX_VALUE)).toBeNull();
    expect(
      stableCooldownRemaining([Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE], 0),
    ).toBeNull();
  });

  it('ignores negative stable clocks without poisoning retained schedules', () => {
    const client = bareClient(1);
    apply(client, {
      tw: 2,
      time: 10,
      self: playerWire(1, {
        auras: [aura('retained', { exp: 20 })],
        cds: { cast: 20 },
      }),
    });

    apply(client, { tw: 2, time: -Number.MAX_VALUE, self: playerWire(1) });
    apply(client, { tw: 2, time: 11, self: playerWire(1) });

    expect(client.player.auras[0]).toMatchObject({ id: 'retained', remaining: 9 });
    expect(client.player.cooldowns.get('cast')).toBe(9);
  });

  it('ages omitted v2 timers and preserves auras on moving lite records', () => {
    const client = bareClient(1);
    apply(client, {
      tw: 2,
      time: 10,
      ents: [playerWire(2, { auras: [aura('remote', { exp: 20 })] })],
      self: playerWire(1, {
        auras: [aura('self', { exp: 15 })],
        cds: { cast: 15, accelerated: [13, 3, 11] },
        ncd: { ore: 12 },
      }),
    });
    expect(client.entities.get(2)?.auras[0].remaining).toBe(10);
    expect(client.player.auras[0].remaining).toBe(5);
    expect(client.player.cooldowns.get('cast')).toBe(5);
    expect(client.player.cooldowns.get('accelerated')).toBe(5);
    expect(client.nodeHarvestableByMe('ore')).toBe(false);

    apply(client, {
      tw: 2,
      time: 11,
      ents: [{ id: 2, x: 1, y: 0, z: 0, f: 0, hp: 100, mhp: 100 }],
      self: playerWire(1),
    });
    expect(client.entities.get(2)?.auras[0].remaining).toBe(9);
    expect(client.player.auras[0].remaining).toBe(4);
    expect(client.player.cooldowns.get('cast')).toBe(4);
    expect(client.player.cooldowns.get('accelerated')).toBe(2);

    apply(client, { tw: 2, time: 13.1, keep: [2], self: playerWire(1) });
    expect(client.nodeHarvestableByMe('ore')).toBe(true);
    expect(client.player.cooldowns.has('accelerated')).toBe(false);
    expect(client.player.cooldowns.get('cast')).toBeCloseTo(1.9, 8);

    apply(client, {
      tw: 2,
      time: 13.1,
      ents: [{ id: 2, x: 2, y: 0, z: 0, f: 0, hp: 100, mhp: 100, auras: [] }],
      self: playerWire(1, { cds: {} }),
    });
    expect(client.entities.get(2)?.auras).toEqual([]);
    expect(client.player.cooldowns.size).toBe(0);
  });

  it('freezes retained auras while ordinary cooldown deadlines continue', () => {
    const client = bareClient(1);
    apply(client, {
      tw: 2,
      time: 0,
      self: playerWire(1, { auras: [aura('retained', { exp: 5 })], cds: { cast: 5 } }),
    });
    apply(client, {
      tw: 2,
      time: 1,
      self: playerWire(1, { dead: 1, hp: 0, auras: [aura('retained', { rem: 4 })] }),
    });
    apply(client, { tw: 2, time: 2, self: playerWire(1, { dead: 1, hp: 0 }) });
    expect(client.player.auras[0].remaining).toBe(4);
    expect(client.player.cooldowns.get('cast')).toBe(3);
  });

  it('keeps v1 and v2 absence semantics isolated across rolling transitions', () => {
    const client = bareClient(1);
    apply(client, {
      time: 1,
      self: playerWire(1, { auras: [aura('legacy', { rem: 5 })], cds: { cast: 5 } }),
    });
    expect(client.player.auras[0].remaining).toBe(5);

    apply(client, {
      tw: 2,
      time: 10,
      self: playerWire(1, { auras: [aura('stable', { exp: 15 })], cds: { cast: 15 } }),
    });
    apply(client, { tw: 2, time: 11, self: playerWire(1) });
    expect(client.player.auras[0]).toMatchObject({ id: 'stable', remaining: 4 });
    expect(client.player.cooldowns.get('cast')).toBe(4);

    apply(client, {
      tw: 3,
      time: 12,
      self: playerWire(1, { auras: [aura('future', { exp: 99 })], cds: { cast: 99 } }),
    });
    expect(client.player.auras[0].id).toBe('stable');
    expect(client.player.cooldowns.get('cast')).toBe(4);

    apply(client, { tw: 2, time: 12, self: playerWire(1) });
    expect(client.player.auras[0]).toMatchObject({ id: 'stable', remaining: 3 });
    expect(client.player.cooldowns.get('cast')).toBe(3);

    apply(client, {
      time: 2,
      self: playerWire(1, { auras: [aura('legacy-again', { rem: 3 })], cds: { cast: 3 } }),
    });
    expect(client.player.auras[0]).toMatchObject({ id: 'legacy-again', remaining: 3 });
    expect(client.player.cooldowns.get('cast')).toBe(3);
    apply(client, { time: 2.05, self: playerWire(1) });
    expect(client.player.auras).toEqual([]);
  });
});
