// The Masterwrought phase 10 consumable behavior suite: the alchemy FLASKS and
// the cooking role foods, driven through a real Sim (useItem plus ticks), never
// through the resolver in isolation.
//
// Three rules make a flask a flask, and all three key on the Aura.flask MARKER
// stamped by the use path (src/sim/items.ts), never on the item kind or the
// aura id:
//   1. one flask at a time, whatever its stat (the strip loop sheds every
//      flask-marked aura before the new one lands),
//   2. downward refusal (a same-family elixir or scroll is refused BEFORE its
//      unit is consumed rather than allowed to overwrite a flask), and
//   3. death persistence (aurasSurvivingDeath keeps a flask-marked aura).
// Everything else about a flask is shipped elixir behavior: it joins the same
// `elixir_${kind}` family, so a flask and a same-stat elixir replace each other
// UPWARD, and a different-stat elixir is untouched.
//
// The role foods are the contrast: Well Fed rides one shared 'well_fed' id, is
// owed only when the 18-second drain COMPLETES, and carries no marker, so it
// dies with you. The def-level values (15/1200, 6/600, foodHp 1392) are pinned
// in tests/masterwrought_budget.test.ts; this file pins what the sim DOES with
// them.
import { describe, expect, it } from 'vitest';
import { DELVES } from '../src/sim/data';
import { ejectToDelveDoor } from '../src/sim/delves/runs';
import { Sim } from '../src/sim/sim';
import { revivePlayerAt } from '../src/sim/spirit';
import type { Aura, Entity, SimEvent } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

const IRONHUSK = 'ironhusk_flask'; // buff_sta 15 / 1200
const WARBOAR = 'warboar_flask'; // buff_ap 15 / 1200
const RUNEWATER = 'runewater_flask'; // buff_int 15 / 1200
const SERPENT = 'elixir_of_the_serpent'; // buff_sta 12 / 900, the top shipped rung
const BOAR = 'elixir_of_the_boar'; // buff_sta 6 / 600, the bottom rung
const SUNPETAL_SCROLL = 'sunpetal_scroll'; // the serpent band's scroll twin
const STEW = 'stonepot_stew'; // Well Fed buff_sta
const CHOWDER = 'sageleaf_chowder'; // Well Fed buff_int

const STA_FAMILY = 'elixir_buff_sta';
const AP_FAMILY = 'elixir_buff_ap';
const INT_FAMILY = 'elixir_buff_int';
const WELL_FED = 'well_fed';
const REFUSAL_LINE = 'A more powerful effect is already active.';

// The meal drain is 18 seconds and only advances on the 2-second regen tick, so
// 20 game seconds of ticks finishes it with one tick of slack.
const MEAL_TICKS = 20 * 20;

// EMPTY_TEST_WORLD keeps terrain and props but no camps, npcs, or ground
// objects: nothing can wander over and interrupt an 18-second meal or a death
// arm, which would make these cases flaky for reasons unrelated to the rules
// under test.
function world(seed = 42): { sim: Sim; pid: number; p: Entity } {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, world: EMPTY_TEST_WORLD });
  const pid = sim.playerId;
  sim.tick();
  return { sim, pid, p: sim.entities.get(pid) as Entity };
}

function use(sim: Sim, pid: number, itemId: string, count = 1): void {
  sim.addItem(itemId, count, pid);
  sim.useItem(itemId, pid);
}

const flaskAuras = (p: Entity): Aura[] => p.auras.filter((a) => a.flask === true);
const aurasById = (p: Entity, id: string): Aura[] => p.auras.filter((a) => a.id === id);

function kill(sim: Sim, p: Entity): void {
  (
    sim as unknown as {
      dealDamage: (
        source: Entity | null,
        target: Entity,
        amount: number,
        crit: boolean,
        school: string,
        ability: string | null,
        kind: string,
      ) => number;
    }
  ).dealDamage(null, p, 999_999, false, 'physical', null, 'hit');
}

