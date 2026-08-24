// The shared feast (farming Phase 12): src/sim/professions/feast.ts driven
// through a REAL Sim (the wellfed.test.ts construction, multi-player via
// noPlayer + addPlayer). Covers the place spend and its lock-aware split, the
// one-active-per-placer rule, every feast-specific farmDenied reason in both
// directions (deny fires AND nothing changed, plus the positive control), the
// dead/busy/combat/slot family gates answering via the shared error sentences,
// the bite spending a serving at START and minting Well Fed only through the
// real updateRegen completion path, the interruption forfeit, the per-player
// ledger and its rename-proof key, the 1 Hz sweep as the ONE despawn site
// (charges and expiry, with the sub-second stale window), the elixir
// coexistence and last-eaten-wins pins, and the zero-draw determinism twin.

import { describe, expect, it } from 'vitest';
import { DELVES, ITEMS } from '../src/sim/data';
import { delveRunForPlayer, freeDelveRun } from '../src/sim/delves/runs';
import { enterDungeon, instanceAt, leaveDungeon } from '../src/sim/instances/dungeons';
import { setItemLocked } from '../src/sim/item_lock';
import {
  FARM_FEAST_ITEM_ID,
  FARM_FEAST_TEMPLATE_ID,
  feastTemplateIds,
  isFeastTemplateId,
  placeFeastAction,
} from '../src/sim/professions/feast';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import {
  type Aura,
  type Entity,
  FARMING_CAST_ID,
  INSTANCE_EMPTY_TIMEOUT,
  INTERACT_RANGE,
  type SimEvent,
} from '../src/sim/types';
import { WELL_FED_AURA_ID } from '../src/sim/wellfed';
import { groundHeight, isInWaterBody, waterLevelAt } from '../src/sim/world';

// The capstone dish the bite serves (ITEMS[FARM_FEAST_ITEM_ID].feast.dishItemId,
// pinned as a literal in the content arm below).
const DISH_ID = 'evergarden_braised_greens';

interface Player {
  pid: number;
  p: Entity;
  meta: PlayerMeta;
}

function join(sim: Sim, name: string, characterId?: number): Player {
  const pid = sim.addPlayer(
    'warrior',
    name,
    characterId === undefined ? undefined : { characterId },
  );
  const p = sim.entities.get(pid)! as Entity;
  const meta = sim.players.get(pid) as PlayerMeta;
  return { pid, p, meta };
}

/** Stand `who` at a small offset from `anchor`, inside INTERACT_RANGE (5). */
function standBeside(who: Player, anchor: Player, dx = 1, dz = 0): void {
  who.p.pos.x = anchor.p.pos.x + dx;
  who.p.pos.z = anchor.p.pos.z + dz;
  who.p.pos.y = anchor.p.pos.y;
  who.p.prevPos = { ...who.p.pos };
}

// A ring of offsets, all within INTERACT_RANGE of the anchor, so up to eleven
// eaters can stand at a feast at once without stacking on one point.
const RING: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [2, 0],
  [-2, 0],
  [0, 2],
];
const EATER_NAMES = [
  'Anna',
  'Boris',
  'Cedric',
  'Dana',
  'Edwin',
  'Farah',
  'Gero',
  'Hilda',
  'Ivo',
  'Jonas',
  'Karl',
];

/** A settled world: one placer plus `nEaters` guests standing beside them.
 *  One tick after the joins (the wellfed.test.ts idiom), positions set after
 *  it so the spawn snap never moves anyone back out of reach. */
function world(nEaters = 1, seed = 42): { sim: Sim; placer: Player; eaters: Player[] } {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  const placer = join(sim, 'Hostess');
  const eaters = EATER_NAMES.slice(0, nEaters).map((name) => join(sim, name));
  sim.tick();
  eaters.forEach((g, i) => {
    standBeside(g, placer, RING[i][0], RING[i][1]);
  });
  return { sim, placer, eaters };
}

function giveFeast(sim: Sim, who: Player, n = 1): void {
  sim.addItem(FARM_FEAST_ITEM_ID, n, who.pid);
}

