// The Graveyard Shift on the authoritative server: a run is a parenthesis, so
// every way out of the session closes it BEFORE the host saves or moves the
// player (server/graveyard_shift_session.ts): a dropped connection, a logout,
// a jail sentence. A won scene keeps its win. A hotbar layout upload is
// refused while Morthen's kit stands in for the bar.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { saveCharacterAndMarketState, saveCharacterState } from '../server/db';
import { type ClientSession, GameServer } from '../server/game';
import { CORPSE_RETURN_TICKS } from '../src/sim/graveyard_shift/corpse_run';
import { BOSS_FOR_A_DAY_DEED_ID, graveReturnSpot } from '../src/sim/graveyard_shift/grave_entry';
import { hasMorthenIdentity } from '../src/sim/graveyard_shift/morthen_identity';
import { startGraveyardShift } from '../src/sim/graveyard_shift/run_lifecycle';
import { graveyardShiftRunFor } from '../src/sim/graveyard_shift/run_state';
import type { CharacterState } from '../src/sim/sim';

function fakeWs() {
  const ws: any = {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(),
  };
  return ws;
}

function onShift(name: string, characterId: number) {
  const server = new GameServer();
  const ws = fakeWs();
  const joined = server.join(ws, characterId, characterId, name, 'warrior', null);
  if ('error' in joined) throw new Error(joined.error);
  const session: ClientSession = joined;
  const sim = server.sim;
  sim.setPlayerLevel(15, session.pid);
  expect(startGraveyardShift(sim.ctx, session.pid, 'grave')).toBeNull();
  expect(hasMorthenIdentity(sim.entities.get(session.pid))).toBe(true);
  return { server, sim, session, ws };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function lastSavedState(): CharacterState {
  const plain = vi.mocked(saveCharacterState).mock.calls.at(-1)?.[2];
  const market = vi.mocked(saveCharacterAndMarketState).mock.calls.at(-1)?.[2];
  const state = (market ?? plain) as CharacterState | undefined;
  if (!state) throw new Error('no save');
  return state;
}

const atGrave = (pos: { x: number; z: number }) => {
  const spot = graveReturnSpot();
  return Math.hypot(pos.x - spot.x, pos.z - spot.z) < 0.5;
};

describe('a Graveyard Shift run on the server', () => {
  it('a dropped connection ends the run before the safety flush', async () => {
    const { server, sim, session, ws } = onShift('Dropper', 301);
    vi.mocked(saveCharacterState).mockClear();
    vi.mocked(saveCharacterAndMarketState).mockClear();
    ws.readyState = 3;
    expect(server.socketClosed(session, ws)).toBe(true);
    // Synchronous, before the flush: the live body is the real character outside.
    expect(graveyardShiftRunFor(sim.ctx, session.pid)).toBeNull();
    const e = sim.entities.get(session.pid)!;
    expect(hasMorthenIdentity(e)).toBe(false);
    expect(e.level).toBe(15);
    expect(atGrave(e.pos)).toBe(true);
    await settle();
    const saved = lastSavedState();
    expect(saved.level).toBe(15);
    expect(atGrave(saved.pos)).toBe(true);
  });

  it('a logout ends the run before the leave save', async () => {
    const { server, sim, session } = onShift('Leaver', 302);
    vi.mocked(saveCharacterState).mockClear();
    vi.mocked(saveCharacterAndMarketState).mockClear();
    await server.leave(session, 'logout');
    expect(graveyardShiftRunFor(sim.ctx, session.pid)).toBeNull();
    const saved = lastSavedState();
    expect(saved.level).toBe(15);
    expect(saved.dead).toBe(false);
    expect(atGrave(saved.pos)).toBe(true);
    // The bots went with the run, the owner with the session.
    expect(sim.entities.has(session.pid)).toBe(false);
  });

  it('a logout in the won scene keeps the deed and the pay in the leave save', async () => {
    const { server, sim, session } = onShift('Winner', 303);
    const meta = sim.ctx.players.get(session.pid)!;
    const copperBefore = meta.copper;
    const run = graveyardShiftRunFor(sim.ctx, session.pid)!;
    const owner = sim.entities.get(session.pid)!;
    const lethal = (pid: number) => {
      const t = sim.entities.get(pid)!;
      (sim as any).dealDamage(owner, t, t.maxHp + 50, false, 'shadow', null, 'hit', true);
    };
    for (const b of run.bots) lethal(b.pid);
    for (let i = 0; i < CORPSE_RETURN_TICKS + 1; i++) sim.tick();
    for (const b of run.bots) lethal(b.pid);
    sim.tick();
    expect(run.outro?.kind).toBe('won');
    vi.mocked(saveCharacterState).mockClear();
    vi.mocked(saveCharacterAndMarketState).mockClear();
    await server.leave(session, 'logout');
    const saved = lastSavedState();
    expect(saved.copper - copperBefore).toBe(2000);
    expect(meta.deedsEarned.has(BOSS_FOR_A_DAY_DEED_ID)).toBe(true);
    expect(saved.level).toBe(15);
  });

  it('a jail sentence ends the run first, so the return point is outside', () => {
    const { server, sim, session } = onShift('Prisoner', 304);
    (server as any).jailSession(session, session, 5);
    expect(graveyardShiftRunFor(sim.ctx, session.pid)).toBeNull();
    expect(hasMorthenIdentity(sim.entities.get(session.pid))).toBe(false);
    expect(atGrave(session.jailed!.returnPos)).toBe(true);
  });

  it('refuses a hotbar layout upload while the kit stands in, accepts it after', () => {
    const { server, sim, session } = onShift('Arranger', 305);
    const save = vi.spyOn(server.hotbarLayouts, 'save');
    const upload = JSON.stringify({ t: 'cmd', cmd: 'save_hotbar_layout', layout: {} });
    server.handleMessage(session, upload);
    expect(save).not.toHaveBeenCalled();
    sim.ctx.graveyardShiftRuns.get(session.pid)!.pendingOutcome = 'aborted';
    sim.tick();
    server.handleMessage(session, upload);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
