// The corpse cue for a raider saved to a per-boss raid boss (the Smith's
// Heart's weekly per-boss lockout, src/sim/instances/raid_boss_lockout.ts and
// the corpse gate src/sim/loot/boss_loot_lock.ts). A saved raider may kill the
// boss again with the group but takes nothing from it, so the corpse must not
// promise them loot either: no satchel, no minimap square, no open coffer, no
// popup and no interact prompt, while the unsaved raider beside them still sees
// all of it. The eligibility is the sim's own gate, answered per viewer by
// IWorld.corpseBossLootDenied in BOTH worlds: the offline Sim from the viewer's
// meta, the online ClientWorld from the corpse's lock mirrored off the real
// server emit (wireEntity's `bll`) against the viewer's mirrored lockouts.
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { CORPSE_LOOT_WIRE_KEYS, writeCorpseLootWire } from '../server/corpse_loot_wire';
import { wireEntity } from '../server/game';
import {
  corpseLootAvailability,
  corpseLootAvailabilityInWorld,
} from '../src/game/corpse_loot_availability';
import { handlePickedEntity } from '../src/game/interactions';
import { resolveNearbyInteractionCandidate } from '../src/game/nearby_interaction_core';
import { decodeBossLootLockWire } from '../src/net/corpse_loot_wire';
import { SMITH_HEART_DUNGEON, SMITH_HEART_FINAL_BOSS } from '../src/sim/content/smith_heart';
import { corpseIndicatorFor, viewerBossLootDenied } from '../src/sim/corpse_loot_state';
import { BUILTIN_WORLD, DUNGEONS, MOBS } from '../src/sim/data';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { type CharacterState, type InstanceSlot, Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { t } from '../src/ui/i18n';
import { bareClient } from './helpers/bare_client';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
const WEEK = 7 * 24 * 60 * 60 * 1000;
const nextReset = (nowMs: number): number => (Math.floor(nowMs / WEEK) + 1) * WEEK;
const T0 = 2900 * WEEK + 2 * 24 * 60 * 60 * 1000;
const FINAL_LOCK = `smith_heart:${SMITH_HEART_FINAL_BOSS}`;

interface Raid {
  sim: Sim;
  inst: InstanceSlot;
  pids: number[];
  clock: { now: number };
}

function raid(
  dungeonId: string,
  names: readonly string[],
  opts: {
    seed?: number;
    clock?: { now: number };
    states?: readonly (CharacterState | undefined)[];
  } = {},
  heroic = false,
): Raid {
  const clock = opts.clock ?? { now: T0 };
  const sim = new Sim({
    seed: opts.seed ?? 51,
    playerClass: 'warrior',
    noPlayer: true,
    world: WORLD,
    devCommands: true,
    lockoutNowMs: () => clock.now,
    weeklyRaidResetMs: nextReset,
  });
  const pids = names.map((name, i) => {
    const state = opts.states?.[i];
    return sim.addPlayer('warrior', name, state ? { state } : undefined);
  });
  for (const pid of pids.slice(1)) {
    sim.partyInvite(pid, pids[0]);
    sim.partyAccept(pid);
  }
  for (const pid of pids) {
    // The per-room raids need a raid group or attunement at the door: the dev
    // entry skips only that, never a lockout.
    const dev = dungeonId !== SMITH_HEART_DUNGEON;
    if (!enterDungeon(sim.ctx, dungeonId, pid, dev)) throw new Error(`enter ${pid}`);
  }
  const inst = sim.ctx.instances.find(
    (i) => i.dungeonId === dungeonId && i.partyKey !== null,
  ) as InstanceSlot;
  if (heroic) inst.difficulty = 'heroic';
  return { sim, inst, pids, clock };
}

function save(r: Raid, i = 0): CharacterState {
  const state = r.sim.serializeCharacter(r.pids[i]);
  if (!state) throw new Error('serialize');
  return state;
}

function kill(r: Raid, mobId: string): Entity {
  const index = DUNGEONS[r.inst.dungeonId].spawns.findIndex((s) => s.mobId === mobId);
  const mob = r.sim.ctx.entities.get(r.inst.mobIds[index]) as Entity;
  r.sim.ctx.handleDeath(mob, r.sim.ctx.entities.get(r.pids[0]) as Entity);
  return mob;
}

/** The corpse's tap-owned purse on top of whatever the kill rolled: the pool
 *  the saved raider's party rights would otherwise advertise to them. */
function purse(r: Raid, corpse: Entity): void {
  corpse.tappedById = r.pids[0];
  corpse.loot = { copper: 900, items: corpse.loot?.items ?? [] };
  corpse.lootable = true;
}

/** The offline Sim read as ONE viewer's IWorld slice (the HUD's own adapter
 *  input), the local player being `pid`. */
function viewOf(r: Raid, pid: number) {
  return {
    playerId: pid,
    inventory: [],
    partyInfo: { members: (r.sim.partyOf(pid)?.members ?? [pid]).map((m) => ({ pid: m })) },
    corpseBossLootDenied: (c: Pick<Entity, 'bossLootLock'>) => r.sim.corpseBossLootDenied(c, pid),
  };
}

function partyIds(r: Raid, pid: number): number[] {
  return [...(r.sim.partyOf(pid)?.members ?? [pid])];
}

/** Anna is saved to Ashgrand (Normal) by an earlier run; Bea is not. */
function savedAndFresh(heroic = false): Raid {
  const first = raid(SMITH_HEART_DUNGEON, ['Anna']);
  kill(first, SMITH_HEART_FINAL_BOSS);
  return raid(
    SMITH_HEART_DUNGEON,
    ['Anna', 'Bea'],
    { seed: 56, clock: first.clock, states: [save(first)] },
    heroic,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('offline: the saved raider sees no loot cue on the boss', () => {
  it('no satchel, no popup, no prompt for the saved raider; all of it for the fresh one', () => {
    const r = savedAndFresh();
    const [anna, bea] = r.pids;
    const corpse = kill(r, SMITH_HEART_FINAL_BOSS);
    purse(r, corpse);
    expect(corpse.bossLootLock).toEqual({ lockId: FINAL_LOCK, freshIds: [bea] });

    expect(r.sim.corpseBossLootDenied(corpse, anna)).toBe(true);
    expect(r.sim.corpseBossLootDenied(corpse, bea)).toBe(false);
    const annaView = viewOf(r, anna);
    const beaView = viewOf(r, bea);
    // The indicator every glow reads (nameplate satchel, minimap square, coffer).
    expect(
      corpseIndicatorFor(
        corpse,
        anna,
        partyIds(r, anna),
        true,
        viewerBossLootDenied(annaView, corpse),
      ),
    ).toBe('none');
    expect(
      corpseIndicatorFor(
        corpse,
        bea,
        partyIds(r, bea),
        true,
        viewerBossLootDenied(beaView, corpse),
      ),
    ).toBe('loot');
    // The popup the HUD opens (its own IWorld adapter): nothing listed, no copper.
    const annaPopup = corpseLootAvailabilityInWorld(annaView, corpse);
    expect(annaPopup).toMatchObject({ hasLoot: false, canOpen: false, visibleCopper: 0 });
    expect(annaPopup.visibleItems).toEqual([]);
    expect(annaPopup.bossSaved).toBe(true);
    const beaPopup = corpseLootAvailabilityInWorld(beaView, corpse);
    expect(beaPopup).toMatchObject({ hasLoot: true, canOpen: true, visibleCopper: 900 });
    expect(beaPopup.bossSaved).toBe(false);
  });

  it('the interact prompt offers the corpse to the fresh raider only', () => {
    const r = savedAndFresh();
    const [anna, bea] = r.pids;
    const corpse = kill(r, SMITH_HEART_FINAL_BOSS);
    purse(r, corpse);
    for (const pid of r.pids) {
      const p = r.sim.ctx.entities.get(pid) as Entity;
      p.pos = { ...corpse.pos };
    }
    const scan = (pid: number) =>
      resolveNearbyInteractionCandidate({
        ...viewOf(r, pid),
        player: r.sim.ctx.entities.get(pid) as Entity,
        entities: new Map([[corpse.id, corpse]]),
        questLog: new Map(),
        farmPatches: [],
      });
    expect(scan(anna)).toBeNull();
    expect(scan(bea)).toMatchObject({ kind: 'corpse', id: corpse.id });
  });

  it('a click on the corpse opens no popup for the saved raider and says why', () => {
    const r = savedAndFresh();
    const corpse = kill(r, SMITH_HEART_FINAL_BOSS);
    purse(r, corpse);
    const click = (pid: number, button: number) => {
      const player = r.sim.ctx.entities.get(pid) as Entity;
      player.pos = { ...corpse.pos };
      const world = {
        ...viewOf(r, pid),
        player,
        entities: r.sim.ctx.entities,
        questLog: new Map(),
        targetEntity: () => {},
      } as unknown as Parameters<typeof handlePickedEntity>[0];
      const hud = {
        openLoot: vi.fn(),
        showError: vi.fn(),
        closeContextMenu: () => {},
      };
      const done = handlePickedEntity(
        world,
        hud as unknown as Parameters<typeof handlePickedEntity>[1],
        corpse.id,
        button,
        0,
        0,
      );
      return { done, hud };
    };
    for (const button of [0, 2]) {
      const saved = click(r.pids[0], button);
      expect(saved.done).toBe(false);
      expect(saved.hud.openLoot).not.toHaveBeenCalled();
      expect(saved.hud.showError).toHaveBeenCalledWith(t('hudChrome.raidLockout.bossSavedNoLoot'));
      const fresh = click(r.pids[1], button);
      expect(fresh.done).toBe(true);
      expect(fresh.hud.openLoot).toHaveBeenCalledWith(corpse.id, 0, 0);
      expect(fresh.hud.showError).not.toHaveBeenCalled();
    }
  });

  it('a Normal save never hides the Heroic kill: the difficulties lock apart', () => {
    const r = savedAndFresh(true);
    const [anna] = r.pids;
    const corpse = kill(r, SMITH_HEART_FINAL_BOSS);
    purse(r, corpse);
    expect(corpse.bossLootLock?.lockId).toBe(`${FINAL_LOCK}:heroic`);
    expect(r.sim.corpseBossLootDenied(corpse, anna)).toBe(false);
    expect(
      corpseIndicatorFor(
        corpse,
        anna,
        partyIds(r, anna),
        true,
        viewerBossLootDenied(viewOf(r, anna), corpse),
      ),
    ).toBe('loot');
  });

  it('the raider the kill itself saves keeps the cue (judged fresh at the kill)', () => {
    const r = raid(SMITH_HEART_DUNGEON, ['Anna']);
    const corpse = kill(r, SMITH_HEART_FINAL_BOSS);
    purse(r, corpse);
    const [anna] = r.pids;
    expect(r.sim.meta(anna)?.raidLockouts.has(FINAL_LOCK)).toBe(true);
    expect(r.sim.corpseBossLootDenied(corpse, anna)).toBe(false);
  });
});

describe('the per-room raids are untouched', () => {
  for (const room of ['ignivar_inner_crucible', 'nythraxis_boss_arena']) {
    it(`${room}: its boss carries no per-boss lock, so its cue never reads one`, () => {
      const r = raid(room, ['Anna']);
      const [anna] = r.pids;
      const boss = DUNGEONS[room].spawns.find((s) => MOBS[s.mobId]?.boss);
      const corpse = kill(r, boss?.mobId as string);
      purse(r, corpse);
      expect(corpse.bossLootLock).toBeUndefined();
      expect(wireEntity(corpse)).not.toHaveProperty('bll');
      // Saved to every room lock there is: the cue is the room raid's own, as before.
      for (const lock of ['ignivar_raid_arena', 'ignivar_inner_crucible', 'nythraxis_boss_arena']) {
        r.sim.meta(anna)?.raidLockouts.set(lock, T0 + WEEK);
      }
      expect(r.sim.corpseBossLootDenied(corpse, anna)).toBe(false);
      const view = viewOf(r, anna);
      expect(
        corpseIndicatorFor(corpse, anna, [anna], true, viewerBossLootDenied(view, corpse)),
      ).toBe(corpseIndicatorFor(corpse, anna, [anna]));
      expect(corpseLootAvailabilityInWorld(view, corpse)).toEqual(
        corpseLootAvailability(corpse, anna, true, [anna], false),
      );
      expect(corpseLootAvailabilityInWorld(view, corpse).hasLoot).toBe(true);
    });
  }

  it('a body with no lock never asks the world at all', () => {
    const ask = vi.fn(() => true);
    expect(viewerBossLootDenied({ corpseBossLootDenied: ask }, {})).toBe(false);
    expect(ask).not.toHaveBeenCalled();
    // A world slice with no such read (a bare fixture) reads as not denied.
    expect(viewerBossLootDenied({}, { bossLootLock: { lockId: FINAL_LOCK, freshIds: [] } })).toBe(
      false,
    );
  });
});

describe('online: the lock rides the wire and ClientWorld answers per viewer', () => {
  function mirrored(r: Raid, corpse: Entity, viewer: number) {
    vi.useFakeTimers();
    vi.setSystemTime(r.clock.now);
    const w = wireEntity(corpse);
    const client = bareClient(viewer);
    // The self snapshot's `lockouts` key, exactly as server/game.ts builds it.
    (client as unknown as { selfLockouts: Record<string, number> }).selfLockouts =
      Object.fromEntries(
        [...(r.sim.meta(viewer)?.raidLockouts ?? new Map())].filter(([, u]) => u > Date.now()),
      );
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot({
      t: 'snap',
      ents: [w],
    });
    return { w, client, mirror: client.entities.get(corpse.id) as Entity };
  }

  it('denies the saved raider and keeps the fresh one, off the real server emit', () => {
    const r = savedAndFresh();
    const [anna, bea] = r.pids;
    const corpse = kill(r, SMITH_HEART_FINAL_BOSS);
    purse(r, corpse);
    const saved = mirrored(r, corpse, anna);
    expect(saved.w.bll).toEqual({ id: FINAL_LOCK, f: [bea] });
    expect(saved.mirror.bossLootLock).toEqual({ lockId: FINAL_LOCK, freshIds: [bea] });
    expect(saved.client.corpseBossLootDenied(saved.mirror)).toBe(true);
    expect(
      corpseIndicatorFor(
        saved.mirror,
        anna,
        partyIds(r, anna),
        true,
        viewerBossLootDenied(saved.client, saved.mirror),
      ),
    ).toBe('none');
    const fresh = mirrored(r, corpse, bea);
    expect(fresh.client.corpseBossLootDenied(fresh.mirror)).toBe(false);
    expect(
      corpseIndicatorFor(
        fresh.mirror,
        bea,
        partyIds(r, bea),
        true,
        viewerBossLootDenied(fresh.client, fresh.mirror),
      ),
    ).toBe('loot');
  });

  it('both worlds lift the denial together once the saved lock runs out', () => {
    const r = savedAndFresh();
    const [anna] = r.pids;
    const corpse = kill(r, SMITH_HEART_FINAL_BOSS);
    purse(r, corpse);
    const { client, mirror } = mirrored(r, corpse, anna);
    expect(r.sim.corpseBossLootDenied(corpse, anna)).toBe(true);
    expect(client.corpseBossLootDenied(mirror)).toBe(true);
    const until = r.sim.meta(anna)?.raidLockouts.get(FINAL_LOCK) as number;
    r.clock.now = until;
    vi.setSystemTime(until);
    expect(r.sim.corpseBossLootDenied(corpse, anna)).toBe(false);
    expect(client.corpseBossLootDenied(mirror)).toBe(false);
  });

  it('a Normal save never hides the Heroic kill online either', () => {
    const r = savedAndFresh(true);
    const [anna] = r.pids;
    const corpse = kill(r, SMITH_HEART_FINAL_BOSS);
    purse(r, corpse);
    const { client, mirror } = mirrored(r, corpse, anna);
    expect(mirror.bossLootLock?.lockId).toBe(`${FINAL_LOCK}:heroic`);
    expect(client.corpseBossLootDenied(mirror)).toBe(false);
  });

  it('clears a mirrored lock when a later record arrives without bll', () => {
    const r = savedAndFresh();
    const corpse = kill(r, SMITH_HEART_FINAL_BOSS);
    purse(r, corpse);
    const { client } = mirrored(r, corpse, r.pids[0]);
    corpse.bossLootLock = undefined; // the respawn (mob/lifecycle.ts)
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot({
      t: 'snap',
      ents: [wireEntity(corpse)],
    });
    const mirror = client.entities.get(corpse.id) as Entity;
    expect(mirror.bossLootLock).toBeUndefined();
    expect(client.corpseBossLootDenied(mirror)).toBe(false);
  });
});

describe('the corpse-loot wire emitter', () => {
  it('writes its keys in the pinned order, bll last, every one only while set', () => {
    const r = savedAndFresh();
    const corpse = kill(r, SMITH_HEART_FINAL_BOSS);
    purse(r, corpse);
    corpse.harvestClaimedBy = r.pids[1];
    corpse.lootFfaTimer = 0;
    corpse.corpseTimer = -1;
    const out: Record<string, unknown> = {};
    writeCorpseLootWire(corpse, out);
    expect(Object.keys(out)).toEqual([...CORPSE_LOOT_WIRE_KEYS]);
    expect(out.bll).toEqual({ id: FINAL_LOCK, f: [r.pids[1]] });
    // Emptied (no longer lootable): the lock stops riding.
    corpse.lootable = false;
    const after: Record<string, unknown> = {};
    writeCorpseLootWire(corpse, after);
    expect(after).not.toHaveProperty('bll');
  });
});

describe('the bll decode', () => {
  it('reads the lock, reuses an unchanged one, and drops a malformed key', () => {
    const lock = decodeBossLootLockWire({ id: FINAL_LOCK, f: [3, 4] }, undefined);
    expect(lock).toEqual({ lockId: FINAL_LOCK, freshIds: [3, 4] });
    expect(decodeBossLootLockWire({ id: FINAL_LOCK, f: [3, 4] }, lock)).toBe(lock);
    expect(decodeBossLootLockWire({ id: FINAL_LOCK, f: [3] }, lock)).toEqual({
      lockId: FINAL_LOCK,
      freshIds: [3],
    });
    for (const junk of [undefined, null, 1, 'x', { id: 2, f: [] }, { id: FINAL_LOCK }]) {
      expect(decodeBossLootLockWire(junk, lock)).toBeUndefined();
    }
  });
});
