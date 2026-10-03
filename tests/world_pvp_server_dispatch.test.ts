// The wire half of the /pvp flag (server/game.ts): the pvp_flag command is
// dispatched to the sim with a strictly boolean payload (anything else is a
// malformed frame and is ignored), and a typed /pvp chat line is claimed as a
// gameplay command on the command lane before the chat gates, like /unstuck.
// The command-schema suite pins the tokens structurally; this drives the real
// dispatch switch and asserts on the sim state that results.
import { describe, expect, it, vi } from 'vitest';

import { COMMAND_NAMES } from '../src/world_api';

// Mock the db layer so no Postgres is needed: only the dispatch hop is under test.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  // The branch's db surface (integration/world-quests-v0440): every export
  // server/game.ts imports, so a future arm of this file never trips
  // "No X export is defined on the mock" (the canonical shape is
  // tests/character_lease_game.test.ts).
  grantAccountMountSkins: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountWeaponSkins: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  saveMarketState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  loadRiftState: vi.fn(async () => null),
  saveRiftState: vi.fn(async () => {}),
  loadGuildBankRow: vi.fn(async () => null),
  loadGuildBankRows: vi.fn(async () => []),
  saveCharacterAndGuildBankState: vi.fn(async () => {}),
  GUILD_BANK_ROW_MAX_BYTES: 262144,
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
}));

import { GameServer, wireEntity } from '../server/game';
import { WORLD_PVP_SKULL_ITEM_ID } from '../src/sim/pvp';
import { WORLD_PVP_TOGGLE_COOLDOWN } from '../src/sim/pvp/world_pvp';
import type { Entity } from '../src/sim/types';

function dispatch(server: GameServer, session: unknown, payload: Record<string, unknown>): void {
  const raw = JSON.stringify({ t: 'cmd', ...payload });
  (server as unknown as { dispatchMessage: (...a: unknown[]) => void }).dispatchMessage(
    session,
    JSON.parse(raw),
    raw,
    0,
  );
}

function joined() {
  const server = new GameServer();
  const session = server.join(
    { readyState: 1, send: () => {} } as never,
    97,
    97,
    'Alpha',
    'warrior',
    null,
  );
  if ('error' in session) throw new Error(session.error);
  const sim = server.sim;
  sim.setPlayerLevel(20, session.pid);
  const p = sim.entities.get(session.pid) as Entity;
  return { server, session, sim, p };
}

describe('world pvp server dispatch', () => {
  it('pvp_flag raises and lowers the flag only with a real boolean', () => {
    const { server, session, sim, p } = joined();
    expect(COMMAND_NAMES).toContain('pvp_flag');
    dispatch(server, session, { cmd: 'pvp_flag', on: 'yes' });
    expect(p.pvpFlag).toBeUndefined();
    dispatch(server, session, { cmd: 'pvp_flag' });
    expect(p.pvpFlag).toBeUndefined();
    dispatch(server, session, { cmd: 'pvp_flag', on: true });
    expect(p.pvpFlag).toBe(true);
    expect(sim.worldPvpInfoFor(session.pid)!.disarmRemaining).toBeNull();
    (sim as unknown as { time: number }).time += WORLD_PVP_TOGGLE_COOLDOWN + 1;
    dispatch(server, session, { cmd: 'pvp_flag', on: false });
    expect(p.pvpFlag).toBe(true); // still up: the countdown is running
    expect(sim.worldPvpInfoFor(session.pid)!.disarmRemaining).toBe(300);
  });

  it('a typed /pvp is claimed as a gameplay command and reaches the sim', () => {
    const { server, session, sim, p } = joined();
    dispatch(server, session, { cmd: 'chat', text: '/pvp on' });
    expect(p.pvpFlag).toBe(true);
    (sim as unknown as { time: number }).time += WORLD_PVP_TOGGLE_COOLDOWN + 1;
    dispatch(server, session, { cmd: 'chat', text: '/pvp' });
    expect(sim.worldPvpInfoFor(session.pid)!.disarmRemaining).toBe(300);
  });
});

// The online half of the World PvP spoils (src/sim/pvp/world_pvp_spoils.ts): a
// flagged-vs-flagged kill on the authoritative server puts the killing blow's
// gold and the victim's skull on the body, the body's loot list rides the
// entity wire (so the killer's client can open it), and the ordinary `loot`
// command takes both. This is the regression pin for "gold is not dropping on
// player kills" online.
describe('world pvp spoils over the wire', () => {
  function joinAs(server: GameServer, id: number, name: string) {
    const session = server.join(
      { readyState: 1, send: () => {} } as never,
      id,
      id,
      name,
      'warrior',
      null,
    );
    if ('error' in session) throw new Error(session.error);
    const sim = server.sim;
    sim.setPlayerLevel(20, session.pid);
    const p = sim.entities.get(session.pid) as Entity;
    p.hp = p.maxHp;
    // Contested ground (thornpeak_heights open ground): the mutual-flag rule.
    p.pos = { x: 60 + (id % 2) * 2, y: p.pos.y, z: 700 };
    p.prevPos = { ...p.pos };
    return { session, p };
  }

  it('drops the gold and the skull on the body, sends the loot list, and the loot command takes it', () => {
    const server = new GameServer();
    const sim = server.sim;
    const killer = joinAs(server, 201, 'Aleph');
    const victim = joinAs(server, 202, 'Bet');
    dispatch(server, killer.session, { cmd: 'pvp_flag', on: true });
    dispatch(server, victim.session, { cmd: 'pvp_flag', on: true });
    expect(killer.p.pvpFlag).toBe(true);
    expect(victim.p.pvpFlag).toBe(true);
    sim.meta(killer.session.pid)!.copper = 0;
    sim.meta(victim.session.pid)!.copper = 20_000;
    sim.ctx.dealDamage(killer.p, victim.p, victim.p.hp + 1_000, false, 'physical', 'Slam', 'hit');
    expect(victim.p.dead).toBe(true);

    const wire = wireEntity(victim.p);
    expect(wire.loot).toBe(1);
    expect(wire.tap).toBe(killer.session.pid);
    expect(wire.lootList).toEqual({
      copper: 2_000,
      items: [
        {
          itemId: WORLD_PVP_SKULL_ITEM_ID,
          count: 1,
          materialSources: [
            {
              source: { gatherer: { kind: 'character', id: 202, name: 'Bet' } },
              count: 1,
            },
          ],
          personalFor: [killer.session.pid],
        },
      ],
    });

    dispatch(server, killer.session, { cmd: 'loot', id: victim.session.pid });
    expect(sim.meta(killer.session.pid)!.copper).toBe(2_000);
    expect(sim.meta(victim.session.pid)!.copper).toBe(18_000);
    const skull = sim
      .meta(killer.session.pid)!
      .inventory.find((s) => s.itemId === WORLD_PVP_SKULL_ITEM_ID);
    // One shared skull stack; its source bucket names the victim by character id.
    expect(skull?.instance).toBeUndefined();
    expect(skull?.materialSources).toEqual([
      { source: { gatherer: { kind: 'character', id: 202, name: 'Bet' } }, count: 1 },
    ]);
    expect(wireEntity(victim.p).lootList).toBeUndefined();
  });
});
