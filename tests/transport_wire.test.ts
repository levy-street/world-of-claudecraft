// The wire half of the scheduled ferry: a passenger's `fry` deck spot (their
// spot on the moving deck in the hull's frame), the snapshot head's schedule
// clock (`time`, or `fc` under a dev skip), the reconciliation self block's
// full-precision deck pose (`rdk`), and the ClientWorld decode that turns them
// back into the same timetable view the offline Sim serves and the deck
// mirrors the renderer draws passengers from (src/net/transport_wire.ts). The
// sim half lives in tests/transport_ferry.test.ts and transport_deck.test.ts;
// the end-to-end voyage in tests/transport_ferry_online.test.ts.

import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; only the wire encoding is under
// test (the hoisted-mock idiom in tests/CLAUDE.md, "Server tests").
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  // The branch's db surface (integration/world-quests-v0440): every export
  // server/game.ts imports, so a future arm of this file never trips
  // "No X export is defined on the mock" (the canonical shape is
  // tests/character_lease_game.test.ts).
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  loadRiftState: vi.fn(async () => null),
  saveRiftState: vi.fn(async () => {}),
  loadGuildBankRow: vi.fn(async () => null),
  loadGuildBankRows: vi.fn(async () => []),
  saveCharacterAndGuildBankState: vi.fn(async () => {}),
  GUILD_BANK_ROW_MAX_BYTES: 262144,
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { wireEntity } from '../server/game';
import { reconciliationSelfWire } from '../server/movement_reconciliation_wire';
import { ferryDeckWire, ferryMovementFrame, transportHeadJson } from '../server/transport_head';
import { isMovementFrozen } from '../src/game/self_motion_gate';
import { applyReconSelfWire, ReconWireState } from '../src/net/movement_reconciliation_wire';
import { applyFerryWire, parseFerryDeck, transportClockFromHead } from '../src/net/transport_wire';
import { EASTBROOK_NIGHTBLOOM_FERRY, TRANSPORT_ROUTES } from '../src/sim/content/transport_ships';
import { Sim } from '../src/sim/sim';
import { deckToWorld } from '../src/sim/transport_deck';
import { transportPhaseAt } from '../src/sim/transport_schedule';
import type { Entity } from '../src/sim/types';
import { WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';
import { bareClient } from './helpers/bare_client';

const ROUTE = EASTBROOK_NIGHTBLOOM_FERRY;
const SHIP = { x: 40, z: -12, rot: 0.9 };

/** Put `e` on a ship at SHIP, at deck spot (lx, lz), facing `lf` off the bow. */
function aboard(e: Entity, lx: number, lz: number, lf: number): void {
  const at = deckToWorld(SHIP, lx, lz, { x: 0, z: 0 });
  e.pos = { x: at.x, y: WATER_LEVEL + 3.3, z: at.z };
  e.facing = SHIP.rot + lf;
  e.ferryRide = { route: ROUTE.id, from: 0, to: 1, ship: { ...SHIP } };
}

describe('the fry deck spot', () => {
  it('is absent on foot, and the hull-frame spot aboard, rounded like x/y/z', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const e = sim.player;
    expect(wireEntity(e)).not.toHaveProperty('fry');
    aboard(e, 1.234567, -4.5, 0.25);
    expect(wireEntity(e).fry).toEqual([0, 1.23, 3.3, -4.5, 0.25]);
    expect(ferryDeckWire(e)).toEqual([0, 1.23, 3.3, -4.5, 0.25]);
    // a passenger of the second route names it by its index
    e.ferryRide = { route: TRANSPORT_ROUTES[1].id, from: 0, to: 1, ship: { ...SHIP } };
    expect((wireEntity(e).fry as number[] | undefined)?.[0]).toBe(1);
    e.ferryRide = null;
    expect(ferryDeckWire(e)).toBeUndefined();
  });

  it('parses only a well-formed spot on a known route', () => {
    expect(parseFerryDeck([0, 1, 3.3, -2, 0.5])).toEqual({ route: 0, x: 1, y: 3.3, z: -2, f: 0.5 });
    expect(parseFerryDeck(undefined)).toBeNull();
    expect(parseFerryDeck(1)).toBeNull();
    expect(parseFerryDeck([0, 1, 3.3, -2])).toBeNull();
    expect(parseFerryDeck([7, 1, 3.3, -2, 0])).toBeNull();
    // every route's index parses; one past the last never does
    expect(parseFerryDeck([1, 1, 3.3, -2, 0])?.route).toBe(1);
    expect(parseFerryDeck([TRANSPORT_ROUTES.length, 1, 3.3, -2, 0])).toBeNull();
    expect(parseFerryDeck([-1, 1, 3.3, -2, 0])).toBeNull();
    expect(parseFerryDeck([0.5, 1, 3.3, -2, 0])).toBeNull();
    expect(parseFerryDeck([0, 'x', 3.3, -2, 0])).toBeNull();
    expect(parseFerryDeck([0, Number.NaN, 3.3, -2, 0])).toBeNull();
  });

  it('decodes onto the client deck mirrors, re-anchors the interpolation, and clears', () => {
    const e = { ferryRiding: false } as Entity;
    applyFerryWire(e, [0, 1, 3.3, 2, 0], -1);
    expect(e.ferryRiding).toBe(true);
    expect(e.ferryDeck).toEqual({ route: 0, x: 1, y: 3.3, z: 2, f: 0 });
    expect(e.ferryDeckPrev).toEqual(e.ferryDeck);
    // the next spot glides on from where the body was drawn (the old spot
    // here: its interpolation had not started)
    applyFerryWire(e, [0, 3, 3.3, 2, 0.4], 0.5);
    expect(e.ferryDeck).toEqual({ route: 0, x: 3, y: 3.3, z: 2, f: 0.4 });
    expect(e.ferryDeckPrev).toEqual({ route: 0, x: 1, y: 3.3, z: 2, f: 0 });
    // half way from 1 to 3 when the next one lands
    applyFerryWire(e, [0, 5, 3.3, 2, 0.4], 0.5);
    expect(e.ferryDeckPrev?.x).toBeCloseTo(2, 9);
    // a snap (negative alpha) restarts on the new spot
    applyFerryWire(e, [0, 9, 3.3, 2, 0.4], -1);
    expect(e.ferryDeckPrev?.x).toBe(9);
    // gone from the wire: off the ship
    applyFerryWire(e, undefined, 0.5);
    expect(e.ferryRiding).toBe(false);
    expect(e.ferryDeck).toBeNull();
    expect(e.ferryDeckPrev).toBeNull();
  });

  it('reaches the ClientWorld mirrors through a real snapshot', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const e = sim.player;
    const client = bareClient(e.id + 1000);
    const apply = (s: unknown) =>
      (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(s);
    aboard(e, -2, 6, 0);
    apply({ t: 'snap', time: 1, ents: [wireEntity(e)] });
    expect(client.entities.get(e.id)?.ferryRiding).toBe(true);
    expect(client.entities.get(e.id)?.ferryDeck).toMatchObject({ route: 0, x: -2, z: 6 });
    e.ferryRide = null;
    apply({ t: 'snap', time: 2, ents: [wireEntity(e)] });
    expect(client.entities.get(e.id)?.ferryRiding).toBe(false);
    expect(client.entities.get(e.id)?.ferryDeck ?? null).toBeNull();
  });
});