function hurt(sim: Sim, p: Entity, amount: number): void {
  (
    sim as unknown as {
      dealDamage: (
        source: Entity | null,
        target: Entity,
        amount: number,
        crit: boolean,
        school: string,
        ability: string | null,
        kind: string,
      ) => number;
    }
  ).dealDamage(null, p, amount, false, 'physical', null, 'hit');
}

describe('flasks: one at a time, refuse downward, survive death', () => {
  it('a second flask of ANOTHER stat sheds the first: at most one flask ever rides', () => {
    const { sim, pid, p } = world();
    use(sim, pid, IRONHUSK);
    expect(flaskAuras(p), 'the first flask landed').toHaveLength(1);
    // The count assertions below are meaningful only while the fixture also
    // carries a NON-flask aura (the warrior's stance), so a fixture change
    // cannot quietly degrade them into the flask-filter length check.
    const totalWithOne = p.auras.length;
    expect(totalWithOne, 'the fixture carries a non-flask aura too').toBeGreaterThanOrEqual(2);

    use(sim, pid, RUNEWATER);

    // THE INVARIANT, not just "the new one is there": at most one flask-marked
    // aura exists at all, and it is the newer one.
    const flasks = flaskAuras(p);
    expect(flasks, 'exactly one flask-marked aura').toHaveLength(1);
    expect(flasks[0].id).toBe(INT_FAMILY);
    expect(flasks[0].value).toBe(15);
    // The stripped aura left the WHOLE list, not merely the flask filter, and
    // nothing else appeared beside it.
    expect(aurasById(p, STA_FAMILY), 'the shed flask is gone entirely').toHaveLength(0);
    expect(p.auras.length).toBe(totalWithOne);
  });

  it('the strip re-derives the stat book: only the surviving flask is in the totals', () => {
    // The stat side of the same shed. Asserting the DELTA rather than aura
    // presence: a strip that removed the aura but left its stats baked would
    // pass every count assertion above.
    const { sim, pid, p } = world();
    const baseSta = p.stats.sta;
    const baseInt = p.stats.int;
    use(sim, pid, IRONHUSK);
    expect(p.stats.sta, 'the sta flask reaches derived stats').toBe(baseSta + 15);
    use(sim, pid, RUNEWATER);
    expect(p.stats.int, 'the int flask reaches derived stats').toBe(baseInt + 15);
    expect(p.stats.sta, 'the shed flask left the stat book').toBe(baseSta);
  });

  it('re-quaffing the SAME flask is a silent refresh, never a fade plus a re-apply', () => {
    const { sim, pid, p } = world();
    use(sim, pid, IRONHUSK);
    for (let i = 0; i < 20 * 30; i++) sim.tick();
    expect(flaskAuras(p)[0].remaining, 'the flask really ticked down').toBeLessThan(1200 - 20);

    sim.drainEvents();
    use(sim, pid, IRONHUSK);
    const events = sim.drainEvents() as SimEvent[];
    const auraEvents = events.filter((e) => e.type === 'aura');
    // The strip loop deliberately SKIPS a same-id flask so applyAura's own
    // same-id same-name rule handles it: that path displaces silently and
    // stamps refresh:true. A strip that took the same-id aura instead would
    // emit a fade first and then a fresh (unrefreshed) application, which is
    // what these two assertions separate.
    expect(
      auraEvents.some((e) => e.type === 'aura' && e.gained === false),
      'no fade for a same-flask re-quaff',
    ).toBe(false);
    const gained = auraEvents.find(
      (e) => e.type === 'aura' && e.gained === true && e.abilityId === STA_FAMILY,
    );
    expect(gained, 'the re-quaff still announces the buff').toBeTruthy();
    expect((gained as { refresh?: boolean }).refresh, 'it is a REFRESH, not a re-apply').toBe(true);
    expect(flaskAuras(p)).toHaveLength(1);
    expect(flaskAuras(p)[0].remaining, 'refreshed to full').toBeGreaterThan(1199);
  });

  it.each([SERPENT, SUNPETAL_SCROLL])(
    '%s is REFUSED under a same-stat flask: the line is emitted and the unit is kept',
    (weakerId) => {
      const { sim, pid, p } = world();
      use(sim, pid, IRONHUSK);
      const totalBefore = p.auras.length;
      sim.addItem(weakerId, 2, pid);
      sim.drainEvents();

      sim.useItem(weakerId, pid);

      // POSITIVE refusal, not just absence of effect: the player is told, the
      // unit is still in the bag for the next attempt, and the flask the guard
      // exists to protect is untouched at full strength.
      const events = sim.drainEvents() as SimEvent[];
      const err = events.find((e) => e.type === 'error');
      expect(err, 'the refusal is announced').toBeTruthy();
      expect((err as { text: string }).text).toBe(REFUSAL_LINE);
      expect(sim.countItem(weakerId, pid), 'the unit was NOT consumed').toBe(2);
      const flasks = flaskAuras(p);
      expect(flasks).toHaveLength(1);
      expect(flasks[0].id).toBe(STA_FAMILY);
      expect(flasks[0].value, 'the flask still rides at full strength').toBe(15);
      expect(flasks[0].flask).toBe(true);
      expect(p.auras.length, 'no aura was added or removed').toBe(totalBefore);
    },
  );

  it.each([SERPENT, SUNPETAL_SCROLL])(
    'a flask replaces an active %s of its own stat: UPWARD always goes through',
    (weakerId) => {
      // The other direction of the refusal family above, for BOTH weaker
      // sources. The scroll arm is the one that was missing: the refusal arm
      // covers scroll-under-flask, so without this nothing said a flask may
      // still be drunk over an active scroll.
      const { sim, pid, p } = world();
      sim.addItem(weakerId, 1, pid);
      sim.useItem(weakerId, pid);
      const before = aurasById(p, STA_FAMILY);
      expect(before, 'the weaker source is active first').toHaveLength(1);
      expect(before[0].flask, 'and carries no marker').toBeUndefined();

      sim.drainEvents();
      use(sim, pid, IRONHUSK);

      expect(
        (sim.drainEvents() as SimEvent[]).filter((e) => e.type === 'error'),
        'going upward is never refused',
      ).toHaveLength(0);
      const after = aurasById(p, STA_FAMILY);
      expect(after, 'never a stack').toHaveLength(1);
      expect(after[0].value, 'the flask took the slot').toBe(15);
      expect(after[0].flask).toBe(true);
    },
  );

  it('a flask still replaces the elixir of its own stat: only DOWNWARD is blocked', () => {
    const { sim, pid, p } = world();
    use(sim, pid, SERPENT);
    const before = aurasById(p, STA_FAMILY);
    expect(before).toHaveLength(1);
    expect(before[0].value).toBe(12);
    expect(before[0].flask, 'an elixir never carries the marker').toBeUndefined();

    use(sim, pid, IRONHUSK);

    const after = aurasById(p, STA_FAMILY);
    expect(after, 'never a stack').toHaveLength(1);
    expect(after[0].value, 'the flask owns the slot').toBe(15);
    expect(after[0].flask).toBe(true);
    expect(sim.countItem(IRONHUSK, pid), 'the flask really was drunk').toBe(0);
  });

  it('a flask of another stat leaves the elixir family alone: both ride at once', () => {
    // The family scoping arm. The shipped elixir/scroll catalog is entirely
    // buff_sta, so the only way to build a cross-family case is to put the
    // flask on the OTHER side: an AP flask must not refuse a stamina elixir.
    const { sim, pid, p } = world();
    use(sim, pid, WARBOAR);
    sim.drainEvents();
    use(sim, pid, SERPENT);

    const errors = (sim.drainEvents() as SimEvent[]).filter((e) => e.type === 'error');
    expect(errors, 'a different family is never refused').toHaveLength(0);
    const ap = aurasById(p, AP_FAMILY);
    expect(ap).toHaveLength(1);
    expect(ap[0].value).toBe(15);
    expect(ap[0].flask).toBe(true);
    const sta = aurasById(p, STA_FAMILY);
    expect(sta).toHaveLength(1);
    expect(sta[0].value).toBe(12);
    expect(sta[0].flask).toBeUndefined();
    expect(sim.countItem(SERPENT, pid), 'the elixir really was drunk').toBe(0);
  });

  it('the strip spares a marker-less elixir of another id: the MARKER decides, not the family', () => {
    // The strip only runs when a FLASK is quaffed, so the elixir has to be worn
    // FIRST for this to exercise it at all. The family-scoping arm above quaffs
    // in the other order, which is why it never put a live elixir in front of
    // the strip. A strip keyed on the `elixir_` id family instead of Aura.flask
    // would shed the serpent right here; keyed on the marker, it cannot see it.
    const { sim, pid, p } = world();
    use(sim, pid, SERPENT);
    const before = aurasById(p, STA_FAMILY);
    expect(before, 'the elixir is worn at the moment the strip runs').toHaveLength(1);
    expect(before[0].flask, 'and carries no marker').toBeUndefined();

    use(sim, pid, RUNEWATER);

    const sta = aurasById(p, STA_FAMILY);
    expect(sta, 'the marker-less elixir survived the strip').toHaveLength(1);
    expect(sta[0].value).toBe(12);
    expect(sta[0].flask).toBeUndefined();
    const flasks = flaskAuras(p);
    expect(flasks, 'and the new flask is the only marked aura').toHaveLength(1);
    expect(flasks[0].id).toBe(INT_FAMILY);
  });

  it('the strip sheds a MARKED aura whose id has nothing to do with elixirs', () => {
    // The other direction, and the reason the arm above is not enough on its
    // own: a strip keyed on the `elixir_` id family would KEEP this decoy,
    // because its id is not in that family at all. Only Aura.flask can see it.
    // Pushed straight onto the list so applyAura's same-id rule cannot swallow
    // it, the death test's decoy idiom.
    const { sim, pid, p } = world();
    p.auras.push({
      id: 'probe_unrelated_ward',
      name: 'Decoy Flask Ward',
      kind: 'buff_armor',
      remaining: 1200,
      duration: 1200,
      value: 4,
      sourceId: p.id,
      school: 'nature',
      flask: true,
    });
    expect(flaskAuras(p), 'the decoy is the only marked aura to start').toHaveLength(1);

    use(sim, pid, IRONHUSK);

    const flasks = flaskAuras(p);
    expect(flasks, 'still exactly one flask rides').toHaveLength(1);
    expect(flasks[0].id).toBe(STA_FAMILY);
    expect(
      p.auras.some((a) => a.id === 'probe_unrelated_ward'),
      'the unrelated MARKED aura was shed, by its marker and nothing else',
    ).toBe(false);
  });

  it('elixir over elixir is untouched: the newest source still wins, weaker included', () => {
    // The shipped rule the flask work must not disturb (the phase 06 pin in
    // tests/inscription_scroll_exclusivity.test.ts states it for scrolls). The
    // downward guard can only fire against a flask-MARKED aura, which no elixir
    // can create, so this stays classic overwrite.
    const { sim, pid, p } = world();
    use(sim, pid, SERPENT);
    sim.drainEvents();
    use(sim, pid, BOAR);

    expect((sim.drainEvents() as SimEvent[]).filter((e) => e.type === 'error')).toHaveLength(0);
    const fam = aurasById(p, STA_FAMILY);
    expect(fam).toHaveLength(1);
    expect(fam[0].value, 'the weaker newest elixir still takes the slot').toBe(6);
    expect(fam[0].flask).toBeUndefined();
    expect(sim.countItem(BOAR, pid), 'the weaker elixir really was drunk').toBe(0);
  });

  it('the MARKER survives death and revive; the same aura id without it does not', () => {
    const { sim, pid, p } = world();
    use(sim, pid, IRONHUSK);
    // A decoy carrying the flask's own aura id, kind, and school but NO marker,
    // pushed straight onto the list so applyAura's same-id rule cannot swallow
    // it. If the death filter keyed on the id (or the kind) instead of the
    // marker, this would survive beside the flask.
    p.auras.push({
      id: STA_FAMILY,
      name: 'Decoy Vigor',
      kind: 'buff_sta',
      remaining: 1200,
      duration: 1200,
      value: 3,
      sourceId: p.id,
      school: 'nature',
    });
    const mortalCount = p.auras.filter((a) => a.flask !== true).length;
    expect(mortalCount, 'the fixture carries mortal auras to lose').toBeGreaterThanOrEqual(2);

    kill(sim, p);

    expect(p.dead).toBe(true);
    const survivors = aurasById(p, STA_FAMILY);
    expect(survivors, 'only the marked one survived its own id').toHaveLength(1);
    expect(survivors[0].flask).toBe(true);
    expect(survivors[0].value).toBe(15);
    expect(
      p.auras.some((a) => a.name === 'Decoy Vigor'),
      'the marker-less twin died',
    ).toBe(false);

    revivePlayerAt(sim.ctx, pid, p.pos, 1);
    expect(p.dead).toBe(false);
    const revived = flaskAuras(p);
    expect(revived, 'the flask is still there after the revive').toHaveLength(1);
    expect(revived[0].id).toBe(STA_FAMILY);
    expect(revived[0].value).toBe(15);
  });
});

