// Intervene: the level-5 warrior mobility row's peel option, which replaced Double
// Charge in place (the option id `war_row_double_charge` is FROZEN so saved picks
// survive the content swap).
//
// Double Charge stored a second Onrush use, and because charges recharge in PARALLEL
// here (combat/casting_lifecycle.ts arms one timer per spend), the second use returned
// on the same 15 sec as the first: two 25-yard gap closers plus two 1 sec stuns per
// cooldown, which made it the dominant warrior PvP pick.
//
// Intervene reuses the `charge` effect against a FRIENDLY target instead, so it adds
// mobility and a peel without adding pressure. The two behaviors that must hold, and
// that this file pins, are that the friendly rush mints NO rage and never flags the
// caster into combat, and that the hostile Onrush is completely unchanged.

import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { placePlayerInOpenField } from './helpers/open_field';

const ROW_LEVEL = 5;
const FROZEN_OPTION_ID = 'war_row_double_charge';

function warriorAt(level: number, spec: string): { sim: Sim; p: Entity } {
  const sim = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(level);
  expect(sim.setSpec(spec)).toBe(true);
  sim.tick();
  expect(sim.selectTalentRow(ROW_LEVEL, FROZEN_OPTION_ID)).toBe(true);
  placePlayerInOpenField(sim);
  const p = sim.entities.get(sim.playerId);
  if (!p) throw new Error('no player');
  return { sim, p };
}

/** An ally `dist` yards away on the open-field lane, in line of sight. */
function allyAt(sim: Sim, dist: number): Entity {
  const pid = sim.addPlayer('priest', 'Ally');
  placePlayerInOpenField(sim, pid, { z: dist });
  const ally = sim.entities.get(pid);
  if (!ally) throw new Error('no ally');
  return ally;
}

function captureErrors(sim: Sim): string[] {
  const out: string[] = [];
  const inner = sim as unknown as { emit: (e: SimEvent) => void };
  const original = inner.emit.bind(sim);
  inner.emit = (e: SimEvent) => {
    if (e.type === 'error') out.push(e.text);
    original(e);
  };
  return out;
}

const gap = (a: Entity, b: Entity): number => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);