function eventsOf<T extends SimEvent['type']>(
  sim: Sim,
  from: number,
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return sim.events.slice(from).filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

/** The single farmDenied reason a call produced, or null. */
function denyReason(sim: Sim, from: number): string | null {
  const denies = eventsOf(sim, from, 'farmDenied');
  return denies.length === 1 ? denies[0].reason : null;
}

function errorTexts(sim: Sim, from: number): string[] {
  return eventsOf(sim, from, 'error').map((e) => e.text);
}

function feastEntities(sim: Sim): Entity[] {
  return [...sim.entities.values()].filter((e) => e.templateId === FARM_FEAST_TEMPLATE_ID);
}

/** Place with the item granted and assert success, returning the feast id. */
function placeOk(sim: Sim, who: Player): number {
  giveFeast(sim, who);
  const from = sim.events.length;
  sim.placeFeast(who.pid);
  const placed = eventsOf(sim, from, 'farmFeastPlaced');
  expect(placed, 'the place succeeded').toHaveLength(1);
  return placed[0].feastId;
}

function tickSeconds(sim: Sim, seconds: number): void {
  for (let i = 0; i < seconds * 20; i++) sim.tick();
}

function wellFedAuras(p: Entity): Aura[] {
  return p.auras.filter((a) => a.id === WELL_FED_AURA_ID);
}

/** Toggle the lock on one feast slot in the wanted direction (the
 *  professions_farming.test.ts idiom: locks toggle a named slot WHOLE, and a
 *  locked/unlocked mix is built by granting around a lock). */
function setSlotLocked(sim: Sim, who: Player, locked: boolean): void {
  const idx = who.meta.inventory.findIndex(
    (s) => s.itemId === FARM_FEAST_ITEM_ID && (s.instance?.locked === true) !== locked,
  );
  expect(idx, `no ${locked ? 'unlocked' : 'locked'} feast slot`).toBeGreaterThanOrEqual(0);
  expect(setItemLocked(sim.ctx, FARM_FEAST_ITEM_ID, locked, who.pid, idx).ok).toBe(true);
}

// Hand-rolled lock-state reads (never the production lock helpers, which are
// part of the code under test).
function lockedUnits(who: Player): number {
  return who.meta.inventory
    .filter((s) => s.itemId === FARM_FEAST_ITEM_ID && s.instance?.locked === true)
    .reduce((n, s) => n + s.count, 0);
}
function unlockedUnits(who: Player): number {
  return who.meta.inventory
    .filter((s) => s.itemId === FARM_FEAST_ITEM_ID && s.instance?.locked !== true)
    .reduce((n, s) => n + s.count, 0);
}

function kill(sim: Sim, who: Player): void {
  sim.ctx.dealDamage(null, who.p, 1_000_000, false, 'physical', null, 'hit');
  expect(who.p.dead).toBe(true);
}

// ---------------------------------------------------------------------------

describe('shared feast: wire tokens and content', () => {
  it('pins the item and template ids to their literals', () => {
    // Literals, never the constants compared to themselves (the wire-name
    // rule): a rename must red here, not slide through green.
    expect(FARM_FEAST_ITEM_ID).toBe('harvest_feast');
    expect(FARM_FEAST_TEMPLATE_ID).toBe('farm_feast');
  });

  it('the content invariant the two silent guards lean on: feast def and capstone dish', () => {
    // placeFeastAction and consumeFeastAction both bail silently when this
    // content is missing; this arm is what makes that bail unreachable in a
    // shipped catalog.
    const def = ITEMS[FARM_FEAST_ITEM_ID];
    expect(def && 'feast' in def ? def.feast : undefined).toEqual({
      charges: 10,
      durationTicks: 3600,
      dishItemId: DISH_ID,
      templateId: FARM_FEAST_TEMPLATE_ID,
    });
    const dish = ITEMS[DISH_ID];
    expect(dish.kind).toBe('food');
    expect(dish.foodHp).toBe(980);
    expect(dish.kind === 'food' ? dish.wellFed : undefined).toEqual({
      aura: 'Well Fed',
      kind: 'buff_sta',
      value: 5,
      duration: 600,
    });
  });
});

describe('shared feast: placing', () => {
  it('spends one item and spawns the object with state, name, and the placed event', () => {
    const { sim, placer } = world(0);
    giveFeast(sim, placer);
    expect(sim.countItem(FARM_FEAST_ITEM_ID, placer.pid)).toBe(1);
    const placedAt = sim.tickCount;
    const from = sim.events.length;
    sim.placeFeast(placer.pid);

    // The bag spend: exactly one unit.
    expect(sim.countItem(FARM_FEAST_ITEM_ID, placer.pid)).toBe(0);

    // The event carries the entity id.
    const placed = eventsOf(sim, from, 'farmFeastPlaced');
    expect(placed).toHaveLength(1);
    expect(placed[0].pid).toBe(placer.pid);
    const feastId = placed[0].feastId;

    // The entity: an object at the placer's feet carrying the placer's raw
    // name as a value (the client composes the localized title off it).
    const e = sim.entities.get(feastId)!;
    expect(e.kind).toBe('object');
    expect(e.templateId).toBe(FARM_FEAST_TEMPLATE_ID);
    expect(e.name).toBe('Hostess');
    expect(e.pos.x).toBe(placer.p.pos.x);
    expect(e.pos.z).toBe(placer.p.pos.z);
    expect(e.lootable).toBe(false);
    expect(e.objectItemId).toBeNull();

    // The state: charges 10, tick-domain expiry 3600 ticks out (literals: the
    // maintainer-flagged tuning lives in ITEMS[FARM_FEAST_ITEM_ID].feast, and
    // a tuning pass moves the content arm above together with this one).
    const st = sim.ctx.feasts.get(feastId)!;
    expect(st).toBeTruthy();
    expect(st.entityId).toBe(feastId);
    expect(st.charges).toBe(10);
    expect(st.expiresAtTick).toBe(placedAt + 3600);
    expect(st.ownerKey).toBe(placer.pid); // no characterId: entityId is the key
    expect(st.eatenBy.size).toBe(0);
  });

  it('no_feast: an empty bag denies and nothing spawns; with the item the same press lands', () => {
    const { sim, placer } = world(0);
    const from = sim.events.length;
    sim.placeFeast(placer.pid);
    expect(denyReason(sim, from)).toBe('no_feast');
    expect(sim.ctx.feasts.size).toBe(0);
    expect(feastEntities(sim)).toHaveLength(0);

    // Positive control: the identical press with the item succeeds.
    giveFeast(sim, placer);
    const from2 = sim.events.length;
    sim.placeFeast(placer.pid);
    expect(eventsOf(sim, from2, 'farmFeastPlaced')).toHaveLength(1);
    expect(feastEntities(sim)).toHaveLength(1);
  });

  it('locked: a locked-only copy denies as locked (never no_feast), item kept, nothing spawns', () => {
    const { sim, placer } = world(0);
    giveFeast(sim, placer);
    setSlotLocked(sim, placer, true);
    const from = sim.events.length;
    sim.placeFeast(placer.pid);
    // The lock-only split: the raw count would have passed, so the denial
    // names the lock, never a phantom shortage.
    expect(denyReason(sim, from)).toBe('locked');
    expect(sim.countItem(FARM_FEAST_ITEM_ID, placer.pid)).toBe(1);
    expect(lockedUnits(placer)).toBe(1);
    expect(sim.ctx.feasts.size).toBe(0);
    expect(feastEntities(sim)).toHaveLength(0);

    // Positive control: unlock the same copy and the press lands.
    setSlotLocked(sim, placer, false);
    const from2 = sim.events.length;
    sim.placeFeast(placer.pid);
    expect(eventsOf(sim, from2, 'farmFeastPlaced')).toHaveLength(1);
  });

  it('the spend takes the unlocked copy and the locked spare survives', () => {
    const { sim, placer } = world(0);
    // Build [unlocked at the lower index, locked at the END slot]: the hub's
    // lock-blind removal walk consumes highest bag index FIRST, so the locked
    // copy sits exactly where a lock-blind spend would take it. Whole-slot
    // locks cannot split a stack, so the mix is the grant-around-a-lock dance:
    // A granted and locked, B granted (a locked slot never merges, fresh end
    // slot), B locked, A unlocked.
    giveFeast(sim, placer);
    setSlotLocked(sim, placer, true); // lock A
    giveFeast(sim, placer); // B: fresh unlocked end slot
    setSlotLocked(sim, placer, true); // lock B (the one unlocked slot)
    setSlotLocked(sim, placer, false); // unlock A (the first locked slot)
    expect(lockedUnits(placer)).toBe(1);
    expect(unlockedUnits(placer)).toBe(1);

    const from = sim.events.length;
    sim.placeFeast(placer.pid);
    expect(eventsOf(sim, from, 'farmFeastPlaced')).toHaveLength(1);
    // The locked end-slot copy was never a victim: A (unlocked) was spent.
    expect(lockedUnits(placer)).toBe(1);
    expect(unlockedUnits(placer)).toBe(0);
  });

  it('a use_item press spends the CLICKED slot, never the id-walk guess (two stacks)', () => {
    const { sim, placer } = world(0);
    // Two distinguishable copies: distinct instance payloads never merge, so
    // CopyA sits at the LOWER bag index and CopyB at the END slot, exactly
    // where the id-only removal walk (highest index first) would strike.
    sim.addItemInstance(FARM_FEAST_ITEM_ID, { signer: 'CopyA' }, placer.pid, 1, { silent: true });
    sim.addItemInstance(FARM_FEAST_ITEM_ID, { signer: 'CopyB' }, placer.pid, 1, { silent: true });
    const idxA = placer.meta.inventory.findIndex(
      (s) => s.itemId === FARM_FEAST_ITEM_ID && s.instance?.signer === 'CopyA',
    );
    const idxB = placer.meta.inventory.findIndex(
      (s) => s.itemId === FARM_FEAST_ITEM_ID && s.instance?.signer === 'CopyB',
    );
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThan(idxA);

    const from = sim.events.length;
    sim.useItem(FARM_FEAST_ITEM_ID, placer.pid, idxA);
    expect(eventsOf(sim, from, 'farmFeastPlaced')).toHaveLength(1);
    // The clicked copy (A) is gone and the end-slot copy (B) survives: the
    // named selection was honored, not the highest-index guess.
    const left = placer.meta.inventory.filter((s) => s.itemId === FARM_FEAST_ITEM_ID);
    expect(left).toHaveLength(1);
    expect(left[0].instance?.signer).toBe('CopyB');
  });

  it('a use_item press naming a LOCKED copy denies as locked even with an unlocked spare', () => {
    const { sim, placer } = world(0);
    // A locked at the lower index, B unlocked at the end slot (a locked slot
    // never merges, so the second grant starts fresh).
    giveFeast(sim, placer);
    setSlotLocked(sim, placer, true);
    giveFeast(sim, placer);
    const idxLocked = placer.meta.inventory.findIndex(
      (s) => s.itemId === FARM_FEAST_ITEM_ID && s.instance?.locked === true,
    );
    expect(idxLocked).toBeGreaterThanOrEqual(0);

    const from = sim.events.length;
    sim.useItem(FARM_FEAST_ITEM_ID, placer.pid, idxLocked);
    // Spending a different copy than the one the player clicked is the
    // id-only guess per-copy addressing exists to remove: the named locked
    // copy refuses as locked, nothing is spent, nothing spawns.
    expect(denyReason(sim, from)).toBe('locked');
    expect(lockedUnits(placer)).toBe(1);
    expect(unlockedUnits(placer)).toBe(1);
    expect(sim.ctx.feasts.size).toBe(0);
    expect(feastEntities(sim)).toHaveLength(0);

    // Positive control: the same press naming the UNLOCKED copy lands and
    // spends exactly it; the locked copy survives.
    const idxUnlocked = placer.meta.inventory.findIndex(
      (s) => s.itemId === FARM_FEAST_ITEM_ID && s.instance?.locked !== true,
    );
    const from2 = sim.events.length;
    sim.useItem(FARM_FEAST_ITEM_ID, placer.pid, idxUnlocked);
    expect(eventsOf(sim, from2, 'farmFeastPlaced')).toHaveLength(1);
    expect(lockedUnits(placer)).toBe(1);
    expect(unlockedUnits(placer)).toBe(0);
  });

  it('a stale named selection refuses without spending (the direct defensive arm)', () => {
    // The tri-state's null branch is unreachable through useItem (which
    // pre-validates the selection), so this drives placeFeastAction directly
    // with an out-of-range index: the refusal must consume nothing and spawn
    // nothing (the free-feast duplication a silent fall-through would risk).
    const { sim, placer } = world(0);
    giveFeast(sim, placer);
    const from = sim.events.length;
    placeFeastAction(sim.ctx, placer.p, placer.meta, 999);
    expect(denyReason(sim, from)).toBe('no_feast');
    expect(sim.countItem(FARM_FEAST_ITEM_ID, placer.pid)).toBe(1);
    expect(sim.ctx.feasts.size).toBe(0);
    expect(feastEntities(sim)).toHaveLength(0);
  });

  it('feast_active: one active feast per placer, while another player still can place', () => {
    const { sim, placer, eaters } = world(1);
    placeOk(sim, placer);

    giveFeast(sim, placer);
    const from = sim.events.length;
    sim.placeFeast(placer.pid);
    expect(denyReason(sim, from)).toBe('feast_active');
    expect(sim.countItem(FARM_FEAST_ITEM_ID, placer.pid)).toBe(1); // unspent
    expect(feastEntities(sim)).toHaveLength(1);
    expect(sim.ctx.feasts.size).toBe(1);

    // A DIFFERENT player is not blocked by my standing feast.
    const other = eaters[0];
    giveFeast(sim, other);
    const from2 = sim.events.length;
    sim.placeFeast(other.pid);
    expect(eventsOf(sim, from2, 'farmFeastPlaced')).toHaveLength(1);
    expect(feastEntities(sim)).toHaveLength(2);
    expect(sim.ctx.feasts.size).toBe(2);
  });

  it('feast_active binds the rename-proof key: a characterId-keyed placer is denied too', () => {
    // Every other feast_active arm uses non-keyed players, where ownerKey
    // equals the session entity id, so a one-active scan comparing entity
    // ids instead of the rename-proof key would pass them all. This arm is
    // the online shape: a keyed placer whose characterId differs from the
    // session pid must still be denied a second helping of placement.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const placer = join(sim, 'Keyed', 501);
    sim.tick();
    expect(placer.meta.characterId).toBe(501);
    expect(placer.pid, 'the key really differs from the session id').not.toBe(501);
    giveFeast(sim, placer, 2);
    const from0 = sim.events.length;
    sim.placeFeast(placer.pid);
    expect(eventsOf(sim, from0, 'farmFeastPlaced')).toHaveLength(1);
    const st = [...sim.ctx.feasts.values()][0];
    expect(st.ownerKey, 'the stored owner key is the characterId').toBe(501);
    const from = sim.events.length;
    sim.placeFeast(placer.pid);
    expect(denyReason(sim, from)).toBe('feast_active');
    expect(feastEntities(sim)).toHaveLength(1);
    expect(sim.countItem(FARM_FEAST_ITEM_ID, placer.pid), 'the second item kept').toBe(1);
  });

  it('dead answers via the shared error sentence, never farmDenied, nothing changes', () => {
    const { sim, placer } = world(0);
    giveFeast(sim, placer);
    kill(sim, placer);
    const from = sim.events.length;
    sim.placeFeast(placer.pid);
    expect(eventsOf(sim, from, 'farmDenied')).toHaveLength(0);
    expect(errorTexts(sim, from)).toContain("You can't do that while dead.");
    expect(sim.countItem(FARM_FEAST_ITEM_ID, placer.pid)).toBe(1);
    expect(sim.ctx.feasts.size).toBe(0);
    expect(feastEntities(sim)).toHaveLength(0);
  });

  it('busy (casting, eating, drinking) answers via the shared error sentence', () => {
    const { sim, placer } = world(0);
    giveFeast(sim, placer);

    // A running cast.
    placer.p.castingAbility = FARMING_CAST_ID;
    let from = sim.events.length;
    sim.placeFeast(placer.pid);
    expect(eventsOf(sim, from, 'farmDenied')).toHaveLength(0);
    expect(errorTexts(sim, from)).toContain('You are busy.');
    expect(sim.countItem(FARM_FEAST_ITEM_ID, placer.pid)).toBe(1);
    placer.p.castingAbility = null;

    // Mid-meal (the isConsuming arm).
    sim.addItem('vale_hearth_loaf', 1, placer.pid);
    sim.useItem('vale_hearth_loaf', placer.pid);
    expect(placer.p.eating).toBeTruthy();
    from = sim.events.length;
    sim.placeFeast(placer.pid);
    expect(eventsOf(sim, from, 'farmDenied')).toHaveLength(0);
    expect(errorTexts(sim, from)).toContain('You are busy.');
    placer.p.eating = null;

    // Mid-drink (isConsuming's other slot).
    sim.addItem('spring_water', 1, placer.pid);
    sim.useItem('spring_water', placer.pid);
    expect(placer.p.drinking).toBeTruthy();
    from = sim.events.length;
    sim.placeFeast(placer.pid);
    expect(eventsOf(sim, from, 'farmDenied')).toHaveLength(0);
    expect(errorTexts(sim, from)).toContain('You are busy.');
    placer.p.drinking = null;
    placer.p.sitting = false;

    // Positive control: the armed expectation really differed from this one.
    from = sim.events.length;
    sim.placeFeast(placer.pid);
    expect(eventsOf(sim, from, 'farmFeastPlaced')).toHaveLength(1);
    expect(sim.countItem(FARM_FEAST_ITEM_ID, placer.pid)).toBe(0);
  });
});

describe('shared feast: the bite and the Well Fed mint', () => {
  it('spends a serving at bite START and mints the dish buff only at the 18s completion', () => {
    const { sim, placer, eaters } = world(1);
    const eater = eaters[0];
    const feastId = placeOk(sim, placer);
    const st = sim.ctx.feasts.get(feastId)!;

    sim.consumeFeast(feastId, eater.pid);
    // The bite START: serving spent, ledger written, the eating slot holds
    // one serving of the capstone dish, and NO buff yet.
    expect(st.charges).toBe(9);
    expect(st.eatenBy.has(eater.pid)).toBe(true);
    expect(eater.p.sitting).toBe(true);
    expect(eater.p.eating?.itemId).toBe(DISH_ID);
    expect(eater.p.eating?.kind).toBe('food');
    expect(eater.p.eating?.hpPer2s).toBe(109); // round(980 foodHp / 9 regen ticks)
    expect(eater.p.eating?.manaPer2s).toBe(0);
    expect(eater.p.eating?.remaining).toBe(18); // CONSUME_DURATION
    expect(wellFedAuras(eater.p), 'no mint at the bite').toEqual([]);

    // Ride out the sit-restore: the mint lands through the REAL updateRegen
    // completion path (no direct wellfed call anywhere in this suite).
    tickSeconds(sim, 22);
    expect(eater.p.eating).toBeNull();
    const wf = wellFedAuras(eater.p);
    expect(wf).toHaveLength(1);
    expect(wf[0].id).toBe(WELL_FED_AURA_ID);
    expect(wf[0].value).toBe(5);
    expect(wf[0].duration).toBe(600);
  });

  it('a feast bite and a bagged dish of the same id mint an IDENTICAL aura', () => {
    // The carried-payload guard (ruling 11c-A2-BUILDER): the defect class
    // this pins is the bite WRITING a Consuming without the wellFed carry,
    // which fails no restore assertion and silently never mints. Both paths
    // run the REAL tick machinery (bag use vs place-then-bite, each ridden
    // through the 18s drain), and the minted aura is compared as a WHOLE
    // record, never mere presence, so a drifted field (kind, school, source,
    // duration) reds here too. `remaining` is excluded by construction: the
    // two runs complete on different ticks of their own sims, so it is
    // re-read at mint time instead (asserted equal to the full duration).
    const bag = world(1, 7);
    const bagEater = bag.eaters[0];
    bag.sim.addItem(DISH_ID, 1, bagEater.pid);
    bag.sim.useItem(DISH_ID, bagEater.pid);
    tickSeconds(bag.sim, 22);
    expect(bag.sim.entities.get(bagEater.pid)).toBeTruthy();
    const bagged = wellFedAuras(bagEater.p);
    expect(bagged, 'the bagged dish minted').toHaveLength(1);

    const feast = world(1, 7);
    const feastEater = feast.eaters[0];
    const feastId = placeOk(feast.sim, feast.placer);
    feast.sim.consumeFeast(feastId, feastEater.pid);
    tickSeconds(feast.sim, 22);
    const bitten = wellFedAuras(feastEater.p);
    expect(bitten, 'the feast bite minted').toHaveLength(1);

    const record = (a: Aura, sourceOf: Entity) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      value: a.value,
      duration: a.duration,
      school: a.school,
      selfSourced: a.sourceId === sourceOf.id,
      fullAtMint: a.duration - a.remaining < 30, // fresh, minus tick slack
    });
    expect(record(bitten[0], feastEater.p)).toEqual(record(bagged[0], bagEater.p));
    // Anchor the equality on one side: a field moving on BOTH sides (the
    // school, the self-source, the at-mint freshness) is invisible to the
    // equality alone, so the bite's record is also pinned to the literals
    // the mint writes.
    expect(bitten[0].school).toBe('nature');
    expect(bitten[0].sourceId).toBe(feastEater.p.id);
    expect(record(bitten[0], feastEater.p).fullAtMint).toBe(true);
  });

  it('once per player: the second press denies feast_eaten, a third player still eats', () => {
    const { sim, placer, eaters } = world(2);
    const [first, second] = eaters;
    const feastId = placeOk(sim, placer);
    const st = sim.ctx.feasts.get(feastId)!;

    sim.consumeFeast(feastId, first.pid);
    expect(st.charges).toBe(9);

    const from = sim.events.length;
    sim.consumeFeast(feastId, first.pid);
    expect(denyReason(sim, from)).toBe('feast_eaten');
    expect(st.charges).toBe(9); // unchanged
    expect(st.eatenBy.size).toBe(1);

    const from2 = sim.events.length;
    sim.consumeFeast(feastId, second.pid);
    expect(eventsOf(sim, from2, 'farmDenied')).toHaveLength(0);
    expect(st.charges).toBe(8);
    expect(st.eatenBy.has(second.pid)).toBe(true);
  });

  it('the ledger key is characterId when present, never the session entity id', () => {
    const { sim, placer } = world(0);
    const keyed = join(sim, 'Mireille', 9001);
    sim.tick();
    standBeside(keyed, placer);
    const feastId = placeOk(sim, placer);
    const st = sim.ctx.feasts.get(feastId)!;

    sim.consumeFeast(feastId, keyed.pid);
    expect(st.charges).toBe(9);
    expect(st.eatenBy.has(9001)).toBe(true);
    expect(st.eatenBy.has(keyed.pid)).toBe(false);
  });

  it('a running non-spell cast blocks the bite with the family busy sentence', () => {
    const { sim, placer, eaters } = world(1);
    const eater = eaters[0];
    const feastId = placeOk(sim, placer);
    const st = sim.ctx.feasts.get(feastId)!;

    eater.p.castingAbility = FARMING_CAST_ID;
    const from = sim.events.length;
    sim.consumeFeast(feastId, eater.pid);
    expect(eventsOf(sim, from, 'farmDenied')).toHaveLength(0);
    expect(errorTexts(sim, from)).toContain('You are busy.');
    expect(st.charges).toBe(10);
    expect(st.eatenBy.size).toBe(0);
    expect(eater.p.eating).toBeNull();

    // Positive control: the same press with the cast cleared lands.
    eater.p.castingAbility = null;
    sim.consumeFeast(feastId, eater.pid);
    expect(st.charges).toBe(9);
  });

  it('in combat, already eating, and dead each refuse before any serving is spent', () => {
    const { sim, placer, eaters } = world(3);
    const [fighter, muncher, casualty] = eaters;
    const feastId = placeOk(sim, placer);
    const st = sim.ctx.feasts.get(feastId)!;

    // In combat: the items.ts food-arm sentence.
    fighter.p.inCombat = true;
    let from = sim.events.length;
    sim.consumeFeast(feastId, fighter.pid);
    expect(eventsOf(sim, from, 'farmDenied')).toHaveLength(0);
    expect(errorTexts(sim, from)).toContain("You can't do that while in combat.");
    expect(st.charges).toBe(10);
    fighter.p.inCombat = false;

    // Already eating a bagged dish: the occupied-slot sentence, and the
    // serving is NOT spent (the slot gate sits before the spend).
    sim.addItem('vale_hearth_loaf', 1, muncher.pid);
    sim.useItem('vale_hearth_loaf', muncher.pid);
    expect(muncher.p.eating).toBeTruthy();
    from = sim.events.length;
    sim.consumeFeast(feastId, muncher.pid);
    expect(eventsOf(sim, from, 'farmDenied')).toHaveLength(0);
    expect(errorTexts(sim, from)).toContain('You are already eating.');
    expect(st.charges).toBe(10);
    expect(st.eatenBy.size).toBe(0);

    // Dead: the shared dead sentence.
    kill(sim, casualty);
    from = sim.events.length;
    sim.consumeFeast(feastId, casualty.pid);
    expect(eventsOf(sim, from, 'farmDenied')).toHaveLength(0);
    expect(errorTexts(sim, from)).toContain("You can't do that while dead.");
    expect(st.charges).toBe(10);

    // Positive control: an unencumbered press from the fighter now lands.
    from = sim.events.length;
    sim.consumeFeast(feastId, fighter.pid);
    expect(eventsOf(sim, from, 'farmDenied')).toHaveLength(0);
    expect(st.charges).toBe(9);
  });

  it('feast_range: out of reach denies untouched, a step closer the same press lands', () => {
    const { sim, placer, eaters } = world(1);
    const eater = eaters[0];
    const feastId = placeOk(sim, placer);
    const st = sim.ctx.feasts.get(feastId)!;

    standBeside(eater, placer, 10, 0); // beyond INTERACT_RANGE (5)
    const from = sim.events.length;
    sim.consumeFeast(feastId, eater.pid);
    expect(denyReason(sim, from)).toBe('feast_range');
    expect(st.charges).toBe(10);
    expect(st.eatenBy.size).toBe(0);
    expect(eater.p.eating).toBeNull();

    standBeside(eater, placer, 1, 0);
    const from2 = sim.events.length;
    sim.consumeFeast(feastId, eater.pid);
    expect(eventsOf(sim, from2, 'farmDenied')).toHaveLength(0);
    expect(st.charges).toBe(9);
  });

  it('a bite at exactly INTERACT_RANGE lands: the deny is strictly beyond the boundary', () => {
    // The client twin (tests/feast_interact.test.ts) pins its INCLUSIVE
    // boundary on the premise the sim accepts at equality; this arm is the
    // sim half of that contract, so a sim-side >= drift reds here instead
    // of silently breaking the client's never-refuse-what-the-sim-accepts
    // promise. Integer coordinates keep the distance exactly 5.0.
    const { sim, placer, eaters } = world(1);
    const eater = eaters[0];
    const feastId = placeOk(sim, placer);
    const ent = sim.entities.get(feastId);
    if (!ent) throw new Error('no feast entity');
    ent.pos.x = Math.round(ent.pos.x);
    ent.pos.z = Math.round(ent.pos.z);
    eater.p.pos.x = ent.pos.x + INTERACT_RANGE;
    eater.p.pos.z = ent.pos.z;
    eater.p.prevPos = { ...eater.p.pos };
    const from = sim.events.length;
    sim.consumeFeast(feastId, eater.pid);
    expect(eventsOf(sim, from, 'farmDenied')).toHaveLength(0);
    expect(eater.p.eating, 'the bite landed at the exact boundary').not.toBeNull();
  });

  it('the bite refuses while swimming with the family sentence, nothing spent', () => {
    // The place gate's own comment cites this refusal as its premise; this
    // arm executes it. The range gate sits BEFORE the swim gate, so the
    // feast is poked within reach of the swimmer (no shore-placed geometry
    // reaches deep water inside INTERACT_RANGE).
    const { sim, placer, eaters } = world(1);
    const eater = eaters[0];
    const feastId = placeOk(sim, placer);
    const st = sim.ctx.feasts.get(feastId)!;
    const water = (() => {
      for (let z = -300; z <= 300; z += 4) {
        for (let x = -300; x <= 300; x += 4) {
          const wl = waterLevelAt(x, z, 42);
          if (isInWaterBody(x, z) && Number.isFinite(wl) && groundHeight(x, z, 42) < wl - 2) {
            return { x, z, y: wl - 0.75 };
          }
        }
      }
      throw new Error('no deep water found on seed 42');
    })();
    eater.p.pos = { ...water };
    eater.p.prevPos = { ...water };
    expect(sim.isSwimming(eater.p), 'the rig really swims').toBe(true);
    const ent = sim.entities.get(feastId);
    if (!ent) throw new Error('no feast entity');
    const shorePos = { ...ent.pos };
    ent.pos = { x: water.x + 1, y: water.y, z: water.z };
    const from = sim.events.length;
    sim.consumeFeast(feastId, eater.pid);
    expect(errorTexts(sim, from)).toEqual(["You can't do that while swimming."]);
    expect(eventsOf(sim, from, 'farmDenied')).toHaveLength(0);
    expect(st.charges, 'nothing spent').toBe(10);
    expect(st.eatenBy.size, 'the ledger untouched').toBe(0);
    expect(eater.p.eating).toBeNull();
    // The positive control: the same press lands ashore.
    ent.pos = shorePos;
    standBeside(eater, placer, 1, 0);
    const from2 = sim.events.length;
    sim.consumeFeast(feastId, eater.pid);
    expect(eventsOf(sim, from2, 'farmDenied')).toHaveLength(0);
    expect(eater.p.eating, 'the shore press lands').not.toBeNull();
    expect(st.charges).toBe(9);
  });

  it('a press in the orphan window (entity gone, state standing) denies without crashing', () => {
    // The !entity leg of the existence gate: between an external entity
    // drop and the next sweep boundary the state still stands; the press
    // must answer feast_expired and never reach the range check, where
    // dist2d on an undefined entity would throw (the crash vector the leg
    // guards).
    const { sim, placer, eaters } = world(1);
    const eater = eaters[0];
    const feastId = placeOk(sim, placer);
    sim.entities.delete(feastId);
    expect(sim.ctx.feasts.has(feastId), 'the state still stands pre-sweep').toBe(true);
    const from = sim.events.length;
    sim.consumeFeast(feastId, eater.pid);
    expect(denyReason(sim, from)).toBe('feast_expired');
    expect(sim.ctx.feasts.get(feastId)?.charges, 'nothing spent').toBe(10);
    expect(eater.p.eating).toBeNull();
  });

  it('interruption forfeits the buff, never refunds the serving, and the ledger keeps the eater', () => {
    const { sim, placer, eaters } = world(1);
    const eater = eaters[0];
    const feastId = placeOk(sim, placer);
    const st = sim.ctx.feasts.get(feastId)!;

    sim.consumeFeast(feastId, eater.pid);
    expect(st.charges).toBe(9);
    tickSeconds(sim, 5);
    expect(eater.p.eating, 'mid-meal before the hit').toBeTruthy();

    // The wellfed.test.ts interruption: damage clears the eating slot.
    sim.ctx.dealDamage(null, eater.p, 5, false, 'physical', null, 'hit');
    expect(eater.p.eating, 'the hit cancels the meal').toBeNull();

    tickSeconds(sim, 20); // well past where 18s would have landed
    expect(wellFedAuras(eater.p), 'the forfeited meal never pays out').toEqual([]);
    expect(st.charges).toBe(9); // spent at START, never refunded

    // The ledger kept the eater: the re-press is feast_eaten, not a free retry.
    const from = sim.events.length;
    sim.consumeFeast(feastId, eater.pid);
    expect(denyReason(sim, from)).toBe('feast_eaten');
    expect(st.charges).toBe(9);
  });
});

