import { describe, expect, it, vi } from 'vitest';
import { type QuestWorldCommand, QuestWorldWireState } from '../src/net/quest_world_wire_state';
import { TurretFeedbackMirror } from '../src/net/turret_feedback_mirror';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { TURRET_FEEDBACK_LIMIT } from '../src/sim/minigames/turret_feedback';
import type { SimEvent } from '../src/sim/types';
import { TURRET_SEAT_CLEARED, turretSeatKeys } from './helpers/turret_seat_wire';

function entry(seq: number, tick = seq): SimEvent {
  return { type: 'turretDefense', pid: 1, seq, tick, event: { type: 'waveCleared', wave: 0 } };
}

const seqs = (mirror: TurretFeedbackMirror) => mirror.entries.map((f) => f.seq);

describe('the turret feedback mirror', () => {
  it('holds routed entries until the next snapshot publishes them, then leaves the ring alone', () => {
    const mirror = new TurretFeedbackMirror();
    mirror.apply(entry(1));
    mirror.apply(entry(2));
    expect(mirror.entries).toEqual([]);
    expect(mirror.publish()).toBe(true);
    const ring = mirror.entries;
    expect(ring.map((f) => f.seq)).toEqual([1, 2]);
    expect(ring[0]).toEqual({ seq: 1, tick: 1, event: { type: 'waveCleared', wave: 0 } });
    expect(Object.isFrozen(ring[0])).toBe(true);
    expect(mirror.publish()).toBe(false);
    expect(mirror.entries).toBe(ring);
    mirror.apply(entry(3));
    expect(mirror.publish()).toBe(true);
    expect(mirror.entries).not.toBe(ring);
    expect(ring.map((f) => f.seq)).toEqual([1, 2]);
    expect(seqs(mirror)).toEqual([1, 2, 3]);
  });

  it('keeps the newest entries, as many as the sim ring holds', () => {
    const mirror = new TurretFeedbackMirror();
    for (let seq = 1; seq <= TURRET_FEEDBACK_LIMIT + 40; seq++) mirror.apply(entry(seq));
    mirror.publish();
    expect(mirror.entries).toHaveLength(TURRET_FEEDBACK_LIMIT);
    expect(mirror.entries[0].seq).toBe(41);
    for (let seq = TURRET_FEEDBACK_LIMIT + 41; seq <= TURRET_FEEDBACK_LIMIT + 50; seq++)
      mirror.apply(entry(seq));
    mirror.publish();
    expect(mirror.entries).toHaveLength(TURRET_FEEDBACK_LIMIT);
    expect(mirror.entries.at(-1)?.seq).toBe(TURRET_FEEDBACK_LIMIT + 50);
  });

  it('starts over when the sequence goes back (a new seat)', () => {
    const mirror = new TurretFeedbackMirror();
    for (const seq of [1, 2, 3]) mirror.apply(entry(seq));
    mirror.publish();
    mirror.apply(entry(4));
    mirror.apply(entry(1, 90));
    mirror.publish();
    expect(mirror.entries).toEqual([{ seq: 1, tick: 90, event: { type: 'waveCleared', wave: 0 } }]);
  });

  it('ignores other events and malformed entries', () => {
    const mirror = new TurretFeedbackMirror();
    mirror.apply({ type: 'log', pid: 1, text: 'hi' } as SimEvent);
    mirror.apply({ ...entry(1), seq: 0 } as SimEvent);
    mirror.apply({ ...entry(1), event: { type: 'nuke' } } as unknown as SimEvent);
    expect(mirror.publish()).toBe(false);
    expect(mirror.entries).toEqual([]);
  });

  it('drops an entry kind a newer server adds, keeping its neighbours in order with no restart', () => {
    const mirror = new TurretFeedbackMirror();
    mirror.apply(entry(1));
    mirror.apply({ ...entry(2), event: { type: 'meteor', id: 1 } } as unknown as SimEvent);
    mirror.apply(entry(3));
    mirror.publish();
    expect(seqs(mirror)).toEqual([1, 3]);
    mirror.apply(entry(4));
    mirror.publish();
    expect(seqs(mirror)).toEqual([1, 3, 4]);
  });

  it('clears the published ring but keeps what is held for the next seat; reset drops both', () => {
    const mirror = new TurretFeedbackMirror();
    mirror.apply(entry(1));
    mirror.publish();
    mirror.apply(entry(2));
    mirror.clear();
    expect(mirror.entries).toEqual([]);
    mirror.publish();
    expect(seqs(mirror)).toEqual([2]);
    mirror.apply(entry(3));
    mirror.reset();
    expect(mirror.publish()).toBe(false);
    expect(mirror.entries).toEqual([]);
  });
});

