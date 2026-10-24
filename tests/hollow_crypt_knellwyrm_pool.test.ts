// The Knellwyrm's health (playtest, 2026-10-12: "Dragon Morthen had 700 hp?").
// The finale spawned on its bare template (1,081 on normal, 7,254 on heroic):
// dead in about 20 s on normal, before its first Dread Bellow. On heroic its
// pool is set the way every Crypt boss's is, fight length x planning party DPS
// (dungeon_difficulty.ts): 80 s x 230. On normal it follows the owner's rule
// for minibosses (2026-10-12): clearly less than every boss of its dungeon, at
// most three quarters of the weakest (Sexton Marrow). Read from the live
// summon in a real claimed crypt, then fought for real at the planning DPS:
// every one of its mechanics comes round before it falls.

import { describe, expect, it, vi } from 'vitest';
import {
  KNELLWYRM_BARED_RIBS,
  KNELLWYRM_DREAD_BELLOW,
  KNELLWYRM_ID,
  KNELLWYRM_KNELL_MARK,
  KNELLWYRM_PYRE_STRAFE,
  MORTHEN_ID,
  MORTHEN_SPOT,
} from '../src/sim/encounters/hollow_crypt';
import { BOSS_CORPSE_HOLD_SECONDS } from '../src/sim/mob/boss_corpse_hold';
import {
  CRYPT_BARROWFLAME_BREATH,
  CRYPT_TAIL_LASH,
  CRYPT_WING_GUST,
} from '../src/sim/mob/trash_kit/cast_ids';
import { DT, type Entity } from '../src/sim/types';
import { boss, cryptFight, type Fight, put, run, tick } from './helpers/crypt_boss_fight';
import { livePools, NORMAL_MINIBOSS_SHARE } from './helpers/dungeon_pools';

vi.setConfig({ testTimeout: 300_000 });

/** The planning numbers: the party's pace, and the heroic pool's length. */
const HEROIC_FIGHT_SECONDS = 80;
const PARTY_DPS = { normal: 55, heroic: 230 } as const;
/** The live pool (dungeon_difficulty.ts 2.18 and 9.64). */
const POOL = { normal: 2357, heroic: 18403 } as const;
/** What it spawned with before: its bare template. */
const BARE = { normal: 1081, heroic: 7254 } as const;
/** Its melee and mechanic factor, untouched. */
const DAMAGE = {
  normal: { weapon: [43, 68], mech: undefined },
  heroic: { weapon: [1675, 2618], mech: 20 },
} as const;

/** Kill Morthen and let his dying rite bring the wyrm down to fight. */
function summon(difficulty: 'normal' | 'heroic'): { f: Fight; wyrm: Entity; hold: () => void } {
  const f = cryptFight(difficulty, 4, new Set([MORTHEN_ID]));
  const morthen = boss(f, MORTHEN_ID);
  const party = [f.tank, ...f.others];
  // Round the pyre: the tank before it, one behind (its tail), two on its flanks.
  const spots = [
    [MORTHEN_SPOT.x, MORTHEN_SPOT.z - 8],
    [MORTHEN_SPOT.x, MORTHEN_SPOT.z + 8],
    [MORTHEN_SPOT.x - 8.5, MORTHEN_SPOT.z],
    [MORTHEN_SPOT.x + 8.5, MORTHEN_SPOT.z],
    [MORTHEN_SPOT.x - 6, MORTHEN_SPOT.z - 6],
  ];
  const hold = () => {
    for (const [i, p] of party.entries()) put(f, p, spots[i][0], spots[i][1]);
  };
  hold();
  f.sim.chat('/dev crypt rise skip', f.tank.id);
  run(f, 0.5, hold);
  f.sim.ctx.handleDeath(morthen, f.tank);
  let wyrm: Entity | undefined;
  for (let t = 0; t < 20 && !wyrm?.knellwyrmFight; t += DT) {
    tick(f, hold);
    wyrm = [...f.sim.ctx.entities.values()].find((e) => e.templateId === KNELLWYRM_ID);
  }
  if (!wyrm?.knellwyrmFight) throw new Error('the Knellwyrm never joined the fight');
  return { f, wyrm, hold };
}

interface Fought {
  f: Fight;
  wyrm: Entity;
  seconds: number;
  casts: Set<string>;
  bared: boolean;
}

/** A real kill: the party deals `pace` times the planning DPS through the
 *  damage path, twice a second, until it falls. */
