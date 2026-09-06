// Well Fed, unified (Masterwrought 11c): the completion-time mint in
// src/sim/wellfed.ts, hooked from the eat/drink loop in updateRegen
// (src/sim/combat/auras.ts) on the carried FoodConsuming.wellFed payload. A real
// Sim is driven through real ticks (the elixir.test.ts construction and
// use-item idiom): the buff lands only when the 18s sit-restore COMPLETES,
// an interrupted meal forfeits it, the ONE 'well_fed' aura id makes the
// whole food family mutually exclusive (last eaten wins, dish or role plate
// alike) while elixir_<kind> coexists because the ids can never collide, the
// mint draws zero rng, and the aura is transient across save/load.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type {
  Aura,
  Consuming,
  Entity,
  FlaskAuraKind,
  ItemDef,
  TimedStatBuffAuraKind,
} from '../src/sim/types';
import { WELL_FED_AURA_ID } from '../src/sim/wellfed';
import { hasAuraRecipe } from '../src/ui/icons';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { sourceFilesUnder } from './helpers/source_files_under';
import { stripComments } from './helpers/strip_comments';

function playerWorld(seed = 42) {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('warrior', 'Aleph');
  sim.tick();
  const p = sim.entities.get(pid)! as Entity;
  return { sim, pid, p };
}

function consume(sim: Sim, pid: number, itemId: string): void {
  sim.addItem(itemId, 1, pid);
  sim.useItem(itemId, pid);
}

function tickSeconds(sim: Sim, seconds: number): void {
  for (let i = 0; i < seconds * 20; i++) sim.tick();
}

function wellFedAuras(p: Entity): Aura[] {
  return p.auras.filter((a) => a.id === WELL_FED_AURA_ID);
}

// The family counted by NAME rather than by id: under a per-kind id
// regression the exact-id helper above finds zero auras (which still reds,
// but as "none" rather than "two"), so the exclusivity arms count the family
// this way too and fail as the claim they are named for.
function wellFedByName(p: Entity): Aura[] {
  return p.auras.filter((a) => a.name === 'Well Fed');
}

// Eat a dish and ride out the full sit-restore: 18s of meal plus regen-tick
// alignment slack (the 2s classic tick fires on tickCount % 40 === 0).
function eatToCompletion(sim: Sim, pid: number, p: Entity, itemId: string): void {
  consume(sim, pid, itemId);
  tickSeconds(sim, 22);
  expect(p.eating, `${itemId} meal completed`).toBeNull();
}