describe('the flask marker at the OTHER site that reuses the death filter', () => {
  it('a flask rides through a delve EJECT, which is not a death at all', () => {
    // The recorded widening, pinned where it can be seen. delves/runs.ts
    // ejectToDelveDoor reuses aurasSurvivingDeath for a LIVE displacement, so
    // the flask survives an eject as well as a death. That is deliberate (a
    // player ejected from a delve has not died, and taking their flask would be
    // harsher than dying), but it is the death filter reaching somewhere its
    // name does not say, so it gets an assertion rather than a comment alone.
    const { sim, pid, p } = world();
    use(sim, pid, IRONHUSK);
    // A marker-less aura to lose, so "the flask survived" is a filter running
    // and not the eject leaving every aura untouched.
    p.auras.push({
      id: 'probe_mortal_ward',
      name: 'Decoy Ward',
      kind: 'buff_armor',
      remaining: 600,
      duration: 600,
      value: 4,
      sourceId: p.id,
      school: 'nature',
    });
    expect(p.dead, 'nobody died: this is the live path').toBe(false);

    ejectToDelveDoor(sim.ctx, pid, DELVES.collapsed_reliquary);

    expect(p.dead, 'still alive after the eject').toBe(false);
    const flasks = flaskAuras(p);
    expect(flasks, 'the flask rode through the eject').toHaveLength(1);
    expect(flasks[0].id).toBe(STA_FAMILY);
    expect(flasks[0].value).toBe(15);
    expect(
      p.auras.some((a) => a.id === 'probe_mortal_ward'),
      'and the filter really ran: the marker-less aura is gone',
    ).toBe(false);
  });
});