describe('shared feast: charges, expiry, and the 1 Hz sweep', () => {
  it('ten bites drain it, the eleventh denies feast_finished, despawn rides the next boundary', () => {
    const { sim, placer, eaters } = world(11);
    const feastId = placeOk(sim, placer);
    const st = sim.ctx.feasts.get(feastId)!;

    for (let i = 0; i < 10; i++) {
      const from = sim.events.length;
      sim.consumeFeast(feastId, eaters[i].pid);
      expect(eventsOf(sim, from, 'farmDenied'), `bite ${i + 1} landed`).toHaveLength(0);
      expect(st.charges).toBe(10 - (i + 1));
    }
    expect(st.charges).toBe(0);
    expect(st.eatenBy.size).toBe(10);

    // The eleventh eater: finished, not expired, and nothing changes.
    const from = sim.events.length;
    sim.consumeFeast(feastId, eaters[10].pid);
    expect(denyReason(sim, from)).toBe('feast_finished');
    expect(st.charges).toBe(0);
    expect(st.eatenBy.size).toBe(10);

    // The sub-second window: the drained feast stands until the EXACT
    // tick-mod-20 boundary (the sweep is the one despawn site).
    let windowTicks = 0;
    while ((sim.tickCount + 1) % 20 !== 0) {
      sim.tick();
      windowTicks++;
      expect(sim.entities.has(feastId), `entity stands at tick ${sim.tickCount}`).toBe(true);
      expect(sim.ctx.feasts.has(feastId), `state stands at tick ${sim.tickCount}`).toBe(true);
    }
    expect(windowTicks, 'the sub-second window really existed').toBeGreaterThan(0);

    sim.tick(); // the boundary tick: updateFarming's 1 Hz sweep runs
    expect(sim.tickCount % 20).toBe(0);
    expect(sim.entities.has(feastId)).toBe(false);
    expect(sim.ctx.feasts.has(feastId)).toBe(false);
  });

  it('expiry: the stale sub-second window denies feast_expired, then the sweep drops both', () => {
    const { sim, placer, eaters } = world(1);
    const eater = eaters[0];
    const feastId = placeOk(sim, placer);
    const st = sim.ctx.feasts.get(feastId)!;

    // Walk to a boundary: the sweep runs there with the feast alive and
    // correctly leaves it standing (charges 10, deadline far out).
    while (sim.tickCount % 20 !== 0) sim.tick();
    expect(sim.entities.has(feastId)).toBe(true);

    // Pull the deadline to the next tick (the wellfed.test.ts remaining-poke
    // precedent: riding out the real 3600 ticks is the arm below), so expiry
    // lands mid-second, 19 ticks shy of the next sweep.
    st.expiresAtTick = sim.tickCount + 1;
    sim.tick();
    expect(sim.tickCount).toBeGreaterThanOrEqual(st.expiresAtTick);
    expect(sim.tickCount % 20).not.toBe(0);

    // The stale window: expired to the command, entity still standing.
    const from = sim.events.length;
    sim.consumeFeast(feastId, eater.pid);
    expect(denyReason(sim, from)).toBe('feast_expired');
    expect(sim.entities.has(feastId)).toBe(true);
    expect(st.charges).toBe(10);
    expect(st.eatenBy.size).toBe(0);

    // The boundary sweep drops entity and state together.
    while (sim.tickCount % 20 !== 0) sim.tick();
    expect(sim.entities.has(feastId)).toBe(false);
    expect(sim.ctx.feasts.has(feastId)).toBe(false);

    // A press on the stale id after despawn: feast_expired, the same reason.
    const from2 = sim.events.length;
    sim.consumeFeast(feastId, eater.pid);
    expect(denyReason(sim, from2)).toBe('feast_expired');
  });

  it('a feast really expires after its full 180s with no state poking', () => {
    // 3620 real ticks: a declared budget so full-suite worker contention
    // cannot kill it at the 20s repo default (the Phase 6 QA lesson; the
    // suite_duration_budget ratchet accepts this row-free under 300s).
    const { sim, placer } = world(0);
    // Pin the WORST-CASE sweep phase (the re-arm class's tightest alignment):
    // place so expiresAtTick lands one tick past a 1 Hz boundary, making the
    // despawn wait the full 19 ticks after expiry. The QA round measured the
    // old finite spawn timer's margin at exactly ONE tick here, so this ride
    // is the arm that reds any regression of the never-re-arm rule at END of
    // life (the dedicated re-arm arm below covers only the start of life).
    while (sim.tickCount % 20 !== 1) sim.tick();
    const feastId = placeOk(sim, placer);
    const placeTick = sim.tickCount;
    const ent = sim.entities.get(feastId);
    if (!ent) throw new Error('no feast entity');
    let despawnTick = -1;
    for (let i = 0; i < 3700 && despawnTick < 0; i++) {
      sim.tick();
      if (!sim.entities.has(feastId)) {
        despawnTick = sim.tickCount;
      } else if (ent.lootable) {
        throw new Error(`re-armed lootable at life tick ${sim.tickCount - placeTick}`);
      }
    }
    expect(despawnTick, 'the feast despawned').toBeGreaterThan(0);
    expect(
      despawnTick - placeTick,
      'despawn landed on the first sweep boundary at or after expiry',
    ).toBeLessThanOrEqual(3600 + 19);
    expect(sim.ctx.feasts.has(feastId)).toBe(false);
  }, 60_000);

  it('the sweep never fires off-boundary: a mid-second drain survives to the exact boundary', () => {
    const { sim, placer } = world(0);
    const feastId = placeOk(sim, placer);
    const st = sim.ctx.feasts.get(feastId)!;

    // Land mid-second, then drain (the poke stands in for ten real bites,
    // which the drain arm above performs; this arm is about the boundary).
    while (sim.tickCount % 20 !== 7) sim.tick();
    st.charges = 0;

    let removedAtTick = -1;
    for (let i = 0; i < 40 && removedAtTick < 0; i++) {
      sim.tick();
      if (!sim.ctx.feasts.has(feastId)) removedAtTick = sim.tickCount;
      else expect(sim.entities.has(feastId), 'entity outlives its state never').toBe(true);
    }
    expect(removedAtTick).toBeGreaterThan(0);
    expect(removedAtTick % 20, 'removal landed exactly on the 1 Hz boundary').toBe(0);
    expect(sim.entities.has(feastId)).toBe(false);
  });
});