describe('well fed: the one aura id', () => {
  it('identity pin: WELL_FED_AURA_ID is well_fed and owns a painted recipe', () => {
    // The one src/ site besides the sanctioned literal AURA_RECIPES key in
    // src/ui/icons.ts that spells the string: every runtime site references
    // the constant (which is what keeps this from being a constant-self-
    // compare), and the view/painter suites pin the literal as FIXTURES on
    // purpose. The seam Phase 15 and the icon prewarm read.
    expect(WELL_FED_AURA_ID).toBe('well_fed');
    expect(hasAuraRecipe(WELL_FED_AURA_ID)).toBe(true);
  });

  it('type fact: only a food def can spell a wellFed payload', () => {
    // The retired runtime food-kind guard is unrepresentable now: the field
    // is kind-scoped on FoodItemDef, so a drink def carrying a payload does
    // not compile. Self-verifying: if the union ever widened, the directive
    // below would itself red tsc as unused.
    const bad: ItemDef = {
      id: 'test_drink',
      name: 'Test Drink',
      kind: 'drink',
      sellValue: 1,
      drinkMana: 10,
      // @ts-expect-error a drink cannot carry a wellFed payload (FoodItemDef only)
      wellFed: { aura: 'Well Fed', kind: 'buff_sta', value: 1, duration: 60 },
    };
    expect(bad.id).toBe('test_drink');
  });

  it('type fact: only the food arm of the eating record can carry the payload', () => {
    // The record the completion site reads is kind-scoped too (FoodConsuming
    // | DrinkConsuming, src/sim/types.ts), so a drink slot can never reach
    // the mint with a payload and the old runtime kind guard is
    // unrepresentable at BOTH layers. Self-verifying like the def pin above.
    const bad: Consuming = {
      itemId: 'test_drink',
      kind: 'drink',
      hpPer2s: 0,
      manaPer2s: 10,
      remaining: 18,
      ticksElapsed: 0,
      // @ts-expect-error a drink record cannot carry a wellFed payload (FoodConsuming only)
      wellFed: { aura: 'Well Fed', kind: 'buff_sta', value: 1, duration: 60 },
    };
    expect(bad.kind).toBe('drink');
  });

  it('content pin: the well-fed carrier set is exactly the seven buff foods', () => {
    const carriers = Object.values(ITEMS)
      .filter((def) => def.kind === 'food' && def.wellFed !== undefined)
      .map((def) => def.id)
      .sort();
    expect(carriers).toEqual([
      'eastbrook_glazed_carrots',
      'evergarden_braised_greens',
      'fenbridge_rice_pudding',
      'highwatch_barley_porridge',
      'sageleaf_chowder',
      'stonepot_stew',
      'warspice_skewers',
    ]);
    // The items.ts use-arm ordering claim (placeMobileStation before feast is
    // behaviorally free because the arms key on different fields) is only
    // true while no def carries both fields; pin that premise too.
    const useAndFeast = Object.values(ITEMS).filter(
      (def) => def.use !== undefined && 'feast' in def && def.feast !== undefined,
    );
    expect(useAndFeast, 'no def may carry both use and feast').toEqual([]);
  });

  it('every live TimedStatBuffPayload carrier uses one of the three narrowed kinds', () => {
    // TimedStatBuffPayload.kind is TimedStatBuffAuraKind, not the whole
    // AuraKind: the payload's contract is "a flat stat buff for a while", and
    // the one-flask singleton strip in items.ts is only correct for that. This
    // is the DATA half of that narrowing (the compiler owns the def half): the
    // union must stay exactly the set the shipped carriers use, so widening it
    // for a kind nothing carries, or a carrier appearing outside it, is a
    // deliberate change here and an audit of the strip.
    const narrowed: readonly TimedStatBuffAuraKind[] = ['buff_ap', 'buff_int', 'buff_sta'];
    const carried = new Set<string>();
    for (const def of Object.values(ITEMS)) {
      if (def.elixir) carried.add(def.elixir.kind);
      if ('wellFed' in def && def.wellFed) carried.add(def.wellFed.kind);
    }
    expect([...carried].sort()).toEqual([...narrowed].sort());
  });

  it('FlaskAuraKind and TimedStatBuffAuraKind stay the same set', () => {
    // Two headers, two warnings, one set. A flask IS a timed stat buff carrier,
    // so the day one union widens without the other the flask arm and the
    // shared payload disagree about what a carrier may be.
    //
    // TYPE-LEVEL, both directions: `Exact` resolves to `true` only when each
    // union extends the other, so a WIDENING of either side and a NARROWING of
    // either side both make the annotation below unsatisfiable and red tsc.
    // The tuple wrappers are what make it decisive: bare `A extends B` would
    // distribute over the union and answer per-member, which is a different
    // (and much weaker) question. Note this arm is tsc's alone: vitest
    // transpiles without type-checking, so a type-only regression here is red
    // under `npx tsc --noEmit` and silent under a bare `vitest run`, the same
    // way the two `@ts-expect-error` pins above are.
    type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    const sameSet: Exact<FlaskAuraKind, TimedStatBuffAuraKind> = true;

    // RUNTIME half, so the case is not a constant compared with itself: each
    // union is spelled out as an exhaustive `Record`, which tsc checks in both
    // directions on its own (a missing key reds on a widening, an excess
    // property reds on a narrowing), and the two independently written key
    // lists are then compared to each other. Adding a kind to one union and
    // only one record is what this arm catches that the type-level one cannot.
    const flaskKinds: Record<FlaskAuraKind, true> = {
      buff_sta: true,
      buff_ap: true,
      buff_int: true,
    };
    const sharedKinds: Record<TimedStatBuffAuraKind, true> = {
      buff_sta: true,
      buff_ap: true,
      buff_int: true,
    };
    expect(sameSet).toBe(true);
    expect(Object.keys(flaskKinds).sort()).toEqual(Object.keys(sharedKinds).sort());
    // ...and against the literal set, so re-spelling BOTH records the same
    // wrong way still reds (the pair compare alone would not see it).
    expect(Object.keys(flaskKinds).sort()).toEqual(['buff_ap', 'buff_int', 'buff_sta']);
  });
});

