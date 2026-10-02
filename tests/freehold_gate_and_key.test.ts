import { describe, expect, it, vi } from 'vitest';
import {
  ARENA_X,
  BG_X,
  BUILTIN_WORLD,
  DELVE_X_MIN,
  DELVES,
  dungeonAt,
  INSTANCE_X_BASE,
  ITEMS,
  RIFT_X_MIN,
  zoneAt,
} from '../src/sim/data';
import { dropEntityFromRoster } from '../src/sim/entity_roster';
import type { FreeholdDenyReason } from '../src/sim/freehold/entry_context';
import { confirmFreeholdGate } from '../src/sim/freehold/gate';
import {
  FREEHOLD_GATE_INTERACT_RANGE,
  FREEHOLD_GATE_TEMPLATE_ID,
  HEARTH_KEY_COOLDOWN_MS,
} from '../src/sim/freehold/gate_rules';
import { mergeFreeholdKeyReadyAt, useHearthKey } from '../src/sim/freehold/hearth_key';
import { enterFreehold } from '../src/sim/freehold/instance';
import { evictFreehold, serializeFreehold, setFreeholdTier } from '../src/sim/freehold/state';
import { JAIL_VISITOR_POS } from '../src/sim/jail';
import { riftInstanceAtPos } from '../src/sim/rift/runs';
import { Sim } from '../src/sim/sim';
import { bgCarryingFlag, startBgMatch } from '../src/sim/social/battleground';
import { FISHING_CAST_ID, type FreeholdKeyAdmission, type SimConfig } from '../src/sim/types';

function setup(extra: Partial<SimConfig> = {}) {
  let now = 1000;
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    freeholdsEnabled: true,
    lockoutNowMs: () => now,
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
    ...extra,
  });
  const pid = sim.primaryId;
  const gate = [...sim.entities.values()].find((e) => e.templateId === FREEHOLD_GATE_TEMPLATE_ID);
  sim.drainEvents();
  return {
    sim,
    pid,
    gate,
    advance: (ms: number) => {
      now += ms;
    },
    near: () => {
      sim.player.pos = { ...gate!.pos };
    },
  };
}
function reasons(sim: Sim) {
  return sim
    .drainEvents()
    .filter((e) => e.type === 'freeholdDenied')
    .map((e) => e.reason);
}
function key(sim: Sim, pid = sim.primaryId) {
  sim.addItem('hearth_key', 1, pid);
  sim.drainEvents();
}

function travelState(sim: Sim) {
  return structuredClone({
    pos: sim.player.pos,
    prevPos: sim.player.prevPos,
    facing: sim.player.facing,
    entrySeq: sim.player.dungeonEntrySeq,
    inventory: sim.inventory,
    clocks: [...sim.freeholdKeyReadyAtMs],
    claims: sim.instances,
    freeholds: [...sim.freeholds],
  });
}
function refusal(sim: Sim, action: () => void, reason: FreeholdDenyReason) {
  sim.drainEvents();
  const before = travelState(sim);
  const draws = vi.fn();
  sim.rng.setObserver(draws);
  action();
  expect(sim.drainEvents()).toEqual([{ type: 'freeholdDenied', pid: sim.primaryId, reason }]);
  expect(travelState(sim)).toEqual(before);
  expect(draws).not.toHaveBeenCalled();
  sim.rng.setObserver(null);
}