describe('shared feast: well-fed vs elixir coexistence and last-eaten-wins', () => {
  it('an elixir survives the feast mint, and a later tier-1 dish downgrades the food buff', () => {
    const { sim, placer, eaters } = world(1);
    const eater = eaters[0];
    const feastId = placeOk(sim, placer);

    // A live elixir buff first.
    sim.addItem('elixir_of_the_boar', 1, eater.pid);
    sim.useItem('elixir_of_the_boar', eater.pid);
    expect(eater.p.auras.find((a) => a.id === 'elixir_buff_sta')?.value).toBe(6);

    // The feast bite to completion: both stand, neither clobbered (the ids
    // cannot collide: 'well_fed' is never an 'elixir_<kind>').
    sim.consumeFeast(feastId, eater.pid);
    tickSeconds(sim, 22);
    expect(eater.p.eating).toBeNull();
    expect(wellFedAuras(eater.p)).toHaveLength(1);
    expect(wellFedAuras(eater.p)[0].value).toBe(5);
    expect(
      eater.p.auras.find((a) => a.id === 'elixir_buff_sta')?.value,
      'the elixir survived the feast grant',
    ).toBe(6);

    // Last eaten wins, the downgrade direction: a tier-1 dish (value 2)
    // eaten after the feast REPLACES the value-5 buff, one shared aura id.
    sim.addItem('eastbrook_glazed_carrots', 1, eater.pid);
    sim.useItem('eastbrook_glazed_carrots', eater.pid);
    tickSeconds(sim, 22);
    expect(eater.p.eating).toBeNull();
    const wf = wellFedAuras(eater.p);
    expect(wf, 'still exactly one well_fed aura').toHaveLength(1);
    expect(wf[0].value).toBe(2);
    expect(eater.p.auras.find((a) => a.id === 'elixir_buff_sta')?.value).toBe(6);
  });

  it('the upgrade direction: the feast bite after a tier-1 dish overwrites 2 with 5', () => {
    const { sim, placer, eaters } = world(1);
    const eater = eaters[0];
    const feastId = placeOk(sim, placer);

    sim.addItem('eastbrook_glazed_carrots', 1, eater.pid);
    sim.useItem('eastbrook_glazed_carrots', eater.pid);
    tickSeconds(sim, 22);
    expect(wellFedAuras(eater.p)[0].value).toBe(2);

    sim.consumeFeast(feastId, eater.pid);
    tickSeconds(sim, 22);
    const wf = wellFedAuras(eater.p);
    expect(wf).toHaveLength(1);
    expect(wf[0].value).toBe(5);
  });
});