describe('well fed: completion timing', () => {
  it('mints the aura only when the 18s sit-restore completes, never mid-meal', () => {
    const { sim, pid, p } = playerWorld();
    consume(sim, pid, 'eastbrook_glazed_carrots');

    tickSeconds(sim, 5);
    expect(p.eating, 'still mid-meal at 5s').toBeTruthy();
    expect(wellFedAuras(p), 'no buff on the first bite').toEqual([]);

    tickSeconds(sim, 17); // 22s total: past 18s plus regen-tick alignment
    expect(p.eating, 'meal finished').toBeNull();
    const wf = wellFedAuras(p);
    expect(wf.length).toBe(1);
    // The minted record against LITERALS, every field the mint writes TODAY
    // (a partial match, so a field added to the mint later is unpinned until
    // it is named here; the id is the helper's own filter key and is pinned
    // to its literal by the identity pin above): the feast-versus-bag
    // identity pin (professions_feast) compares two mints to each other and
    // cannot see a field that moves on both sides, so the school and the
    // self-source are anchored here.
    expect(wf[0]).toMatchObject({
      id: WELL_FED_AURA_ID,
      name: 'Well Fed',
      kind: 'buff_sta',
      value: 2,
      duration: 600,
      school: 'nature',
      sourceId: p.id,
    });
    expect(wf[0].remaining).toBeGreaterThan(590);
  });

  it('the 18s boundary: still no mint at 17s in, minted by 19s', () => {
    // playerWorld ticks once, so the consume starts at tickCount 1 and the
    // 2s regen boundaries land at ticks 40, 80, ... 360: eight boundaries
    // have fired by 17s (remaining 2, meal in flight, no aura) and the
    // ninth (18s) is the completion. Pins the CONSUME_DURATION scale the
    // 5s/22s arms cannot see: a meal that completed early would mint here.
    const { sim, pid, p } = playerWorld();
    consume(sim, pid, 'eastbrook_glazed_carrots');
    tickSeconds(sim, 17);
    expect(p.eating, 'still eating at 17s').toBeTruthy();
    expect(wellFedAuras(p), 'no aura at 17s').toEqual([]);
    tickSeconds(sim, 2);
    expect(p.eating, 'meal ended at the 18s boundary').toBeNull();
    expect(wellFedAuras(p)).toHaveLength(1);
  });

  it('a plain dish (no wellFed field) completes with no aura minted', () => {
    const { sim, pid, p } = playerWorld();
    eatToCompletion(sim, pid, p, 'vale_hearth_loaf');
    expect(wellFedAuras(p)).toEqual([]);
  });

  it('a finished drink runs the same completion loop and mints nothing', () => {
    // updateRegen runs the completion block for BOTH slots and calls the
    // mint for the drink slot too (with no payload: DrinkConsuming has no
    // field to carry one), so the sim-level half of the food-only contract
    // is pinned here through a real gulp, not only at the builder.
    const { sim, pid, p } = playerWorld();
    consume(sim, pid, 'spring_water');
    expect(p.drinking, 'the gulp started').toBeTruthy();
    tickSeconds(sim, 22);
    expect(p.drinking, 'the gulp finished').toBeNull();
    expect(wellFedAuras(p)).toEqual([]);
    expect(wellFedByName(p)).toEqual([]);
  });
});

