// Mountain's Wrath on Heroic and Mythic kills ANYONE it finds unhidden (the
// owner's review of 2026-11-09, docs/design/raid/smith_heart.md section 7.1):
// cloth, leather, mail and a tank without a defensive die; a tank under a
// strong defensive (40 to 50 percent) lives on a sliver, Memory of Stone
// included; an immunity takes none of it; Normal keeps its numbers; the
// inherited Wrath (the Seam Singer's) stays a must-shelter but never a sure
// kill on a full cloth body. Over REAL Sim claims.

import { describe, expect, it } from 'vitest';
import { HAMMER_PIT } from '../src/sim/content/smith_heart_layout';
import {
  COUNCIL_DIFFICULTY,
  COUNCIL_NAMES,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { type Aura, DT, type Entity, type SimEvent } from '../src/sim/types';
import { type CouncilFight, councilFight, hitsOf } from './helpers/council_fight';

/** A Heroic-geared (the bots' `/dev bis`) level-20 body: the fire mage 1,335
 *  (the lowest in the raid), the protection warrior 2,732 and paladin 2,658
 *  (measured headless, Power Word: Fortitude adds about 3 percent). */
const CLOTH = 1335;
const LEATHER = 1570;
const TANK = 2800;
const ticks = (s: number) => Math.round(s / DT);

function council(tier: 'normal' | 'heroic' | 'mythic', seed = 17): CouncilFight {
  const f = councilFight(4, seed);
  f.dev('/dev heart council pull');
  f.tick();
  if (tier !== 'normal') expect(f.dev(`/dev heart council ${tier} on`)).toBe(true);
  const st = f.state();
  if (!st) throw new Error('the council did not pull');
  st.weightTimer = 999;
  st.wakeTimer = 999;
  st.rockTimer = 999;
  st.boltTimer = 999;
  st.songTimer = 999;
  st.rushTimer = 999;
  st.songDue = null;
  return f;
}

function aura(f: CouncilFight, p: Entity, kind: Aura['kind'], value: number, id: string): void {
  f.sim.ctx.applyAura(p, {
    id,
    name: id,
    kind,
    remaining: 30,
    duration: 30,
    value,
    sourceId: p.id,
    school: 'physical',
  });
}

/** Every player in the open by the caster at the pit's middle, each at its
 *  own pool, through one landed Wrath (the plain sim tick: no top-up). */
function openWrath(
  f: CouncilFight,
  pools: readonly number[],
  dress: (p: Entity, i: number) => void = () => {},
  caster: 'guardian' | 'singer' = 'guardian',
): { ev: SimEvent[]; open: Entity[] } {
  const c = f.bodies()[caster] as Entity;
  const w = f.world(HAMMER_PIT.x, HAMMER_PIT.z);
  c.pos.x = w.x;
  c.pos.z = w.z;
  c.pos.y = f.sim.ctx.groundPos(w.x, w.z).y;
  c.prevPos = { ...c.pos };
  f.sim.ctx.rebucket(c);
  for (const p of f.pillars()) f.sim.ctx.dropEntity(p.e.id);
  f.inst.objectIds = f.inst.objectIds.filter((id) => f.sim.ctx.entities.has(id));
  const open = f.players.slice(0, pools.length);
  open.forEach((p, i) => {
    f.put(p, HAMMER_PIT.x + 6 + i, HAMMER_PIT.z + 4);
    // Dressed first: an aura recomputes the stats, the pool is set after.
    dress(p, i);
    p.maxHp = pools[i];
    p.hp = pools[i];
  });
  expect(f.dev('/dev heart council wrath')).toBe(true);
  const cast = caster === 'guardian' ? T.wrathCast : T.heirWrathCast;
  const ev: SimEvent[] = [];
  for (let i = 0; i < ticks(cast) + 2; i++) ev.push(...f.sim.tick());
  return { ev, open };
}

function killGuardianFirst(f: CouncilFight): void {
  f.sim.ctx.handleDeath(f.bodies().guardian as Entity, f.players[3]);
  f.tick();
}

describe("Mountain's Wrath: Heroic and Mythic kill whoever no pillar hides", () => {
  it('the rows: Heroic and Mythic share the factor, Normal keeps 1', () => {
    expect(COUNCIL_DIFFICULTY.normal.wrathMult).toBe(1);
    expect(COUNCIL_DIFFICULTY.normal.heirWrathMult).toBe(1);
    expect(COUNCIL_DIFFICULTY.normal.crowdShare).toBe(0.5);
    // Mythic at least as hard as Heroic (it was weaker before the review).
    expect(COUNCIL_DIFFICULTY.mythic.wrathMult).toBeGreaterThanOrEqual(
      COUNCIL_DIFFICULTY.heroic.wrathMult,
    );
    expect(COUNCIL_DIFFICULTY.mythic.heirWrathMult).toBeGreaterThanOrEqual(
      COUNCIL_DIFFICULTY.heroic.heirWrathMult,
    );
    // An undefended tank in Defensive Stance (10 percent less) still dies to
    // the lowest roll; the highest, with Memory of Stone, under a 40 percent
    // cut in stance, leaves the tank standing.
    for (const tier of ['heroic', 'mythic'] as const) {
      const r = COUNCIL_DIFFICULTY[tier];
      const lo = T.wrathMin * r.damageMult * r.wrathMult;
      const hi = T.wrathMax * r.damageMult * r.wrathMult;
      expect(lo * 0.9, tier).toBeGreaterThan(TANK);
      expect(hi * (1 + T.memoryPerFallen) * 0.9 * 0.6, tier).toBeLessThan(TANK * 0.95);
    }
  });

  for (const tier of ['heroic', 'mythic'] as const) {
    it(`${tier}: cloth, leather and an undefended tank (in stance) all die`, () => {
      const f = council(tier);
      const { ev, open } = openWrath(f, [CLOTH, LEATHER, TANK], (p, i) => {
        if (i === 2) aura(f, p, 'defensive_stance', 0, 'defensive_stance');
      });
      for (const p of open) {
        expect(hitsOf(ev, COUNCIL_NAMES.wrath, p.id).length, p.name).toBe(1);
        expect(p.dead, p.name).toBe(true);
      }
    });

    it(`${tier}: a tank under a strong defensive lives, on a sliver`, () => {
      for (const seed of [17, 23, 41]) {
        const f = council(tier, seed);
        const { ev, open } = openWrath(f, [TANK, TANK], (p, i) => {
          aura(f, p, 'defensive_stance', 0, 'defensive_stance');
          // A 50 percent physical cut (Raised Guard) and a 40 percent ward
          // (Martyr's Aegis).
          if (i === 0) aura(f, p, 'buff_dr_phys', 0.5, 'raised_guard');
          else aura(f, p, 'shield_wall', 0.4, 'martyrs_aegis');
        });
        for (const p of open) {
          expect(hitsOf(ev, COUNCIL_NAMES.wrath, p.id).length, p.name).toBe(1);
          expect(p.dead, `${p.name} seed ${seed}`).toBe(false);
          // A sliver: the blow still takes a third or more of the pool.
          expect(p.hp, p.name).toBeLessThan(TANK * 0.67);
        }
        // The 40 percent ward is the thin one: under a third left at most.
        expect(open[1].hp).toBeLessThan(TANK * 0.3);
      }
    });

    it(`${tier}: an immunity takes none of it`, () => {
      const f = council(tier);
      const { ev, open } = openWrath(f, [CLOTH, CLOTH], (p, i) => {
        if (i === 0) aura(f, p, 'stasis', 0, 'ice_block');
        else p.damageImmune = true;
      });
      for (const p of open) {
        expect(p.dead, p.name).toBe(false);
        expect(p.hp, p.name).toBe(CLOTH);
        expect(hitsOf(ev, COUNCIL_NAMES.wrath, p.id).every((a) => a === 0)).toBe(true);
      }
    });
  }

  it('normal: unchanged, 440 to 520 and the cloth body lives', () => {
    const f = council('normal');
    const { ev, open } = openWrath(f, [CLOTH, CLOTH, CLOTH]);
    for (const p of open) {
      const [hit] = hitsOf(ev, COUNCIL_NAMES.wrath, p.id);
      expect(hit).toBeGreaterThanOrEqual(T.wrathMin);
      expect(hit).toBeLessThanOrEqual(T.wrathMax);
      expect(p.dead).toBe(false);
    }
  });

  it("heroic: with the Guardian fallen, the Singer's Wrath is a must-shelter, never a sure kill", () => {
    for (const seed of [17, 23, 41, 59]) {
      const f = council('heroic', seed);
      killGuardianFirst(f);
      const { ev, open } = openWrath(f, [CLOTH, CLOTH, CLOTH], () => {}, 'singer');
      for (const p of open) {
        const [hit] = hitsOf(ev, COUNCIL_NAMES.wrath, p.id);
        // Memory of Stone included: over 70 percent of the body, never all.
        expect(hit, `seed ${seed}`).toBeGreaterThan(CLOTH * 0.7);
        // (Her melee swing may land on her target in the same breath: the
        // Wrath's own blow is the claim.)
        expect(hit, `seed ${seed}`).toBeLessThan(CLOTH);
      }
    }
  });

  it('mythic: the heir is at least as hard as heroic', () => {
    const h = COUNCIL_DIFFICULTY.heroic;
    const m = COUNCIL_DIFFICULTY.mythic;
    expect(m.damageMult * m.heirWrathMult).toBeGreaterThanOrEqual(h.damageMult * h.heirWrathMult);
    expect(T.heirWrathMax * m.damageMult * m.heirWrathMult * (1 + T.memoryPerFallen)).toBeLessThan(
      CLOTH,
    );
  });
});
