// The two recovery sicknesses (The Keeper's Toll and Unstuck Sickness) are the one
// debuff class no player counter may shed. They already survive dying and relogging
// (aurasSurvivingDeath in src/sim/resurrection.ts); before this suite they were still
// ordinary dispel food, so a warlock Voidfeast, a paladin Cleansing Verdict, or a mage
// Cold Coffin erased the whole penalty (and Voidfeast healed the caster 6% for it).
//
// The rule is enforced in ONE place: the `undispellable` aura flag, honored by
// isPlayerRemovableAura in src/sim/aura_classify.ts, which both the dispel executor
// (+ its requiresDispellable cast gate) and the cleanseSelf executor route through.
// The negative controls below are what keep the fix from becoming "nothing is
// dispellable": an ordinary magic debuff must still be dispelled and cleansed.

import { describe, expect, it } from 'vitest';
import { isDispellableAura, isPlayerRemovableAura } from '../src/sim/aura_classify';
import { isCancelableAura } from '../src/sim/combat/aura_cancel';
import {
  RES_SICKNESS_STAT_MULT,
  RESURRECTION_SICKNESS_ID,
  UNSTUCK_SICKNESS_ID,
} from '../src/sim/resurrection';
import { Sim } from '../src/sim/sim';
import { applyResurrectionSickness, applyUnstuckSickness } from '../src/sim/spirit';
import type { Aura, Entity, PlayerClass } from '../src/sim/types';

type Ev = { type?: string; text?: string };
type AnySim = Sim & Record<string, any>;

// A plain magic debuff: the negative control. Same school as the sicknesses and also a
// negative-value buff_* stat drain, so it differs from them ONLY by the flag. Anything
// that stops removing this one has over-reached.
function witheringWail(sourceId: number): Aura {
  return {
    id: 'test_withering_wail',
    name: 'Withering Wail',
    kind: 'buff_allstats_pct',
    remaining: 60,
    duration: 60,
    value: -0.1,
    sourceId,
    school: 'shadow',
  };
}

function sicknessAura(p: Entity, which: 'resurrection' | 'unstuck'): Aura {
  const aura = p.auras.find((a) => a.id === idOf(which));
  if (!aura) throw new Error(`no ${which} sickness applied`);
  return aura;
}

const idOf = (which: 'resurrection' | 'unstuck') =>
  which === 'resurrection' ? RESURRECTION_SICKNESS_ID : UNSTUCK_SICKNESS_ID;

// A single-player rig at a level where the sickness has a real duration (both
// sicknesses are zero-length below level 10), with the row-8 talent allocated.
function rig(
  cls: PlayerClass,
  talentRow: string,
  level = 12,
): { sim: AnySim; p: Entity; events: Ev[] } {
  const sim = new Sim({ seed: 7, playerClass: cls, autoEquip: true }) as AnySim;
  sim.setPlayerLevel(level);
  expect(sim.applyTalents({ spec: null, rows: { 8: talentRow } })).toBe(true);
  const p = sim.player as Entity;
  p.resource = p.maxResource;
  const events: Ev[] = [];
  const emitter = sim as unknown as { emit(e: Ev): void };
  const orig = emitter.emit.bind(sim);
  emitter.emit = (e: Ev) => {
    events.push(e);
    orig(e);
  };
  return { sim, p, events };
}

const sicken = (sim: AnySim, p: Entity, which: 'resurrection' | 'unstuck') => {
  if (which === 'resurrection') applyResurrectionSickness(sim.ctx, p);
  else applyUnstuckSickness(sim.ctx, p);
  expect(p.auras.some((a) => a.id === idOf(which))).toBe(true);
};

const has = (p: Entity, id: string) => p.auras.some((a) => a.id === id);

describe('the recovery sicknesses carry the undispellable flag', () => {
  it.each(['resurrection', 'unstuck'] as const)('%s sickness is flagged on apply', (which) => {
    const { sim, p } = rig('warlock', 'wlk_r8_voidfeast');
    sicken(sim, p, which);
    expect(sicknessAura(p, which).undispellable).toBe(true);
  });

  it('a flagged aura is removable by nothing, in either dispel direction', () => {
    const flagged = { ...witheringWail(1), undispellable: true as const };
    expect(isPlayerRemovableAura(flagged)).toBe(false);
    expect(isDispellableAura(flagged, false)).toBe(false);
    expect(isDispellableAura(flagged, true)).toBe(false);
    // A debuff was never right-click cancelable; the flag must not make it one.
    expect(isCancelableAura(flagged)).toBe(false);
  });

  it('an unflagged magic debuff stays dispellable (the fix is not a blanket ban)', () => {
    const plain = witheringWail(1);
    expect(isPlayerRemovableAura(plain)).toBe(true);
    expect(isDispellableAura(plain, false)).toBe(true);
  });
});

