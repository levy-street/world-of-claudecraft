// The orange promotion (Masterwrought phase 13, R3): the deterministic act on
// an already-Perfected apex copy in src/sim/professions/perfecting.ts
// (resolveLegendaryPromotion, reached through the perfect_item command with a
// name) plus its pure name leaf (legendary_name.ts) and the equipment
// interplay (the instance-aware unique-equipped read and the Masterwrought
// legendary sub-cap both count a promoted copy). The Phase 12 fixture rule
// holds: the promoted copies here are walked to Perfected through the REAL
// resolvePerfectingAttempt path (forced rolls, the perfecting.test.ts
// technique), never hand-stamped wholesale, except where an arm explicitly
// needs a second Perfected copy and says so.
import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import { DUNGEON_X_THRESHOLD, ITEMS, zoneAt } from '../src/sim/data';
import { isUniqueEquipped } from '../src/sim/equipment_rules';
import {
  MAX_LEGENDARY_NAME_LENGTH,
  normalizeLegendaryName,
} from '../src/sim/professions/legendary_name';
import {
  LEGENDARY_PROMOTION_COST,
  PERFECTING_ATTEMPT_COST,
  PERFECTING_RANKS,
  PERFECTING_SKILL_REQ,
  resolveLegendaryPromotion,
  resolvePerfectingAttempt,
} from '../src/sim/professions/perfecting';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, ItemDef, SimEvent } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

const APEX_NECK = 'wyrmfall_pendant'; // apex jewelry, no class gate (jewelcrafting)
const APEX_RING = 'warhewn_signet';
const APEX_RING2 = 'prismglass_loop'; // second apex ring def (the sub-cap pair)
const DEED = 'deed_of_making';
const NAME = 'Sunrise Vow';
const ALREADY_LINE = 'That work is already legendary.';
const NEEDS_NAME_LINE = 'That work needs a name to become a legend.';
const BAD_NAME_LINE = 'That name cannot be inscribed on the work.';
const NEEDS_DEED_LINE = 'You need a Deed of Making to make that work a legend.';
const LOCKED_LINE = 'A material needed for perfecting is locked.';

function world(seed = 5): { sim: Sim; pid: number; meta: PlayerMeta; e: Entity } {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, world: EMPTY_TEST_WORLD });
  const pid = sim.playerId;
  return {
    sim,
    pid,
    meta: sim.players.get(pid) as PlayerMeta,
    e: sim.entities.get(pid) as Entity,
  };
}

/** A skill-125 jewelcrafter holding attempt materials and promotion deeds. */
function promoter(seed = 5): ReturnType<typeof world> {
  const w = world(seed);
  w.meta.craftSkills.jewelcrafting = PERFECTING_SKILL_REQ;
  for (const c of PERFECTING_ATTEMPT_COST) w.sim.addItem(c.itemId, 8, w.pid);
  w.sim.addItem(DEED, 2, w.pid);
  return w;
}

function bagRefOf(meta: PlayerMeta, itemId: string): { bag: number; itemId: string } {
  const bag = meta.inventory.findIndex((s) => s.itemId === itemId);
  expect(bag, `${itemId} is really in the bags`).toBeGreaterThanOrEqual(0);
  return { bag, itemId };
}

function errorsOf(sim: Sim): string[] {
  return (sim.drainEvents() as SimEvent[])
    .filter((ev): ev is Extract<SimEvent, { type: 'error' }> => ev.type === 'error')
    .map((ev) => ev.text);
}

/** Force every rng draw to `value` and count the draws (the perfecting.test.ts
 *  idiom). The returned counter is ALSO the zero-draw pin for everything after
 *  the walk: any later rng.next() from any arm increments it. */
function forceRoll(sim: Sim, value: number): () => number {
  let draws = 0;
  (sim.rng as { next: () => number }).next = () => {
    draws += 1;
    return value;
  };
  return () => draws;
}

/** Walk a bagged apex copy to Perfected through the REAL attempt path (four
 *  forced successes), returning the shared draw counter. */
function walkToPerfected(
  w: ReturnType<typeof world>,
  ref: { bag: number; itemId: string } | { slot: 'neck' | 'ring1' },
): () => number {
  const draws = forceRoll(w.sim, 0);
  for (let i = 0; i < PERFECTING_RANKS; i++) w.sim.perfectItemAs(w.pid, ref);
  expect(draws(), 'the walk really resolved four attempts').toBe(PERFECTING_RANKS);
  const payload =
    'slot' in ref ? w.meta.equipmentInstance[ref.slot] : w.meta.inventory[ref.bag]?.instance;
  expect(payload?.perfected, 'the walk reached Perfected').toBe(true);
  return draws;
}