describe('role foods: Well Fed lands only on a finished meal, and is mortal', () => {
  it('a finished meal grants Well Fed with the plate own payload', () => {
    const { sim, pid, p } = world();
    use(sim, pid, STEW);
    expect(p.eating, 'the meal started').not.toBeNull();
    expect(aurasById(p, WELL_FED), 'nothing is owed mid-drain').toHaveLength(0);

    for (let i = 0; i < MEAL_TICKS; i++) sim.tick();

    expect(p.eating, 'the drain finished').toBeNull();
    const fed = aurasById(p, WELL_FED);
    expect(fed, 'the finished meal paid out').toHaveLength(1);
    expect(fed[0].kind).toBe('buff_sta');
    expect(fed[0].value).toBe(6);
    expect(fed[0].duration).toBe(600);
    expect(fed[0].remaining).toBeGreaterThan(590);
    expect(fed[0].flask, 'Well Fed carries no flask marker').toBeUndefined();
  });

  it('an INTERRUPTED meal grants nothing, and the plate is still spent', () => {
    // The sibling of the case above, deliberately its own test: one arm proving
    // the fixture grants when the drain completes is what keeps this one from
    // passing for the wrong reason (a fixture that never fed at all).
    const { sim, pid, p } = world();
    use(sim, pid, STEW);
    for (let i = 0; i < 20 * 8; i++) sim.tick();
    expect(p.eating, 'still eating when the hit lands').not.toBeNull();
    expect(aurasById(p, WELL_FED), 'nothing granted yet').toHaveLength(0);

    hurt(sim, p, 10);

    expect(p.dead, 'the interrupt is a hit, not a death').toBe(false);
    expect(p.eating, 'the hit ended the meal').toBeNull();
    for (let i = 0; i < MEAL_TICKS; i++) sim.tick();
    expect(aurasById(p, WELL_FED), 'an interrupted meal is owed nothing, ever').toHaveLength(0);
    expect(sim.countItem(STEW, pid), 'the plate was consumed all the same').toBe(0);
  });

  it('one Well Fed slot: the newest finished plate replaces the last, whatever its role', () => {
    const { sim, pid, p } = world();
    use(sim, pid, STEW);
    for (let i = 0; i < MEAL_TICKS; i++) sim.tick();
    expect(aurasById(p, WELL_FED)[0].kind).toBe('buff_sta');
    const totalAfterFirst = p.auras.length;

    use(sim, pid, CHOWDER);
    for (let i = 0; i < MEAL_TICKS; i++) sim.tick();

    const fed = aurasById(p, WELL_FED);
    expect(fed, 'never two plates at once').toHaveLength(1);
    expect(fed[0].kind, 'the newest role wins the slot').toBe('buff_int');
    expect(fed[0].value).toBe(6);
    expect(p.auras.length, 'the second plate added no aura beside the slot').toBe(totalAfterFirst);
  });

  it('death takes Well Fed and leaves the flask: the contrast, in one scenario', () => {
    const { sim, pid, p } = world();
    use(sim, pid, IRONHUSK);
    use(sim, pid, STEW);
    for (let i = 0; i < MEAL_TICKS; i++) sim.tick();
    expect(aurasById(p, WELL_FED), 'both effects ride before the death').toHaveLength(1);
    expect(flaskAuras(p)).toHaveLength(1);

    kill(sim, p);

    expect(aurasById(p, WELL_FED), 'Well Fed is mortal').toHaveLength(0);
    const flasks = flaskAuras(p);
    expect(flasks, 'the flask is not').toHaveLength(1);
    expect(flasks[0].value).toBe(15);
  });
});

describe('the phase 10 consumables reach a real player', () => {
  it('the stamina flask raises max HP, and the shed of it takes the HP back', () => {
    // The end-to-end proof that these auras are not decorative: the derived
    // pool moves with the marker, both when it lands and when the singleton
    // strip sheds it.
    const { sim, pid, p } = world();
    const baseHp = p.maxHp;
    use(sim, pid, IRONHUSK);
    const withFlask = p.maxHp;
    expect(withFlask, 'stamina from the flask reaches the pool').toBeGreaterThan(baseHp);
    use(sim, pid, WARBOAR);
    expect(p.maxHp, 'shedding it takes the pool back down').toBe(baseHp);
  });
});