describe('shared feast: zero-draw determinism', () => {
  // The whole feast lifecycle (place, bite, meal completion, sweep despawn)
  // owns ZERO rng draws: a scenario running it records the IDENTICAL draw
  // stream as a control that never touches the feast, and two same-seed
  // feast runs march in lockstep event for event.
  function runScenario(withFeast: boolean): {
    draws: number[];
    streams: SimEvent[][];
    eater: Entity;
    sim: Sim;
  } {
    const sim = new Sim({ seed: 4242, playerClass: 'warrior', noPlayer: true });
    const placer = join(sim, 'Hostess');
    const eater = join(sim, 'Anna');
    sim.tick();
    standBeside(eater, placer);
    const draws: number[] = [];
    const streams: SimEvent[][] = [];
    sim.rng.setObserver((value: number) => {
      draws.push(value);
    });
    try {
      let feastId = -1;
      if (withFeast) {
        sim.addItem(FARM_FEAST_ITEM_ID, 1, placer.pid);
        const from = sim.events.length;
        sim.placeFeast(placer.pid);
        feastId = eventsOf(sim, from, 'farmFeastPlaced')[0].feastId;
        sim.consumeFeast(feastId, eater.pid);
      }
      // Ride out the meal, then pull the deadline in and cross a sweep
      // boundary, so the despawn path is inside the observed window too.
      for (let i = 0; i < 22 * 20; i++) streams.push(sim.tick());
      if (withFeast) {
        const st = sim.ctx.feasts.get(feastId)!;
        st.expiresAtTick = sim.tickCount; // already reached; the poke draws nothing
      }
      for (let i = 0; i < 40; i++) streams.push(sim.tick());
      if (withFeast) expect(sim.ctx.feasts.size, 'the feast really despawned').toBe(0);
    } finally {
      sim.rng.setObserver(null);
    }
    return { draws, streams, eater: eater.p, sim };
  }

  it('the lifecycle records the identical draw stream as a feast-free control', () => {
    const feastRun = runScenario(true);
    const control = runScenario(false);

    // Non-vacuity: the feast run really minted, the control really did not,
    // and the observer really recorded a stream.
    expect(wellFedAuras(feastRun.eater)).toHaveLength(1);
    expect(wellFedAuras(control.eater)).toEqual([]);
    expect(feastRun.draws.length).toBeGreaterThan(0);

    expect(feastRun.draws.length).toBe(control.draws.length);
    expect(feastRun.draws).toEqual(control.draws);
  });

  it('two same-seed feast runs march in lockstep: equal draws and event streams', () => {
    const a = runScenario(true);
    const b = runScenario(true);
    expect(b.draws).toEqual(a.draws);
    expect(b.streams).toEqual(a.streams);
    expect(b.sim.tickCount).toBe(a.sim.tickCount);
  });
});