describe('well fed: interruption forfeits the buff', () => {
  it('damage mid-meal cancels eating and no aura ever appears', () => {
    const { sim, pid, p } = playerWorld();
    consume(sim, pid, 'eastbrook_glazed_carrots');
    tickSeconds(sim, 5);
    expect(p.eating, 'mid-meal before the hit').toBeTruthy();

    sim.ctx.dealDamage(null, p, 5, false, 'physical', null, 'hit');
    expect(p.eating, 'the hit cancels the meal').toBeNull();

    tickSeconds(sim, 20); // well past where 18s would have landed
    expect(wellFedAuras(p), 'the forfeited meal never pays out').toEqual([]);
  });

  it('the killing blow clears the meal and the buff is forfeited for good', () => {
    // SCOPE, stated honestly (the joint-coverage rule): lethal damage
    // routes through the shared consuming-interrupt clear in
    // src/sim/combat/damage.ts BEFORE the death-reset block's own
    // belt-and-braces clear, so this arm pins the joint OUTCOME (no meal
    // survives the killing blow, and nothing mints through 30s of
    // dead-state ticks), not the death-reset site specifically: a
    // diagnostic mutant deleting the death block's eating clear survives
    // this suite because the interrupt site already covers it. The
    // posthumous-quiet window below is the coverage the alive-interrupt
    // arm above cannot give.
    const { sim, pid, p } = playerWorld();
    consume(sim, pid, 'eastbrook_glazed_carrots');
    tickSeconds(sim, 5);
    expect(p.eating, 'mid-meal before the killing blow').toBeTruthy();

    sim.ctx.dealDamage(null, p, 1_000_000, false, 'physical', null, 'hit');
    expect(p.dead, 'the hit was lethal').toBe(true);
    expect(p.eating, 'the killing blow cleared the meal').toBeNull();

    // Far past every boundary the meal could have reached, through death
    // and any respawn handling: the mint must never land posthumously.
    tickSeconds(sim, 30);
    expect(wellFedAuras(p), 'no posthumous mint').toEqual([]);
  });

  it('a second dish mid-meal is refused outright, never a restart', () => {
    const { sim, pid, p } = playerWorld();
    consume(sim, pid, 'eastbrook_glazed_carrots'); // dish A
    tickSeconds(sim, 5);
    expect(p.eating?.itemId).toBe('eastbrook_glazed_carrots');
    const remainingBefore = p.eating?.remaining;

    sim.addItem('fenbridge_rice_pudding', 1, pid); // dish B
    sim.useItem('fenbridge_rice_pudding', pid);
    // The already-eating guard (src/sim/items.ts, #2565) refuses B before
    // anything is spent: the slot keeps A (same item, timer untouched) and
    // B stays in the bag.
    expect(p.eating?.itemId).toBe('eastbrook_glazed_carrots');
    expect(p.eating?.remaining).toBe(remainingBefore);
    expect(sim.countItem('fenbridge_rice_pudding', pid)).toBe(1);

    // A's meal completes on A's own clock and mints A's aura, exactly one.
    tickSeconds(sim, 17);
    expect(p.eating).toBeNull();
    const wf = wellFedAuras(p);
    expect(wf).toHaveLength(1);
    expect(wf[0].value).toBe(2); // A's value, never B's 3
  });
});

describe('well fed: elixir coexistence (the ids cannot collide, both orders)', () => {
  // Coexistence needs no namespace registration and no stacking mechanism:
  // aura replacement keys purely on aura.id + sourceId, and 'well_fed' can
  // never equal an 'elixir_<kind>' id BY CONSTRUCTION, so the two families
  // are independent in both orders. The construction itself is pinned in the
  // exclusivity describe below.
  it('eat then quaff: well_fed and elixir_buff_sta coexist untouched', () => {
    const { sim, pid, p } = playerWorld();
    eatToCompletion(sim, pid, p, 'eastbrook_glazed_carrots');
    consume(sim, pid, 'elixir_of_the_boar');

    const wf = p.auras.find((a) => a.id === WELL_FED_AURA_ID);
    const elx = p.auras.find((a) => a.id === 'elixir_buff_sta');
    expect(wf, 'food buff survives the quaff').toBeTruthy();
    expect(wf!.value).toBe(2);
    expect(elx, 'elixir landed beside it').toBeTruthy();
    expect(elx!.value).toBe(6);
  });

  it('quaff then eat: the elixir survives the meal completing', () => {
    const { sim, pid, p } = playerWorld();
    consume(sim, pid, 'elixir_of_the_boar');
    eatToCompletion(sim, pid, p, 'eastbrook_glazed_carrots');

    const wf = p.auras.find((a) => a.id === WELL_FED_AURA_ID);
    const elx = p.auras.find((a) => a.id === 'elixir_buff_sta');
    expect(wf, 'food buff landed').toBeTruthy();
    expect(wf!.value).toBe(2);
    expect(elx, 'elixir intact after the meal').toBeTruthy();
    expect(elx!.value).toBe(6);
  });

  it('the two families are disjoint over the WHOLE catalog, not just the pair quaffed above', () => {
    // ADDED AT PHASE 15, the SPANNING half of the pin ip-15-KIT owes, read off
    // the CATALOG rather than off the one constant: the arms above prove
    // coexistence for the pair they drink, this proves the ids CANNOT collide
    // for every payload the game ships. `elixir_${kind}` is the id
    // src/sim/items.ts builds for every elixir, scroll and flask; well_fed is
    // what every food mints. A new payload kind (the guardian-elixir family
    // items.ts anticipates), or a rename of either scheme toward the other's
    // shape, reds here rather than surfacing as a coexistence bug for a stat
    // nobody wrote a behavioural arm for.
    const elixirIds = new Set<string>();
    let payloadCount = 0;
    for (const def of Object.values(ITEMS)) {
      if (def.kind !== 'elixir' && def.kind !== 'scroll' && def.kind !== 'flask') continue;
      expect(def.elixir, `${def.id} carries an elixir payload`).toBeTruthy();
      elixirIds.add(`elixir_${def.elixir!.kind}`);
      payloadCount++;
    }
    expect(payloadCount, 'the shipped elixir-family carrier count').toBe(10);
    expect([...elixirIds].sort(), 'the shipped elixir-family ids').toEqual([
      'elixir_buff_ap',
      'elixir_buff_int',
      'elixir_buff_sta',
    ]);
    expect(elixirIds.has(WELL_FED_AURA_ID), 'no elixir id is the food id').toBe(false);
    for (const id of elixirIds) {
      expect(WELL_FED_AURA_ID.startsWith(id), `${id} is not a prefix of the food id`).toBe(false);
      expect(id.startsWith(WELL_FED_AURA_ID), `the food id is not a prefix of ${id}`).toBe(false);
    }
  });
});