describe('the turret seat on the quest wire state', () => {
  const planJson = JSON.parse(JSON.stringify(resolveTurretPlan()));

  /** The smallest valid seat the state keys join back into: a fresh seat before its first wave. */
  function seat(rev: number) {
    return {
      origin: { x: 10, y: 5, z: 20 },
      defense: {
        cx: 10,
        cz: 20,
        startTick: 100,
        rev,
        phase: 'intro',
        phaseEndTick: 160,
        wave: 0,
        integrity: 100,
        readyTick: 100,
        shockReadyTick: 100,
        aimX: 0,
        aimZ: 1,
        shots: [],
        monsters: [],
        barrels: [],
        stats: {
          shots: 0,
          hits: 0,
          kills: 0,
          breaches: 0,
          pointsLost: 0,
          longestThrow: 0,
          longestAirtime: 0,
          bowled: 0,
          barrelsDetonated: 0,
          barrelKills: 0,
          shockwaves: 0,
          frags: 0,
          resupplies: 0,
        },
      },
      waveCount: planJson.waves.length,
      monstersLeft: 0,
    };
  }

  class Client extends QuestWorldWireState {
    readonly commands: QuestWorldCommand[] = [];
    protected override sendQuestWorldCommand(command: QuestWorldCommand): void {
      this.commands.push(command);
    }
    route(event: SimEvent): void {
      this.applyQuestWorldEvent(event);
    }
    drop(): void {
      this.clearVehicleMirrors();
    }
  }

  it('starts empty, seats on the two keys, reads the snapshot tick as the clock', () => {
    const client = new Client();
    expect(client.turretSession).toBeNull();
    expect(client.turretClock).toBeNull();
    client.applyQuestSelfSnapshot({ turp: planJson, ...turretSeatKeys(seat(0)) }, 5, 101);
    expect(client.turretSession?.defense.rev).toBe(0);
    expect(client.turretSession?.feedback).toEqual([]);
    expect(client.turretClock).toBe(101);
    for (const tick of [undefined, -1, 1.5, '102']) {
      client.applyQuestSelfSnapshot({}, 5, tick);
      expect(client.turretClock, `tick ${tick}`).toBeNull();
    }
  });

  it('keeps one object until the state key or the ring moves', () => {
    const client = new Client();
    client.applyQuestSelfSnapshot({ turp: planJson, ...turretSeatKeys(seat(0)) }, 5, 101);
    const first = client.turretSession;
    client.applyQuestSelfSnapshot({}, 5, 102);
    expect(client.turretSession).toBe(first);
    expect(client.turretClock).toBe(102);
    client.route(entry(1, 102));
    expect(client.turretSession).toBe(first);
    client.applyQuestSelfSnapshot({}, 5, 103);
    const ringMoved = client.turretSession;
    expect(ringMoved).not.toBe(first);
    expect(ringMoved?.defense).toBe(first?.defense);
    expect(ringMoved?.feedback.map((f) => f.seq)).toEqual([1]);
    client.applyQuestSelfSnapshot(turretSeatKeys(seat(1)), 5, 104);
    expect(client.turretSession).not.toBe(ringMoved);
    expect(client.turretSession?.defense.rev).toBe(1);
    expect(client.turretSession?.defense.plan).toBe(first?.defense.plan);
    expect(client.turretSession?.feedback).toBe(ringMoved?.feedback);
  });

  it('clears on a null seat, a malformed seat, a missing plan, a dropped socket and a reset', () => {
    const client = new Client();
    const seated = () =>
      client.applyQuestSelfSnapshot({ turp: planJson, ...turretSeatKeys(seat(0)) }, 5, 101);
    seated();
    client.route(entry(1));
    client.applyQuestSelfSnapshot(TURRET_SEAT_CLEARED, 5, 102);
    expect(client.turretSession).toBeNull();
    expect(client.turretClock).toBeNull();
    client.applyQuestSelfSnapshot(turretSeatKeys(seat(2)), 5, 103);
    expect(client.turretSession?.feedback).toEqual([]);

    expect(client.commands).toEqual([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    client.applyQuestSelfSnapshot(turretSeatKeys({ ...seat(3), waveCount: -1 }), 5, 104);
    expect(client.turretSession).toBeNull();
    client.applyQuestSelfSnapshot({ turp: null, ...turretSeatKeys(seat(4)) }, 5, 105);
    expect(client.turretSession).toBeNull();
    // A seat the server holds but this client cannot read: one leave for the whole stretch.
    expect(client.commands).toEqual([{ cmd: 'vehicle_leave' }]);
    warn.mockRestore();

    seated();
    client.drop();
    expect(client.turretSession).toBeNull();
    expect(client.turretClock).toBeNull();
    client.applyQuestSelfSnapshot({}, 5, 106);
    expect(client.turretSession).toBeNull();

    seated();
    client.resetQuestWorldWireState();
    expect(client.turretSession).toBeNull();
    client.applyQuestSelfSnapshot({}, 5, 107);
    expect(client.turretSession).toBeNull();
  });

  it('reads only the keys a record moves, and leaves once on a partial family', () => {
    const client = new Client();
    client.applyQuestSelfSnapshot({ turp: planJson, ...turretSeatKeys(seat(0)) }, 5, 101);
    const first = client.turretSession;
    // A revision that moved only the revision key: every other key keeps its last value.
    client.applyQuestSelfSnapshot({ tuv: 1 }, 5, 102);
    expect(client.turretSession).not.toBe(first);
    expect(client.turretSession?.defense.rev).toBe(1);
    expect({ ...client.turretSession!.defense, rev: 0 }).toEqual(first?.defense);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // A cleared section beside a live seat: no seat decodes, and the client leaves it once.
      client.applyQuestSelfSnapshot({ tus: null }, 5, 103);
      expect(client.turretSession).toBeNull();
      client.applyQuestSelfSnapshot({ tuv: 2 }, 5, 104);
      expect(client.turretSession).toBeNull();
      expect(client.commands).toEqual([{ cmd: 'vehicle_leave' }]);
      // The whole family again (a resume): the seat reads, and a later stretch leaves again.
      client.applyQuestSelfSnapshot(turretSeatKeys(seat(3)), 5, 105);
      expect(client.turretSession?.defense.rev).toBe(3);
      client.applyQuestSelfSnapshot({ tub: null }, 5, 106);
      expect(client.turretSession).toBeNull();
      expect(client.commands).toEqual([{ cmd: 'vehicle_leave' }, { cmd: 'vehicle_leave' }]);
      // A null seat key is the server's "no seat": the whole family clears, with no leave,
      // even beside parts the server never nulled (a never-seated spectate anchor).
      client.applyQuestSelfSnapshot(turretSeatKeys(seat(4)), 5, 107);
      client.applyQuestSelfSnapshot({ tur: null }, 5, 108);
      expect(client.turretSession).toBeNull();
      expect(client.commands).toHaveLength(2);
      // Every key cleared is a left seat, not an unreadable one.
      client.applyQuestSelfSnapshot(TURRET_SEAT_CLEARED, 5, 110);
      client.applyQuestSelfSnapshot({}, 5, 111);
      expect(client.commands).toHaveLength(2);
    } finally {
      warn.mockRestore();
    }
  });
});
