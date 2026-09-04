// The arm-marked heavy-self members over the REAL online dispatch (Phase 18,
// the perfect-item dirty-flag and farming-refusal reads): a frame the dispatch
// itself refuses (a malformed perfect_item ref, a screened legendary name, a
// farming frame failing its type guards) never sets selfHeavyDirty, while a
// frame that reaches the sim does, whatever the sim then decides. The
// receipt-marked family keeps its standing shape (an `equip` frame marks on
// receipt even when malformed), which is the partition's behavioral control.
// The pure membership pins live in tests/heavy_self_arm_marks.test.ts.
import { describe, expect, it, vi } from 'vitest';

// The canonical GameServer db-mock shape (tests/character_lease_game.test.ts):
// hoisted above the server/game import; nothing here reaches Postgres.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
  insertBankLedgerRows: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

import { type ClientSession, GameServer } from '../server/game';

function fakeWs(): { sent: unknown[]; ws: unknown } {
  const sent: unknown[] = [];
  return {
    sent,
    ws: {
      readyState: 1,
      send: (raw: string) => sent.push(JSON.parse(raw)),
      close: () => {},
      terminate: () => {},
      on: () => {},
    },
  };
}

function joinServer(
  server: GameServer,
  id: number,
  name: string,
): { session: ClientSession; sent: unknown[] } {
  const fc = fakeWs();
  const session = server.join(fc.ws as never, id, id, name, 'warrior', null);
  // join() answers a refusal object rather than a session on a rejected join
  // (a taken character, a lease it could not acquire). Narrow it, never cast
  // past it: every case below drives a real session, so a refusal here is a
  // broken fixture and should say so loudly instead of failing on a later
  // property read. The house idiom (tests/audit_cur_conservation.test.ts).
  if ('error' in session) throw new Error(session.error);
  return { session, sent: fc.sent };
}

function heavyDirty(session: ClientSession): boolean {
  return (session as unknown as { selfHeavyDirty: boolean }).selfHeavyDirty;
}

function clearHeavyDirty(session: ClientSession): void {
  (session as unknown as { selfHeavyDirty: boolean }).selfHeavyDirty = false;
}

function cmd(server: GameServer, session: ClientSession, body: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...body }));
}

function noticeTexts(sent: unknown[]): string[] {
  const texts: string[] = [];
  for (const frame of sent) {
    const f = frame as { t?: string; list?: { type?: string; text?: string }[] };
    if (f.t !== 'events') continue;
    for (const ev of f.list ?? []) if (typeof ev.text === 'string') texts.push(ev.text);
  }
  return texts;
}