describe('well fed: one food buff at a time (last eaten wins, whole family)', () => {
  it('a better dish overwrites: exactly one well_fed aura, the new value', () => {
    const { sim, pid, p } = playerWorld();
    eatToCompletion(sim, pid, p, 'eastbrook_glazed_carrots');
    expect(wellFedAuras(p).length).toBe(1);
    expect(wellFedAuras(p)[0].value).toBe(2);

    eatToCompletion(sim, pid, p, 'fenbridge_rice_pudding');
    const wf = wellFedAuras(p);
    expect(wf.length, 'food buffs never stack with each other').toBe(1);
    expect(wf[0].value).toBe(3);
    expect(wellFedByName(p), 'one Well Fed by name after the overwrite').toHaveLength(1);
  });

  it('the three role foods are mutually exclusive: newest kind wins', () => {
    // The unified id is what makes this true: under the retired per-kind
    // namespace a stew and a skewer would have STACKED (different ids), and
    // no classic food buff ever did. Stew, then skewers, then chowder:
    // exactly one well_fed aura after each meal, carrying the newest kind.
    const { sim, pid, p } = playerWorld();
    eatToCompletion(sim, pid, p, 'stonepot_stew');
    let wf = wellFedAuras(p);
    expect(wf).toHaveLength(1);
    expect(wf[0].kind).toBe('buff_sta');

    eatToCompletion(sim, pid, p, 'warspice_skewers');
    wf = wellFedAuras(p);
    expect(wf, 'the skewers replaced the stew').toHaveLength(1);
    expect(wf[0].kind).toBe('buff_ap');
    expect(wellFedByName(p), 'one Well Fed by name, not two').toHaveLength(1);

    eatToCompletion(sim, pid, p, 'sageleaf_chowder');
    wf = wellFedAuras(p);
    expect(wf, 'the chowder replaced the skewers').toHaveLength(1);
    expect(wf[0].kind).toBe('buff_int');
    expect(wf[0].value).toBe(6);
    expect(wellFedByName(p), 'one Well Fed by name after three plates').toHaveLength(1);
  });

  it('a farming dish and a role food are mutually exclusive, in both orders', () => {
    // Dish then plate: the apex overwrites the trainer rung.
    const a = playerWorld();
    eatToCompletion(a.sim, a.pid, a.p, 'evergarden_braised_greens');
    expect(wellFedAuras(a.p)[0].value).toBe(5);
    eatToCompletion(a.sim, a.pid, a.p, 'stonepot_stew');
    let wf = wellFedAuras(a.p);
    expect(wf, 'the plate replaced the dish').toHaveLength(1);
    expect(wf[0].value).toBe(6);
    expect(wf[0].duration).toBe(900);
    expect(wellFedByName(a.p), 'dish then plate: one Well Fed by name').toHaveLength(1);

    // Plate then dish: last eaten still wins, even downward. Classic rule:
    // the mint never compares power, it replaces on the shared id.
    const b = playerWorld(43);
    eatToCompletion(b.sim, b.pid, b.p, 'stonepot_stew');
    expect(wellFedAuras(b.p)[0].value).toBe(6);
    eatToCompletion(b.sim, b.pid, b.p, 'evergarden_braised_greens');
    wf = wellFedAuras(b.p);
    expect(wf, 'the dish replaced the plate').toHaveLength(1);
    expect(wf[0].value).toBe(5);
    expect(wf[0].duration).toBe(600);
    expect(wellFedByName(b.p), 'plate then dish: one Well Fed by name').toHaveLength(1);
  });

  it('re-eating the same dish refreshes remaining to full duration', () => {
    const { sim, pid, p } = playerWorld();
    eatToCompletion(sim, pid, p, 'fenbridge_rice_pudding');
    tickSeconds(sim, 30);
    const before = wellFedAuras(p)[0].remaining;
    expect(before).toBeLessThan(580); // decayed well below full (600)

    eatToCompletion(sim, pid, p, 'fenbridge_rice_pudding');
    const wf = wellFedAuras(p);
    expect(wf.length, 'still exactly one well_fed aura').toBe(1);
    expect(wf[0].remaining).toBeGreaterThan(before);
    expect(wf[0].remaining).toBeGreaterThan(590); // fresh 600 minus tick slack
  });
});