describe('warlock Voidfeast cannot devour a sickness', () => {
  it.each(['resurrection', 'unstuck'] as const)(
    'refuses the self-cast on %s sickness before billing',
    (which) => {
      const { sim, p, events } = rig('warlock', 'wlk_r8_voidfeast');
      sicken(sim, p, which);
      const manaBefore = p.resource;
      const hpBefore = p.hp;
      sim.targetEntity(p.id);
      sim.castAbility('voidfeast');
      sim.tick();
      expect(
        events.some((e) => e.type === 'error' && /nothing to devour/i.test(e.text ?? '')),
      ).toBe(true);
      expect(has(p, idOf(which))).toBe(true);
      // The gate refuses before billing, so the 6% devour heal never pays out either.
      expect(p.resource).toBe(manaBefore);
      expect(p.cooldowns.has('voidfeast')).toBe(false);
      expect(p.hp).toBe(hpBefore);
    },
  );

  it('refuses an ally carrying only Resurrection Sickness', () => {
    const sim = new Sim({
      seed: 7,
      playerClass: 'warlock',
      autoEquip: true,
      noPlayer: true,
    }) as AnySim;
    const lockId = sim.addPlayer('warlock', 'Lock') as number;
    const allyId = sim.addPlayer('warrior', 'Ally') as number;
    sim.setPlayerLevel(12, lockId);
    sim.setPlayerLevel(12, allyId);
    expect(sim.applyTalents({ spec: null, rows: { 8: 'wlk_r8_voidfeast' } }, lockId)).toBe(true);
    const lock = sim.entities.get(lockId) as Entity;
    const ally = sim.entities.get(allyId) as Entity;
    ally.pos = { ...lock.pos, x: lock.pos.x + 2 };
    ally.prevPos = { ...ally.pos };
    sim.rebucket(ally);
    lock.resource = lock.maxResource;
    applyResurrectionSickness(sim.ctx, ally);
    const manaBefore = lock.resource;
    sim.targetEntity(allyId, lockId);
    sim.castAbility('voidfeast', lockId);
    for (let i = 0; i < 15; i++) sim.tick();
    expect(has(ally, RESURRECTION_SICKNESS_ID)).toBe(true);
    expect(lock.resource).toBe(manaBefore);
    expect(lock.cooldowns.has('voidfeast')).toBe(false);
  });

  it('still devours an ordinary debuff sitting under a sickness', () => {
    const { sim, p } = rig('warlock', 'wlk_r8_voidfeast');
    // Order matters: the dispel executor scans from the END of the aura array and
    // stops at its `count`, so the sickness must be the FIRST candidate it meets.
    // With the wail pushed last the test would pass with no fix at all.
    p.auras.push(witheringWail(p.id));
    sicken(sim, p, 'resurrection');
    sim.targetEntity(p.id);
    sim.castAbility('voidfeast');
    for (let i = 0; i < 15; i++) sim.tick();
    expect(has(p, 'test_withering_wail')).toBe(false);
    expect(has(p, RESURRECTION_SICKNESS_ID)).toBe(true);
  });
});

describe('paladin Cleansing Verdict cannot purge a sickness', () => {
  it.each(['resurrection', 'unstuck'] as const)(
    'leaves %s sickness on the target and takes the debuff beneath it',
    (which) => {
      const { sim, p } = rig('paladin', 'pal_r8_cleansing_verdict');
      // Wail FIRST, sickness second: Cleansing Verdict carries no requiresDispellable
      // gate and dispels count 1 scanning from the end, so this ordering is what makes
      // the case decisive. It must skip the sickness and take the wail underneath.
      p.auras.push(witheringWail(p.id));
      sicken(sim, p, which);
      sim.targetEntity(p.id);
      sim.castAbility('cleansing_verdict');
      for (let i = 0; i < 15; i++) sim.tick();
      expect(has(p, 'test_withering_wail')).toBe(false);
      expect(has(p, idOf(which))).toBe(true);
    },
  );

  it.each(['resurrection', 'unstuck'] as const)(
    'finds nothing to purge when %s sickness is the only debuff',
    (which) => {
      const { sim, p } = rig('paladin', 'pal_r8_cleansing_verdict');
      sicken(sim, p, which);
      sim.targetEntity(p.id);
      sim.castAbility('cleansing_verdict');
      for (let i = 0; i < 15; i++) sim.tick();
      expect(has(p, idOf(which))).toBe(true);
    },
  );
});

describe('mage Cold Coffin (cleanseSelf) cannot strip a sickness', () => {
  it.each(['resurrection', 'unstuck'] as const)('leaves %s sickness on the caster', (which) => {
    // Cold Coffin is a base mage ability at level 12, so no talent row is needed;
    // the row-8 allocation just keeps the rig helper uniform.
    const { sim, p } = rig('mage', 'mag_r8_warded');
    sicken(sim, p, which);
    p.auras.push(witheringWail(p.id));
    sim.castAbility('ice_block');
    sim.tick();
    // cleanseSelf still strips every ordinary debuff: that is the whole ability.
    expect(has(p, 'test_withering_wail')).toBe(false);
    expect(has(p, idOf(which))).toBe(true);
  });
});

describe('the sickness drain survives every counter', () => {
  it('keeps the full stat penalty folded in after a cleanse attempt', () => {
    const { sim, p } = rig('mage', 'mag_r8_warded');
    const healthy = p.maxHp;
    sicken(sim, p, 'resurrection');
    const sickened = p.maxHp;
    expect(sickened).toBeLessThan(healthy);
    sim.castAbility('ice_block');
    sim.tick();
    expect(p.maxHp).toBe(sickened);
    expect(sicknessAura(p, 'resurrection').value).toBe(RES_SICKNESS_STAT_MULT);
  });

  it('refuses the right-click cancel a player could try on the buff bar', () => {
    const { sim, p } = rig('mage', 'mag_r8_warded');
    sicken(sim, p, 'resurrection');
    sim.cancelAura(RESURRECTION_SICKNESS_ID);
    expect(has(p, RESURRECTION_SICKNESS_ID)).toBe(true);
  });
});
