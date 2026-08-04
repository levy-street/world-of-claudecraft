// Enchanting COMMANDS across both worlds (the seam the content wave
// left un-wired): the Sim command methods (disenchantItem/applyEnchant/
// salvageItem) each stash their outcome AND emit their pid-scoped, text-free
// event exactly once; the live GameServer routes disenchant_item/apply_enchant/
// salvage_item to the sim resolver and mirrors the outcome back over BOTH the
// pid-scoped event (immediacy) and the denc/ench/salv self-delta (convergence);
// and the ClientWorld read surface (lastDisenchantResult/lastEnchantResult/
// lastSalvageResult) updates from each arm. The #2033 stub-trap class: a dropped
// wire case or a stripped reason leaves every offline resolver test green, so the
// online routing arm is load-bearing. The stash/round-trip codec is additionally
// pinned in tests/snapshots.test.ts; the resolver semantics in
// tests/professions_enchanting.test.ts and tests/professions_typed_reagents.test.ts.
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so the live GameServer suite needs no Postgres (the vi.mock
// hoisting caveat from #2088 applies: this block cannot reference imports).
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
}));

import { type ClientSession, GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';
import { CRAFT_THROTTLE_MAX_PER_WINDOW } from '../src/sim/professions/action_throttle';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { bareClient } from './helpers/bare_client';

// A common-quality one-hand weapon: disenchants to arcane_dust with NO typed
// secondary, salvages to bone_fragments, and takes the mainhand Might enchant.
const COMMON_WEAPON = 'eastbrook_arming_sword';
// A rare mace: disenchants to a FIXED single arcane_essence primary PLUS one
// typed, bind-on-trade secondary (resonant_steel), zero rng draws. Pinned in
// tests/professions_typed_reagents.test.ts.
const RARE_WEAPON = 'moggers_copper_cudgel';
const RARE_PRIMARY = 'arcane_essence';
const RARE_SECONDARY = 'resonant_steel';
// enchant_weapon_might: itemSlot 'mainhand', reagents 5x arcane_dust, str +2
// (the magnitude is pinned to that literal in enchants_magnitude_invariants).
const WEAPON_ENCHANT = 'enchant_weapon_might';
// A helmet enchant, used to exercise the wrong_slot deny on the weapon above.
const HELMET_ENCHANT = 'enchant_helmet_fortitude';
const DUST = 'arcane_dust';
// A second common one-hand weapon (def slot 'mainhand', so the same Might enchant
// applies), used as the WORN target when a copy of COMMON_WEAPON is already
// enchanted and sitting in the bags.
const WORN_WEAPON = 'bronzework_mace';

const makeSim = (seed = 7): Sim => new Sim({ seed, playerClass: 'warrior', autoEquip: false });

function eventsOfType(events: SimEvent[], type: SimEvent['type']): SimEvent[] {
  return events.filter((ev) => ev.type === type);
}

// ---------------------------------------------------------------------------
// Offline Sim: the command methods stash + emit exactly once, both arms.
// ---------------------------------------------------------------------------
describe('offline Sim enchanting commands: stash + single pid-scoped emit', () => {
  it('salvageItem stashes lastSalvageResult and emits salvageResult exactly once (success)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem(COMMON_WEAPON, 1, pid);
    sim.drainEvents();
    sim.salvageItem(COMMON_WEAPON, pid);
    const salv = eventsOfType(sim.drainEvents(), 'salvageResult');
    expect(salv).toHaveLength(1);
    if (salv[0].type !== 'salvageResult') throw new Error('expected salvageResult');
    expect(salv[0].ok).toBe(true);
    expect(salv[0].itemId).toBe(COMMON_WEAPON);
    expect(salv[0].materialItemId).toBe('bone_fragments');
    expect(salv[0].count).toBeGreaterThan(0);
    expect(salv[0].pid).toBe(pid);
    // The stash mirrors the event's payload.
    expect(sim.lastSalvageResult).toEqual({
      ok: true,
      itemId: COMMON_WEAPON,
      materialItemId: 'bone_fragments',
      count: salv[0].count,
    });
    expect(sim.lastSalvageResultFor(pid)).toEqual(sim.lastSalvageResult);
  });

  it('disenchantItem emits the typed secondary on a rare+ piece (fixed primary, one secondary)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem(RARE_WEAPON, 1, pid);
    sim.drainEvents();
    sim.disenchantItem(RARE_WEAPON, pid);
    const denc = eventsOfType(sim.drainEvents(), 'disenchantResult');
    expect(denc).toHaveLength(1);
    if (denc[0].type !== 'disenchantResult') throw new Error('expected disenchantResult');
    expect(denc[0].ok).toBe(true);
    expect(denc[0].itemId).toBe(RARE_WEAPON);
    expect(denc[0].materialItemId).toBe(RARE_PRIMARY);
    expect(denc[0].count).toBe(1);
    expect(denc[0].secondaryItemId).toBe(RARE_SECONDARY);
    expect(denc[0].secondaryCount).toBe(1);
    expect(denc[0].pid).toBe(pid);
    expect(sim.lastDisenchantResult).toEqual({
      ok: true,
      itemId: RARE_WEAPON,
      materialItemId: RARE_PRIMARY,
      count: 1,
      secondaryItemId: RARE_SECONDARY,
      secondaryCount: 1,
    });
    // The typed secondary rode ctx.addItemInstance with { bindOnTrade: true }.
    const secondarySlot = sim.inventory.find((s) => s.itemId === RARE_SECONDARY);
    expect(secondarySlot?.instance?.bindOnTrade).toBe(true);
  });

  it('a sub-rare disenchant carries no secondary fields', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem(COMMON_WEAPON, 1, pid);
    sim.drainEvents();
    sim.disenchantItem(COMMON_WEAPON, pid);
    const denc = eventsOfType(sim.drainEvents(), 'disenchantResult')[0];
    if (denc?.type !== 'disenchantResult') throw new Error('expected disenchantResult');
    expect(denc.ok).toBe(true);
    expect(denc.materialItemId).toBe(DUST);
    expect(denc.secondaryItemId).toBeUndefined();
    expect(denc.secondaryCount).toBeUndefined();
  });

  it('applyEnchant stashes lastEnchantResult and emits enchantResult exactly once (success)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem(COMMON_WEAPON, 1, pid);
    sim.addItem(DUST, 5, pid);
    sim.drainEvents();
    sim.applyEnchant(COMMON_WEAPON, WEAPON_ENCHANT, undefined, undefined, pid);
    const ench = eventsOfType(sim.drainEvents(), 'enchantResult');
    expect(ench).toHaveLength(1);
    if (ench[0].type !== 'enchantResult') throw new Error('expected enchantResult');
    expect(ench[0].ok).toBe(true);
    expect(ench[0].itemId).toBe(COMMON_WEAPON);
    expect(ench[0].enchantId).toBe(WEAPON_ENCHANT);
    expect(ench[0].reason).toBeUndefined();
    expect(ench[0].pid).toBe(pid);
    expect(sim.lastEnchantResult).toEqual({
      ok: true,
      itemId: COMMON_WEAPON,
      enchantId: WEAPON_ENCHANT,
    });
  });

  it('a deny surfaces the reason through BOTH the event and the stash, inventory untouched', () => {
    const sim = makeSim();
    const pid = sim.playerId;

    // salvage of a not-held item.
    sim.drainEvents();
    sim.salvageItem(COMMON_WEAPON, pid);
    const salvDeny = eventsOfType(sim.drainEvents(), 'salvageResult')[0];
    if (salvDeny?.type !== 'salvageResult') throw new Error('expected salvageResult');
    expect(salvDeny.ok).toBe(false);
    expect(salvDeny.reason).toBe('not_held');
    expect(sim.lastSalvageResult?.reason).toBe('not_held');

    // wrong_slot enchant deny: the sword is held but the enchant targets a helmet.
    sim.addItem(COMMON_WEAPON, 1, pid);
    sim.addItem(DUST, 5, pid);
    sim.drainEvents();
    sim.applyEnchant(COMMON_WEAPON, HELMET_ENCHANT, undefined, undefined, pid);
    const wrongSlot = eventsOfType(sim.drainEvents(), 'enchantResult')[0];
    if (wrongSlot?.type !== 'enchantResult') throw new Error('expected enchantResult');
    expect(wrongSlot.ok).toBe(false);
    expect(wrongSlot.reason).toBe('wrong_slot');
    expect(sim.lastEnchantResult?.reason).toBe('wrong_slot');
    // ok:false left the inventory untouched: sword and dust still held.
    expect(sim.countItem(COMMON_WEAPON, pid)).toBe(1);
    expect(sim.countItem(DUST, pid)).toBe(5);

    // insufficient_materials enchant deny (sword held, no dust).
    const sim2 = makeSim(11);
    const pid2 = sim2.playerId;
    sim2.addItem(COMMON_WEAPON, 1, pid2);
    sim2.drainEvents();
    sim2.applyEnchant(COMMON_WEAPON, WEAPON_ENCHANT, undefined, undefined, pid2);
    const shortMats = eventsOfType(sim2.drainEvents(), 'enchantResult')[0];
    if (shortMats?.type !== 'enchantResult') throw new Error('expected enchantResult');
    expect(shortMats.reason).toBe('insufficient_materials');
    expect(sim2.countItem(COMMON_WEAPON, pid2)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Replay / dup safety + the shared-window throttle boundary.
// ---------------------------------------------------------------------------
describe('offline Sim enchanting commands: replay + throttle safety', () => {
  it('running the same command twice with one held copy destroys once, second is not_held', () => {
    for (const kind of ['salvage', 'disenchant', 'enchant'] as const) {
      const sim = makeSim();
      const pid = sim.playerId;
      sim.addItem(COMMON_WEAPON, 1, pid);
      if (kind === 'enchant') sim.addItem(DUST, 10, pid); // enough for two applies if it re-granted

      const run = () => {
        if (kind === 'salvage') sim.salvageItem(COMMON_WEAPON, pid);
        else if (kind === 'disenchant') sim.disenchantItem(COMMON_WEAPON, pid);
        else sim.applyEnchant(COMMON_WEAPON, WEAPON_ENCHANT, undefined, undefined, pid);
      };

      run();
      // The one held copy was consumed exactly once. salvage/disenchant destroy
      // the piece outright (0 left); enchant transforms it into an enchanted
      // instance of the SAME itemId (total stays 1, but it is no longer eligible),
      // so a replay still can never re-consume it.
      if (kind === 'enchant') {
        expect(sim.countItem(COMMON_WEAPON, pid), kind).toBe(1);
        expect(sim.countEnchantableItem(COMMON_WEAPON, pid), kind).toBe(0);
      } else {
        expect(sim.countItem(COMMON_WEAPON, pid), kind).toBe(0);
      }
      const first =
        kind === 'salvage'
          ? sim.lastSalvageResult
          : kind === 'disenchant'
            ? sim.lastDisenchantResult
            : sim.lastEnchantResult;
      expect(first?.ok, kind).toBe(true);

      sim.drainEvents();
      run();
      // The second command finds nothing to act on: exactly one deny, no
      // second destruction or grant. salvage/disenchant destroyed the copy, so
      // theirs is not_held; the enchant replay finds the copy still present
      // but already enchanted, and names that real cause (#2415).
      const second =
        kind === 'salvage'
          ? sim.lastSalvageResult
          : kind === 'disenchant'
            ? sim.lastDisenchantResult
            : sim.lastEnchantResult;
      expect(second?.ok, kind).toBe(false);
      expect(second?.reason, kind).toBe(kind === 'enchant' ? 'already_enchanted' : 'not_held');
    }
  });

  it('the (MAX+1)th action in the 60s window denies throttled BEFORE any inventory change', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // One more copy than the shared window allows, all held at once (no sim.tick,
    // so sim.time never advances the window).
    const copies = CRAFT_THROTTLE_MAX_PER_WINDOW + 1;
    sim.addItem(COMMON_WEAPON, copies, pid);

    for (let i = 0; i < CRAFT_THROTTLE_MAX_PER_WINDOW; i++) {
      sim.salvageItem(COMMON_WEAPON, pid);
      expect(sim.lastSalvageResult?.ok, `salvage #${i + 1}`).toBe(true);
    }
    // Exactly at the boundary (the 12b lesson: assert AT the boundary): the
    // budget is spent, so the next action denies with no consumption.
    expect(sim.countItem(COMMON_WEAPON, pid)).toBe(1);
    sim.drainEvents();
    sim.salvageItem(COMMON_WEAPON, pid);
    const throttled = eventsOfType(sim.drainEvents(), 'salvageResult')[0];
    if (throttled?.type !== 'salvageResult') throw new Error('expected salvageResult');
    expect(throttled.ok).toBe(false);
    expect(throttled.reason).toBe('throttled');
    // The throttled action consumed nothing: the last copy is still held.
    expect(sim.countItem(COMMON_WEAPON, pid)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Live GameServer wire routing: each command routes to the sim resolver and the
// outcome returns over BOTH the pid-scoped event AND the self-delta, and lands
// in a real ClientWorld read surface. Modeled on
// tests/professions_training_online.test.ts + tests/snapshots.test.ts.
// ---------------------------------------------------------------------------
const FIELD_POS = { x: 0, z: 150 };

function fakeWs(): { sent: { t: string; list?: SimEvent[]; [k: string]: unknown }[]; ws: unknown } {
  const sent: { t: string; list?: SimEvent[] }[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
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

function placeAt(server: GameServer, pid: number, pos: { x: number; z: number }): void {
  const entity = (
    server.sim as unknown as { entities: Map<number, { pos: any; prevPos?: any }> }
  ).entities.get(pid);
  if (!entity) throw new Error(`no entity for pid ${pid}`);
  entity.pos.x = pos.x;
  entity.pos.z = pos.z;
  entity.prevPos = { x: pos.x, z: pos.z };
}

function routeTick(server: GameServer): void {
  (server as unknown as { routeEvents(e: SimEvent[]): void }).routeEvents(server.sim.tick());
}

function broadcast(server: GameServer): void {
  (server as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();
}

function lastSnap(sent: { t: string; self?: any }[]): { self: Record<string, unknown> } | null {
  for (let i = sent.length - 1; i >= 0; i--) if (sent[i].t === 'snap') return sent[i] as any;
  return null;
}

function cmd(server: GameServer, session: ClientSession, body: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...body }));
}

function eventsFor(sent: { t: string; list?: SimEvent[] }[], type: SimEvent['type']): SimEvent[] {
  return sent
    .filter((m) => m.t === 'events')
    .flatMap((m) => m.list ?? [])
    .filter((ev) => ev.type === type);
}

function metaOf(server: GameServer, pid: number): PlayerMeta {
  const meta = (server.sim as unknown as { players: Map<number, PlayerMeta> }).players.get(pid);
  if (!meta) throw new Error(`no meta for pid ${pid}`);
  return meta;
}

describe('enchanting commands over the live GameServer wire (event + delta routing)', () => {
  it('disenchant_item routes the pid-scoped event AND the denc delta into a ClientWorld', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const fcOther = fakeWs();
    const st = joinServer(server, fc, 401, 'Dis');
    joinServer(server, fcOther, 402, 'Bystander');
    placeAt(server, st.pid, FIELD_POS);
    server.sim.addItem(COMMON_WEAPON, 1, st.pid);

    cmd(server, st, { cmd: 'disenchant_item', item: COMMON_WEAPON });
    routeTick(server);

    // Immediacy arm: exactly one pid-scoped disenchantResult, owner only.
    const denc = eventsFor(fc.sent, 'disenchantResult');
    expect(denc).toHaveLength(1);
    if (denc[0].type !== 'disenchantResult') throw new Error('expected disenchantResult');
    expect(denc[0].ok).toBe(true);
    expect(denc[0].pid).toBe(st.pid);
    expect(eventsFor(fcOther.sent, 'disenchantResult')).toEqual([]);

    // Convergence arm: the denc self-delta mirrors the server stash, and a real
    // ClientWorld decodes it onto lastDisenchantResult.
    broadcast(server);
    const snap = lastSnap(fc.sent);
    if (!snap) throw new Error('no snapshot');
    const stash = server.sim.lastDisenchantResultFor(st.pid);
    expect(snap.self.denc).toEqual(stash);
    const client = bareClient(st.pid);
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(snap);
    expect(client.lastDisenchantResult).toEqual(stash);
  });

  it('apply_enchant routes the enchantResult event AND the ench delta into a ClientWorld', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 403, 'Ench');
    placeAt(server, st.pid, FIELD_POS);
    server.sim.addItem(COMMON_WEAPON, 1, st.pid);
    server.sim.addItem(DUST, 5, st.pid);

    cmd(server, st, { cmd: 'apply_enchant', item: COMMON_WEAPON, enchant: WEAPON_ENCHANT });
    routeTick(server);

    const ench = eventsFor(fc.sent, 'enchantResult');
    expect(ench).toHaveLength(1);
    if (ench[0].type !== 'enchantResult') throw new Error('expected enchantResult');
    expect(ench[0].ok).toBe(true);
    expect(ench[0].enchantId).toBe(WEAPON_ENCHANT);
    expect(ench[0].pid).toBe(st.pid);

    broadcast(server);
    const snap = lastSnap(fc.sent);
    if (!snap) throw new Error('no snapshot');
    const stash = server.sim.lastEnchantResultFor(st.pid);
    expect(snap.self.ench).toEqual(stash);
    const client = bareClient(st.pid);
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(snap);
    expect(client.lastEnchantResult).toEqual(stash);
  });

  it('apply_enchant with confirm: true replaces over the wire and the replaced payload mirrors back (#2415)', () => {
    const AGILITY = 'enchant_weapon_agility';
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 409, 'Repl');
    placeAt(server, st.pid, FIELD_POS);
    server.sim.ctx.addItemInstance(
      COMMON_WEAPON,
      { signer: 'Tester', enchant: WEAPON_ENCHANT, rolled: { stats: { str: 2 } } },
      st.pid,
    );
    server.sim.addItem(DUST, 5, st.pid);

    cmd(server, st, {
      cmd: 'apply_enchant',
      item: COMMON_WEAPON,
      enchant: AGILITY,
      confirm: true,
    });
    routeTick(server);

    const ench = eventsFor(fc.sent, 'enchantResult');
    expect(ench).toHaveLength(1);
    if (ench[0].type !== 'enchantResult') throw new Error('expected enchantResult');
    expect(ench[0].ok).toBe(true);
    expect(ench[0].enchantId).toBe(AGILITY);

    // Server-side truth: the enchant layer swapped, the signer rode through.
    const slot = metaOf(server, st.pid).inventory.find((s) => s.itemId === COMMON_WEAPON);
    expect(slot?.instance?.enchant).toBe(AGILITY);
    expect(slot?.instance?.rolled?.stats).toEqual({ agi: 2 });
    expect(slot?.instance?.signer).toBe('Tester');

    // The replaced payload converges into a real ClientWorld's inventory
    // mirror (enchantResult is a HEAVY_SELF_EVENTS member, so the self inv
    // re-diffs even though the replace minted through the loot path).
    broadcast(server);
    const snap = lastSnap(fc.sent);
    if (!snap) throw new Error('no snapshot');
    const client = bareClient(st.pid);
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(snap);
    const mirrored = client.inventory.find((s) => s.itemId === COMMON_WEAPON);
    expect(mirrored?.instance?.enchant).toBe(AGILITY);
    expect(mirrored?.instance?.signer).toBe('Tester');
  });

  it('the dispatch confirm guard is a STRICT boolean check: a truthy non-boolean reads as unconfirmed', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 410, 'Strict');
    placeAt(server, st.pid, FIELD_POS);
    server.sim.ctx.addItemInstance(
      COMMON_WEAPON,
      { enchant: WEAPON_ENCHANT, rolled: { stats: { str: 2 } } },
      st.pid,
    );
    server.sim.addItem(DUST, 5, st.pid);

    // The house dispatch rule (`msg.confirm === true`): anything else is the
    // unconfirmed path, which denies with the dedicated honest reason and
    // consumes nothing. Two truthy non-booleans, so neither the string nor
    // the number arm of a loosened check can slip through.
    for (const confirm of ['yes', 1] as const) {
      cmd(server, st, {
        cmd: 'apply_enchant',
        item: COMMON_WEAPON,
        enchant: 'enchant_weapon_agility',
        confirm,
      });
      routeTick(server);
    }
    const ench = eventsFor(fc.sent, 'enchantResult');
    expect(ench).toHaveLength(2);
    for (const ev of ench) {
      if (ev.type !== 'enchantResult') throw new Error('expected enchantResult');
      expect(ev.ok).toBe(false);
      expect(ev.reason).toBe('already_enchanted');
    }
    const slot = metaOf(server, st.pid).inventory.find((s) => s.itemId === COMMON_WEAPON);
    expect(slot?.instance?.enchant).toBe(WEAPON_ENCHANT);
    expect(server.sim.countItem(DUST, st.pid)).toBe(5);
  });

  it('a confirmed WORN replace over the wire swaps in place and the eqi mirror carries the new payload', () => {
    const AGILITY = 'enchant_weapon_agility';
    const server = new GameServer();
    const fc = fakeWs();
    const fcWatch = fakeWs();
    const st = joinServer(server, fc, 411, 'WornRepl');
    const watch = joinServer(server, fcWatch, 412, 'WornWatch');
    placeAt(server, st.pid, FIELD_POS);
    placeAt(server, watch.pid, FIELD_POS);
    // Wear an enchanted, signed copy through the real equip path, then
    // confirm-replace it over the live dispatch.
    server.sim.ctx.addItemInstance(
      COMMON_WEAPON,
      { signer: 'Tester', enchant: AGILITY, rolled: { stats: { agi: 2 } } },
      st.pid,
    );
    server.sim.equipItemToSlot(COMMON_WEAPON, 'mainhand', st.pid);
    server.sim.addItem(DUST, 5, st.pid);

    cmd(server, st, {
      cmd: 'apply_enchant',
      item: COMMON_WEAPON,
      enchant: WEAPON_ENCHANT,
      slot: 'mainhand',
      confirm: true,
    });
    routeTick(server);

    const ench = eventsFor(fc.sent, 'enchantResult');
    expect(ench).toHaveLength(1);
    if (ench[0].type !== 'enchantResult') throw new Error('expected enchantResult');
    expect(ench[0].ok).toBe(true);
    expect(ench[0].enchantId).toBe(WEAPON_ENCHANT);

    // Server truth: replaced in place, signer intact, reagents spent.
    const meta = metaOf(server, st.pid);
    expect(meta.equipmentInstance.mainhand?.enchant).toBe(WEAPON_ENCHANT);
    expect(meta.equipmentInstance.mainhand?.rolled?.stats).toEqual({ str: 2 });
    expect(meta.equipmentInstance.mainhand?.signer).toBe('Tester');
    expect(server.sim.countItem(DUST, st.pid)).toBe(0);

    // The eqi identity mirror re-diffs for an ONLOOKER: the watcher's full
    // record for the wearer carries the replaced payload (allowlisted fields
    // only: signer/enchant/rolled, never the lock flags), proving the
    // identity JSON diff fired on the in-place swap, and a real ClientWorld
    // decodes it onto the wearer's equippedInstances.
    fcWatch.sent.length = 0;
    broadcast(server);
    const snap = lastSnap(fcWatch.sent) as unknown as { ents: Record<string, any>[] } | null;
    if (!snap) throw new Error('no snapshot');
    const record = snap.ents.find((r) => r.id === st.pid);
    expect(record?.eqi).toEqual({
      mainhand: { signer: 'Tester', enchant: WEAPON_ENCHANT, rolled: { stats: { str: 2 } } },
    });
    const client = bareClient(watch.pid);
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(snap);
    expect(client.entities.get(st.pid)?.equippedInstances.mainhand?.enchant).toBe(WEAPON_ENCHANT);
  });

  it('apply_enchant with a worn slot enchants in place and the eqi mirror carries it', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const fcWatch = fakeWs();
    const st = joinServer(server, fc, 407, 'Wearer');
    const watch = joinServer(server, fcWatch, 408, 'Watcher');
    placeAt(server, st.pid, FIELD_POS);
    placeAt(server, watch.pid, FIELD_POS);
    server.sim.addItem(COMMON_WEAPON, 1, st.pid);
    server.sim.equipItemToSlot(COMMON_WEAPON, 'mainhand', st.pid);
    server.sim.addItem(DUST, 5, st.pid);
    const strBefore = server.sim.entities.get(st.pid)!.stats.str;

    cmd(server, st, {
      cmd: 'apply_enchant',
      item: COMMON_WEAPON,
      enchant: WEAPON_ENCHANT,
      slot: 'mainhand',
    });
    routeTick(server);

    const ench = eventsFor(fc.sent, 'enchantResult');
    expect(ench).toHaveLength(1);
    if (ench[0].type !== 'enchantResult') throw new Error('expected enchantResult');
    expect(ench[0].ok).toBe(true);
    // In PLACE: the piece never left the slot, nothing entered the bags, and the
    // reagents were spent. enchant_weapon_might is str +2.
    const meta = metaOf(server, st.pid);
    expect(meta.equipment.mainhand).toBe(COMMON_WEAPON);
    expect(meta.equipmentInstance.mainhand?.enchant).toBe(WEAPON_ENCHANT);
    expect(server.sim.countItem(COMMON_WEAPON, st.pid)).toBe(0);
    expect(server.sim.countItem(DUST, st.pid)).toBe(0);
    expect(server.sim.entities.get(st.pid)!.stats.str).toBe(strBefore + 2);

    // The eqi identity key re-diffs off the rebuilt render mirror, so the next
    // broadcast carries the new payload to an onlooker with no extra dirtying.
    fcWatch.sent.length = 0;
    broadcast(server);
    const snap = lastSnap(fcWatch.sent) as unknown as { ents: Record<string, any>[] } | null;
    if (!snap) throw new Error('no snapshot');
    const record = snap.ents.find((r) => r.id === st.pid);
    expect(record?.eqi).toEqual({
      mainhand: { enchant: WEAPON_ENCHANT, rolled: { stats: { str: 2 } } },
    });
    const client = bareClient(watch.pid);
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(snap);
    expect(client.entities.get(st.pid)?.equippedInstances.mainhand?.enchant).toBe(WEAPON_ENCHANT);
  });

  it('the worn arm re-diffs the self inv mirror: the spent reagents leave the bag at once', () => {
    // The worn arm mints NOTHING, so it emits no loot event: without
    // 'enchantResult' in HEAVY_SELF_EVENTS the enchant itself would still show
    // immediately (it rides the eqi identity diff) while the spent reagents
    // lingered in the bag mirror for up to HEAVY_SELF_REFRESH_TICKS. Same shape as
    // the unbindResult pin in tests/professions_commissions.test.ts.
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 440, 'Fresh');
    placeAt(server, st.pid, FIELD_POS);
    // A BAGGED apply first, purely to burn the one-off first-enchant deed grant:
    // a deed grant bumps meta.wireRev, which is an INDEPENDENT heavy-self trigger
    // (server/game.ts heavyDue) and would otherwise mask what this test pins.
    server.sim.addItem(COMMON_WEAPON, 1, st.pid);
    server.sim.addItem(DUST, 5, st.pid);
    cmd(server, st, { cmd: 'apply_enchant', item: COMMON_WEAPON, enchant: WEAPON_ENCHANT });
    routeTick(server);
    expect(server.sim.lastEnchantResultFor(st.pid)?.ok).toBe(true);

    // Now the real subject: a plain WORN piece plus fresh reagents.
    server.sim.addItem(WORN_WEAPON, 1, st.pid);
    server.sim.equipItemToSlot(WORN_WEAPON, 'mainhand', st.pid);
    server.sim.addItem(DUST, 5, st.pid);
    routeTick(server);

    const lastInvFrom = (fromIdx: number) => {
      for (let i = fc.sent.length - 1; i >= fromIdx; i--) {
        const m = fc.sent[i] as { t: string; self?: Record<string, unknown> };
        if (m.t === 'snap' && m.self && 'inv' in m.self) {
          return m.self.inv as { itemId: string; count: number }[];
        }
      }
      return null;
    };

    // Flush the heavy self mirror: this broadcast establishes a lastSent inv that
    // still carries all 5 dust.
    broadcast(server);
    const flushed = lastInvFrom(0);
    expect(flushed).not.toBeNull();
    expect(flushed?.find((s) => s.itemId === DUST)?.count).toBe(5);
    // Negative control: with the dirty flag flushed, wireRev settled, and the
    // stagger not due, a further broadcast re-sends no inv at all. So the ONLY
    // thing that can re-diff inv below is enchantResult's HEAVY_SELF_EVENTS
    // membership.
    let controlFrom = fc.sent.length;
    broadcast(server);
    if (lastInvFrom(controlFrom) !== null) {
      // The staggered safety refresh happened to land on that tick; step past it.
      broadcast(server);
      controlFrom = fc.sent.length;
      broadcast(server);
    }
    expect(lastInvFrom(controlFrom), 'negative control: no dirty, no inv re-send').toBeNull();

    const beforeCmd = fc.sent.length;
    cmd(server, st, {
      cmd: 'apply_enchant',
      item: WORN_WEAPON,
      enchant: WEAPON_ENCHANT,
      slot: 'mainhand',
    });
    routeTick(server);
    const ench = eventsFor(fc.sent, 'enchantResult').slice(-1);
    if (ench[0]?.type !== 'enchantResult') throw new Error('expected enchantResult');
    expect(ench[0].ok).toBe(true);
    // Nothing entered the bags, so no loot event fired on this arm.
    expect(
      fc.sent
        .slice(beforeCmd)
        .filter((m) => m.t === 'events')
        .flatMap((m) => m.list ?? [])
        .filter((ev) => ev.type === 'loot'),
    ).toEqual([]);

    // Neutralize the two OTHER heavy-self triggers so this pin measures exactly
    // one thing. meta.wireRev is bumped by any deed grant the skill gain unlocks,
    // which is incidental (a veteran enchanter with every enchanting deed already
    // earned gets no bump, and that is the player this fix is for); the staggered
    // safety refresh is the ~2s backstop the fix exists to beat. With both pinned
    // aside, only enchantResult's HEAVY_SELF_EVENTS membership can re-send inv.
    const session = st as unknown as { lastWireRev: number };
    session.lastWireRev = metaOf(server, st.pid).wireRev;
    // 40 = server/game.ts HEAVY_SELF_REFRESH_TICKS (not exported); pinned as a
    // literal so a change to the backstop cadence surfaces here.
    expect((server.sim.tickCount + st.pid) % 40).not.toBe(0);
    const afterFrom = fc.sent.length;
    broadcast(server);
    const lastInv = lastInvFrom(afterFrom);
    expect(lastInv, 'enchantResult re-diffed the heavy inv mirror').not.toBeNull();
    // The dust is gone from the WIRE copy, not just from the server's own state.
    expect(lastInv?.find((s) => s.itemId === DUST)).toBeUndefined();
  });

  it('a garbage slot value falls back to the bagged arm: no throw, no worn write', () => {
    for (const [i, bogus] of [42, 'not_a_slot', { slot: 'mainhand' }, null].entries()) {
      const server = new GameServer();
      const fc = fakeWs();
      const st = joinServer(server, fc, 420 + i, `Fuzz${i}`);
      placeAt(server, st.pid, FIELD_POS);
      // The copy lives in the BAGS, and nothing of this id is worn.
      server.sim.addItem(COMMON_WEAPON, 1, st.pid);
      server.sim.addItem(DUST, 5, st.pid);
      const meta = metaOf(server, st.pid);
      expect(meta.equipment.mainhand).not.toBe(COMMON_WEAPON);

      cmd(server, st, {
        cmd: 'apply_enchant',
        item: COMMON_WEAPON,
        enchant: WEAPON_ENCHANT,
        slot: bogus,
      });
      routeTick(server);

      // Anything that is not a real equipment key reads as undefined, which IS
      // the bagged arm: the mint landed in the inventory and no worn slot was
      // written. Nothing threw.
      const ench = eventsFor(fc.sent, 'enchantResult');
      expect(ench, String(bogus)).toHaveLength(1);
      if (ench[0].type !== 'enchantResult') throw new Error('expected enchantResult');
      expect(ench[0].ok, String(bogus)).toBe(true);
      expect(meta.equipmentInstance.mainhand?.enchant, String(bogus)).toBeUndefined();
      const minted = meta.inventory.find(
        (s) => s.itemId === COMMON_WEAPON && s.instance?.enchant === WEAPON_ENCHANT,
      );
      expect(minted, String(bogus)).toBeDefined();
    }
  });

  it('a real slot the client does not actually wear that item in is refused (server authority)', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 430, 'Liar');
    placeAt(server, st.pid, FIELD_POS);
    server.sim.addItem(COMMON_WEAPON, 1, st.pid); // bagged, NOT worn
    server.sim.addItem(DUST, 5, st.pid);

    cmd(server, st, {
      cmd: 'apply_enchant',
      item: COMMON_WEAPON,
      enchant: WEAPON_ENCHANT,
      slot: 'offhand',
    });
    routeTick(server);

    const ench = eventsFor(fc.sent, 'enchantResult');
    expect(ench).toHaveLength(1);
    if (ench[0].type !== 'enchantResult') throw new Error('expected enchantResult');
    expect(ench[0].ok).toBe(false);
    expect(ench[0].reason).toBe('not_held');
    // Nothing was consumed and no payload was invented for the empty slot: the
    // named slot is a request, never a claim the sim trusts.
    const meta = metaOf(server, st.pid);
    expect(meta.equipmentInstance.offhand).toBeUndefined();
    expect(server.sim.countItem(DUST, st.pid)).toBe(5);
    expect(server.sim.countItem(COMMON_WEAPON, st.pid)).toBe(1);
  });

  it('salvage_item routes the salvageResult event AND the salv delta into a ClientWorld', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 404, 'Salv');
    placeAt(server, st.pid, FIELD_POS);
    server.sim.addItem(COMMON_WEAPON, 1, st.pid);

    cmd(server, st, { cmd: 'salvage_item', item: COMMON_WEAPON });
    routeTick(server);

    const salv = eventsFor(fc.sent, 'salvageResult');
    expect(salv).toHaveLength(1);
    if (salv[0].type !== 'salvageResult') throw new Error('expected salvageResult');
    expect(salv[0].ok).toBe(true);
    expect(salv[0].pid).toBe(st.pid);

    broadcast(server);
    const snap = lastSnap(fc.sent);
    if (!snap) throw new Error('no snapshot');
    const stash = server.sim.lastSalvageResultFor(st.pid);
    expect(snap.self.salv).toEqual(stash);
    const client = bareClient(st.pid);
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(snap);
    expect(client.lastSalvageResult).toEqual(stash);
  });

  it('a malformed command (missing/wrong-typed field) is ignored: no crash, no event', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 405, 'Fuzzer');
    placeAt(server, st.pid, FIELD_POS);
    server.sim.addItem(COMMON_WEAPON, 1, st.pid);

    cmd(server, st, { cmd: 'disenchant_item', item: 42 });
    cmd(server, st, { cmd: 'apply_enchant', item: COMMON_WEAPON }); // enchant missing
    cmd(server, st, { cmd: 'salvage_item' }); // item missing
    routeTick(server);

    expect(eventsFor(fc.sent, 'disenchantResult')).toEqual([]);
    expect(eventsFor(fc.sent, 'enchantResult')).toEqual([]);
    expect(eventsFor(fc.sent, 'salvageResult')).toEqual([]);
    // No side effect: the piece is still held (nothing was consumed).
    expect(server.sim.countItem(COMMON_WEAPON, st.pid)).toBe(1);
  });

  it('a rare disenchant online mirrors the typed secondary into the client inventory as a bind-on-trade stack', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 406, 'Rarely');
    placeAt(server, st.pid, FIELD_POS);
    server.sim.addItem(RARE_WEAPON, 1, st.pid);

    cmd(server, st, { cmd: 'disenchant_item', item: RARE_WEAPON });
    routeTick(server);

    const denc = eventsFor(fc.sent, 'disenchantResult')[0];
    if (denc?.type !== 'disenchantResult') throw new Error('expected disenchantResult');
    expect(denc.secondaryItemId).toBe(RARE_SECONDARY);
    expect(denc.secondaryCount).toBe(1);

    // The loot event marks the session heavy-dirty, so the self inventory
    // refreshes (exactly like a craft): the mirrored client inventory carries the
    // typed secondary as an instanced stack with bindOnTrade set. Wire data
    // minimization is asymmetric on purpose: the OWNER must see their own payload
    // in full (the self `inv` mirror is unfiltered), so bindOnTrade survives here.
    // Only the FOREIGN inspect path (server/game.ts eqi allowlist) strips it, which
    // the "strips non-cosmetic instance fields" pin in tests/snapshots.test.ts
    // guards for boundTo/charges/bindOnTrade alike.
    broadcast(server);
    const snap = lastSnap(fc.sent);
    if (!snap) throw new Error('no snapshot');
    const client = bareClient(st.pid);
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(snap);
    const secondarySlot = client.inventory.find((s) => s.itemId === RARE_SECONDARY);
    expect(secondarySlot?.instance?.bindOnTrade).toBe(true);
    expect(client.inventory.some((s) => s.itemId === RARE_PRIMARY)).toBe(true);
    // The rare piece was consumed.
    expect(server.sim.countItem(RARE_WEAPON, st.pid)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ClientWorld liveness: the command SEND arm (right wire tokens) and the EVENT
// mirror arm (immediacy), independent of the delta path proven above.
// ---------------------------------------------------------------------------
describe('ClientWorld enchanting members are live (send + event mirror)', () => {
  it('the command methods send the exact wire tokens', () => {
    const prevWs = (globalThis as { WebSocket?: unknown }).WebSocket;
    (globalThis as { WebSocket?: unknown }).WebSocket = { OPEN: 1 };
    try {
      const sent: unknown[] = [];
      // Kept bespoke on purpose (issue #2088): a hand-picked field subset plus
      // a live `ws` mock. tests/helpers/bare_client.ts bareClient() is the
      // default for a new suite that just needs a bare ClientWorld.
      const c: any = Object.create(ClientWorld.prototype);
      c.connected = true;
      c.spectating = null;
      c.ws = { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) };
      const client = c as ClientWorld;
      client.disenchantItem('sword_x');
      client.disenchantItem('sword_x', { slotIndex: 3 });
      client.applyEnchant('sword_x', 'ench_y');
      client.applyEnchant('sword_x', 'ench_y', 'offhand');
      client.applyEnchant('sword_x', 'ench_y', undefined, true);
      client.applyEnchant('sword_x', 'ench_y', 'offhand', true);
      client.applyEnchant('sword_x', 'ench_y', undefined, false);
      client.salvageItem('sword_z');
      expect(sent).toEqual([
        { t: 'cmd', cmd: 'disenchant_item', item: 'sword_x' },
        { t: 'cmd', cmd: 'disenchant_item', item: 'sword_x', slot: 3 },
        // No slot given: an undefined field drops out of the JSON entirely, so a
        // bagged apply stays byte-identical to the pre-feature wire form.
        { t: 'cmd', cmd: 'apply_enchant', item: 'sword_x', enchant: 'ench_y' },
        // The worn arm rides the SAME command with the optional slot appended.
        { t: 'cmd', cmd: 'apply_enchant', item: 'sword_x', enchant: 'ench_y', slot: 'offhand' },
        // #2415: the confirm flag rides ONLY when exactly true (the craftItem
        // commission idiom), on both the bagged and worn forms...
        { t: 'cmd', cmd: 'apply_enchant', item: 'sword_x', enchant: 'ench_y', confirm: true },
        {
          t: 'cmd',
          cmd: 'apply_enchant',
          item: 'sword_x',
          enchant: 'ench_y',
          slot: 'offhand',
          confirm: true,
        },
        // ...and an explicit false sends the pre-feature form, byte-identical.
        { t: 'cmd', cmd: 'apply_enchant', item: 'sword_x', enchant: 'ench_y' },
        { t: 'cmd', cmd: 'salvage_item', item: 'sword_z' },
      ]);
    } finally {
      (globalThis as { WebSocket?: unknown }).WebSocket = prevWs;
    }
  });

  it('the event mirror arm updates lastX from the pid-scoped event (immediacy, no delta)', () => {
    const client = bareClient(1);
    const internals = client as unknown as {
      applyDisenchantResultEvent(ev: SimEvent): void;
      applyEnchantResultEvent(ev: SimEvent): void;
      applySalvageResultEvent(ev: SimEvent): void;
    };
    expect(client.lastDisenchantResult).toBeNull(); // bareClient's declaration default

    internals.applyDisenchantResultEvent({
      type: 'disenchantResult',
      ok: true,
      itemId: RARE_WEAPON,
      materialItemId: RARE_PRIMARY,
      count: 1,
      secondaryItemId: RARE_SECONDARY,
      secondaryCount: 1,
      pid: 1,
    });
    expect(client.lastDisenchantResult).toEqual({
      ok: true,
      itemId: RARE_WEAPON,
      materialItemId: RARE_PRIMARY,
      count: 1,
      secondaryItemId: RARE_SECONDARY,
      secondaryCount: 1,
    });

    internals.applyEnchantResultEvent({
      type: 'enchantResult',
      ok: false,
      itemId: COMMON_WEAPON,
      enchantId: WEAPON_ENCHANT,
      reason: 'insufficient_materials',
      pid: 1,
    });
    expect(client.lastEnchantResult).toEqual({
      ok: false,
      itemId: COMMON_WEAPON,
      enchantId: WEAPON_ENCHANT,
      reason: 'insufficient_materials',
    });

    internals.applySalvageResultEvent({
      type: 'salvageResult',
      ok: true,
      itemId: COMMON_WEAPON,
      materialItemId: 'bone_fragments',
      count: 3,
      pid: 1,
    });
    expect(client.lastSalvageResult).toEqual({
      ok: true,
      itemId: COMMON_WEAPON,
      materialItemId: 'bone_fragments',
      count: 3,
    });
  });
});