describe('well fed: duration ticks down and the aura expires', () => {
  it('remaining decreases with real ticks and the expiry path removes it', () => {
    const { sim, pid, p } = playerWorld();
    eatToCompletion(sim, pid, p, 'eastbrook_glazed_carrots');
    const first = wellFedAuras(p)[0].remaining;

    tickSeconds(sim, 10);
    const later = wellFedAuras(p)[0].remaining;
    expect(later).toBeLessThan(first);
    expect(first - later).toBeGreaterThan(8); // roughly the 10s that passed

    // Riding out the full 600s is thousands of ticks; the generic expiry walk
    // in updateAuras is what removes it, so drop remaining to the brink and
    // let real ticks finish the job.
    wellFedAuras(p)[0].remaining = 0.5;
    tickSeconds(sim, 2);
    expect(wellFedAuras(p), 'expired aura removed').toEqual([]);
  });
});

describe('well fed: transient across save and load', () => {
  it('a live aura does not survive the serializeCharacter round trip', () => {
    // Auras are transient by design: no persistence path serializes entity
    // auras (serializeCharacter carries no auras key, only the two dedicated
    // sickness timers), so a relog drops the buff like any temporary aura.
    const { sim, pid, p } = playerWorld();
    eatToCompletion(sim, pid, p, 'eastbrook_glazed_carrots');
    expect(wellFedAuras(p).length).toBe(1);

    const state = sim.serializeCharacter(pid)!;
    expect(state).toBeTruthy();
    expect('auras' in (state as unknown as Record<string, unknown>)).toBe(false);

    const sim2 = new Sim({ seed: 43, playerClass: 'warrior', noPlayer: true });
    const pid2 = sim2.addPlayer('warrior', 'Restored', { state });
    sim2.tick();
    const p2 = sim2.entities.get(pid2)! as Entity;
    expect(wellFedAuras(p2), 'buff gone after the round trip').toEqual([]);
  });
});

