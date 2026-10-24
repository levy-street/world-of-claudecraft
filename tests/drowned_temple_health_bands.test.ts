// The Drowned Temple on the owner's heroic health bands (2026-10-12): on heroic
// every non-final boss carries about 25,000. Choirmother Selthe goes to about
// 25,000 and the Mere Hydra, a boss by the owner's ruling, to about 25,000
// across its three heads (8,333 a head, where a head had 4,306). The Tideglass
// Colossus (23,003) already sits beside the band and Ysolei, the final boss, is
// untouched, as is every normal pool (the Hydra's 2,000 a head included). A
// head that regrows on heroic still stands up with the 2,153 it always had.
// Health only: melee, mechanic factors and armor are the shipped numbers. Read
// from live spawns in a real claim, and the regrowth driven through real ticks.

import { describe, expect, it, vi } from 'vitest';
import {
  HYDRA_CENTER_ID,
  HYDRA_LEFT_ID,
  HYDRA_RIGHT_ID,
  HYDRA_TUNING,
  POOL,
} from '../src/sim/encounters/drowned_temple';
import { HEROIC_BOSS_BAND, type LivePool, livePools } from './helpers/dungeon_pools';
import { boss, engage, fight, put, run } from './helpers/temple_fight';

vi.setConfig({ testTimeout: 300_000 });

const HEADS = ['mere_hydra_head_left', 'mere_hydra_head_center', 'mere_hydra_head_right'];
const HEAD_HEROIC: LivePool = { hp: 8333, weapon: [1422, 2221], mech: 6, armor: 630 };
const HEAD_NORMAL: LivePool = { hp: 2000, weapon: [69, 108], mech: undefined, armor: 384 };

const HEROIC: Record<string, LivePool> = {
  // Choirmother Selthe: was 20,650.
  choirmother_selthe: { hp: 25004, weapon: [1360, 2125], mech: 4.5, armor: 578 },
  // Untouched: the Colossus beside the band, Ysolei the final boss.
  tideglass_colossus: { hp: 23003, weapon: [1422, 2221], mech: 5, armor: 788 },
  ysolei: { hp: 34497, weapon: [1483, 2317], mech: 5, armor: 735 },
};

const NORMAL: Record<string, LivePool> = {
  choirmother_selthe: { hp: 9899, weapon: [63, 98], mech: undefined, armor: 330 },
  tideglass_colossus: { hp: 11495, weapon: [69, 108], mech: undefined, armor: 480 },
  ysolei: { hp: 17994, weapon: [76, 119], mech: undefined, armor: 476 },
};

describe('Drowned Temple pools read from live spawns', () => {
  const heroic = livePools('drowned_temple', 'heroic');
  const normal = livePools('drowned_temple', 'normal');

  it('pins every heroic pool with its shipped melee, mechanic factor and armor', () => {
    for (const [id, row] of Object.entries(HEROIC)) expect(heroic[id], id).toEqual(row);
    // Each head was 4,306.
    for (const id of HEADS) expect(heroic[id], id).toEqual(HEAD_HEROIC);
  });

  it('pins every normal pool with its shipped melee, mechanic factor and armor', () => {
    for (const [id, row] of Object.entries(NORMAL)) expect(normal[id], id).toEqual(row);
    for (const id of HEADS) expect(normal[id], id).toEqual(HEAD_NORMAL);
  });

  it('holds Selthe and the whole Hydra in the heroic boss band', () => {
    expect(heroic.choirmother_selthe.hp).toBeGreaterThanOrEqual(HEROIC_BOSS_BAND.min);
    expect(heroic.choirmother_selthe.hp).toBeLessThanOrEqual(HEROIC_BOSS_BAND.max);
    const hydra = HEADS.reduce((sum, id) => sum + heroic[id].hp, 0);
    expect(hydra).toBe(24999);
    expect(hydra).toBeGreaterThanOrEqual(HEROIC_BOSS_BAND.min);
    expect(hydra).toBeLessThanOrEqual(HEROIC_BOSS_BAND.max);
    expect(heroic.ysolei.hp).toBeGreaterThan(HEROIC_BOSS_BAND.max);
  });
});

for (const difficulty of ['normal', 'heroic'] as const) {
  describe(`the Mere Hydra regrows a head with the health it always had (${difficulty})`, () => {
    it('stands a fallen head back up 20 s later, through the real fight', () => {
      const f = fight(difficulty);
      const heads = [HYDRA_LEFT_ID, HYDRA_CENTER_ID, HYDRA_RIGHT_ID].map((id) => boss(f, id));
      put(f, f.tank, POOL.x, POOL.z - 2);
      put(f, f.others[0], POOL.x - 12, POOL.z - 12);
      put(f, f.others[1], POOL.x + 12, POOL.z - 12);
      const spots = [f.tank, ...f.others].map((p) => [p, p.pos.x - f.ox, p.pos.z - f.oz] as const);
      const hold = () => {
        for (const [p, x, z] of spots) put(f, p, x, z);
      };
      // The live pools, untouched by the harness.
      for (const h of heads) engage(f, h, 0);
      const pool = heads[2].maxHp;
      expect(pool).toBe(difficulty === 'heroic' ? 8333 : 2000);
      run(f, 0.2, hold);
      f.sim.ctx.handleDeath(heads[2], f.tank);
      run(f, 0.2, hold);
      const st = heads[0].templeFight;
      if (st?.kind !== 'hydra') throw new Error('no hydra fight');
      // A second before it regrows (the 20 s are not simulated; the Tsunami,
      // which holds a regrowth, is kept away).
      st.diedAt[2] = (st.diedAt[2] ?? 0) - (HYDRA_TUNING.regrowAfter - 1);
      st.tsunamiTimer = 30;
      run(f, 0.5, hold);
      expect(heads[2].dead).toBe(true);
      run(f, 0.7, hold);
      expect(heads[2].dead).toBe(false);
      // Half of 2,000 on normal; on heroic the half of the 4,306 a head had.
      // Literals on purpose: a retune of the heroic head pool or of
      // HYDRA_TUNING.regrowShareHeroic that moves this number has to move it here.
      expect(heads[2].hp).toBe(difficulty === 'heroic' ? 2153 : 1000);
    });
  });
}