function fight(difficulty: 'normal' | 'heroic', pace: number): Fought {
  const { f, wyrm, hold } = summon(difficulty);
  const party = [f.tank, ...f.others];
  const chunk = (PARTY_DPS[difficulty] * pace * 0.5) / party.length;
  const casts = new Set<string>();
  let bared = false;
  let ticks = 0;
  for (; ticks < 200 / DT && !wyrm.dead; ticks++) {
    if (ticks % 10 === 0) {
      for (const p of party) {
        if (wyrm.dead) break;
        f.sim.ctx.dealDamage(p, wyrm, chunk, false, 'physical', null, 'hit', false, {
          mult: p === f.tank ? 8 : 1,
        });
      }
    }
    tick(f, hold);
    if (wyrm.castingAbility) casts.add(wyrm.castingAbility);
    if (wyrm.auras.some((a) => a.id === KNELLWYRM_BARED_RIBS)) bared = true;
  }
  expect(wyrm.dead).toBe(true);
  return { f, wyrm, seconds: ticks * DT, casts, bared };
}

/** Every mechanic came round at least once. */
function expectWholeKit(fought: Fought, difficulty: 'normal' | 'heroic'): void {
  const { casts, bared } = fought;
  // The drake kit on its template...
  expect(casts).toContain(CRYPT_BARROWFLAME_BREATH);
  expect(casts).toContain(CRYPT_TAIL_LASH);
  expect(casts).toContain(CRYPT_WING_GUST);
  // ...its own Pyre Strafe and Dread Bellow (and the Bared Ribs window)...
  expect(casts).toContain(KNELLWYRM_PYRE_STRAFE);
  expect(casts).toContain(KNELLWYRM_DREAD_BELLOW);
  expect(bared).toBe(true);
  // ...and on heroic the Burning Knell.
  expect(casts.has(KNELLWYRM_KNELL_MARK)).toBe(difficulty === 'heroic');
}

for (const difficulty of ['normal', 'heroic'] as const) {
  describe(`the Knellwyrm (${difficulty})`, () => {
    it('lands with its derived pool and fights a whole fight at the planning DPS', () => {
      const fought = fight(difficulty, 1);
      const { wyrm, seconds } = fought;
      expect(wyrm.maxHp).toBe(POOL[difficulty]);
      // More than the doubling the playtest asked of the minibosses.
      expect(wyrm.maxHp).toBeGreaterThan(BARE[difficulty] * 2);
      if (difficulty === 'heroic') {
        // 80 s of the planning party's damage, to the template's rounding...
        const planned = HEROIC_FIGHT_SECONDS * PARTY_DPS.heroic;
        expect(Math.abs(wyrm.maxHp - planned) / planned).toBeLessThan(0.005);
        // ...which is a miniboss's: inside 15,000 to 20,000, under the bosses' 25,000.
        expect(wyrm.maxHp).toBeGreaterThanOrEqual(15_000);
        expect(wyrm.maxHp).toBeLessThanOrEqual(20_000);
      } else {
        // A miniboss: three quarters of the Crypt's weakest boss or less.
        const marrow = livePools('hollow_crypt', 'normal').sexton_marrow.hp;
        expect(marrow).toBe(3152);
        expect(wyrm.maxHp).toBeLessThanOrEqual(marrow * NORMAL_MINIBOSS_SHARE);
      }
      // Health only: its melee and its mechanic factor are the shipped ones.
      expect([wyrm.weapon?.min, wyrm.weapon?.max]).toEqual(DAMAGE[difficulty].weapon);
      expect(wyrm.mechanicDamageMult).toBe(DAMAGE[difficulty].mech);
      // Its purse waits on the body for the boss hold, not the trash minute.
      expect(wyrm.lootable).toBe(true);
      expect(wyrm.corpseTimer).toBeGreaterThan(BOSS_CORPSE_HOLD_SECONDS - 5);
      // A finale, not a formality, and done inside the budget: over a minute
      // on heroic (its Burning Knell is flown out of reach), and on normal
      // long enough for the Dread Bellow to land (26 s) with time to spare.
      expect(seconds).toBeGreaterThan(difficulty === 'heroic' ? 60 : 32);
      expect(seconds).toBeLessThan(difficulty === 'heroic' ? 150 : 50);
      expectWholeKit(fought, difficulty);
    });

    it('meets a party at twice the planning DPS with what its pool allows', () => {
      const fought = fight(difficulty, 2);
      if (difficulty === 'heroic') {
        // Half the fight on the ground (the Knell flies on top of it): every
        // mechanic still comes round.
        expect(fought.seconds).toBeGreaterThan(26);
        expect(fought.seconds).toBeLessThan(80);
        expectWholeKit(fought, difficulty);
        return;
      }
      // Normal: a miniboss's pool does not promise the Dread Bellow (it lands
      // at 26 s) at twice the pace. The drake kit and the Pyre Strafe (marked
      // at 14 s) still come round.
      expect(fought.seconds).toBeGreaterThan(18);
      expect(fought.seconds).toBeLessThan(26);
      expect(fought.casts).toContain(CRYPT_BARROWFLAME_BREATH);
      expect(fought.casts).toContain(CRYPT_TAIL_LASH);
      expect(fought.casts).toContain(CRYPT_WING_GUST);
      expect(fought.casts).toContain(KNELLWYRM_PYRE_STRAFE);
    });
  });
}