describe('the reconciliation self block aboard', () => {
  const session = {
    movementWireVersion: 2 as const,
    lastConsumedCt: 41,
    movementOverrideEpoch: 3,
    movementOverrideActive: false,
    movementMoveSpeedMult: 1,
  };

  it('adds the full-precision deck pose (rdk) for a passenger only', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const e = sim.player;
    expect(reconciliationSelfWire(session, e)).not.toHaveProperty('rdk');
    aboard(e, 1.234567, -4.5, 0.25);
    const wire = reconciliationSelfWire(session, e);
    const rdk = wire.rdk as number[];
    expect(rdk[0]).toBe(0);
    expect(rdk[1]).toBeCloseTo(1.234567, 9);
    expect(rdk[3]).toBeCloseTo(-4.5, 9);
    expect(rdk[4]).toBeCloseTo(0.25, 9);
    // the client decodes it beside the world pose
    const target = new ReconWireState();
    applyReconSelfWire(target, wire as Record<string, unknown>, 2);
    expect(target.reconDeck?.x).toBeCloseTo(1.234567, 9);
    expect(target.reconAuthoritativeX).toBeCloseTo(e.pos.x, 9);
    applyReconSelfWire(target, reconciliationSelfWire(session, { ...e, ferryRide: null }), 2);
    expect(target.reconDeck).toBeNull();
  });

  it('measures the steps of a passenger in the hull frame, for the override epoch', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const e = sim.player;
    const out = { x: 0, y: 0, z: 0 };
    expect(ferryMovementFrame(e, out)).toBe(-1);
    expect(out).toEqual(e.pos);
    aboard(e, 2, 3, 0);
    expect(ferryMovementFrame(e, out)).toBe(0);
    expect(out.x).toBeCloseTo(2, 9);
    expect(out.y).toBeCloseTo(3.3, 9);
    expect(out.z).toBeCloseTo(3, 9);
  });
});

describe('the schedule clock on the snapshot head', () => {
  it('rides as `time` in play; a dev skip adds `fc`', () => {
    expect(transportHeadJson({ time: 12.5, transportClockOffset: 0 })).toBe('');
    expect(transportHeadJson({ time: 12.5, transportClockOffset: 40 })).toBe(',"fc":52.5');
    expect(transportClockFromHead({ time: 12.5 })).toBe(12.5);
    expect(transportClockFromHead({ time: 12.5, fc: 52.5 })).toBe(52.5);
    expect(transportClockFromHead({ time: 'x' })).toBeNull();
    expect(transportClockFromHead({ time: Number.NaN, fc: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('gives the ClientWorld the same timetable view the offline Sim serves', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const client = bareClient(sim.player.id + 1000);
    const apply = (s: unknown) =>
      (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(s);
    for (const clock of [5, 61, 75, 85, 100, 150, 170, 240, 300]) {
      sim.transportClockOffset = clock - sim.time;
      apply({ t: 'snap', time: sim.time, fc: sim.time + sim.transportClockOffset, ents: [] });
      const online = client.ferryView();
      const offline = sim.ferryView();
      if (!online || !offline) throw new Error('no ferry view');
      expect({ ...online, passenger: false }).toEqual({ ...offline, passenger: false });
      expect(online.phase).toBe(transportPhaseAt(ROUTE, clock).phase);
    }
  });
});

describe('a passenger walks the deck (never movement-frozen)', () => {
  it('only an unreleased corpse is frozen', () => {
    const alive = { dead: false, ghost: false };
    expect(isMovementFrozen(alive)).toBe(false);
    expect(isMovementFrozen({ dead: true, ghost: false })).toBe(true);
    expect(isMovementFrozen({ dead: true, ghost: true })).toBe(false);
  });
});