describe('normalizeLegendaryName: the sim-side shape half', () => {
  it('trims, collapses inner whitespace, and returns the normalized name', () => {
    expect(normalizeLegendaryName('  Oath   of \t Vale  ')).toBe('Oath of Vale');
    expect(normalizeLegendaryName(NAME)).toBe(NAME);
    expect(normalizeLegendaryName("D'arna-Vel")).toBe("D'arna-Vel");
  });

  it('holds the 2..32 boundary on the NORMALIZED string', () => {
    expect(normalizeLegendaryName('A'), 'one char is under the floor').toBeNull();
    expect(normalizeLegendaryName('Ab')).toBe('Ab');
    expect(normalizeLegendaryName('A'.repeat(MAX_LEGENDARY_NAME_LENGTH))).toBe(
      'A'.repeat(MAX_LEGENDARY_NAME_LENGTH),
    );
    expect(normalizeLegendaryName('A'.repeat(MAX_LEGENDARY_NAME_LENGTH + 1))).toBeNull();
    // The boundary binds AFTER normalization: 33 raw chars that collapse to
    // 32 are legal, and padding never rescues an over-long core.
    expect(normalizeLegendaryName(`A  ${'b'.repeat(MAX_LEGENDARY_NAME_LENGTH - 2)}`)).toBe(
      `A ${'b'.repeat(MAX_LEGENDARY_NAME_LENGTH - 2)}`,
    );
    expect(MAX_LEGENDARY_NAME_LENGTH).toBe(32);
  });

  it('refuses every off-shape input, non-strings included', () => {
    for (const bad of ['1Blade', "'Leading", '-Lead', ' ', '', 'Bad_Name', 'Bad!', 'Bläde']) {
      expect(normalizeLegendaryName(bad), JSON.stringify(bad)).toBeNull();
    }
    for (const bad of [undefined, null, 42, true, { name: 'X' }, ['X']]) {
      expect(normalizeLegendaryName(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('the content the promotion consumes', () => {
  it('pins the deed def, its recipe row, and the promotion bill', () => {
    expect(LEGENDARY_PROMOTION_COST).toEqual([{ itemId: DEED, count: 1 }]);
    const def = ITEMS[DEED];
    expect(def).toBeTruthy();
    expect(def.name).toBe('Deed of Making');
    // A consumable document, never gear and never counted combat power.
    expect(def.kind).toBe('junk');
    expect(def.slot).toBeUndefined();
    expect(def.stats).toBeUndefined();
    expect(def.masterwrought).toBeUndefined();
    // The TRADABLE arm of the perfecting-bill family (the wyrmfall_core
    // shape): an inscriptionist scribes it FOR the promoter.
    expect(def.soulbound).toBeUndefined();
    expect(def.quality).toBe('rare');
  });

  it('pins the D13-7 deed row BY NAME (renown 50, the legendariesForged count-1 trigger)', () => {
    // The catalog sha and the total-renown literal both move on any edit, but
    // neither names this row: a compensating edit elsewhere could keep the
    // total while this row drifted. Named, the row is decisive on its own.
    expect(DEEDS.prog_legendmaker).toMatchObject({
      id: 'prog_legendmaker',
      category: 'progression',
      renown: 50,
      trigger: { kind: 'stat', stat: 'legendariesForged', count: 1 },
    });
    expect(DEEDS.prog_legendmaker.reward).toBeUndefined();
    expect(DEEDS.prog_legendmaker.hidden).toBeFalsy();
    expect(DEEDS.prog_legendmaker.feat).toBeFalsy();
  });
});

describe('the promotion success path (the real producer end to end)', () => {
  it('consumes ONE deed, stamps quality+name, keeps stats byte-identical, draws zero', () => {
    const w = promoter(71);
    const { sim, pid, meta } = w;
    sim.addItemInstance(APEX_NECK, { signer: 'Crafter' }, pid, 1);
    const ref = bagRefOf(meta, APEX_NECK);
    const draws = walkToPerfected(w, ref);
    const drawsAfterWalk = draws();
    const before = JSON.parse(JSON.stringify(meta.inventory[ref.bag].instance));
    const attemptBefore = PERFECTING_ATTEMPT_COST.map((c) => sim.countItem(c.itemId, pid));
    const revBefore = meta.wireRev;
    sim.drainEvents();

    sim.perfectItemAs(pid, ref, `  Sunrise   Vow `); // normalization runs end to end
    const events = sim.drainEvents() as SimEvent[];

    // ZERO draws across the whole promotion (the shared counter idiom).
    expect(draws()).toBe(drawsAfterWalk);
    // Exactly one deed consumed; the attempt bill untouched.
    expect(sim.countItem(DEED, pid)).toBe(1);
    expect(PERFECTING_ATTEMPT_COST.map((c) => sim.countItem(c.itemId, pid))).toEqual(attemptBefore);
    // The payload is the pre-promotion payload plus EXACTLY the quality
    // override and the name: stats byte-identical, signer retained.
    const after = meta.inventory[ref.bag].instance;
    expect(after).toEqual({
      ...before,
      rolled: { ...before.rolled, quality: 'legendary' },
      name: NAME,
    });
    expect(after?.signer).toBe('Crafter');
    // The two text-free events, personal first, then the zone copy reaching
    // the (overworld) owner as recipient; NO notice line rides the success.
    const forged = events.filter((ev) => ev.type === 'legendaryForged');
    expect(forged).toEqual([
      { type: 'legendaryForged', itemId: APEX_NECK, name: NAME, owner: pid, pid },
    ]);
    const zone = events.filter(
      (ev): ev is Extract<SimEvent, { type: 'legendaryForgedZone' }> =>
        ev.type === 'legendaryForgedZone',
    );
    // Exactly one zone copy in a one-player world: a duplicate fan-out to the
    // same recipient would read as a second line in chat.
    expect(zone.length).toBe(1);
    expect(zone[0]).toMatchObject({
      pid,
      ownerPid: pid,
      ownerName: meta.name,
      itemId: APEX_NECK,
      itemName: NAME,
    });
    expect(events.filter((ev) => ev.type === 'log')).toEqual([]);
    expect(events.filter((ev) => ev.type === 'error')).toEqual([]);
    // The wire bump pair: the quest-resync hook's own bump plus the module's
    // payload-mutation bump, the attempt's exact pair.
    expect(meta.wireRev).toBe(revBefore + 2);
    // The deed stat feeds the Book of Deeds counter.
    expect(meta.deedStats.counters.legendariesForged).toBe(1);
  });

  it('the quality override and name persist through serializeCharacter -> addPlayer', () => {
    const w = promoter(72);
    const { sim, pid, meta } = w;
    sim.addItemInstance(APEX_NECK, { signer: 'Crafter' }, pid, 1);
    const ref = bagRefOf(meta, APEX_NECK);
    walkToPerfected(w, ref);
    sim.perfectItemAs(pid, ref, NAME);
    expect(meta.inventory[ref.bag].instance?.rolled?.quality).toBe('legendary');
    const state = sim.serializeCharacter(pid);
    expect(state).toBeTruthy();

    const fresh = new Sim({ seed: 72, playerClass: 'warrior', noPlayer: true });
    const loadedPid = fresh.addPlayer('warrior', 'Reloaded', { state: state ?? undefined });
    const loadedMeta = fresh.players.get(loadedPid) as PlayerMeta;
    const loaded = loadedMeta.inventory.find((s) => s.itemId === APEX_NECK);
    expect(loaded?.instance?.rolled?.quality).toBe('legendary');
    expect(loaded?.instance?.name).toBe(NAME);
    expect(loaded?.instance?.perfected).toBe(true);
    expect(loaded?.instance?.signer).toBe('Crafter');
  });

  it('routes the IWorld (ref, name) call shape onto the primary player', () => {
    // The facet arm is perfectItem(ref, name?) resolving the PRIMARY player
    // (the offline-host shape); the server's pid-explicit arm is
    // perfectItemAs(pid, ref, name?), which every other case here drives.
    const w = promoter(73);
    const { sim, pid, meta } = w;
    sim.addItemInstance(APEX_NECK, {}, pid, 1);
    const ref = bagRefOf(meta, APEX_NECK);
    walkToPerfected(w, ref);
    sim.perfectItem(ref, 'Blade of Dawn');
    expect(meta.inventory[ref.bag].instance?.rolled?.quality).toBe('legendary');
    expect(meta.inventory[ref.bag].instance?.name).toBe('Blade of Dawn');
  });

  it('promotes a WORN Perfected copy in place: stats unmoved, peer mirror rebuilt', () => {
    const w = promoter(74);
    const { sim, pid, meta, e } = w;
    sim.setPlayerLevel(20);
    sim.addItem(APEX_NECK, 1, pid);
    sim.equipItem(APEX_NECK, pid);
    expect(meta.equipment.neck).toBe(APEX_NECK);
    const draws = walkToPerfected(w, { slot: 'neck' });
    const base = draws();
    const before = JSON.parse(JSON.stringify(meta.equipmentInstance.neck));
    const statsBefore = { int: e.stats.int, maxHp: e.maxHp, attackPower: e.attackPower };
    sim.perfectItemAs(pid, { slot: 'neck' }, NAME);
    // The WORN arm's byte-identity proof, the bagged case's twin (the phase 13
    // QA mutation lane: a worn-arm-only stat slip survived every pin): the
    // payload is the pre-promotion payload plus EXACTLY the quality override
    // and the name, and the arm drew nothing.
    expect(meta.equipmentInstance.neck).toEqual({
      ...before,
      rolled: { ...before.rolled, quality: 'legendary' },
      name: NAME,
    });
    expect(draws(), 'zero draws across the worn promotion').toBe(base);
    // Presentation only (R3): the wearer's derived stats never move.
    expect({ int: e.stats.int, maxHp: e.maxHp, attackPower: e.attackPower }).toEqual(statsBefore);
    // But the worn promotion DOES rerun recalcPlayerStats: it is the ONE
    // site the peer eqi mirror (Entity.equippedInstances) is rebuilt, so
    // peers see the promoted name and quality at the moment, not at the
    // next unrelated recalc (the 2026-08-27 review finding).
    expect(e.equippedInstances.neck?.name).toBe(NAME);
    expect(e.equippedInstances.neck?.rolled?.quality).toBe('legendary');
  });

  it('marks the legendary discovery at the stamp, and the deed lands the same tick', () => {
    // The 2026-08-27 review: without a markItemDiscovered at the stamp site
    // the quality:legendary mark (a real deed trigger, col_first_legendary)
    // only landed at the NEXT LOGIN's retro seed pass.
    const w = promoter(75);
    const { sim, pid, meta } = w;
    sim.addItemInstance(APEX_NECK, {}, pid, 1);
    const ref = bagRefOf(meta, APEX_NECK);
    const draws = walkToPerfected(w, ref);
    const base = draws();
    expect(meta.deedStats.visited.has('quality:legendary'), 'no mark before').toBe(false);
    sim.perfectItemAs(pid, ref, NAME);
    expect(meta.deedStats.visited.has('quality:legendary'), 'marked at the stamp').toBe(true);
    expect(draws(), 'the mark costs zero draws').toBe(base);
    // The dirty-key evaluator grants at the tick tail, not only after reload:
    // the discovery deed AND the phase's own capstone (the D13-7 row on the
    // legendariesForged stat) both land this tick.
    sim.tick();
    expect(meta.deedsEarned.has('col_first_legendary')).toBe(true);
    expect(meta.deedsEarned.has('prog_legendmaker')).toBe(true);
  });

  it('the shared view empties the bill once promoted (no act is left to promise)', () => {
    const w = promoter(78);
    const { sim, pid, meta } = w;
    sim.addItemInstance(APEX_NECK, {}, pid, 1);
    const ref = bagRefOf(meta, APEX_NECK);
    walkToPerfected(w, ref);
    // Perfected, not yet promoted: the bill is the promotion's Deed of Making.
    expect(sim.perfectingInfo(ref, pid)).toMatchObject({
      perfected: true,
      promoted: false,
      materials: [{ itemId: DEED, required: 1, have: 2 }],
    });
    sim.perfectItemAs(pid, ref, NAME);
    // Promoted: no next act, so no row (the affordance rule: arm 1 refuses a
    // re-promotion, and a view may not promise what the path refuses).
    expect(sim.perfectingInfo(ref, pid)).toMatchObject({
      perfected: true,
      promoted: true,
      equipBlocked: false,
      materials: [],
    });
  });

  it('an INSTANCED owner keeps only the personal event: no zone copies at all', () => {
    const w = promoter(79);
    const { sim, pid, meta, e } = w;
    sim.addItemInstance(APEX_NECK, {}, pid, 1);
    const ref = bagRefOf(meta, APEX_NECK);
    const draws = walkToPerfected(w, ref);
    const base = draws();
    e.pos.x = DUNGEON_X_THRESHOLD + 100;
    sim.drainEvents();
    sim.perfectItemAs(pid, ref, NAME);
    const events = sim.drainEvents() as SimEvent[];
    expect(events.filter((ev) => ev.type === 'legendaryForged')).toHaveLength(1);
    expect(events.filter((ev) => ev.type === 'legendaryForgedZone')).toHaveLength(0);
    expect(draws(), 'the instance skip draws nothing either').toBe(base);
    expect(meta.inventory[ref.bag].instance?.name, 'the promotion itself still landed').toBe(NAME);
  });

  it('fans one zone copy to every overworld player in the zone, the owner first, far zones excluded', () => {
    const w = promoter(80);
    const { sim, pid, meta, e } = w;
    const near = sim.addPlayer('mage', 'Nearby');
    const far = sim.addPlayer('priest', 'Farhand');
    const nearE = sim.entities.get(near) as Entity;
    const farE = sim.entities.get(far) as Entity;
    nearE.pos.x = e.pos.x;
    nearE.pos.z = e.pos.z;
    // Walk the far peer out of the owner's zone (the masterwork_zone_broadcast
    // idiom); the world's zone map decides where the border is.
    const zoneId = zoneAt(e.pos.x, e.pos.z).id;
    let z = e.pos.z;
    for (let i = 0; i < 400 && zoneAt(e.pos.x, z).id === zoneId; i++) z += 50;
    if (zoneAt(e.pos.x, z).id === zoneId) {
      z = e.pos.z;
      for (let i = 0; i < 400 && zoneAt(e.pos.x, z).id === zoneId; i++) z -= 50;
    }
    expect(zoneAt(e.pos.x, z).id, 'a second zone exists to place the far peer in').not.toBe(zoneId);
    farE.pos.x = e.pos.x;
    farE.pos.z = z;
    sim.addItemInstance(APEX_NECK, {}, pid, 1);
    const ref = bagRefOf(meta, APEX_NECK);
    walkToPerfected(w, ref);
    sim.drainEvents();
    sim.perfectItemAs(pid, ref, NAME);
    const events = sim.drainEvents() as SimEvent[];
    const celebration = events.filter(
      (ev) => ev.type === 'legendaryForged' || ev.type === 'legendaryForgedZone',
    );
    // Personal first, then exactly the owner's and the same-zone peer's copies.
    expect(celebration.map((ev) => ev.type)).toEqual([
      'legendaryForged',
      'legendaryForgedZone',
      'legendaryForgedZone',
    ]);
    const recipients = celebration
      .filter((ev) => ev.type === 'legendaryForgedZone')
      .map((ev) => ev.pid)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(recipients).toEqual([pid, near].sort((a, b) => a - b));
    expect(recipients).not.toContain(far);
  });

  it('promotes a Perfected copy with NO rolled record: a stats-free { quality } mints', () => {
    // The attempt only mints rolled when the R5 bonus is non-empty, so a
    // Perfected payload with no rolled record is a legal input; the
    // promotion must mint { quality: 'legendary' } cleanly, with no stats
    // key, and readers must tolerate the stats-free record.
    const w = promoter(76);
    const { sim, pid, meta } = w;
    sim.addItemInstance(APEX_NECK, { perfected: true, boundTo: pid }, pid, 1);
    const ref = bagRefOf(meta, APEX_NECK);
    const draws = forceRoll(sim, 0);
    sim.perfectItemAs(pid, ref, NAME);
    expect(draws(), 'zero draws across the promotion').toBe(0);
    const after = meta.inventory[ref.bag].instance;
    expect(after?.rolled, 'exactly the quality override, no stats key').toEqual({
      quality: 'legendary',
    });
    expect(after?.name).toBe(NAME);
    // A reader over the stats-free record: the unique rule counts the copy.
    expect(isUniqueEquipped(ITEMS[APEX_NECK], after)).toBe(true);
  });
});

describe('the promotion deny ladder: each arm red-direction, zero draws, nothing consumed', () => {
  /** A promoter one real walk in: the bagged apex copy is Perfected and the
   *  shared draw counter is armed. */
  function walked(seed: number): ReturnType<typeof world> & {
    ref: { bag: number; itemId: string };
    draws: () => number;
    base: number;
    rev: number;
    forged: number;
  } {
    const w = promoter(seed);
    w.sim.addItemInstance(APEX_NECK, { signer: 'Crafter' }, w.pid, 1);
    const ref = bagRefOf(w.meta, APEX_NECK);
    const draws = walkToPerfected(w, ref);
    w.sim.drainEvents();
    return {
      ...w,
      ref,
      draws,
      base: draws(),
      rev: w.meta.wireRev,
      forged: w.meta.deedStats.counters.legendariesForged ?? 0,
    };
  }

  /** Every deny arm's shared contract: the one line, zero draws, the deed
   *  count, no stamp, no wireRev bump, and the deed stat untouched (`rev` and
   *  `forged` are the values captured at the walk, re-captured by a test
   *  that promotes first). */
  function expectDenied(w: ReturnType<typeof walked>, line: string, deedsExpected: number): void {
    expect(errorsOf(w.sim)).toEqual([line]);
    expect(w.draws(), 'zero draws on the deny arm').toBe(w.base);
    expect(w.sim.countItem(DEED, w.pid)).toBe(deedsExpected);
    expect(w.meta.inventory[w.ref.bag].instance?.rolled?.quality).toBeUndefined();
    expect(w.meta.inventory[w.ref.bag].instance?.name).toBeUndefined();
    expect(w.meta.wireRev, 'a denial never bumps wireRev').toBe(w.rev);
    expect(w.meta.deedStats.counters.legendariesForged ?? 0, 'a denial never bumps the stat').toBe(
      w.forged,
    );
  }

  it('a missing name (undefined and empty) refuses with the needs-a-name line', () => {
    const w = walked(81);
    w.sim.perfectItemAs(w.pid, w.ref);
    expectDenied(w, NEEDS_NAME_LINE, 2);
    w.sim.perfectItemAs(w.pid, w.ref, '');
    expectDenied(w, NEEDS_NAME_LINE, 2);
  });

  it('a bad-shape name refuses with the inscription line', () => {
    const w = walked(82);
    for (const bad of ['1Blade', 'A', 'A'.repeat(MAX_LEGENDARY_NAME_LENGTH + 1), 'Bad_Name']) {
      w.sim.perfectItemAs(w.pid, w.ref, bad);
      expectDenied(w, BAD_NAME_LINE, 2);
    }
  });

  it('a genuine deed shortfall refuses with the deed line', () => {
    const w = walked(83);
    // Removing the deed stack SPLICES its cell out, shifting the apex cell
    // down one: re-derive the index-plus-id ref (the item_copy_ref
    // discipline this fixture itself relies on).
    w.sim.removeItem(DEED, 2, w.pid);
    w.ref = bagRefOf(w.meta, APEX_NECK);
    // The setup's own bag mutation bumped wireRev; the deny must not.
    w.rev = w.meta.wireRev;
    w.sim.drainEvents();
    w.sim.perfectItemAs(w.pid, w.ref, NAME);
    expectDenied(w, NEEDS_DEED_LINE, 0);
  });

  it('a lock-only deed shortfall refuses with the DEDICATED locked line', () => {
    const w = walked(84);
    const deedSlot = w.meta.inventory.find((s) => s.itemId === DEED);
    expect(deedSlot).toBeTruthy();
    if (deedSlot) deedSlot.instance = { locked: true };
    w.sim.drainEvents();
    w.sim.perfectItemAs(w.pid, w.ref, NAME);
    expect(errorsOf(w.sim)).toEqual([LOCKED_LINE]);
    expect(w.draws()).toBe(w.base);
    expect(deedSlot?.instance?.locked, 'the locked stack is never spent').toBe(true);
    expect(w.meta.inventory[w.ref.bag].instance?.rolled?.quality).toBeUndefined();
  });

  it('an already-legendary copy refuses with the already line, deed intact', () => {
    const w = walked(85);
    w.sim.perfectItemAs(w.pid, w.ref, NAME);
    expect(w.sim.countItem(DEED, w.pid), 'the promotion itself spent one').toBe(1);
    expect(w.meta.deedStats.counters.legendariesForged).toBe(1);
    w.sim.drainEvents();
    const revAfterPromotion = w.meta.wireRev;
    w.sim.perfectItemAs(w.pid, w.ref, 'Second Name');
    expect(errorsOf(w.sim)).toEqual([ALREADY_LINE]);
    expect(w.draws()).toBe(w.base);
    expect(w.sim.countItem(DEED, w.pid)).toBe(1);
    expect(w.meta.inventory[w.ref.bag].instance?.name, 'the first name stands').toBe(NAME);
    // A refused re-promotion is a denial like any other: no wireRev bump and
    // the forging count stays at the one real promotion.
    expect(w.meta.wireRev).toBe(revAfterPromotion);
    expect(w.meta.deedStats.counters.legendariesForged).toBe(1);
  });

  it('the skill gate guards the promotion too (one gate, both acts)', () => {
    const w = walked(86);
    w.meta.craftSkills.jewelcrafting = PERFECTING_SKILL_REQ - 1;
    w.sim.drainEvents();
    w.sim.perfectItemAs(w.pid, w.ref, NAME);
    expect(errorsOf(w.sim)).toEqual([
      'Perfecting that requires 125 skill in the craft that made it.',
    ]);
    expect(w.draws()).toBe(w.base);
    expect(w.sim.countItem(DEED, w.pid)).toBe(2);
  });

  it('a denial never bumps wireRev on ANY arm; the success pair is pinned above', () => {
    // Every arm in this describe asserts it through expectDenied; this case
    // keeps the two cheapest arms back to back so the claim reads in one place.
    const w = walked(87);
    w.sim.perfectItemAs(w.pid, w.ref); // needs-a-name
    w.sim.perfectItemAs(w.pid, w.ref, '1Blade'); // bad shape
    expect(w.meta.wireRev).toBe(w.rev);
  });
});

describe('the equip interplay: a promoted copy counts on BOTH rules', () => {
  it('isUniqueEquipped is instance-aware but PROMOTION-SCOPED and add-only', () => {
    const ring = ITEMS[APEX_RING];
    expect(ring.quality).toBe('epic');
    expect(isUniqueEquipped(ring)).toBe(false);
    // A promoted copy (the promotion always stamps perfected first) counts.
    expect(isUniqueEquipped(ring, { perfected: true, rolled: { quality: 'legendary' } })).toBe(
      true,
    );
    // A LEGACY legendary-rolled payload (old masterwork bumps wrote
    // rolled.quality; no perfected flag) does NOT: retroactively capturing
    // it would bench live characters at their next login (the 2026-08-27
    // scoping correction).
    expect(isUniqueEquipped(ring, { rolled: { quality: 'legendary' } })).toBe(false);
    expect(isUniqueEquipped(ring, { perfected: true, rolled: { quality: 'epic' } })).toBe(false);
    // A def-level legendary keeps its answer with no instance at all, and a
    // BELOW-def rolled quality can never remove def-level uniqueness
    // (add-only, the sync reviewer's two-way-read finding).
    const defLegendary = { ...ring, id: 'qa_p13_def_legendary', quality: 'legendary' } as ItemDef;
    expect(isUniqueEquipped(defLegendary)).toBe(true);
    expect(isUniqueEquipped(defLegendary, { rolled: { quality: 'epic' } })).toBe(true);
  });

  it('a BAGGED promotion of a duplicate-worn promoted id refuses per the unique rule', () => {
    // The 2026-08-27 review: the promotion re-runs equip legality, so a
    // second promoted copy of a worn promoted def is refused AT THE MINT
    // (burning the deed and the name on a copy that could never be worn
    // beside its twin would be the alternative). Zero draws, deed intact.
    const w = promoter(91);
    const { sim, pid, meta } = w;
    sim.setPlayerLevel(20);
    // First copy: the REAL walk, promoted, worn on ring1.
    sim.addItemInstance(APEX_RING, {}, pid, 1);
    const ref = bagRefOf(meta, APEX_RING);
    const draws = walkToPerfected(w, ref);
    sim.perfectItemAs(pid, ref, NAME);
    sim.equipItem(APEX_RING, pid);
    expect(meta.equipment.ring1).toBe(APEX_RING);
    expect(meta.equipmentInstance.ring1?.rolled?.quality).toBe('legendary');
    const base = draws();
    // Second copy: hand-stamped Perfected (the one sanctioned shortcut, the
    // suite's real-path fixture is the first copy), promoted through the
    // REAL entry while its promoted twin is worn.
    sim.addItemInstance(APEX_RING, { perfected: true, boundTo: pid }, pid, 1);
    const idx2 = meta.inventory.findIndex(
      (s) => s.itemId === APEX_RING && s.instance?.perfected === true,
    );
    expect(idx2).toBeGreaterThanOrEqual(0);
    sim.drainEvents();
    sim.perfectItemAs(pid, { bag: idx2, itemId: APEX_RING }, 'Second Oath');
    expect(errorsOf(sim)).toEqual(['You can only equip one of those.']);
    expect(draws(), 'zero draws on the deny arm').toBe(base);
    expect(sim.countItem(DEED, pid), 'only the first promotion spent a deed').toBe(1);
    const second = meta.inventory[idx2].instance;
    expect(second?.rolled?.quality, 'the second copy stays unpromoted').toBeUndefined();
    expect(second?.name).toBeUndefined();
  });

  it('two promoted copies minted apart (neither worn) still cannot be WORN together', () => {
    // The unique rule scans WORN slots, so promoting two bagged copies of
    // one def is legal while neither is worn; the equip path then refuses
    // the second copy, judging the incoming unit's own payload.
    const w = promoter(94);
    const { sim, pid, meta } = w;
    sim.setPlayerLevel(20);
    sim.addItemInstance(APEX_RING, {}, pid, 1);
    const ref = bagRefOf(meta, APEX_RING);
    walkToPerfected(w, ref);
    sim.perfectItemAs(pid, ref, NAME);
    sim.addItemInstance(APEX_RING, { perfected: true, boundTo: pid }, pid, 1);
    // Copy 1 stays bagged and promoted, so pick the still-unpromoted twin.
    const idx2 = meta.inventory.findIndex(
      (s) =>
        s.itemId === APEX_RING &&
        s.instance?.perfected === true &&
        s.instance?.rolled?.quality !== 'legendary',
    );
    expect(idx2).toBeGreaterThanOrEqual(0);
    sim.perfectItemAs(pid, { bag: idx2, itemId: APEX_RING }, 'Second Oath');
    const promoted = meta.inventory.filter(
      (s) => s.itemId === APEX_RING && s.instance?.rolled?.quality === 'legendary',
    );
    expect(promoted.length, 'both copies really promoted').toBe(2);
    sim.equipItem(APEX_RING, pid);
    expect(meta.equipment.ring1).toBe(APEX_RING);
    sim.drainEvents();
    sim.equipItem(APEX_RING, pid);
    expect(errorsOf(sim)).toEqual(['You can only equip one of those.']);
    expect(meta.equipment.ring2, 'the free finger stays empty').toBeUndefined();
  });

  it('a WORN promotion refuses when another worn piece is already legendary (the sub-cap)', () => {
    // The review probe: two worn apex rings, both Perfected; promoting both
    // in place minted two worn legendaries past MASTERWROUGHT_LEGENDARY_CAP
    // (and next login benchDuplicateUniqueEquipped... no, distinct defs:
    // just an illegal worn set). The worn arm now answers the equip path's
    // sub-cap with the copy's own slot excluded: the second promotion
    // refuses with the equip path's exact literal, zero draws, deed intact.
    const w = promoter(95);
    const { sim, pid, meta } = w;
    sim.setPlayerLevel(20);
    sim.addItem(APEX_RING, 1, pid);
    sim.addItem(APEX_RING2, 1, pid);
    sim.equipItem(APEX_RING, pid);
    sim.equipItem(APEX_RING2, pid);
    expect(meta.equipment.ring1).toBe(APEX_RING);
    expect(meta.equipment.ring2).toBe(APEX_RING2);
    const draws = walkToPerfected(w, { slot: 'ring1' });
    for (let i = 0; i < PERFECTING_RANKS; i++) w.sim.perfectItemAs(pid, { slot: 'ring2' });
    expect(meta.equipmentInstance.ring2?.perfected).toBe(true);
    sim.perfectItemAs(pid, { slot: 'ring1' }, NAME);
    expect(meta.equipmentInstance.ring1?.rolled?.quality).toBe('legendary');
    const base = draws();
    sim.drainEvents();
    sim.perfectItemAs(pid, { slot: 'ring2' }, 'Second Oath');
    expect(errorsOf(sim)).toEqual(['You can only equip one legendary Masterwrought item.']);
    expect(draws(), 'zero draws on the deny arm').toBe(base);
    expect(sim.countItem(DEED, pid), 'only the first promotion spent a deed').toBe(1);
    expect(meta.equipmentInstance.ring2?.rolled?.quality).toBeUndefined();
    expect(meta.equipmentInstance.ring2?.name).toBeUndefined();
  });

  it('a worn promoted piece plus an ORDINARY Masterwrought piece stays legal inside cap 2', () => {
    const w = promoter(92);
    const { sim, pid, meta } = w;
    sim.setPlayerLevel(20);
    sim.addItemInstance(APEX_NECK, {}, pid, 1);
    const ref = bagRefOf(meta, APEX_NECK);
    walkToPerfected(w, ref);
    sim.perfectItemAs(pid, ref, NAME);
    sim.equipItem(APEX_NECK, pid);
    expect(meta.equipment.neck).toBe(APEX_NECK);
    sim.addItem(APEX_RING, 1, pid);
    sim.drainEvents();
    sim.equipItem(APEX_RING, pid);
    expect(errorsOf(sim)).toEqual([]);
    expect(meta.equipment.ring1).toBe(APEX_RING);
  });

  it('a worn promoted piece refuses a SECOND legendary-effective piece (the sub-cap)', () => {
    const w = promoter(93);
    const { sim, pid, meta } = w;
    sim.setPlayerLevel(20);
    sim.addItemInstance(APEX_NECK, {}, pid, 1);
    const ref = bagRefOf(meta, APEX_NECK);
    walkToPerfected(w, ref);
    sim.perfectItemAs(pid, ref, NAME);
    sim.equipItem(APEX_NECK, pid);
    expect(meta.equipmentInstance.neck?.rolled?.quality).toBe('legendary');
    // A different apex def, hand-stamped Perfected and promoted for real:
    // families differ so unique-equipped passes, and the LEGENDARY sub-cap is
    // the rule that answers.
    sim.addItemInstance(APEX_RING, { perfected: true, boundTo: pid }, pid, 1);
    const ref2 = bagRefOf(meta, APEX_RING);
    sim.perfectItemAs(pid, ref2, 'Second Oath');
    sim.drainEvents();
    sim.equipItem(APEX_RING, pid);
    expect(errorsOf(sim)).toEqual(['You can only equip one legendary Masterwrought item.']);
    expect(meta.equipment.ring1).toBeUndefined();
  });
});

describe('the shared deny head runs once per routed promotion, and gates the direct entries (phase 18)', () => {
  /** Wrap ctx.resolve with a counter: the seam probe for how many times the
   *  shared head actually ran (the head resolves the player once for its
   *  dead gate and once for its own ladder; nothing else on these paths
   *  touches ctx.resolve). Installed AFTER any fixture walk, so only the
   *  action under test is counted. */
  function countResolves(sim: Sim): () => number {
    let calls = 0;
    const ctx = sim.ctx as unknown as {
      resolve: (pid?: number) => ReturnType<Sim['resolve']>;
    };
    const real = ctx.resolve;
    ctx.resolve = (pid?: number) => {
      calls += 1;
      return real(pid);
    };
    return () => calls;
  }

  it('routing an already-Perfected copy through the attempt entry re-runs NO shared gate', () => {
    // The routed path (resolvePerfectingAttempt -> resolveLegendaryPromotion)
    // threads the already-resolved target, so it must cost exactly the same
    // player resolutions as the standalone promotion entry: two (the head's
    // dead gate, then its own ladder). Before phase 18 the promotion's head
    // re-ran whole, doubling the count.
    const routed = promoter(96);
    routed.sim.addItem(APEX_NECK, 1, routed.pid);
    const routedRef = bagRefOf(routed.meta, APEX_NECK);
    walkToPerfected(routed, routedRef);
    const routedCalls = countResolves(routed.sim);
    resolvePerfectingAttempt(routed.sim.ctx, routed.pid, routedRef, NAME);
    expect(routed.meta.inventory[routedRef.bag].instance?.rolled?.quality).toBe('legendary');

    const standalone = promoter(96);
    standalone.sim.addItem(APEX_NECK, 1, standalone.pid);
    const aloneRef = bagRefOf(standalone.meta, APEX_NECK);
    walkToPerfected(standalone, aloneRef);
    const aloneCalls = countResolves(standalone.sim);
    resolveLegendaryPromotion(standalone.sim.ctx, standalone.pid, aloneRef, NAME);
    expect(standalone.meta.inventory[aloneRef.bag].instance?.rolled?.quality).toBe('legendary');

    // The load-bearing pin is the RELATIVE one below; the absolute count is
    // the head's current cost (dead gate + ladder), not a contract, so a
    // future cleanup that threads the resolved player into the gate may
    // lower it without failing here (the phase 18 review's reading).
    expect(aloneCalls(), 'the standalone entry: at most dead gate + ladder').toBeLessThanOrEqual(2);
    expect(routedCalls(), 'the routed entry costs not one resolution more').toBe(aloneCalls());
  });

  it('a DIRECT headless call of resolveLegendaryPromotion hits the real dead gate', () => {
    // The gate used to be a comment ("a new server or headless caller ...
    // must gate first, or a dead player's copy promotes"); it is real code in
    // the shared head now, so the bypass path is refused identically.
    const w = promoter(97);
    const { sim, pid, meta, e } = w;
    sim.addItem(APEX_NECK, 1, pid);
    const ref = bagRefOf(meta, APEX_NECK);
    const draws = walkToPerfected(w, ref);
    e.dead = true;
    sim.drainEvents();
    resolveLegendaryPromotion(sim.ctx, pid, ref, NAME);
    expect(errorsOf(sim)).toEqual(["You can't do that while dead."]);
    expect(draws(), 'the refusal draws nothing').toBe(PERFECTING_RANKS);
    expect(sim.countItem(DEED, pid), 'the deed is intact').toBe(2);
    const copy = meta.inventory[ref.bag].instance;
    expect(copy?.rolled?.quality, 'no promotion stamped').toBeUndefined();
    expect(copy?.name).toBeUndefined();
  });
});