describe('Freehold Gate authoritative confirmation', () => {
  it('spawns only on a lit authored host, without loot or a proximity teleport', () => {
    const { sim, gate, near } = setup();
    expect(gate).toMatchObject({
      kind: 'object',
      objectItemId: null,
      lootable: false,
      facing: 0,
      respawnTimer: Infinity,
    });
    near();
    for (let i = 0; i < 4; i++) sim.tick();
    expect(dungeonAt(sim.player.pos.x)).toBeNull();
    expect(sim.countItem('hearth_key')).toBe(0);
    expect(setup({ freeholdsEnabled: false }).gate).toBeUndefined();
    expect(
      setup({ world: { ...BUILTIN_WORLD, services: {}, camps: [], npcs: {}, groundObjects: [] } })
        .gate,
    ).toBeUndefined();
  });
  it('refuses forged distant confirmation and accepts only the live radius', () => {
    const { sim, pid, gate, near } = setup();
    expect(FREEHOLD_GATE_INTERACT_RANGE).toBe(5);
    const before = { ...sim.player.pos };
    sim.freeholdEnter();
    expect(sim.player.pos).toEqual(before);
    expect(reasons(sim)).toEqual(['busy']);
    near();
    sim.player.pos.x += 5.01;
    expect(confirmFreeholdGate(sim.ctx, pid)).toBe(false);
    expect(reasons(sim)).toEqual(['busy']);
    sim.player.pos = { ...gate!.pos, x: gate!.pos.x + 5 };
    expect(confirmFreeholdGate(sim.ctx, pid)).toBe(true);
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('freehold_inn_room');
    expect(sim.countItem('hearth_key')).toBe(1);
    expect(sim.freeholdKeyReadyAtMs.size).toBe(0);
  });
  it('checks only local spatial candidates even with a large distant roster and before the first tick', () => {
    const { sim, near, gate } = setup();
    for (let i = 0; i < 2000; i++) {
      sim.ctx.addEntity({ ...gate!, id: sim.nextId++, pos: { x: 500 + i, y: 0, z: 500 } });
    }
    let candidates = 0;
    const query = sim.grid.forEachInRadius.bind(sim.grid);
    vi.spyOn(sim.grid, 'forEachInRadius').mockImplementation((x, z, range, callback) => {
      query(x, z, range, (e, d2) => {
        candidates++;
        callback(e, d2);
      });
    });
    refusal(sim, () => sim.freeholdEnter(), 'busy');
    expect(candidates).toBe(1); // The player is the only local candidate.
    near();
    sim.freeholdEnter();
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('freehold_inn_room');
    expect(candidates).toBeLessThan(5);
    expect(candidates).toBeGreaterThan(0);
  });
  it('grants once and retries full bags without undoing entry', () => {
    const { sim, near } = setup();
    sim.inventory.splice(
      0,
      sim.inventory.length,
      ...Array.from({ length: sim.bagCapacity }, () => ({
        itemId: 'masters_field_forge',
        count: 1,
      })),
    );
    expect(sim.canAddItem('hearth_key', 1)).toBe(false);
    near();
    sim.freeholdEnter();
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('freehold_inn_room');
    expect(sim.countItem('hearth_key')).toBe(0);
    expect(reasons(sim)).toEqual([]);
    sim.inventory.pop();
    sim.freeholdLeave();
    near();
    sim.freeholdEnter();
    expect(sim.countItem('hearth_key')).toBe(1);
    sim.freeholdLeave();
    near();
    sim.freeholdEnter();
    expect(sim.countItem('hearth_key')).toBe(1);
  });
  it('restores a genuinely missing granted key without changing entitlement or an existing deadline', () => {
    const { sim, pid, near } = setup();
    near();
    sim.freeholdEnter();
    expect(sim.countItem('hearth_key')).toBe(1);
    sim.freeholdLeave();
    sim.useItem('hearth_key');
    expect(sim.freeholdKeyReadyAtMs.get(`entity:${pid}`)).toBe(3601000);
    sim.freeholdLeave();
    const entitlement = structuredClone(sim.freeholds.get(`entity:${pid}`));
    sim.removeItem('hearth_key', 1);
    expect(sim.countItem('hearth_key')).toBe(0);
    near();
    sim.freeholdEnter();
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('freehold_inn_room');
    expect(sim.countItem('hearth_key')).toBe(1);
    expect(sim.freeholds.get(`entity:${pid}`)).toEqual(entitlement);
    expect(sim.freeholdKeyReadyAtMs.get(`entity:${pid}`)).toBe(3601000);
    sim.freeholdLeave();
    near();
    sim.freeholdEnter();
    expect(sim.countItem('hearth_key')).toBe(1);
    expect(sim.freeholdKeyReadyAtMs.get(`entity:${pid}`)).toBe(3601000);
  });
  it('permits explicit physical entry and key grant at zero condition', () => {
    const { sim, pid, near } = setup();
    sim.freeholds.get(`entity:${pid}`)!.condition = 0;
    near();
    sim.freeholdEnter();
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('freehold_inn_room');
    expect(sim.countItem('hearth_key')).toBe(1);
    expect(sim.freeholds.get(`entity:${pid}`)!.condition).toBe(0);
    expect(reasons(sim)).toEqual([]);
  });
  it('keeps the released owner corpse run, including an old-tier claim', () => {
    const { sim, pid, near } = setup();
    near();
    sim.freeholdEnter();
    const claim = sim.instances.find((i) => i.partyKey === `entity:${pid}`)!;
    sim.player.corpsePos = { ...sim.player.pos };
    sim.player.corpseInstanceId = claim.exitId;
    sim.player.dead = true;
    sim.player.ghost = true;
    sim.player.hp = 0;
    setFreeholdTier(sim.ctx, `entity:${pid}`, 'cottage');
    near();
    sim.freeholdEnter();
    expect(sim.player.dead).toBe(false);
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('freehold_inn_room');
  });
  it('physical entry ignores the remote cooldown and unavailable key participant', () => {
    const admission = vi.fn((): FreeholdKeyAdmission => 'deny');
    const { sim, pid, near } = setup({ freeholdKeyAdmission: admission });
    sim.freeholdKeyReadyAtMs.set(`entity:${pid}`, 9999999);
    near();
    sim.freeholdEnter();
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('freehold_inn_room');
    expect(sim.freeholdKeyReadyAtMs.get(`entity:${pid}`)).toBe(9999999);
    // The physical gate never asks the remote participant at all.
    expect(admission).not.toHaveBeenCalled();
  });
});