describe('well fed: the mint draws zero rng', () => {
  // The professions_farming.test.ts draw-observer idiom, twinned: two sims
  // from one seed run the identical eat sequence, one with the buff dish and
  // one with a plain dish of the SAME foodHp (90). If the well-fed mint drew
  // even one rng value, the recorded draw streams would diverge in count or
  // value; identical streams prove the mint adds zero draws.
  function recordEatSequence(itemId: string): { draws: number[]; p: Entity } {
    const { sim, pid, p } = playerWorld(4242);
    const draws: number[] = [];
    sim.rng.setObserver((value: number) => {
      draws.push(value);
    });
    try {
      consume(sim, pid, itemId);
      tickSeconds(sim, 22);
    } finally {
      sim.rng.setObserver(null);
    }
    expect(p.eating).toBeNull();
    return { draws, p };
  }

  it('the eat-plus-completion draw stream matches a plain meal exactly', () => {
    const buffed = recordEatSequence('eastbrook_glazed_carrots');
    const plain = recordEatSequence('vale_hearth_loaf');

    // Non-vacuity: the buffed run really minted, the plain run really did not.
    expect(wellFedAuras(buffed.p).length).toBe(1);
    expect(wellFedAuras(plain.p)).toEqual([]);
    // Non-vacuity of the RIG: the observer really recorded a stream (an
    // unwired observer would leave both runs empty-equal and prove nothing),
    // and the twin premise holds: same foodHp, so the two meals differ ONLY
    // in the wellFed field.
    expect(buffed.draws.length).toBeGreaterThan(0);
    expect(ITEMS.vale_hearth_loaf.foodHp).toBe(ITEMS.eastbrook_glazed_carrots.foodHp);

    expect(buffed.draws.length).toBe(plain.draws.length);
    expect(buffed.draws).toEqual(plain.draws);
  });
});

