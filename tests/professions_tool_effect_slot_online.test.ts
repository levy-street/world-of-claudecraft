// The slot_tool_effect and recharge_tool_effect dispatch cases over the live
// GameServer wire.
//
// The dev gate that used to sit on slot_tool_effect is GONE, and these arms
// are its replacement: the command's price is now enforced by the resolver
// itself (the mint consumes a crafted charm from the sender's own bags), so
// a production realm accepts the command and the free-grant incident's
// attack, a bare hand-built frame, mints nothing because the attacker holds
// no charm. Both directions stay load-bearing: accepted WITH the charm,
// refused (and charge-free, consumption-free) WITHOUT it.
//
// Harness copied from tests/professions_training_online.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db layer so the live GameServer suite needs no Postgres (the
// vi.mock hoisting caveat from #2088 applies: this block cannot reference
// imports).
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
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
}));

import { type ClientSession, GameServer } from '../server/game';
import type { PlayerMeta } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function fakeWs(): { sent: { t: string; list?: SimEvent[]; [k: string]: unknown }[]; ws: unknown } {
  const sent: { t: string; list?: SimEvent[] }[] = [];
  return {
    sent,
    ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) },
  };
}

function joinServer(
  server: GameServer,
  fc: ReturnType<typeof fakeWs>,
  id: number,
  name: string,
): ClientSession {
  const session = server.join(fc.ws as never, id, id, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function metaOf(server: GameServer, pid: number): PlayerMeta {
  const meta = (server.sim as unknown as { players: Map<number, PlayerMeta> }).players.get(pid);
  if (!meta) throw new Error(`no meta for pid ${pid}`);
  return meta;
}

function routeTick(server: GameServer): void {
  (server as unknown as { routeEvents(e: SimEvent[]): void }).routeEvents(server.sim.tick());
}

function cmd(server: GameServer, session: ClientSession, body: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...body }));
}

function toolEffectResultsOf(sent: { t: string; list?: SimEvent[] }[]): SimEvent[] {
  return sent
    .filter((m) => m.t === 'events')
    .flatMap((m) => m.list ?? [])
    .filter((ev) => ev.type === 'toolEffectResult');
}

// Production shape for EVERY arm in this file, the acceptance paths
// included: the claim "a production realm accepts the charm-holding sender"
// is only a claim while the dev env is provably unset.
beforeEach(() => {
  expect(process.env.ALLOW_DEV_COMMANDS).toBeUndefined();
});