describe('shared feast: entry-point convergence and the sweep inverse cleanup', () => {
  it('water refuses PLACEMENT: the spend never destroys the item into an uneatable feast', () => {
    // The QA gate's find: the bite refuses while swimming, so a water
    // placement would burn the tier-4 item on a feast nobody can ever eat
    // and hold the one-active slot for the full 180s. Combat placement
    // stays legal by the stated header decision (combat ends; water does
    // not), so only the swim gate is pinned here.
    const { sim, placer } = world(0);
    giveFeast(sim, placer);
    const dry = { ...placer.p.pos };
    // Deep water is positional (ground below the local water level), so the
    // rig scans for a declared water body and treads its surface (the
    // mount_transition findDeepLake idiom, shore-walk trimmed away).
    const water = (() => {
      for (let z = -300; z <= 300; z += 4) {
        for (let x = -300; x <= 300; x += 4) {
          const wl = waterLevelAt(x, z, 42);
          if (isInWaterBody(x, z) && Number.isFinite(wl) && groundHeight(x, z, 42) < wl - 2) {
            return { x, z, y: wl - 0.75 };
          }
        }
      }
      throw new Error('no deep water found on seed 42');
    })();
    placer.p.pos = { ...water };
    placer.p.prevPos = { ...water };
    expect(sim.isSwimming(placer.p), 'the rig really swims').toBe(true);
    const from = sim.events.length;
    sim.placeFeast(placer.pid);
    expect(errorTexts(sim, from)).toEqual(["You can't do that while swimming."]);
    expect(eventsOf(sim, from, 'farmFeastPlaced')).toHaveLength(0);
    expect(feastEntities(sim)).toHaveLength(0);
    expect(sim.countItem(FARM_FEAST_ITEM_ID, placer.pid), 'the item was NOT spent').toBe(1);
    placer.p.pos = { ...dry }; // the positive control: the same press lands on dry ground
    placer.p.prevPos = { ...dry };
    const from2 = sim.events.length;
    sim.placeFeast(placer.pid);
    expect(eventsOf(sim, from2, 'farmFeastPlaced')).toHaveLength(1);
  });

  it('useItem on the feast item PLACES it: both entry points share the one action body', () => {
    // The items.ts def.feast arm (the architecture review's silent-no-op
    // finding): a use_item frame naming the feast must place it exactly like
    // world.placeFeast, never fall through the kind ladder as a dead click.
    const { sim, placer } = world(0);
    giveFeast(sim, placer);
    const from = sim.events.length;
    sim.useItem(FARM_FEAST_ITEM_ID, placer.pid);
    expect(eventsOf(sim, from, 'farmFeastPlaced'), 'the use placed the feast').toHaveLength(1);
    const spread = feastEntities(sim);
    expect(spread).toHaveLength(1);
    expect(sim.ctx.feasts.has(spread[0].id)).toBe(true);
    expect(sim.countItem(FARM_FEAST_ITEM_ID, placer.pid), 'the item was spent once').toBe(0);
  });

  it('the object-respawn sweep never re-arms the feast (lootable stays false for life)', () => {
    // The player-path probe's find: sim.ts's entity loop treats every
    // lootable-false object as a cooling pickup and re-armed the feast one
    // second after placement, handing the interact press to the generic
    // object arm (a silent dead press). The spawn respawnTimer outlives the
    // feast, so the sweep can never flip it back.
    const { sim, placer } = world(0);
    const feastId = placeOk(sim, placer);
    const ent = sim.entities.get(feastId);
    expect(ent?.lootable).toBe(false);
    tickSeconds(sim, 5); // well past the old one-second re-arm
    expect(ent?.lootable, 'the respawn sweep must never re-arm a feast as a pickup').toBe(false);
  });

  it('a FeastState whose entity vanished out from under it is reclaimed by the sweep', () => {
    // No other despawn path exists today (the sweep is the one despawn
    // site); this simulates a hypothetical external entity drop so the
    // inverse-cleanup leg is EXECUTED, not just read: the state and the
    // placer's one-active slot must both come back at the next boundary.
    const { sim, placer } = world(0);
    const feastId = placeOk(sim, placer);
    sim.entities.delete(feastId);
    tickSeconds(sim, 1.05);
    expect(sim.ctx.feasts.has(feastId), 'the orphaned state was reclaimed').toBe(false);
    giveFeast(sim, placer);
    const from = sim.events.length;
    sim.placeFeast(placer.pid);
    expect(denyReason(sim, from), 'the one-active slot freed with it').toBeNull();
    expect(eventsOf(sim, from, 'farmFeastPlaced')).toHaveLength(1);
  });
});