describe('well fed: the retired namespace is gone (the unification landed)', () => {
  // Phase 15 reads this pin as the proof the unification actually landed
  // rather than leaving a dead second aura namespace behind: 'well_fed' and
  // 'elixir_<kind>' coexist BY CONSTRUCTION (an id equality can never hold
  // between them), the food family is one-at-a-time (the behavioral arms
  // above), and no source anywhere still mints or matches a wellfed_<kind>
  // aura id. The sweep looks for the id namespace as a STRING-LITERAL prefix
  // (a quote directly before the token), which is what an aura id literal or
  // a template like the retired mint's id interpolation looks like, and what
  // a module path or prose mention does not.
  it('well_fed can never collide with an elixir id, and no per-kind well-fed id exists anywhere', () => {
    expect(WELL_FED_AURA_ID.startsWith('elixir')).toBe(false);
    expect(WELL_FED_AURA_ID.includes('_fed')).toBe(true);

    // Needles built from parts so this file's own source cannot match them,
    // and POSITIVE controls (also built from parts) so a mis-built needle can
    // never turn the negative sweep below into a pass over nothing. TWO
    // needles since Phase 15, because one spelling is one spelling:
    //  - the QUOTED retired prefix, the shape an aura-id literal or the
    //    retired mint's own template interpolation takes, and
    //  - the KIND-SHAPED token at ANY position, which is what catches the
    //    three spellings the quoted needle cannot see. An UNQUOTED object key:
    //    the AURA_RECIPES map in src/ui/icons.ts keys the live row as
    //    `well_fed:` with no quote at all, so a retired per-kind row would be
    //    spelled `wellfed_buff_sta:` in exactly that map (planted there, the
    //    quoted needle stayed green over 48 tests). A namespace re-derived
    //    from the SURVIVING constant ('well_fed_buff_sta'), which carries a
    //    middle underscore the first needle forbids. And the camelCase
    //    spelling of the field name. Only the second needle is case-blind: a
    //    case-blind quoted needle starts matching the WELL_FED_AURA_ID
    //    identifier itself.
    const quoted = new RegExp(`['"\`]${'well'}${'fed'}_`);
    const kindShaped = new RegExp(`${'well'}_?${'fed'}_buff_[a-z]`, 'i');
    const retiredId = `${'well'}${'fed'}_buff_sta`;
    expect(quoted.test(`const id = '${retiredId}';`), 'quoted needle: a quoted id').toBe(true);
    expect(quoted.test(`id: \`${retiredId}\``), 'quoted needle: a template literal').toBe(true);
    expect(kindShaped.test(`  ${retiredId}: recipe(),`), 'kind needle: an UNQUOTED key').toBe(true);
    expect(
      kindShaped.test(`id: '${WELL_FED_AURA_ID}_buff_sta'`),
      'kind needle: an id re-derived from the surviving constant',
    ).toBe(true);
    expect(
      kindShaped.test(`  ${'well'}${'Fed'}_buff_sta: 1,`),
      'kind needle: the camelCase spelling of the field name',
    ).toBe(true);

    // EVERY source root since Phase 15, not the three the client lives in:
    // ip-15-KIT says the retired namespace exists NOWHERE and the packet's QA
    // checklist says "absent from the tree", and a stale aura-id MATCHER is as
    // much a leftover as a stale mint. server/ is where an id-keyed reader
    // would live (snapshot_timer_wire, party_frame_projection and
    // cheater_mark_runtime all key on aura fields), and a retired-id literal
    // planted there was invisible to the old three-root walk.
    const ROOTS = ['src', 'scripts', 'tests', 'server', 'headless', 'bot', 'electron'] as const;
    // Non-vacuity floors PER ROOT (tests/CLAUDE.md): an empty walk would make
    // the assertion below pass over nothing at all, and a single total would
    // clear on src/ alone even if a root silently dropped out of the walk, so
    // each root is floored near its own real count. The tests/ floor sits
    // ABOVE what a single-level collapse of tests/ would leave, and the NESTED
    // counts pin the recursion directly: a walk that stopped descending reds
    // on its own line instead of hiding inside a total. headless/, bot/ and
    // electron/ are FLAT today, so their nested floor is 0 and the loop below
    // skips the assertion rather than reddening on the honest tree.
    const FLOORS: Record<(typeof ROOTS)[number], { scanned: number; nested: number }> = {
      src: { scanned: 1800, nested: 1500 },
      scripts: { scanned: 400, nested: 200 },
      tests: { scanned: 3000, nested: 250 },
      server: { scanned: 250, nested: 50 },
      headless: { scanned: 2, nested: 0 },
      bot: { scanned: 10, nested: 0 },
      electron: { scanned: 15, nested: 0 },
    };
    const offenders: string[] = [];
    const scanned: Record<string, number> = {};
    const nested: Record<string, number> = {};
    for (const root of ROOTS) {
      scanned[root] = 0;
      nested[root] = 0;
      for (const f of sourceFilesUnder(join(process.cwd(), root), {
        skipDirectories: ['node_modules'],
      })) {
        scanned[root]++;
        if (f.file.includes('/')) nested[root]++;
        const code = stripComments(readFileSync(f.full, 'utf8'));
        if (quoted.test(code) || kindShaped.test(code)) offenders.push(`${root}/${f.file}`);
      }
    }
    for (const root of ROOTS) {
      expect(scanned[root], `the sweep really walked ${root}/`).toBeGreaterThan(
        FLOORS[root].scanned,
      );
      if (FLOORS[root].nested > 0) {
        expect(nested[root], `the walk descended under ${root}/`).toBeGreaterThan(
          FLOORS[root].nested,
        );
      }
    }
    expect(offenders, 'files still carrying a per-kind well-fed id').toEqual([]);
    // Explicit budget: the synchronous seven-root walk plus comment-stripping
    // over every file reproducibly exceeds the 20000ms default (isolated repro).
  }, 60000);

  it('every carrier mints exactly the one id at RUNTIME, whatever the source spells', () => {
    // The sweep above reads TEXT, so a per-kind namespace ASSEMBLED at runtime
    // (a constant plus the payload kind) is invisible to it: no retired token
    // ever appears as a literal to find. This is the same claim measured
    // through the mint instead, which is the only way to close that shape.
    // Without it the per-kind regression is caught only as collateral by a
    // dozen arms named for timing, rng and save/load, and none of them says
    // what actually broke.
    const carriers = Object.values(ITEMS)
      .filter((def) => def.kind === 'food' && def.wellFed !== undefined)
      .map((def) => def.id)
      .sort();
    expect(carriers, 'the sweep really has carriers to eat').toHaveLength(7);
    for (const itemId of carriers) {
      const { sim, pid, p } = playerWorld();
      eatToCompletion(sim, pid, p, itemId);
      const fed = wellFedByName(p);
      expect(fed, `${itemId} minted exactly one Well Fed`).toHaveLength(1);
      expect(fed[0].id, `${itemId} minted the ONE id`).toBe(WELL_FED_AURA_ID);
      expect(
        p.auras.filter((a) => a.id !== WELL_FED_AURA_ID && a.id.includes('fed')).map((a) => a.id),
        `${itemId} minted no second well-fed namespace`,
      ).toEqual([]);
    }
    // Measured 8.0 s alone here, and it timed out at vitest's 20 s default on a CI
    // runner sharing eight shards: the case mints through every carrier at runtime
    // rather than reading source text. Allowance sized like the sibling above, and the
    // file's declared sum stays under the per-file default so no ledger row is owed.
  }, 40_000);

  it('scan hygiene: this guard reads only through the shared walker', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['source_files_under']);
  });
});
