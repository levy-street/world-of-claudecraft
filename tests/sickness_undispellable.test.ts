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
import { BUILTIN_WORLD } from '../src/sim/data';
import {
  RES_SICKNESS_STAT_MULT,
  RESURRECTION_SICKNESS_ID,
  SICKNESS_AURA_IDS,
  UNSTUCK_SICKNESS_ID,
} from '../src/sim/resurrection';
import { Sim } from '../src/sim/sim';
import { applyResurrectionSickness, applyUnstuckSickness } from '../src/sim/spirit';
import type { Aura, Entity, PlayerClass } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { bareClient } from './helpers/bare_client';

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

  // The cancel arms above ride on isDebuffAura: both sicknesses are negative-value
  // buff_* auras, so they were already refused as debuffs and those assertions hold
  // with the flag reverted. A POSITIVE-value buff is the only shape where the
  // removability term is what decides, so this is the case that actually covers it.
  it('refuses the cancel on a flagged HELPFUL buff, where the flag is the deciding term', () => {
    const helpful: Aura = {
      id: 'test_bound_boon',
      name: 'Bound Boon',
      kind: 'buff_ap',
      remaining: 60,
      duration: 60,
      value: 50,
      sourceId: 1,
      school: 'holy',
    };
    expect(isCancelableAura(helpful)).toBe(true);
    expect(isCancelableAura({ ...helpful, undispellable: true })).toBe(false);
    // The client's matching buff-bar affordance is covered beside its own module,
    // in tests/auras_view.test.ts ("never offers a right-click cancel ...").
  });
});