describe('the durable clock merge', () => {
  it('moves the live clock FORWARD only: an older, equal or clockless reading changes nothing', () => {
    const { sim } = setup();
    const key = 'account:41';
    mergeFreeholdKeyReadyAt(sim.ctx, key, 9000);
    expect(sim.freeholdKeyReadyAtMs.get(key)).toBe(9000);
    // A stale durable read must never hand out a free trip.
    mergeFreeholdKeyReadyAt(sim.ctx, key, 5000);
    expect(sim.freeholdKeyReadyAtMs.get(key)).toBe(9000);
    mergeFreeholdKeyReadyAt(sim.ctx, key, 9000);
    expect(sim.freeholdKeyReadyAtMs.get(key)).toBe(9000);
    for (const none of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      mergeFreeholdKeyReadyAt(sim.ctx, key, none);
      expect(sim.freeholdKeyReadyAtMs.get(key), String(none)).toBe(9000);
    }
    // Control: a later reading does move it.
    mergeFreeholdKeyReadyAt(sim.ctx, key, 9001);
    expect(sim.freeholdKeyReadyAtMs.get(key)).toBe(9001);
  });
});

describe('Hearth Key isolated account travel', () => {
  it('defines one permanent soulbound tool without a sale, discard or listing route', () => {
    expect(ITEMS.hearth_key).toMatchObject({
      kind: 'tool',
      use: { type: 'freeholdEnter' },
      soulbound: true,
      noMarketList: true,
      noDiscard: true,
      sellValue: 0,
    });
  });
  it('capacity refusal spends no cooldown and a reclaimed slot permits retry', () => {
    const { sim } = setup();
    key(sim);
    for (let i = 0; i < 24; i++) {
      const owner = sim.addPlayer('warrior', `Other${i}`);
      expect(enterFreehold(sim.ctx, owner)).toBe(true);
    }
    refusal(sim, () => sim.useItem('hearth_key'), 'busy');
    expect(sim.freeholdKeyReadyAtMs.size).toBe(0);
    const slot = sim.instances.find(
      (i) => i.dungeonId === 'freehold_inn_room' && i.partyKey !== null,
    )!;
    // The pool's own reap/recovery mechanics are covered by freehold_instance.
    // This boundary test supplies its reclaimed slot to the same item retry.
    slot.partyKey = null;
    sim.useItem('hearth_key');
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('freehold_inn_room');
    expect(sim.freeholdKeyReadyAtMs.size).toBe(1);
  });
  it('a backwards clock cannot shorten an already accepted deadline', () => {
    const { sim, pid, advance } = setup();
    key(sim);
    sim.useItem('hearth_key');
    sim.freeholdLeave();
    sim.drainEvents();
    advance(-999);
    sim.useItem('hearth_key');
    expect(reasons(sim)).toEqual(['cooldown']);
    expect(sim.freeholdKeyReadyAtMs.get(`entity:${pid}`)).toBe(3601000);
  });
  it('is permanent, ownership checked, and dark-host inert', () => {
    const { sim, pid } = setup();
    key(sim);
    evictFreehold(sim.ctx, `entity:${pid}`);
    const pos = { ...sim.player.pos };
    sim.useItem('hearth_key');
    expect(reasons(sim)).toEqual(['no_freehold']);
    expect(sim.player.pos).toEqual(pos);
    expect(sim.freeholds.size).toBe(0);
    expect(sim.countItem('hearth_key')).toBe(1);
    const dark = setup({ freeholdsEnabled: false });
    key(dark.sim);
    dark.sim.useItem('hearth_key');
    expect(reasons(dark.sim)).toEqual(['no_freehold']);
    expect(dark.sim.freeholdKeyReadyAtMs.size).toBe(0);
  });
  it('uses the injected clock, literal hour boundary and no RNG', () => {
    expect(HEARTH_KEY_COOLDOWN_MS).toBe(3600000);
    const { sim, pid, advance } = setup();
    key(sim);
    const draws = vi.fn();
    sim.rng.setObserver(draws);
    sim.useItem('hearth_key');
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('freehold_inn_room');
    expect(sim.countItem('hearth_key')).toBe(1);
    expect(sim.freeholdKeyReadyAtMs.get(`entity:${pid}`)).toBe(3601000);
    sim.freeholdLeave();
    advance(3599999);
    sim.drainEvents();
    sim.useItem('hearth_key');
    expect(reasons(sim)).toEqual(['cooldown']);
    advance(1);
    sim.useItem('hearth_key');
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('freehold_inn_room');
    expect(draws).not.toHaveBeenCalled();
    sim.rng.setObserver(null);
    expect(serializeFreehold(sim.ctx, `entity:${pid}`)).not.toHaveProperty('readyAtMs');
  });
  it('keeps the account clock across alts and plot-tier changes, with Sim isolation', () => {
    const { sim, advance } = setup();
    const a = sim.addPlayer('warrior', 'SiblingA', { freeholdOwnerKey: 'account:9' });
    const b = sim.addPlayer('warrior', 'SiblingB', { freeholdOwnerKey: 'account:9' });
    key(sim, a);
    key(sim, b);
    sim.useItem('hearth_key', a);
    setFreeholdTier(sim.ctx, 'account:9', 'cottage');
    sim.drainEvents();
    sim.useItem('hearth_key', b);
    expect(reasons(sim)).toEqual(['cooldown']);
    advance(3600000);
    sim.useItem('hearth_key', b);
    expect(dungeonAt(sim.entities.get(b)!.pos.x)?.id).toBe('freehold_cottage');
    expect(setup().sim.freeholdKeyReadyAtMs.size).toBe(0);
  });
  it('already selected home is a silent no-op before remote authority or clock reads', () => {
    const admission = vi.fn((): FreeholdKeyAdmission => 'deny');
    const clock = vi.fn(() => 50);
    const { sim, pid } = setup({ freeholdKeyAdmission: admission, lockoutNowMs: clock });
    key(sim);
    enterFreehold(sim.ctx, pid);
    sim.drainEvents();
    clock.mockClear();
    const seq = sim.player.dungeonEntrySeq;
    sim.useItem('hearth_key');
    expect(sim.drainEvents()).toEqual([]);
    expect(sim.player.dungeonEntrySeq).toBe(seq);
    expect(admission).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
  });
  it('refuses a foreign owner claim of the selected tier before the current-home no-op', () => {
    const admission = vi.fn((): FreeholdKeyAdmission => 'admit');
    const clock = vi.fn(() => 1000);
    const { sim } = setup({ freeholdKeyAdmission: admission, lockoutNowMs: clock });
    key(sim);
    const other = sim.addPlayer('warrior', 'OtherOwner', { freeholdOwnerKey: 'account:92' });
    expect(enterFreehold(sim.ctx, other)).toBe(true);
    sim.player.pos = { ...sim.entities.get(other)!.pos };
    const foreignClaimId = sim.ctx.instanceClaimIdAt(sim.player.pos);
    expect(foreignClaimId).not.toBeNull();
    expect(sim.instances.find((claim) => claim.exitId === foreignClaimId)).toMatchObject({
      dungeonId: 'freehold_inn_room',
      partyKey: 'account:92',
    });
    clock.mockClear();
    refusal(sim, () => sim.useItem('hearth_key'), 'instanced');
    expect(admission).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
  });
  it('rejects a forged key use without possession before any housing action', () => {
    const admission = vi.fn((): FreeholdKeyAdmission => 'admit');
    const { sim } = setup({ freeholdKeyAdmission: admission });
    expect(sim.countItem('hearth_key')).toBe(0);
    const before = travelState(sim);
    const draws = vi.fn();
    sim.rng.setObserver(draws);
    sim.useItem('hearth_key');
    expect(sim.drainEvents()).toEqual([
      { type: 'error', pid: sim.primaryId, text: "You don't have that item." },
    ]);
    expect(travelState(sim)).toEqual(before);
    expect(admission).not.toHaveBeenCalled();
    expect(draws).not.toHaveBeenCalled();
  });
  it('uses a non-key item through its own effect without any housing transition', () => {
    const admission = vi.fn((): FreeholdKeyAdmission => 'admit');
    const { sim } = setup({ freeholdKeyAdmission: admission });
    sim.addItem('minor_healing_potion', 1);
    sim.player.hp = sim.player.maxHp - 50;
    sim.drainEvents();
    const before = travelState(sim);
    sim.useItem('minor_healing_potion');
    expect(sim.player.hp).toBe(sim.player.maxHp);
    expect(sim.countItem('minor_healing_potion')).toBe(0);
    const events = sim.drainEvents();
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'heal', source: 'potion', amount: 50 }),
    );
    expect(events.some((event) => event.type === 'freeholdDenied')).toBe(false);
    const after = travelState(sim);
    expect({ ...after, inventory: before.inventory }).toEqual(before);
    expect(admission).not.toHaveBeenCalled();
  });
  it('another owned tier is still instanced and an unavailable participant cannot authorize', () => {
    const { sim, pid } = setup({ freeholdKeyAdmission: () => 'deny' });
    key(sim);
    enterFreehold(sim.ctx, pid);
    setFreeholdTier(sim.ctx, `entity:${pid}`, 'cottage');
    sim.drainEvents();
    sim.useItem('hearth_key');
    expect(reasons(sim)).toEqual(['instanced']);
    sim.freeholdLeave();
    sim.drainEvents();
    sim.useItem('hearth_key');
    expect(reasons(sim)).toEqual(['busy']);
    expect(sim.freeholdKeyReadyAtMs.size).toBe(0);
  });
  it('reads the local clock BEFORE admission: an unready key never consults the host', () => {
    const admission = vi.fn((): FreeholdKeyAdmission => 'admit');
    const { sim, pid, advance } = setup({ freeholdKeyAdmission: admission });
    key(sim);
    sim.freeholdKeyReadyAtMs.set(`entity:${pid}`, 1001);
    // A key spammed through its cooldown is refused locally, at no host cost.
    for (let i = 0; i < 3; i++) refusal(sim, () => sim.useItem('hearth_key'), 'cooldown');
    expect(admission).not.toHaveBeenCalled();
    // Positive control: at the exact boundary (now 1001, ready at 1001) the
    // same spy IS consulted, once, with the owner key and the pid.
    advance(1);
    sim.useItem('hearth_key');
    expect(admission).toHaveBeenCalledTimes(1);
    expect(admission).toHaveBeenCalledWith(`entity:${pid}`, pid);
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('freehold_inn_room');
    expect(sim.freeholdKeyReadyAtMs.get(`entity:${pid}`)).toBe(3601001);
    // The order decides the REASON too: a host that would deny is never asked
    // while the clock is unready, so the player reads cooldown, not busy.
    const denying = vi.fn((): FreeholdKeyAdmission => 'deny');
    const realm = setup({ freeholdKeyAdmission: denying });
    key(realm.sim);
    realm.sim.freeholdKeyReadyAtMs.set(`entity:${realm.pid}`, 1001);
    refusal(realm.sim, () => realm.sim.useItem('hearth_key'), 'cooldown');
    expect(denying).not.toHaveBeenCalled();
  });
  it('a pending admission is silent: no denial, nothing moved, nothing spent, no draw', () => {
    const admission = vi.fn((): FreeholdKeyAdmission => 'pending');
    const { sim, pid } = setup({ freeholdKeyAdmission: admission });
    key(sim);
    const before = travelState(sim);
    const draws = vi.fn();
    sim.rng.setObserver(draws);
    expect(useHearthKey(sim.ctx, pid)).toBe(false);
    sim.useItem('hearth_key');
    expect(sim.drainEvents()).toEqual([]);
    expect(travelState(sim)).toEqual(before);
    expect(sim.countItem('hearth_key')).toBe(1);
    expect(dungeonAt(sim.player.pos.x)).toBeNull();
    expect(sim.freeholdKeyReadyAtMs.has(`entity:${pid}`)).toBe(false);
    // It WAS asked both times: the silence is the pending answer, not a skip.
    expect(admission).toHaveBeenCalledTimes(2);
    expect(admission).toHaveBeenNthCalledWith(1, `entity:${pid}`, pid);
    expect(admission).toHaveBeenNthCalledWith(2, `entity:${pid}`, pid);
    expect(draws).not.toHaveBeenCalled();
    sim.rng.setObserver(null);
  });
  it('only an exact admit runs the trip: deny and any other answer refuse busy', () => {
    // Fail closed: a legacy boolean, a wrong case or no answer at all is not
    // 'admit', so none of them can buy a trip.
    for (const answer of ['deny', true, 'ADMIT', undefined]) {
      const { sim } = setup({
        freeholdKeyAdmission: () => answer as unknown as FreeholdKeyAdmission,
      });
      key(sim);
      refusal(sim, () => sim.useItem('hearth_key'), 'busy');
    }
    // The contrast arm: the exact 'admit' enters and spends the clock.
    const { sim, pid } = setup({ freeholdKeyAdmission: () => 'admit' });
    key(sim);
    expect(useHearthKey(sim.ctx, pid)).toBe(true);
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('freehold_inn_room');
    expect(sim.freeholdKeyReadyAtMs.get(`entity:${pid}`)).toBe(3601000);
  });
  it("evicts an owner's live clock at its LAST session's leave, with or without a record", () => {
    const { sim } = setup();
    const a = sim.addPlayer('warrior', 'ClockA', { freeholdOwnerKey: 'account:31' });
    const b = sim.addPlayer('mage', 'ClockB', { freeholdOwnerKey: 'account:31' });
    const c = sim.addPlayer('rogue', 'ClockC', { freeholdOwnerKey: 'account:32' });
    const d = sim.addPlayer('priest', 'ClockD', { freeholdOwnerKey: 'account:33' });
    // account:31 holds NO record (a held or absent plot joins without one): the
    // case a record-gated eviction would keep for the life of the Sim.
    evictFreehold(sim.ctx, 'account:31');
    expect(sim.freeholds.has('account:31')).toBe(false);
    expect(sim.freeholds.has('account:32')).toBe(true);
    mergeFreeholdKeyReadyAt(sim.ctx, 'account:31', 5000);
    mergeFreeholdKeyReadyAt(sim.ctx, 'account:32', 6000);
    mergeFreeholdKeyReadyAt(sim.ctx, 'account:33', 7000);
    expect([...sim.freeholdKeyReadyAtMs]).toEqual([
      ['account:31', 5000],
      ['account:32', 6000],
      ['account:33', 7000],
    ]);
    // A second live session of the same owner keeps the clock.
    sim.removePlayer(a);
    expect(sim.freeholdKeyReadyAtMs.get('account:31')).toBe(5000);
    // The last one takes it, and seeds no record on the way out.
    sim.removePlayer(b);
    expect(sim.freeholdKeyReadyAtMs.has('account:31')).toBe(false);
    expect(sim.freeholds.has('account:31')).toBe(false);
    // With a record, the last leave takes the clock and the record together.
    sim.removePlayer(c);
    expect(sim.freeholdKeyReadyAtMs.has('account:32')).toBe(false);
    expect(sim.freeholds.has('account:32')).toBe(false);
    // The owner still online keeps both, untouched.
    expect(sim.freeholdKeyReadyAtMs.get('account:33')).toBe(7000);
    expect(sim.freeholds.has('account:33')).toBe(true);
    expect(sim.players.has(d)).toBe(true);

    // And with NO record anywhere in the Sim, the clock alone still goes.
    const bare = setup();
    const e = bare.sim.addPlayer('warrior', 'ClockE', { freeholdOwnerKey: 'account:34' });
    for (const owner of [...bare.sim.freeholds.keys()]) evictFreehold(bare.sim.ctx, owner);
    expect(bare.sim.freeholds.size).toBe(0);
    mergeFreeholdKeyReadyAt(bare.sim.ctx, 'account:34', 8000);
    expect(bare.sim.freeholdKeyReadyAtMs.get('account:34')).toBe(8000);
    bare.sim.removePlayer(e);
    expect(bare.sim.freeholdKeyReadyAtMs.size).toBe(0);
    expect(bare.sim.freeholds.size).toBe(0);
  });
  it.each([
    [
      'dead',
      (sim: Sim) => {
        sim.player.dead = true;
      },
      'dead',
    ],
    [
      'combat',
      (sim: Sim) => {
        sim.player.inCombat = true;
      },
      'combat',
    ],
    [
      'duel membership',
      (sim: Sim) => {
        sim.duels.set(sim.primaryId, {} as never);
      },
      'match',
    ],
    [
      'arena membership',
      (sim: Sim) => {
        sim.arenaMatches.set(sim.primaryId, {} as never);
      },
      'match',
    ],
    [
      'battleground membership',
      (sim: Sim) => {
        sim.bgMatches.set(sim.primaryId, {} as never);
      },
      'match',
    ],
    [
      'arena band',
      (sim: Sim) => {
        sim.player.pos.x = ARENA_X;
      },
      'match',
    ],
    [
      'battleground band',
      (sim: Sim) => {
        sim.player.pos.x = BG_X;
      },
      'match',
    ],
    [
      'rift band',
      (sim: Sim) => {
        sim.player.pos.x = RIFT_X_MIN;
      },
      'instanced',
    ],
    [
      'delve band',
      (sim: Sim) => {
        sim.player.pos.x = DELVE_X_MIN;
      },
      'instanced',
    ],
    [
      'unknown band',
      (sim: Sim) => {
        sim.player.pos.x = INSTANCE_X_BASE;
      },
      'instanced',
    ],
    [
      'invalid position',
      (sim: Sim) => {
        sim.player.pos.z = NaN;
      },
      'instanced',
    ],
    [
      'jail sentence',
      (sim: Sim) => {
        sim.player.jailed = true;
      },
      'busy',
    ],
    [
      'jail visitor',
      (sim: Sim) => {
        Object.assign(sim.player.pos, JAIL_VISITOR_POS);
      },
      'busy',
    ],
    [
      'gathering',
      (sim: Sim) => {
        sim.player.castingAbility = FISHING_CAST_ID;
      },
      'busy',
    ],
  ] as const)('refuses %s without changing inventory, clocks or claims', (_name, alter, reason) => {
    for (const surface of ['gate', 'key']) {
      const { sim, near } = setup();
      key(sim);
      near();
      alter(sim);
      refusal(
        sim,
        () => (surface === 'gate' ? sim.freeholdEnter() : sim.useItem('hearth_key')),
        reason,
      );
    }
  });
});