describe('shared feast: instance lifecycle', () => {
  it('a feast placed inside a dungeon instance falls with the run, freeing the slot', () => {
    // Without the objectIds registration, freeInstance tears down the run's
    // mobs and registered objects but leaves the feast standing at the slot
    // origin, still edible for the NEXT party claiming the slot and still
    // holding the placer's one-active slot for the rest of its 180s.
    const { sim, placer } = world(0);
    expect(enterDungeon(sim.ctx, 'dawnhold_castle', placer.pid)).toBe(true);
    sim.tick(); // settle the door processing
    const feastId = placeOk(sim, placer);
    const inst = instanceAt(sim.ctx, placer.p.pos);
    expect(inst, 'the placer stands inside a claimed instance').not.toBeNull();
    expect(inst?.partyKey, 'the instance is claimed').not.toBeNull();

    // The run ends: the placer leaves and the reaper's empty timeout elapses
    // (poked, the suite's state-write idiom; the real wait is 5 minutes).
    expect(leaveDungeon(sim.ctx, placer.pid)).toBe(true);
    if (inst) inst.emptyFor = INSTANCE_EMPTY_TIMEOUT;
    tickSeconds(sim, 2.05); // one reaper boundary plus one farming sweep boundary

    expect(sim.entities.has(feastId), 'the entity fell with the instance').toBe(false);
    expect(sim.ctx.feasts.has(feastId), 'the sweep reclaimed the state').toBe(false);

    // And the placer's one-active slot freed with it.
    giveFeast(sim, placer);
    const from = sim.events.length;
    sim.placeFeast(placer.pid);
    expect(denyReason(sim, from), 'the one-active slot freed with the run').toBeNull();
    expect(eventsOf(sim, from, 'farmFeastPlaced')).toHaveLength(1);
  });

  it('a feast placed inside a delve run falls with the run, freeing the slot', () => {
    // Delves are their OWN spatial system with their own roster (the
    // qa-checklist symmetry find): freeDelveRun and the module advance drop
    // run.objectIds, and without registration the table outlived the run at
    // the slot origin for the next claiming party, exactly the dungeon leak.
    const { sim, placer } = world(0);
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel, placer.pid);
    sim.enterDelve('collapsed_reliquary', 'normal', placer.pid);
    sim.tick(); // settle the entry teleport
    const run = delveRunForPlayer(sim.ctx, placer.pid);
    expect(run, 'the placer stands inside the claimed run').not.toBeNull();
    if (!run) return;
    const feastId = placeOk(sim, placer);

    // The run ends (the direct teardown; the empty reaper's wait is minutes).
    freeDelveRun(sim.ctx, run);
    tickSeconds(sim, 2.05); // a farming sweep boundary for the state reclaim

    expect(sim.entities.has(feastId), 'the entity fell with the run').toBe(false);
    expect(sim.ctx.feasts.has(feastId), 'the sweep reclaimed the state').toBe(false);

    giveFeast(sim, placer);
    const from = sim.events.length;
    sim.placeFeast(placer.pid);
    expect(denyReason(sim, from), 'the one-active slot freed with the run').toBeNull();
    expect(eventsOf(sim, from, 'farmFeastPlaced')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// THE APEX FEAST TIER (masterwrought Phase 11k). Everything below is about the
// WIDENING: the action used to name one module constant, so a second feast
// either did nothing or spent the party feast instead (that is exactly how
// Phase 11i's capstone shipped dead). These arms hold the generalization from
// both ends: the family is DERIVED from the catalog, every apex feast reaches
// the ground through the SAME code path as the party feast, and the dedicated
// command's meaning is unchanged.

/** The three apex rungs, each paired with the SHIPPED plate it serves. Written
 *  as literals rather than derived from the defs, because the pairing is the
 *  content claim under test: a def that re-points its dish must red here. */
const APEX_FEASTS: readonly [item: string, dish: string, template: string][] = [
  ['stonepot_feast', 'stonepot_stew', 'stonepot_feast'],
  ['warspice_feast', 'warspice_skewers', 'warspice_feast'],
  ['sageleaf_feast', 'sageleaf_chowder', 'sageleaf_feast'],
];

/** Place `itemId` through the REAL use path (useItem names the clicked slot,
 *  which is how every apex feast reaches the ground), returning the entity. */
function useToPlace(sim: Sim, who: Player, itemId: string): Entity | null {
  sim.addItem(itemId, 1, who.pid);
  const slotIndex = who.meta.inventory.findIndex((s) => s.itemId === itemId);
  expect(slotIndex, `${itemId} reached the bags`).toBeGreaterThanOrEqual(0);
  const from = sim.events.length;
  sim.useItem(itemId, who.pid, slotIndex);
  const placed = eventsOf(sim, from, 'farmFeastPlaced');
  if (placed.length !== 1) return null;
  return sim.entities.get(placed[0].feastId) ?? null;
}

describe('the apex feast tier: the placeable family', () => {
  it('the family is DERIVED from the catalog and every template is unique', () => {
    // The derivation is what makes a fifth feast impossible to half-wire: it
    // walks ITEMS for the feast payload rather than naming ids. The LITERAL
    // beside it is the guard (a derivation alone follows the table down and
    // cannot fail), and the uniqueness pin is decision K1's actual content
    // requirement: two feasts sharing a template are labelled the same.
    const ids = feastTemplateIds();
    expect(ids).toEqual(['farm_feast', 'sageleaf_feast', 'stonepot_feast', 'warspice_feast']);
    const fromCatalog = Object.values(ITEMS).flatMap((def) =>
      'feast' in def && def.feast ? [def.feast.templateId] : [],
    );
    expect(fromCatalog.length, 'one template per feast def, none shared').toBe(
      new Set(fromCatalog).size,
    );
    expect(fromCatalog.length, 'four feasts ship: the party rung plus three roles').toBe(4);
    // The predicate, called rather than re-implemented, on both arms.
    for (const id of ids) expect(isFeastTemplateId(id), id).toBe(true);
    expect(isFeastTemplateId('farm_bed')).toBe(false);
    expect(isFeastTemplateId(undefined)).toBe(false);
    expect(isFeastTemplateId(null)).toBe(false);
  });

  it('each apex feast serves its own SHIPPED apex plate, at the party rung tuning', () => {
    // A serving IS the plate (decision K5 keeps charges and duration at the
    // rung below), so re-tuning the plate re-tunes the feast and the feast can
    // never drift from the bagged dish.
    for (const [itemId, dishId, templateId] of APEX_FEASTS) {
      const def = ITEMS[itemId];
      expect(def, itemId).toBeTruthy();
      expect(def.quality, `${itemId} stays rare-or-better for craft signing`).toBe('epic');
      expect(def.kind).toBe('junk');
      expect(def.sellValue).toBe(300);
      expect('feast' in def ? def.feast : undefined).toEqual({
        charges: 10,
        durationTicks: 3600,
        dishItemId: dishId,
        templateId,
      });
      const dish = ITEMS[dishId];
      expect(dish.kind, `${dishId} is a real bagged plate`).toBe('food');
      expect(dish.kind === 'food' ? dish.wellFed?.aura : undefined).toBe('Well Fed');
    }
    // The three roles are DISTINCT, which is the whole reason there are three.
    const kinds = APEX_FEASTS.map(([, dishId]) => {
      const dish = ITEMS[dishId];
      return dish.kind === 'food' ? dish.wellFed?.kind : undefined;
    });
    expect(kinds).toEqual(['buff_sta', 'buff_ap', 'buff_int']);
  });

  it('an apex feast places through use_item, carrying every inherited contract', () => {
    const { sim, placer } = world(0);
    const e = useToPlace(sim, placer, 'stonepot_feast');
    expect(e, 'the apex feast reached the ground').toBeTruthy();
    if (!e) return;
    // Its OWN template, never the party feast's: sharing one is the decision
    // K1 rejected alternative, and it is what would label this a Harvest Feast.
    expect(e.templateId).toBe('stonepot_feast');
    expect(e.name, 'the PLACER name rides as a value').toBe('Hostess');
    // The three contracts inherited verbatim, pinned on an APEX feast rather
    // than only on harvest_feast: without all three the object-respawn sweep
    // re-arms the table and the generic object arm eats the interact press.
    expect(e.respawnTimer).toBe(Infinity);
    expect(e.lootable).toBe(false);
    expect(e.objectItemId).toBeNull();
    // And the state carries the plate the PLACED item names.
    const st = sim.ctx.feasts.get(e.id);
    expect(st?.dishItemId).toBe('stonepot_stew');
    expect(st?.charges).toBe(10);
    // The bag paid exactly one copy of the clicked item, and no party feast.
    expect(sim.countItem('stonepot_feast', placer.pid)).toBe(0);
    expect(sim.countItem(FARM_FEAST_ITEM_ID, placer.pid)).toBe(0);
  });

  it('a bite from an apex feast mints the APEX plate aura, not the party dish', () => {
    // The bug this pins is the one that made 11i's capstone a lie: the bite
    // used to re-read a module constant, so every feast served the party
    // feast's dish whatever the def said.
    const { sim, placer, eaters } = world(1);
    const e = useToPlace(sim, placer, 'sageleaf_feast');
    expect(e).toBeTruthy();
    if (!e) return;
    const guest = eaters[0];
    sim.consumeFeast(e.id, guest.pid);
    tickSeconds(sim, 20);
    const auras = wellFedAuras(guest.p);
    expect(auras, 'exactly one Well Fed').toHaveLength(1);
    const dish = ITEMS.sageleaf_chowder;
    const wanted = dish.kind === 'food' ? dish.wellFed : undefined;
    // DERIVATION PLUS LITERAL, because the derivation alone is a constant
    // self-comparison: both sides would read the same def the production code
    // reads, so a re-tune of the plate would move them together and prove
    // nothing. The literal is what reds on a re-tune; the derivation is what
    // says WHERE the number is supposed to come from.
    expect(wanted?.value, 'the plate really carries a magnitude').toBeDefined();
    expect(auras[0].value, 'the magnitude resolved off the DISH, never re-typed').toBe(
      wanted?.value,
    );
    expect(auras[0].value, 'and the literal beside it').toBe(6);
    // And the discriminator, which is what makes this arm decisive: the party
    // feast's dish is buff_sta at 5, so a bite that served the module constant
    // instead of the placed item would land buff_sta here.
    expect(auras[0].kind, 'the CASTER plate').toBe('buff_int');
    expect(auras[0].kind).not.toBe('buff_sta');
  });

  it('the well-fed ladder is unchanged across tiers: last eaten wins', () => {
    // The first time two feasts of DIFFERENT tiers can stand in one room, so
    // the one shared aura id gets its cross-tier pin here (11c owns the rule
    // and it is not re-opened).
    const { sim, placer, eaters } = world(1);
    const guest = eaters[0];
    const apex = useToPlace(sim, placer, 'stonepot_feast');
    expect(apex).toBeTruthy();
    if (!apex) return;
    sim.consumeFeast(apex.id, guest.pid);
    tickSeconds(sim, 20);
    expect(wellFedAuras(guest.p)).toHaveLength(1);
    // stonepot_stew's own value, resolved through the feast rather than typed.
    const stew = ITEMS.stonepot_stew;
    expect(wellFedAuras(guest.p)[0].value).toBe(stew.kind === 'food' ? stew.wellFed?.value : -1);
    expect(wellFedAuras(guest.p)[0].value, 'and the literal beside it').toBe(6);

    // Now a party feast from a DIFFERENT placer (the one-per-placer rule is
    // per placer, so this needs a second cook).
    const cook = join(sim, 'Cook');
    standBeside(cook, placer, -1, 0);
    sim.tick();
    const partyId = placeOk(sim, cook);
    sim.consumeFeast(partyId, guest.pid);
    tickSeconds(sim, 20);
    const after = wellFedAuras(guest.p);
    expect(after, 'still exactly one Well Fed: replaced, never stacked').toHaveLength(1);
    expect(after[0].value, 'the party dish replaced the apex one').toBe(5);
  });
});

describe('the apex feast tier: the rules that did NOT move', () => {
  it('decision K4: one live feast per placer, TIER-AGNOSTIC, in BOTH directions', () => {
    // feast.ts sweeps ctx.feasts by ownerKey with no tier key, so tier-agnostic
    // is what the code already does; pinning it in both orders turns an
    // accident into a decision.
    const a = world(0);
    expect(useToPlace(a.sim, a.placer, 'warspice_feast')).toBeTruthy();
    a.sim.addItem(FARM_FEAST_ITEM_ID, 1, a.placer.pid);
    let from = a.sim.events.length;
    a.sim.placeFeast(a.placer.pid);
    expect(denyReason(a.sim, from), 'apex standing, party refused').toBe('feast_active');
    expect(a.sim.countItem(FARM_FEAST_ITEM_ID, a.placer.pid), 'and nothing was spent').toBe(1);

    const b = world(0);
    placeOk(b.sim, b.placer);
    b.sim.addItem('warspice_feast', 1, b.placer.pid);
    const slot = b.placer.meta.inventory.findIndex((s) => s.itemId === 'warspice_feast');
    from = b.sim.events.length;
    b.sim.useItem('warspice_feast', b.placer.pid, slot);
    expect(denyReason(b.sim, from), 'party standing, apex refused').toBe('feast_active');
    expect(b.sim.countItem('warspice_feast', b.placer.pid), 'and nothing was spent').toBe(1);
  });

  it('a bare place_feast still places the PARTY feast and can never place an apex one', () => {
    // The dedicated command carries no item id, so its default is what keeps
    // its meaning: no wire field moved for this tier.
    const { sim, placer } = world(0);
    sim.addItem('stonepot_feast', 1, placer.pid);
    let from = sim.events.length;
    sim.placeFeast(placer.pid);
    expect(denyReason(sim, from), 'holding ONLY an apex feast, the bare command refuses').toBe(
      'no_feast',
    );
    expect(sim.countItem('stonepot_feast', placer.pid), 'and the apex copy survives').toBe(1);

    // Holding BOTH, the bare command still takes the party feast. This is the
    // half that would silently regress if the default were dropped.
    sim.addItem(FARM_FEAST_ITEM_ID, 1, placer.pid);
    from = sim.events.length;
    sim.placeFeast(placer.pid);
    const placed = eventsOf(sim, from, 'farmFeastPlaced');
    expect(placed).toHaveLength(1);
    expect(sim.entities.get(placed[0].feastId)?.templateId).toBe(FARM_FEAST_TEMPLATE_ID);
    expect(sim.countItem('stonepot_feast', placer.pid), 'the apex copy is untouched').toBe(1);
  });

  it('a non-feast id refuses outright rather than falling through to the party feast', () => {
    // The action takes an id now, so the defensive arm matters: a caller
    // naming a non-feast must not spend a Harvest Feast, which is precisely
    // the destructive outcome the pre-widening code produced.
    const { sim, placer } = world(0);
    giveFeast(sim, placer);
    const from = sim.events.length;
    placeFeastAction(sim.ctx, placer.p, placer.meta, undefined, 'cooking_salt');
    expect(eventsOf(sim, from, 'farmFeastPlaced'), 'nothing placed').toHaveLength(0);
    expect(sim.countItem(FARM_FEAST_ITEM_ID, placer.pid), 'the party feast was NOT spent').toBe(1);
  });
});

describe('the apex feast tier: the teardown class is INHERITED, not rewritten', () => {
  // The highest-risk half of the widening, and the reason it is asserted BY
  // BEHAVIOR rather than by reading the code: the placement registers the
  // entity on TWO rosters, and it does so precisely because without them the
  // table outlived its room and stood there, still edible, for the next
  // claiming party. A generalization that forked the placement path would keep
  // every arm above green and lose exactly this.

  it('an apex feast placed in a claimed dungeon instance falls with the run', () => {
    const { sim, placer } = world(0);
    expect(enterDungeon(sim.ctx, 'dawnhold_castle', placer.pid)).toBe(true);
    sim.tick();
    const e = useToPlace(sim, placer, 'stonepot_feast');
    expect(e, 'the apex feast reached the ground inside the instance').toBeTruthy();
    if (!e) return;
    const inst = instanceAt(sim.ctx, placer.p.pos);
    expect(inst?.partyKey, 'the instance is claimed').not.toBeNull();
    expect(inst?.objectIds, 'and the APEX entity joined its teardown roster').toContain(e.id);

    expect(leaveDungeon(sim.ctx, placer.pid)).toBe(true);
    if (inst) inst.emptyFor = INSTANCE_EMPTY_TIMEOUT;
    tickSeconds(sim, 2.05);

    expect(sim.entities.has(e.id), 'the entity fell with the instance').toBe(false);
    expect(sim.ctx.feasts.has(e.id), 'the sweep reclaimed the state').toBe(false);
    // And the one-active slot freed with it, which is the half a stranded
    // entity would silently hold for the full 180 seconds.
    expect(useToPlace(sim, placer, 'stonepot_feast'), 'the slot freed too').toBeTruthy();
  });

  it('an apex feast placed inside a delve run falls with the run', () => {
    const { sim, placer } = world(0);
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel, placer.pid);
    sim.enterDelve('collapsed_reliquary', 'normal', placer.pid);
    sim.tick();
    const run = delveRunForPlayer(sim.ctx, placer.pid);
    expect(run, 'the placer stands inside the claimed run').not.toBeNull();
    if (!run) return;
    const e = useToPlace(sim, placer, 'sageleaf_feast');
    expect(e).toBeTruthy();
    if (!e) return;
    expect(run.objectIds, 'the APEX entity joined the delve roster too').toContain(e.id);

    freeDelveRun(sim.ctx, run);
    tickSeconds(sim, 2.05);

    expect(sim.entities.has(e.id), 'the entity fell with the run').toBe(false);
    expect(sim.ctx.feasts.has(e.id), 'the sweep reclaimed the state').toBe(false);
    expect(useToPlace(sim, placer, 'sageleaf_feast'), 'the slot freed too').toBeTruthy();
  });
});
