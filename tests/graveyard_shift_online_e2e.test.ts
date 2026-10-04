// The Graveyard Shift end to end on the authoritative server, through the
// real command and snapshot pipes: two players at the grave, one eligible.
// Only the eligible one ever receives the grave and their own Tibbs; they take
// the shift from his dialog, win it, and get the deed and the pay at the win,
// his report back at the grave, and a save that reloads as the real character.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  insertCharacterDeeds: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { GameServer } from '../server/game';
import { CORPSE_RETURN_TICKS } from '../src/sim/graveyard_shift/corpse_run';
import {
  BOSS_FOR_A_DAY_DEED_ID,
  GRAVE_ENTITY_ID,
  graveReturnSpot,
} from '../src/sim/graveyard_shift/grave_entry';
import { tibbsFor } from '../src/sim/graveyard_shift/grave_staging';
import { hasMorthenIdentity } from '../src/sim/graveyard_shift/morthen_identity';
import { graveyardShiftRunFor } from '../src/sim/graveyard_shift/run_state';
import { Sim } from '../src/sim/sim';
import { type FakeClient, fakeWs, joinServer } from './helpers/bare_client';

function advance(server: GameServer): void {
  const events = server.sim.tick();
  (server as any).routeEvents(events);
  (server as any).broadcastSnapshots();
}

function place(server: GameServer, pid: number, x: number, z: number) {
  const e = server.sim.entities.get(pid)!;
  e.pos = server.sim.ctx.groundPos(x, z);
  e.prevPos = { ...e.pos };
  (server.sim as any).rebucket(e);
}

// Every entity id a client was ever sent, across all its snapshots.
const seenIds = (fc: FakeClient) =>
  new Set(
    fc.sent.filter((m: any) => m.t === 'snap').flatMap((m: any) => m.ents.map((e: any) => e.id)),
  );

const sentText = (fc: FakeClient) => JSON.stringify(fc.sent);

const cmd = (server: GameServer, session: any, body: Record<string, unknown>) =>
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...body }));

describe('the Graveyard Shift on the server, end to end', () => {
  it('a private grave and Tibbs, a won shift, the pay, the report and an honest save', async () => {
    const server = new GameServer();
    const fcA = fakeWs();
    const fcB = fakeWs();
    const a = joinServer(server, fcA, 401, 'Eligible');
    const b = joinServer(server, fcB, 402, 'Bystander');
    const sim = server.sim;
    sim.setPlayerLevel(15, a.pid);
    sim.ctx.players.get(a.pid)!.deedsEarned.set('dgn_hollow_crypt', '2026-10-01');
    sim.setPlayerLevel(15, b.pid);
    const spot = graveReturnSpot();
    place(server, a.pid, spot.x, spot.z);
    place(server, b.pid, spot.x + 1.5, spot.z);
    for (let i = 0; i < 3; i++) advance(server);

    // The grave exists once for the realm, but only the eligible player gets it.
    expect(sim.entities.has(GRAVE_ENTITY_ID)).toBe(true);
    expect(seenIds(fcA).has(GRAVE_ENTITY_ID)).toBe(true);
    expect(seenIds(fcB).has(GRAVE_ENTITY_ID)).toBe(false);
    // B does receive snapshots of that very spot: A, standing beside them.
    expect(seenIds(fcB).has(a.pid)).toBe(true);

    // A touches it: their own Tibbs rises, offered to them alone.
    cmd(server, a, { cmd: 'pickup', id: GRAVE_ENTITY_ID });
    advance(server);
    advance(server);
    const tibbs = tibbsFor(sim.ctx, a.pid)!;
    expect(tibbs).toBeDefined();
    expect(seenIds(fcA).has(tibbs.id)).toBe(true);
    expect(seenIds(fcB).has(tibbs.id)).toBe(false);
    const latestB = fcB.sent.filter((m: any) => m.t === 'snap').at(-1);
    expect(latestB.ents.some((e: any) => e.id === a.pid)).toBe(true);
    expect(sentText(fcA)).toContain('"graveyardShiftOffer"');
    expect(sentText(fcB)).not.toContain('"graveyardShiftOffer"');
    // B cannot raise one at an invisible grave.
    cmd(server, b, { cmd: 'pickup', id: GRAVE_ENTITY_ID });
    advance(server);
    expect(tibbsFor(sim.ctx, b.pid)).toBeUndefined();

    // [Take the shift]: the targeted interact on A's Tibbs.
    cmd(server, a, { cmd: 'target', id: tibbs.id });
    cmd(server, a, { cmd: 'interact' });
    advance(server);
    const run = graveyardShiftRunFor(sim.ctx, a.pid)!;
    expect(run?.entry).toBe('grave');
    expect(hasMorthenIdentity(sim.entities.get(a.pid))).toBe(true);

    // Win: every adventurer down twice (one corpse run each).
    const meta = sim.ctx.players.get(a.pid)!;
    const copperBefore = meta.copper;
    const owner = sim.entities.get(a.pid)!;
    const lethal = (pid: number) => {
      const t = sim.entities.get(pid)!;
      (sim as any).dealDamage(owner, t, t.maxHp + 50, false, 'shadow', null, 'hit', true);
    };
    for (const bot of run.bots) lethal(bot.pid);
    for (let i = 0; i < CORPSE_RETURN_TICKS + 1; i++) advance(server);
    for (const bot of run.bots) lethal(bot.pid);
    advance(server);
    expect(run.outro?.kind).toBe('won');
    // The deed and the pay land with the win, in the Crypt.
    expect(meta.deedsEarned.has(BOSS_FOR_A_DAY_DEED_ID)).toBe(true);
    expect(meta.copper - copperBefore).toBe(2000);

    // Through the Staff Exit: back at the grave, his report in A's dialog.
    const exit = sim.entities.get(run.outro!.portalId!)!;
    place(server, a.pid, exit.pos.x, exit.pos.z);
    advance(server);
    advance(server);
    expect(graveyardShiftRunFor(sim.ctx, a.pid)).toBeNull();
    const back = sim.entities.get(a.pid)!;
    expect(hasMorthenIdentity(back)).toBe(false);
    expect(Math.hypot(back.pos.x - spot.x, back.pos.z - spot.z)).toBeLessThan(0.5);
    expect(sentText(fcA)).toContain('"report":{"outcome":"won"');
    // The shift won, the grave leaves A's view too.
    for (let i = 0; i < 3; i++) advance(server);
    const latest = fcA.sent.filter((m: any) => m.t === 'snap').at(-1);
    expect(latest.ents.some((e: any) => e.id === GRAVE_ENTITY_ID)).toBe(false);

    // A save now reloads as the real character, deed and pay included.
    const saved = sim.serializeCharacter(a.pid)!;
    expect(saved.level).toBe(15);
    expect(saved.copper - copperBefore).toBe(2000);
    expect(saved.deeds?.[BOSS_FOR_A_DAY_DEED_ID]).toBeDefined();
    const fresh = new Sim({ seed: 3, playerClass: 'warrior', noPlayer: true });
    const pid = fresh.addPlayer('warrior', 'Reloaded', { state: saved });
    expect(fresh.entities.get(pid)!.level).toBe(15);
    expect(hasMorthenIdentity(fresh.entities.get(pid))).toBe(false);
    expect(fresh.ctx.players.get(pid)!.deedsEarned.has(BOSS_FOR_A_DAY_DEED_ID)).toBe(true);
  });
});