describe('Intervene (level-5 warrior mobility row)', () => {
  it('is granted to EVERY warrior spec, not just one', () => {
    // Grants bypass the level and spec gates in abilitiesKnownAt, and the ability
    // carries no `specs` list, so a class row must reach all three specs. A spec-gated
    // ability here would silently do nothing for the specs left out.
    for (const spec of ['arms', 'fury', 'prot']) {
      const { sim, p } = warriorAt(20, spec);
      const meta = sim.players.get(p.id);
      if (!meta) throw new Error('no meta');
      const known = abilitiesKnownAt('warrior', 20, meta.talentMods);
      expect(
        known.some((a) => a.def.id === 'intervene'),
        `${spec} knows Intervene`,
      ).toBe(true);
    }
  });

  it('rushes the caster to a friendly player and shields them', () => {
    const { sim, p } = warriorAt(20, 'fury');
    const ally = allyAt(sim, 15);
    sim.tick();
    const before = gap(p, ally);
    expect(before).toBeCloseTo(15, 0);

    sim.targetEntity(ally.id);
    const errors = captureErrors(sim);
    sim.castAbility('intervene');
    for (let i = 0; i < 80; i++) sim.tick();

    expect(gap(p, ally)).toBeLessThan(before);
    expect(gap(p, ally)).toBeLessThanOrEqual(5);
    const shield = ally.auras.find((a) => a.kind === 'absorb');
    expect(shield?.name).toBe('Intervene');
    // Rank 3 at level 20; the ranks track ~6-7% of the health curve across the band.
    expect(shield?.value).toBe(50);
    expect(errors).toEqual([]);
  });

  it('mints no rage and never flags the caster into combat', () => {
    const { sim, p } = warriorAt(20, 'fury');
    const ally = allyAt(sim, 15);
    sim.tick();
    p.resource = 0;
    p.inCombat = false;
    p.autoAttack = false;

    sim.targetEntity(ally.id);
    sim.castAbility('intervene');
    for (let i = 0; i < 80; i++) sim.tick();

    expect(p.resource).toBe(0);
    expect(p.inCombat).toBe(false);
    // Landing on an ally must not engage auto-attack: startAutoAttack would refuse a
    // friendly target and toast "Invalid attack target." on every Intervene.
    expect(p.autoAttack).toBe(false);
  });

  it('scales its shield by rank across the level band it is usable in', () => {
    const shieldAt = (level: number): number => {
      const { sim, p } = warriorAt(level, 'fury');
      const meta = sim.players.get(p.id);
      if (!meta) throw new Error('no meta');
      const known = abilitiesKnownAt('warrior', level, meta.talentMods);
      const iv = known.find((a) => a.def.id === 'intervene');
      const absorb = iv?.effects.find((e) => e.type === 'absorb');
      return absorb && absorb.type === 'absorb' ? absorb.amount : -1;
    };
    // A flat value tuned for the cap would be roughly three times as strong at level 5,
    // where a warrior has 252 max health against 822 at level 20.
    expect({ l5: shieldAt(5), l11: shieldAt(11), l17: shieldAt(17), l20: shieldAt(20) }).toEqual({
      l5: 18,
      l11: 34,
      l17: 50,
      l20: 50,
    });
  });

  it('holds those numbers to the RATIO they were authored from, not just their values', () => {
    // Review asked for this one, and it was a fair ask: the pin above is absolutes
    // only, so a re-tune that broke the reasoning behind the numbers (they are a share
    // of the health curve, not free-standing figures) would have kept it green as long
    // as someone edited the expected values to match. This asserts the RULE instead.
    //
    // Measured against the WARRIOR's own curve because that is the anchor the def
    // comment reasons from. Intervene shields an ally whose health the caster does not
    // control, so the caster's curve is the only stable yardstick at authoring time.
    const shareAt = (level: number): number => {
      const { sim, p } = warriorAt(level, 'fury');
      const meta = sim.players.get(p.id);
      if (!meta) throw new Error('no meta');
      const known = abilitiesKnownAt('warrior', level, meta.talentMods);
      const absorb = known
        .find((a) => a.def.id === 'intervene')
        ?.effects.find((e) => e.type === 'absorb');
      if (!absorb || absorb.type !== 'absorb') throw new Error('no absorb effect');
      return absorb.amount / p.maxHp;
    };

    // At each rank's OWN unlock level the share is flat, which is the whole claim.
    for (const level of [5, 11, 17]) {
      const share = shareAt(level);
      expect(share, `level ${level} share ${(share * 100).toFixed(2)}%`).toBeGreaterThan(0.065);
      expect(share, `level ${level} share ${(share * 100).toFixed(2)}%`).toBeLessThan(0.075);
    }
    // Rank 3 is the last rank, so between 17 and the cap the share DECAYS as health
    // keeps climbing. Pinned in that direction on purpose: a peel that grew relatively
    // stronger at cap would be the failure this ranking exists to avoid.
    expect(shareAt(20)).toBeLessThan(shareAt(17));

    // And the ceiling the def comment claims: a warrior peel never rivals a dedicated
    // healer shield. Read from content rather than restated, so re-tuning either side
    // moves this test.
    const psalmRanks = ABILITIES.power_word_shield.ranks ?? [];
    const psalmAtCap = psalmRanks[psalmRanks.length - 1]?.effects?.find((e) => e.type === 'absorb');
    if (!psalmAtCap || psalmAtCap.type !== 'absorb') throw new Error('no healer shield fixture');
    const intervene = ABILITIES.intervene.ranks?.at(-1)?.effects.find((e) => e.type === 'absorb');
    if (!intervene || intervene.type !== 'absorb') throw new Error('no intervene rank 3');
    expect(intervene.amount).toBeLessThan(psalmAtCap.amount / 3);
  });

  it('holds the warrior mobility budget: Intervene and Heroic Leap on 30 sec', () => {
    // The point of this row re-cut is the PvP mobility budget, so the two knobs move
    // together and are pinned together. Intervene sits at DOUBLE the hostile Onrush
    // deliberately: the replacement must not hand a short-cooldown reposition back
    // through the friendly door. Heroic Leap is base kit, so its 30 sec reaches all
    // three specs, not just the warriors who take this row.
    expect(ABILITIES.intervene.cooldown).toBe(30);
    expect(ABILITIES.heroic_leap.cooldown).toBe(30);
    expect(ABILITIES.charge.cooldown).toBe(15);
  });

  it('refuses to rush the caster: no target and an enemy target both mean no ally', () => {
    // resolveFriendlyTarget falls back to the CASTER when the current target is
    // missing, dead, or hostile, which is right for a heal and wrong for a rush.
    // Without a gate that fallback turned Intervene into an off-GCD personal absorb
    // every 30 sec for every warrior who takes the row: exactly the quiet extra
    // budget this row swap exists to remove, and the opposite of "rush to a friendly
    // player". Both entry paths are covered because they resolve through the same
    // fallback and a gate on one alone would leave the other open.
    for (const withEnemyTarget of [false, true]) {
      const { sim, p } = warriorAt(20, 'fury');
      if (withEnemyTarget) {
        const mob = createMob(9101, MOBS.training_dummy, 20, {
          x: p.pos.x,
          y: p.pos.y,
          z: p.pos.z + 15,
        });
        mob.hostile = true;
        sim.addEntity(mob);
        sim.targetEntity(mob.id);
      }
      const errors = captureErrors(sim);
      sim.castAbility('intervene');
      for (let i = 0; i < 20; i++) sim.tick();

      expect(
        p.auras.some((a) => a.kind === 'absorb'),
        `withEnemyTarget=${withEnemyTarget}: no self-shield`,
      ).toBe(false);
      // Refused ABOVE the billing, so nothing is spent either. A refusal that still
      // charged the 30 sec would be its own bug.
      expect(
        p.cooldowns.has('intervene'),
        `withEnemyTarget=${withEnemyTarget}: no cooldown billed`,
      ).toBe(false);
      expect(errors).toContain('You must target an ally.');
    }
  });

  it('enforces its authored 8 yd minimum against a friendly target', () => {
    // The def authors minRange: 8 and the tooltip header advertises "8-25 yd range",
    // but the minRange gate lived only in the HOSTILE branch, so an ally standing on
    // top of the warrior took the cast and the floor was a promise the sim ignored.
    const { sim, p } = warriorAt(20, 'fury');
    const ally = allyAt(sim, 2);
    sim.tick();
    sim.targetEntity(ally.id);
    const errors = captureErrors(sim);

    sim.castAbility('intervene');
    for (let i = 0; i < 20; i++) sim.tick();

    expect(
      ally.auras.some((a) => a.kind === 'absorb'),
      'no shield inside the floor',
    ).toBe(false);
    expect(p.cooldowns.has('intervene'), 'and no cooldown billed').toBe(false);
    expect(errors).toContain('Too close!');
  });

  it('still lands at the edges of its authored band, so the two gates are not blanket refusals', () => {
    // Guards the two guards above. Both would also pass if Intervene simply stopped
    // working, so pin that the band it advertises is the band it accepts.
    for (const dist of [8, 25]) {
      const { sim, p } = warriorAt(20, 'fury');
      const ally = allyAt(sim, dist);
      sim.tick();
      sim.targetEntity(ally.id);
      const errors = captureErrors(sim);

      sim.castAbility('intervene');
      for (let i = 0; i < 80; i++) sim.tick();

      expect(
        ally.auras.some((a) => a.kind === 'absorb'),
        `${dist} yd is inside the band`,
      ).toBe(true);
      expect(p.cooldowns.has('intervene'), `${dist} yd bills the cooldown`).toBe(true);
      expect(errors).toEqual([]);
    }
  });

  it('leaves the hostile Onrush completely unchanged', () => {
    // The friendly branch is gated on target hostility, not on the ability id, so this
    // is the regression guard for every warrior who never picks the row.
    const { sim, p } = warriorAt(20, 'fury');
    p.resource = 0;
    p.inCombat = false;
    p.autoAttack = false;
    const mob = createMob(9002, MOBS.training_dummy, 20, {
      x: p.pos.x,
      y: p.pos.y,
      z: p.pos.z + 15,
    });
    mob.hostile = true;
    sim.addEntity(mob);
    sim.targetEntity(mob.id);

    sim.castAbility('charge');
    for (let i = 0; i < 60; i++) sim.tick();

    expect(p.resource).toBeGreaterThan(0); // Onrush still mints its 9 rage
    expect(p.inCombat).toBe(true);
    expect(p.autoAttack).toBe(true); // and still engages on arrival
    expect(mob.auras.some((a) => a.kind === 'absorb')).toBe(false); // never shields an enemy
  });
});