describe('the flag reaches the online client', () => {
  it('round-trips through the wire as und and back to undispellable', () => {
    const client = bareClient(1);
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot({
      ents: [
        {
          id: 2,
          k: 'player',
          nm: 'Sick',
          lv: 12,
          x: 0,
          y: 0,
          z: 0,
          f: 0,
          hp: 40,
          mhp: 40,
          auras: [
            {
              id: RESURRECTION_SICKNESS_ID,
              name: 'Resurrection Sickness',
              kind: 'buff_allstats_pct',
              rem: 600,
              dur: 600,
              value: RES_SICKNESS_STAT_MULT,
              school: 'shadow',
              und: 1,
            },
          ],
        },
      ],
    });
    const mirrored = client.entities.get(2)?.auras.find((a) => a.id === RESURRECTION_SICKNESS_ID);
    expect(mirrored?.undispellable).toBe(true);
    expect(isPlayerRemovableAura(mirrored as Aura)).toBe(false);
  });

  it('leaves an ordinary aura unflagged when the server omits und', () => {
    const client = bareClient(1);
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot({
      ents: [
        {
          id: 3,
          k: 'player',
          nm: 'Well',
          lv: 12,
          x: 0,
          y: 0,
          z: 0,
          f: 0,
          hp: 40,
          mhp: 40,
          auras: [
            { id: 'test_buff', name: 'Test Buff', kind: 'buff_ap', rem: 30, dur: 30, value: 5 },
          ],
        },
      ],
    });
    const mirrored = client.entities.get(3)?.auras.find((a) => a.id === 'test_buff');
    expect(mirrored?.undispellable).toBeUndefined();
    expect(isPlayerRemovableAura(mirrored as Aura)).toBe(true);
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

// The arena/fiesta clean slate wipes every aura outright (readyArenaFighter), which
// is deliberate: nobody should fight a normalized bout at a quarter of their stats.
// But the wipe also meant one queue laundered the whole penalty, so the debt is now
// stashed in preMatchPools and handed back on the way out (restoreArenaReturnPools).

// Seat a real ranked bout, at a level where a sickness has a non-zero duration
// (applySickness is a no-op below level 10, which is what makes the level matter here).
function seatArenaBout(): { sim: AnySim; a: number; b: number } {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  }) as AnySim;
  const a = sim.addPlayer('warrior', 'Aleph') as number;
  const b = sim.addPlayer('mage', 'Bet') as number;
  for (const [pid, x] of [
    [a, 0],
    [b, 6],
  ] as const) {
    sim.setPlayerLevel(12, pid);
    const e = sim.entities.get(pid) as Entity;
    e.pos.x = x;
    e.pos.z = -40;
    e.pos.y = groundHeight(x, -40, sim.cfg.seed);
    e.prevPos = { ...e.pos };
    sim.rebucket(e);
  }
  return { sim, a, b };
}

// End the bout decisively and run out the return delay that hands the survivor back
// to the world. The pre-fight countdown has to run out first: a bout only resolves
// once it is active, so killing during the countdown just waits out the 150s cap.
function finishArenaBout(sim: AnySim, winnerPid: number, loserPid: number): void {
  for (let i = 0; i < 20 * 10; i++) {
    if (sim.arenaMatchFor(winnerPid)?.state === 'active') break;
    sim.tick();
  }
  expect(sim.arenaMatchFor(winnerPid)?.state).toBe('active');
  const winner = sim.entities.get(winnerPid) as Entity;
  const loser = sim.entities.get(loserPid) as Entity;
  loser.hp = 1;
  sim.dealDamage(winner, loser, 1000, false, 'physical', 'Test', 'hit');
  for (let i = 0; i < 20 * 60 && sim.arenaMatchFor(winnerPid); i++) sim.tick();
  expect(sim.arenaMatchFor(winnerPid)).toBeNull();
}

describe('an arena bout is a parenthesis, not a way to shed a sickness', () => {
  it.each(['resurrection', 'unstuck'] as const)(
    'clears %s sickness for the bout and hands it back on return',
    (which) => {
      const { sim, a, b } = seatArenaBout();
      const sick = sim.entities.get(a) as Entity;
      sicken(sim, sick, which);
      const owed = sicknessAura(sick, which).remaining;

      sim.arenaQueueJoin(a);
      sim.arenaQueueJoin(b);
      sim.tick(); // matchmaking seats the pair
      // The clean slate is intact for the bout itself: this half is the pre-existing
      // behavior the fix deliberately preserves.
      expect(has(sick, idOf(which))).toBe(false);

      finishArenaBout(sim, a, b);

      // The debt came back, and never more than the fighter owed walking in.
      expect(has(sick, idOf(which))).toBe(true);
      const returned = sicknessAura(sick, which);
      expect(returned.remaining).toBeGreaterThan(0);
      expect(returned.remaining).toBeLessThanOrEqual(owed);
      expect(returned.undispellable).toBe(true);
    },
  );

  it('leaves a fighter who entered healthy healthy on return', () => {
    const { sim, a, b } = seatArenaBout();
    sim.arenaQueueJoin(a);
    sim.arenaQueueJoin(b);
    sim.tick();
    finishArenaBout(sim, a, b);
    const winner = sim.entities.get(a) as Entity;
    expect(winner.auras.some((aura) => SICKNESS_AURA_IDS.has(aura.id))).toBe(false);
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

  // Persistence stores only the remaining seconds and restores through the same
  // applySickness funnel, so the flag cannot be lost across a relog by construction.
  // This pins that construction: a future refactor that rebuilds the aura literal at
  // the restore site instead of calling applySickness fails here.
  it.each(['resurrection', 'unstuck'] as const)(
    'restores %s sickness flagged when a saved remaining is replayed',
    (which) => {
      const { sim, p } = rig('mage', 'mag_r8_warded');
      const restore = which === 'resurrection' ? applyResurrectionSickness : applyUnstuckSickness;
      restore(sim.ctx, p, 42);
      const aura = sicknessAura(p, which);
      expect(aura.remaining).toBe(42);
      expect(aura.undispellable).toBe(true);
    },
  );

  it('refuses the right-click cancel a player could try on the buff bar', () => {
    const { sim, p } = rig('mage', 'mag_r8_warded');
    sicken(sim, p, 'resurrection');
    sim.cancelAura(RESURRECTION_SICKNESS_ID);
    expect(has(p, RESURRECTION_SICKNESS_ID)).toBe(true);
  });
});