describe('slot_tool_effect on a production realm: the charm is the gate now', () => {
  it('mints NOTHING for a charm-less sender, dev env unset, and says so', () => {
    // The free-grant incident's exact attack: a valid tool, a hand-built
    // frame, no crafted charm (the beforeEach pins the production shape).
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Slotter');
    const pid = session.pid as number;
    server.sim.addItem('copper_mining_pick', 1, pid);
    cmd(server, session, {
      cmd: 'slot_tool_effect',
      profession: 'mining',
      effect: 'gatherers_cache',
    });
    // Absent, not empty: the whole absent-by-default contract rides on every
    // deny arm returning before the lazy init.
    expect(metaOf(server, pid).toolEffectSlots).toBeUndefined();
    // And the refusal is not silent: the pid-scoped result event names it.
    routeTick(server);
    const results = toolEffectResultsOf(fc.sent);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      action: 'slot',
      ok: false,
      reason: 'no_charm',
      professionId: 'mining',
    });
  });

  it('mints the slot for a sender holding the charm, consuming it', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Crafter');
    const pid = session.pid as number;
    server.sim.addItem('copper_mining_pick', 1, pid);
    server.sim.addItemInstance('gatherers_cache', { signer: 'Crafter' }, pid, 1);
    cmd(server, session, {
      cmd: 'slot_tool_effect',
      profession: 'mining',
      effect: 'gatherers_cache',
    });
    const meta = metaOf(server, pid);
    expect(meta.toolEffectSlots?.mining?.effectId).toBe('gatherers_cache');
    // The consumed charm's signer became the slot's craftedBy, and the copy
    // is gone: the mint is never free.
    expect(meta.toolEffectSlots?.mining?.craftedBy).toBe('Crafter');
    expect(server.sim.countItem('gatherers_cache', pid)).toBe(0);
    routeTick(server);
    expect(toolEffectResultsOf(fc.sent).at(-1)).toMatchObject({
      action: 'slot',
      ok: true,
      professionId: 'mining',
      effectId: 'gatherers_cache',
    });
  });

  it('toolEffectResult is a HEAVY_SELF_EVENTS member: the actor self-mirror re-diffs', () => {
    // The consumed charm never rides a loot event, so the self inventory
    // mirror converges ONLY because routing this event to its actor sets the
    // session's heavy-dirty flag (server/game.ts routeEvents). Dropping the
    // membership leaves the client's bags stale until the staggered refresh,
    // with every other assertion green: this flag IS the membership.
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Mirror');
    const pid = session.pid as number;
    server.sim.addItem('copper_mining_pick', 1, pid);
    server.sim.addItemInstance('gatherers_cache', { signer: 'Mirror' }, pid, 1);
    cmd(server, session, {
      cmd: 'slot_tool_effect',
      profession: 'mining',
      effect: 'gatherers_cache',
    });
    // slot_tool_effect is deliberately NOT in HEAVY_SELF_CMDS, so any dirty
    // flag below is the EVENT's doing, not the command's.
    (session as unknown as { selfHeavyDirty: boolean }).selfHeavyDirty = false;
    routeTick(server);
    expect(toolEffectResultsOf(fc.sent).at(-1)).toMatchObject({ action: 'slot', ok: true });
    expect((session as unknown as { selfHeavyDirty: boolean }).selfHeavyDirty).toBe(true);
    // The deny arms ride the same event, the family's standing shape.
    (session as unknown as { selfHeavyDirty: boolean }).selfHeavyDirty = false;
    cmd(server, session, {
      cmd: 'slot_tool_effect',
      profession: 'mining',
      effect: 'gatherers_cache',
    });
    routeTick(server);
    expect(toolEffectResultsOf(fc.sent).at(-1)).toMatchObject({ ok: false });
    expect((session as unknown as { selfHeavyDirty: boolean }).selfHeavyDirty).toBe(true);
  });

  it('re-validates the payload sim-side rather than trusting the frame', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Malformed');
    const pid = session.pid as number;
    server.sim.addItem('copper_mining_pick', 1, pid);
    server.sim.addItemInstance('gatherers_cache', { signer: 'Malformed' }, pid, 1);
    // Non-string fields fall out at the shape guard.
    cmd(server, session, { cmd: 'slot_tool_effect', profession: 42, effect: 'gatherers_cache' });
    cmd(server, session, { cmd: 'slot_tool_effect', profession: 'mining', effect: 7 });
    // Unknown ids fall out sim-side.
    cmd(server, session, {
      cmd: 'slot_tool_effect',
      profession: 'skinning',
      effect: 'gatherers_cache',
    });
    cmd(server, session, {
      cmd: 'slot_tool_effect',
      profession: 'mining',
      effect: 'no_such_effect',
    });
    expect(metaOf(server, pid).toolEffectSlots).toBeUndefined();
    // A mode outside the union is passed THROUGH and refused by the sim, so
    // the two hosts agree; laundering it to undefined here would have hit the
    // sim default and turned a refusal into a success.
    cmd(server, session, {
      cmd: 'slot_tool_effect',
      profession: 'mining',
      effect: 'gatherers_cache',
      mode: 'sometimes',
    });
    expect(metaOf(server, pid).toolEffectSlots).toBeUndefined();
    // Every refusal above left the charm unconsumed.
    expect(server.sim.countItem('gatherers_cache', pid)).toBe(1);
    // The control: the same frame minus the bad mode does land.
    cmd(server, session, {
      cmd: 'slot_tool_effect',
      profession: 'mining',
      effect: 'gatherers_cache',
    });
    expect(metaOf(server, pid).toolEffectSlots?.mining?.confirmMode).toBe('always');
    expect(server.sim.countItem('gatherers_cache', pid)).toBe(0);
  });
});

describe('recharge_tool_effect over the wire', () => {
  it('prices, consumes, and refills server-side; the event carries the price paid', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Recharger');
    const pid = session.pid as number;
    server.sim.addItem('copper_mining_pick', 1, pid);
    server.sim.addItemInstance('gatherers_cache', { signer: 'Recharger' }, pid, 1);
    cmd(server, session, {
      cmd: 'slot_tool_effect',
      profession: 'mining',
      effect: 'gatherers_cache',
    });
    const meta = metaOf(server, pid);
    const slot = meta.toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    slot.durability = 0;
    server.sim.addItem('arcane_dust', 10, pid);
    cmd(server, session, { cmd: 'recharge_tool_effect', profession: 'mining' });
    // Common pick, 20-charge fill, original crafter: ceil((20/10) * 0.5) = 1.
    expect(slot.durability).toBe(20);
    expect(slot.maxDurability).toBe(20);
    expect(server.sim.countItem('arcane_dust', pid)).toBe(9);
    routeTick(server);
    expect(toolEffectResultsOf(fc.sent).at(-1)).toMatchObject({
      action: 'recharge',
      ok: true,
      professionId: 'mining',
      effectId: 'gatherers_cache',
      materialItemId: 'arcane_dust',
      count: 1,
    });
  });

  it('refuses a slotless profession and a non-string frame without touching anything', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'NoSlot');
    const pid = session.pid as number;
    server.sim.addItem('copper_mining_pick', 1, pid);
    server.sim.addItem('arcane_dust', 10, pid);
    cmd(server, session, { cmd: 'recharge_tool_effect', profession: 42 });
    cmd(server, session, { cmd: 'recharge_tool_effect', profession: 'mining' });
    expect(server.sim.countItem('arcane_dust', pid)).toBe(10);
    routeTick(server);
    const results = toolEffectResultsOf(fc.sent);
    // Only the well-formed frame reached the sim; it answered no_slot.
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ action: 'recharge', ok: false, reason: 'no_slot' });
  });
});