describe('Public gate and key transition evidence', () => {
  it.each([
    [true, true, 'dead'],
    [true, false, 'dead'],
    [false, true, 'combat'],
    [false, false, 'no_freehold'],
  ] as const)(
    'preserves dead/combat/ownership precedence for dead=%s combat=%s',
    (dead, combat, reason) => {
      for (const surface of ['gate', 'key']) {
        const { sim, near } = setup();
        key(sim);
        near();
        evictFreehold(sim.ctx, `entity:${sim.primaryId}`);
        sim.player.dead = dead;
        sim.player.inCombat = combat;
        refusal(
          sim,
          () => (surface === 'gate' ? sim.freeholdEnter() : sim.useItem('hearth_key')),
          reason,
        );
      }
    },
  );
  it.each(['missing ownership', 'disabled host'])(
    '%s returns only a text-free denial on both surfaces',
    (context) => {
      for (const surface of ['gate', 'key']) {
        const { sim, near } = setup({ freeholdsEnabled: context !== 'disabled host' });
        key(sim);
        if (context === 'missing ownership') {
          near();
          evictFreehold(sim.ctx, `entity:${sim.primaryId}`);
        }
        refusal(
          sim,
          () => (surface === 'gate' ? sim.freeholdEnter() : sim.useItem('hearth_key')),
          'no_freehold',
        );
      }
    },
  );
  it.each(['absent gate', 'dead gate', 'wrong kind', 'wrong template', 'vertical distance'])(
    'refuses %s without side effects',
    (context) => {
      const { sim, near, gate } = setup();
      near();
      if (context === 'absent gate') dropEntityFromRoster(sim.ctx, gate!.id);
      else if (context === 'dead gate') gate!.dead = true;
      else if (context === 'wrong kind') gate!.kind = 'npc';
      else if (context === 'wrong template') gate!.templateId = 'mailbox';
      else sim.player.pos.y += FREEHOLD_GATE_INTERACT_RANGE + 0.01;
      refusal(sim, () => sim.freeholdEnter(), 'busy');
    },
  );
  it.each(['unavailable authority', 'invalid clock', 'cooldown'])(
    'key %s refusal preserves all travel state',
    (context) => {
      const admission = vi.fn(
        (): FreeholdKeyAdmission => (context === 'unavailable authority' ? 'deny' : 'admit'),
      );
      const { sim } = setup({
        freeholdKeyAdmission: admission,
        ...(context === 'invalid clock' ? { lockoutNowMs: () => NaN } : {}),
      });
      key(sim);
      if (context === 'cooldown') sim.freeholdKeyReadyAtMs.set(`entity:${sim.primaryId}`, 1001);
      refusal(sim, () => sim.useItem('hearth_key'), context === 'cooldown' ? 'cooldown' : 'busy');
      // The local clock is read BEFORE the host: an unreadable or unready clock
      // refuses without consulting admission, and only a ready one reaches it.
      expect(admission).toHaveBeenCalledTimes(context === 'unavailable authority' ? 1 : 0);
    },
  );
  it.each(['x', 'y', 'z'] as const)('rejects nonfinite %s positions on both surfaces', (axis) => {
    for (const surface of ['gate', 'key']) {
      const { sim, near } = setup();
      key(sim);
      near();
      sim.player.pos[axis] = NaN;
      refusal(
        sim,
        () => (surface === 'gate' ? sim.freeholdEnter() : sim.useItem('hearth_key')),
        'instanced',
      );
    }
  });
  it('the permanent key travels from Mirefen Marsh, beyond the Eastbrook gate zone', () => {
    const { sim } = setup();
    key(sim);
    sim.player.pos = sim.groundPos(0, 300);
    expect(zoneAt(sim.player.pos.x, sim.player.pos.z).name).toBe('Mirefen Marsh');
    const draws = vi.fn();
    sim.rng.setObserver(draws);
    sim.useItem('hearth_key');
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('freehold_inn_room');
    expect(sim.countItem('hearth_key')).toBe(1);
    expect([...sim.freeholdKeyReadyAtMs.values()]).toEqual([3601000]);
    expect(draws).not.toHaveBeenCalled();
  });
  it('replays the same seed through entry, no-op, cooldown refusal and exact expiry without RNG', () => {
    function replay() {
      const { sim, near, advance } = setup();
      const draws = vi.fn();
      sim.rng.setObserver(draws);
      const steps: unknown[] = [];
      const capture = () => steps.push({ state: travelState(sim), events: sim.drainEvents() });
      near();
      sim.freeholdEnter();
      expect(dungeonAt(sim.player.pos.x)?.id).toBe('freehold_inn_room');
      expect(sim.countItem('hearth_key')).toBe(1);
      capture();
      sim.freeholdLeave();
      capture();
      sim.useItem('hearth_key');
      expect(dungeonAt(sim.player.pos.x)?.id).toBe('freehold_inn_room');
      capture();
      const home = travelState(sim);
      sim.useItem('hearth_key');
      expect(travelState(sim)).toEqual(home);
      expect(sim.drainEvents()).toEqual([]);
      capture();
      sim.freeholdLeave();
      capture();
      sim.useItem('hearth_key');
      expect(sim.events).toEqual([
        { type: 'freeholdDenied', pid: sim.primaryId, reason: 'cooldown' },
      ]);
      capture();
      advance(3600000);
      sim.useItem('hearth_key');
      expect(dungeonAt(sim.player.pos.x)?.id).toBe('freehold_inn_room');
      capture();
      expect(draws).not.toHaveBeenCalled();
      return steps;
    }
    expect(replay()).toEqual(replay());
  });
  it('rejects an actual dungeon claim on both surfaces', () => {
    const { sim } = setup();
    key(sim);
    sim.setPlayerLevel(20);
    sim.enterDungeon('nythraxis_crypt');
    expect(sim.ctx.instanceClaimIdAt(sim.player.pos)).not.toBeNull();
    refusal(sim, () => sim.freeholdEnter(), 'instanced');
    refusal(sim, () => sim.useItem('hearth_key'), 'instanced');
  });
  it('rejects both travel surfaces inside a real generated rift floor', () => {
    const { sim } = setup();
    key(sim);
    sim.enterRift(9001, 20, sim.primaryId);
    const run = riftInstanceAtPos(sim.ctx, sim.player.pos);
    expect(run).not.toBeNull();
    expect(run!.mobIds.length).toBeGreaterThan(0);
    expect(run!.partyKey).not.toBeNull();
    refusal(sim, () => sim.freeholdEnter(), 'instanced');
    refusal(sim, () => sim.useItem('hearth_key'), 'instanced');
    expect(riftInstanceAtPos(sim.ctx, sim.player.pos)).toBe(run);
  });
  it('rejects an actual flag carrier even during an overworld position gap', () => {
    const { sim, pid, near } = setup();
    key(sim);
    const pids = [
      pid,
      ...Array.from({ length: 9 }, (_, i) => sim.addPlayer('warrior', `Flag${i}`)),
    ];
    startBgMatch(sim.ctx, pids.slice(0, 5), pids.slice(5));
    const match = sim.bgMatches.get(pid)!;
    expect(match).toBeDefined();
    match.state = 'active';
    sim.player.pos = { ...match.flags[1].pos };
    sim.bgFlagAction(pid);
    sim.tick();
    expect(bgCarryingFlag(sim.ctx, pid)).toBe(true);
    near();
    refusal(sim, () => sim.freeholdEnter(), 'match');
    refusal(sim, () => sim.useItem('hearth_key'), 'match');
  });
  it('rejects travel inside a real delve but permits it after legitimate exit with the run reserved', () => {
    const { sim, near } = setup();
    key(sim);
    const def = DELVES.collapsed_reliquary;
    sim.setPlayerLevel(def.minLevel);
    sim.player.pos = sim.groundPos(def.doorPos.x, def.doorPos.z);
    sim.enterDelve(def.id, 'normal');
    const run = sim.ctx.delveRunForPlayer(sim.primaryId);
    expect(run).not.toBeNull();
    refusal(sim, () => sim.freeholdEnter(), 'instanced');
    refusal(sim, () => sim.useItem('hearth_key'), 'instanced');
    sim.leaveDelve();
    expect(run!.partyKey).not.toBeNull();
    expect(sim.ctx.delveRunForPlayer(sim.primaryId)).toBeNull();
    // Reservation lifetime is not player presence: the real exit permits both routes.
    near();
    sim.freeholdEnter();
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('freehold_inn_room');
    sim.freeholdLeave();
    sim.useItem('hearth_key');
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('freehold_inn_room');
  });
});