describe('perfect_item: the dispatch refusals mark nothing, the sim-bound frame marks', () => {
  it('a malformed ref drops before the sim and leaves the heavy flag clear', () => {
    const server = new GameServer();
    const { session } = joinServer(server, 901, 'Fuzzer');
    const spy = vi.spyOn(server.sim, 'perfectItemAs');
    clearHeavyDirty(session);
    for (const body of [
      { cmd: 'perfect_item' },
      { cmd: 'perfect_item', slot: 'hat' },
      { cmd: 'perfect_item', bag: 1.5, item: 'wyrmfall_pendant' },
      { cmd: 'perfect_item', slot: 'neck', bag: 0, item: 'wyrmfall_pendant' },
    ]) {
      cmd(server, session, body);
      expect(heavyDirty(session), JSON.stringify(body)).toBe(false);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('a screened legendary name answers the notice, never reaches the sim, and marks nothing', () => {
    const server = new GameServer();
    const { session, sent } = joinServer(server, 902, 'Namer');
    const pid = session.pid as number;
    const spy = vi.spyOn(server.sim, 'perfectItemAs');
    // The refusal needs a copy that would CONSUME the name (phase 18 narrowed
    // the screen to exactly that): Sim.perfectItemAs routes a `perfected`
    // payload to the promotion ladder and everything else to the ordinary
    // attempt, which ignores the name. Worn on the neck, so the `slot` ref the
    // other cases use resolves to it.
    const meta = server.sim.meta(pid);
    if (!meta) throw new Error('no meta');
    meta.equipment.neck = 'wyrmfall_pendant';
    meta.equipmentInstance.neck = { perfected: true };
    clearHeavyDirty(session);
    sent.length = 0;
    // Shape-valid AND offensive: the content screen refuses it (a digit-bearing
    // spelling would be shape-invalid and ride through raw for the sim's own
    // shape arm instead; tests/perfecting_wire.test.ts pins that split).
    cmd(server, session, { cmd: 'perfect_item', slot: 'neck', name: 'fuck' });
    expect(spy).not.toHaveBeenCalled();
    expect(heavyDirty(session)).toBe(false);
    expect(noticeTexts(sent)).toContain('That name is not allowed.');
  });

  it('an offensive name on an UNPERFECTED copy is stripped, so the frame reaches the sim and MARKS', () => {
    // The partition's newest member (phase 18): a screened name is no longer a
    // dispatch refusal on every copy, only on one the promotion ladder would
    // stamp it onto. On any other copy the name is stripped and the attempt
    // proceeds, which puts the frame back in the sim-bound arm: it marks.
    const server = new GameServer();
    const { session, sent } = joinServer(server, 911, 'Stripped');
    const spy = vi.spyOn(server.sim, 'perfectItemAs');
    clearHeavyDirty(session);
    sent.length = 0;
    // Nothing worn on the neck, so nothing is perfected: the same frame the
    // case above refuses now rides through UNNAMED and marks on the way in.
    cmd(server, session, { cmd: 'perfect_item', slot: 'neck', name: 'fuck' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(session.pid, { slot: 'neck' }, undefined);
    expect(heavyDirty(session)).toBe(true);
    expect(noticeTexts(sent)).not.toContain('That name is not allowed.');
  });

  it('a well-formed frame marks the moment it reaches the sim (the sim then decides)', () => {
    const server = new GameServer();
    const { session } = joinServer(server, 903, 'Hopeful');
    const spy = vi.spyOn(server.sim, 'perfectItemAs');
    clearHeavyDirty(session);
    // Nothing worn on the neck: the sim's own deny ladder refuses, which the
    // dispatch cannot see. The mark is the "reached the sim" contract.
    cmd(server, session, { cmd: 'perfect_item', slot: 'neck' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(heavyDirty(session)).toBe(true);
  });
});

describe('farming: a frame refused by its type guards marks nothing, a sim-bound frame marks', () => {
  it('plant_crop with a non-string bed or crop drops before the sim, flag clear', () => {
    const server = new GameServer();
    const { session } = joinServer(server, 904, 'Fumbler');
    const plant = vi.spyOn(server.sim, 'plantCrop');
    clearHeavyDirty(session);
    for (const body of [
      { cmd: 'plant_crop' },
      { cmd: 'plant_crop', bed: 7, crop: 'vale_wheat' },
      { cmd: 'plant_crop', bed: 'bed_a', crop: 3 },
      { cmd: 'plant_crop', bed: 'bed_a', crop: 'vale_wheat', compost: 'yes' },
    ]) {
      cmd(server, session, body);
      expect(heavyDirty(session), JSON.stringify(body)).toBe(false);
    }
    expect(plant).not.toHaveBeenCalled();
  });

  it('harvest_crop with a non-string bed drops before the sim, flag clear', () => {
    const server = new GameServer();
    const { session } = joinServer(server, 905, 'Reaper');
    const harvest = vi.spyOn(server.sim, 'harvestCrop');
    clearHeavyDirty(session);
    cmd(server, session, { cmd: 'harvest_crop', bed: 12 });
    cmd(server, session, { cmd: 'harvest_crop' });
    expect(harvest).not.toHaveBeenCalled();
    expect(heavyDirty(session)).toBe(false);
  });

  it('a well-formed plant_crop marks when it reaches the sim, even one the sim refuses', () => {
    const server = new GameServer();
    const { session } = joinServer(server, 906, 'Seedless');
    const plant = vi.spyOn(server.sim, 'plantCrop');
    clearHeavyDirty(session);
    // No seed, no hoe, not at a bed: the sim refuses (farmDenied), but the
    // frame passed the dispatch's guards and the arm marked on the way in.
    cmd(server, session, { cmd: 'plant_crop', bed: 'bed_a', crop: 'vale_wheat' });
    expect(plant).toHaveBeenCalledTimes(1);
    expect(heavyDirty(session)).toBe(true);
  });

  it('convert_husks and place_feast (payload-free) mark on every dispatched frame', () => {
    const server = new GameServer();
    const { session } = joinServer(server, 907, 'Composter');
    clearHeavyDirty(session);
    cmd(server, session, { cmd: 'convert_husks' });
    expect(heavyDirty(session)).toBe(true);
    clearHeavyDirty(session);
    cmd(server, session, { cmd: 'place_feast' });
    expect(heavyDirty(session)).toBe(true);
  });

  it('consume_feast is no heavy-self member: a well-formed frame never marks', () => {
    const server = new GameServer();
    const { session } = joinServer(server, 908, 'Eater');
    const consume = vi.spyOn(server.sim, 'consumeFeast');
    clearHeavyDirty(session);
    cmd(server, session, { cmd: 'consume_feast', id: 42 });
    expect(consume).toHaveBeenCalledTimes(1);
    expect(heavyDirty(session)).toBe(false);
  });
});

describe('the receipt-marked family keeps its standing shape (the partition control)', () => {
  it('an equip frame marks on receipt even when malformed', () => {
    const server = new GameServer();
    const { session } = joinServer(server, 909, 'Dresser');
    clearHeavyDirty(session);
    cmd(server, session, { cmd: 'equip' });
    expect(heavyDirty(session)).toBe(true);
  });

  it('a combat command marks on neither path', () => {
    const server = new GameServer();
    const { session } = joinServer(server, 910, 'Fighter');
    clearHeavyDirty(session);
    cmd(server, session, { cmd: 'attack' });
    cmd(server, session, { cmd: 'target', id: null });
    expect(heavyDirty(session)).toBe(false);
  });
});

describe('place_feast server slot validation', () => {
  it('rejects present malformed slots before the sim', () => {
    const server = new GameServer();
    const { session } = joinServer(server, 912, 'Malformed Feast');
    const place = vi.spyOn(server.sim, 'placeFeast');
    for (const slot of [-1, 1.5, '0', null]) {
      clearHeavyDirty(session);
      cmd(server, session, { cmd: 'place_feast', slot });
      expect(place, JSON.stringify(slot)).not.toHaveBeenCalled();
      expect(heavyDirty(session), JSON.stringify(slot)).toBe(false);
    }
  });

  it('preserves omitted-slot and zero-slot calls', () => {
    const server = new GameServer();
    const { session } = joinServer(server, 913, 'Valid Feast');
    const place = vi.spyOn(server.sim, 'placeFeast');

    clearHeavyDirty(session);
    cmd(server, session, { cmd: 'place_feast' });
    expect(place).toHaveBeenLastCalledWith(session.pid, undefined);
    expect(heavyDirty(session)).toBe(true);

    clearHeavyDirty(session);
    cmd(server, session, { cmd: 'place_feast', slot: 0 });
    expect(place).toHaveBeenLastCalledWith(session.pid, 0);
    expect(heavyDirty(session)).toBe(true);
  });
});
