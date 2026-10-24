// Knight-Commander Olen, the fallen paladin (src/sim/encounters/sunken_bastion/
// olen.ts): the Hallowed Brine the tank drags him out of, the Rebounding
// Bulwark that punishes a stacked group, the Sentence of the Tide the mark
// takes away from the group, the Unbroken Oath at half health and its two
// soldiers, the heroic numbers, the wipe and the deed. Full Sim ticks in a
// real claimed Bastion.

import { describe, expect, it, vi } from 'vitest';
import { BREACH_BASTION } from '../src/sim/content/sunken_bastion_layout';
import { DUNGEONS } from '../src/sim/data';
import {
  bulwarkChain,
  HALLOWED_BRINE_TEMPLATE,
  OLEN_BREACHED,
  OLEN_BREACHED_VULN,
  OLEN_BRINE_HALLOWED,
  OLEN_DEED,
  OLEN_HALLOWED_BRINE,
  OLEN_ID,
  OLEN_IN_BRINE,
  OLEN_KIT,
  OLEN_OATH_KNEEL,
  OLEN_OATH_VIGIL,
  OLEN_REBOUNDING_BULWARK,
  OLEN_SENTENCED,
  OLEN_SOLDIER_ID,
  OLEN_TIDE_SENTENCE,
  OLEN_UNBROKEN_OATH,
} from '../src/sim/encounters/sunken_bastion';
import { DT, type Entity } from '../src/sim/types';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';
import {
  aura,
  boss,
  earned,
  type Fight,
  fight,
  live,
  put,
  run,
  took,
  until,
} from './helpers/bastion_fight';

vi.setConfig({ testTimeout: 60_000 });

const T = OLEN_KIT;
const KEEP_OLEN = new Set([OLEN_ID]);
/** The Breach Bastion's middle (instance-local). */
const MID = { x: 57, z: 130 };

function olenFight(
  difficulty: 'normal' | 'heroic' = 'normal',
  extra = 3,
): { f: Fight; olen: Entity } {
  const f = fight(difficulty, extra, KEEP_OLEN);
  const olen = boss(f, OLEN_ID);
  put(f, olen, MID.x, MID.z);
  put(f, f.tank, MID.x, MID.z - 3);
  // Spread far apart by default: no rebound, no splash.
  const spots = [
    [MID.x - 14, MID.z + 8],
    [MID.x + 14, MID.z + 8],
    [MID.x, MID.z + 16],
  ];
  for (const [i, p] of f.others.entries()) put(f, p, spots[i][0], spots[i][1]);
  olen.maxHp = 1e6;
  olen.hp = olen.maxHp;
  f.sim.ctx.aggroMob(olen, f.tank, false);
  return { f, olen };
}

function holdAll(f: Fight): () => void {
  const hold = [f.tank, ...f.others].map((p) => [p, p.pos.x - f.ox, p.pos.z - f.oz] as const);
  return () => {
    for (const [p, x, z] of hold) put(f, p, x, z);
  };
}

function pools(f: Fight): Entity[] {
  return f.inst.objectIds
    .map((id) => f.sim.ctx.entities.get(id))
    .filter((e): e is Entity => e?.templateId === HALLOWED_BRINE_TEMPLATE);
}

describe('Olen the fallen paladin: the pure rebound order', () => {
  it('rebounds to the nearest player not yet struck within reach, ties to the lower id', () => {
    const a = { id: 1, x: 0, z: 0 };
    const others = [
      { id: 2, x: 6, z: 0 },
      { id: 3, x: 3, z: 0 },
      { id: 4, x: 30, z: 0 },
      { id: 5, x: 9, z: 0 },
    ];
    expect(bulwarkChain(a, others, 10, 3)).toEqual([1, 3, 2]);
    expect(bulwarkChain(a, others, 10, 9)).toEqual([1, 3, 2, 5]);
    expect(bulwarkChain(a, [{ id: 9, x: 11, z: 0 }], 10, 3)).toEqual([1]);
    expect(
      bulwarkChain(
        a,
        [
          { id: 8, x: 0, z: 4 },
          { id: 7, x: 4, z: 0 },
        ],
        10,
        2,
      ),
    ).toEqual([1, 7]);
  });
});

describe('Olen the fallen paladin: Hallowed Brine', () => {
  it('drives his sword in, the pool burns whoever stands in it, shields him, and dries', () => {
    const { f, olen } = olenFight();
    const keep = holdAll(f);
    expect(
      until(f, () => olen.castingAbility === OLEN_HALLOWED_BRINE, T.brineFirst + 1, keep),
    ).toBe(true);
    expect(olen.castTotal).toBeCloseTo(T.brineCast, 5);
    expect(until(f, () => pools(f).length === 1, T.brineCast + 0.2, keep)).toBe(true);
    const pool = pools(f)[0];
    expect(Math.hypot(pool.pos.x - olen.pos.x, pool.pos.z - olen.pos.z)).toBeLessThan(0.5);
    expect(pool.scale).toBe(T.brineRadius);
    // The tank stands in it with him; the others stand far off.
    const from = f.hits.length;
    run(f, 2.05, keep);
    expect(took(f, f.tank, 'Hallowed Brine', from)).toBe(2 * T.brinePerSecond);
    expect(aura(f.tank, OLEN_IN_BRINE)).toBeDefined();
    for (const p of f.others) expect(took(f, p, 'Hallowed Brine', from)).toBe(0);
    // In his own brine he sheds 40 percent; dragged out, nothing.
    expect(aura(olen, OLEN_BRINE_HALLOWED)?.value).toBe(T.brineShield);
    let hp = olen.hp;
    f.sim.dealDamage(f.tank, olen, 1000, false, 'shadow', 'Strike', 'hit', true);
    expect(hp - olen.hp).toBe(600);
    const out = () => {
      keep();
      put(f, olen, MID.x + 12, MID.z - 10);
    };
    run(f, DT * 2, out);
    expect(aura(olen, OLEN_BRINE_HALLOWED)).toBeUndefined();
    hp = olen.hp;
    f.sim.dealDamage(f.tank, olen, 1000, false, 'shadow', 'Strike', 'hit', true);
    expect(hp - olen.hp).toBe(1000);
    // The pool dries after its 15 s.
    run(f, T.brineSeconds, out);
    expect(f.sim.ctx.entities.has(pool.id)).toBe(false);
  });
});

describe('Olen the fallen paladin: the brine reaches 9 yd (10 heroic)', () => {
  function reachTest(difficulty: 'normal' | 'heroic', radius: number): void {
    const { f, olen } = olenFight(difficulty);
    const [inside, outside] = f.others;
    // One just inside the rim, one just outside it (west and east of him).
    const keep = () => {
      put(f, olen, MID.x, MID.z);
      put(f, f.tank, MID.x, MID.z - 3);
      put(f, inside, MID.x - (radius - 0.5), MID.z);
      put(f, outside, MID.x + radius + 0.5, MID.z);
    };
    expect(until(f, () => pools(f).length === 1, T.brineFirst + T.brineCast + 1, keep)).toBe(true);
    expect(pools(f)[0].scale).toBe(radius);
    const from = f.hits.length;
    run(f, 2.05, keep);
    expect(took(f, inside, 'Hallowed Brine', from)).toBeGreaterThan(0);
    expect(aura(inside, OLEN_IN_BRINE)).toBeDefined();
    expect(took(f, outside, 'Hallowed Brine', from)).toBe(0);
    expect(aura(outside, OLEN_IN_BRINE)).toBeUndefined();
  }

  it('normal: a 9 yd pool', () => {
    expect(T.brineRadius).toBe(9);
    reachTest('normal', T.brineRadius);
  });

  it('heroic: a 10 yd pool', () => {
    expect(T.brineRadiusHeroic).toBe(10);
    reachTest('heroic', T.brineRadiusHeroic);
  });

  it('fits his arena: from his spawn the pool leaves room to drag him out', () => {
    const spawn = DUNGEONS.sunken_bastion.spawns.find((sp) => sp.mobId === OLEN_ID);
    if (!spawn) throw new Error('no Olen spawn');
    const off = Math.hypot(spawn.x - BREACH_BASTION.x, spawn.z - BREACH_BASTION.z);
    // Past the heroic pool's rim there is still a long walk of open floor.
    expect(BREACH_BASTION.r - off - T.brineRadiusHeroic).toBeGreaterThanOrEqual(8);
  });

  it('the finder line states the live radius, damage and shield', () => {
    const line = hudChromeStrings.finder.mech.hallowed_brine;
    expect(line).toContain(`${T.brineRadius} yard`);
    expect(line).toContain(`${T.brineRadiusHeroic} on heroic`);
    expect(line).toContain(`${T.brinePerSecond} damage a second`);
    expect(line).toContain(`${T.brinePerSecondHeroic} on heroic`);
    expect(line).toContain(`${Math.round(T.brineShield * 100)} percent`);
  });
});

describe('Olen the fallen paladin: Rebounding Bulwark', () => {
  function shieldOn(f: Fight, olen: Entity, keep: () => void): void {
    const st = olen.bastionFight;
    if (st?.kind === 'olen') {
      st.brineTimer = 99;
      st.sentenceTimer = 99;
    }
    expect(
      until(f, () => olen.castingAbility === OLEN_REBOUNDING_BULWARK, T.bulwarkFirst + 2, keep),
    ).toBe(true);
  }

  it('a spread group: it strikes its mark alone and flies home', () => {
    const { f, olen } = olenFight();
    const keep = holdAll(f);
    run(f, DT, keep);
    shieldOn(f, olen, keep);
    const mark = f.sim.ctx.entities.get(olen.castTargetId ?? -1) as Entity;
    expect(mark).not.toBe(f.tank);
    const from = f.hits.length;
    run(f, T.bulwarkCast + T.bulwarkHop * 4, keep);
    const struck = [f.tank, ...f.others].filter((p) => took(f, p, 'Rebounding Bulwark', from) > 0);
    expect(struck.map((p) => p.id)).toEqual([mark.id]);
    const dmg = took(f, mark, 'Rebounding Bulwark', from);
    expect(dmg).toBeGreaterThanOrEqual(T.bulwarkMin);
    expect(dmg).toBeLessThanOrEqual(T.bulwarkMax);
    const st = olen.bastionFight;
    expect(st?.kind === 'olen' && st.bulwark === null && !st.rebounded).toBe(true);
  });

  it('a stacked group: it rebounds to three players, never twice to one, and costs the deed', () => {
    const { f, olen } = olenFight();
    // Everyone huddles a few yards apart behind him.
    for (const [i, p] of f.others.entries()) put(f, p, MID.x - 4 + i * 4, MID.z + 9);
    const keep = holdAll(f);
    run(f, DT, keep);
    shieldOn(f, olen, keep);
    const from = f.hits.length;
    run(f, T.bulwarkCast + T.bulwarkHop * 6, keep);
    const order = f.hits
      .slice(from)
      .filter((h) => h.ability === 'Rebounding Bulwark')
      .map((h) => h.targetId);
    expect(order).toHaveLength(T.bulwarkHits);
    expect(new Set(order).size).toBe(T.bulwarkHits);
    const st = olen.bastionFight;
    expect(st?.kind === 'olen' && st.rebounded).toBe(true);
  });

  it('heroic: it strikes up to four', () => {
    const { f, olen } = olenFight('heroic');
    for (const [i, p] of f.others.entries()) put(f, p, MID.x - 4 + i * 4, MID.z + 9);
    put(f, f.tank, MID.x, MID.z + 5);
    const keep = holdAll(f);
    run(f, DT, keep);
    shieldOn(f, olen, keep);
    const from = f.hits.length;
    run(f, T.bulwarkCast + T.bulwarkHop * 7, keep);
    const order = f.hits
      .slice(from)
      .filter((h) => h.ability === 'Rebounding Bulwark')
      .map((h) => h.targetId);
    expect(order).toHaveLength(T.bulwarkHitsHeroic);
  });
});

describe('Olen the fallen paladin: Sentence of the Tide', () => {
  it('marks a non-tank; five seconds later the column strikes everyone within 6 yd of them', () => {
    const { f, olen } = olenFight();
    run(f, DT);
    const st = olen.bastionFight;
    if (st?.kind !== 'olen') throw new Error('no fight');
    st.brineTimer = 99;
    st.bulwarkTimer = 99;
    st.sentenceTimer = 0.1;
    const keep = holdAll(f);
    expect(until(f, () => olen.castingAbility === OLEN_TIDE_SENTENCE, 1, keep)).toBe(true);
    run(f, T.sentenceCast + DT, keep);
    const mark = [f.tank, ...f.others].find((p) => aura(p, OLEN_SENTENCED)) as Entity;
    expect(mark).toBeDefined();
    expect(mark).not.toBe(f.tank);
    // The mark carries the splash's reach, so a client paints the true ring.
    expect(aura(mark, OLEN_SENTENCED)?.value2).toBe(T.sentenceRadius);
    // A neighbour stands close to the mark, the rest far.
    const near = f.others.find((p) => p !== mark) as Entity;
    const at = { x: mark.pos.x - f.ox, z: mark.pos.z - f.oz };
    const stand = () => {
      keep();
      put(f, near, at.x + 3, at.z);
    };
    const from = f.hits.length;
    run(f, T.sentenceSeconds - 0.2, stand);
    expect(took(f, mark, 'Sentence of the Tide', from)).toBe(0);
    run(f, 0.4, stand);
    const hit = took(f, mark, 'Sentence of the Tide', from);
    expect(hit).toBeGreaterThanOrEqual(T.sentenceMin);
    expect(hit).toBeLessThanOrEqual(T.sentenceMax);
    expect(took(f, near, 'Sentence of the Tide', from)).toBeGreaterThan(0);
    for (const p of [f.tank, ...f.others])
      if (p !== mark && p !== near) expect(took(f, p, 'Sentence of the Tide', from)).toBe(0);
    expect(aura(mark, OLEN_SENTENCED)).toBeUndefined();
  });
});

describe('Olen the fallen paladin: the Unbroken Oath', () => {
  it('at half health he kneels into an immune bubble; killing his soldiers breaks it', () => {
    const { f, olen } = olenFight();
    const keep = holdAll(f);
    run(f, 0.5, keep);
    olen.hp = Math.round(olen.maxHp * 0.49);
    run(f, DT * 2, keep);
    expect(olen.castingAbility).toBe(OLEN_OATH_KNEEL);
    expect(aura(olen, OLEN_UNBROKEN_OATH)).toBeDefined();
    const hp = olen.hp;
    f.sim.dealDamage(f.tank, olen, 5000, false, 'physical', 'Strike', 'hit', false);
    expect(olen.hp).toBe(hp);
    run(f, T.oathKneel, keep);
    expect(olen.castingAbility).toBe(OLEN_OATH_VIGIL);
    const soldiers = live(f, OLEN_SOLDIER_ID);
    expect(soldiers).toHaveLength(T.oathSoldiers);
    for (const s of soldiers) {
      expect(s.inCombat).toBe(true);
      expect(Math.hypot(s.pos.x - olen.pos.x, s.pos.z - olen.pos.z)).toBeCloseTo(
        T.oathSoldierRing,
        0,
      );
    }
    // Still sealed with one soldier standing.
    f.sim.ctx.handleDeath(soldiers[0], f.tank);
    run(f, DT * 2, keep);
    expect(aura(olen, OLEN_UNBROKEN_OATH)).toBeDefined();
    f.sim.dealDamage(f.tank, olen, 5000, false, 'physical', 'Strike', 'hit', false);
    expect(olen.hp).toBe(hp);
    // The last falls: the bubble bursts and he is Breached.
    f.sim.ctx.handleDeath(soldiers[1], f.tank);
    run(f, DT * 2, keep);
    expect(aura(olen, OLEN_UNBROKEN_OATH)).toBeUndefined();
    expect(olen.castingAbility).toBeNull();
    expect(olen.auras.some((a) => a.id === OLEN_BREACHED && a.kind === 'stun')).toBe(true);
    expect(olen.auras.find((a) => a.id === OLEN_BREACHED_VULN)?.value).toBe(T.oathBrokenVuln);
    const before = olen.hp;
    f.sim.dealDamage(f.tank, olen, 100, false, 'physical', 'Strike', 'hit', true);
    expect(olen.hp).toBeLessThan(before);
    // Once a fight.
    olen.hp = Math.round(olen.maxHp * 0.2);
    run(f, 1, keep);
    expect(live(f, OLEN_SOLDIER_ID)).toHaveLength(0);
  });

  it('heroic: three soldiers rise', () => {
    const { f, olen } = olenFight('heroic');
    run(f, 0.5);
    olen.hp = Math.round(olen.maxHp * 0.49);
    run(f, T.oathKneel + DT * 3);
    expect(live(f, OLEN_SOLDIER_ID)).toHaveLength(T.oathSoldiersHeroic);
  });
});

describe('Olen the fallen paladin: the Oath at the rim', () => {
  it('kneeling by the open rim, his soldiers still rise on the bastion floor', () => {
    const { f, olen } = olenFight();
    put(f, olen, MID.x + 19, MID.z);
    const keep = () => {
      holdAll(f)();
    };
    run(f, 0.3, keep);
    olen.hp = Math.round(olen.maxHp * 0.49);
    run(f, T.oathKneel + DT * 4, keep);
    const soldiers = live(f, OLEN_SOLDIER_ID);
    expect(soldiers).toHaveLength(T.oathSoldiers);
    for (const s of soldiers) {
      const d = Math.hypot(s.pos.x - f.ox - MID.x, s.pos.z - f.oz - MID.z);
      expect(d).toBeLessThanOrEqual(22 - 4 + 0.01);
    }
  });
});

describe('Olen the fallen paladin: the wipe and the deed', () => {
  it('a wipe during the vigil leaves no soldier standing', () => {
    const { f, olen } = olenFight();
    run(f, 0.3);
    olen.hp = Math.round(olen.maxHp * 0.49);
    run(f, T.oathKneel + DT * 4);
    expect(live(f, OLEN_SOLDIER_ID)).toHaveLength(T.oathSoldiers);
    olen.aiState = 'evade';
    olen.aggroTargetId = null;
    run(f, 1);
    expect(live(f, OLEN_SOLDIER_ID)).toHaveLength(0);
    expect(olen.damageImmune).toBe(false);
  });

  it('stepping out of the brine drops its mark at once', () => {
    const { f, olen } = olenFight();
    const keep = holdAll(f);
    expect(until(f, () => pools(f).length === 1, T.brineFirst + T.brineCast + 1, keep)).toBe(true);
    run(f, 0.5, keep);
    expect(aura(f.tank, OLEN_IN_BRINE)).toBeDefined();
    run(f, DT * 2, () => {
      keep();
      put(f, f.tank, MID.x + 15, MID.z - 10);
    });
    expect(aura(f.tank, OLEN_IN_BRINE)).toBeUndefined();
    void olen;
  });

  it('a wipe dries the brine, lifts the bubble and clears every mark', () => {
    const { f, olen } = olenFight();
    const keep = holdAll(f);
    expect(until(f, () => pools(f).length > 0, T.brineFirst + T.brineCast + 1, keep)).toBe(true);
    olen.hp = Math.round(olen.maxHp * 0.49);
    run(f, DT * 2, keep);
    expect(aura(olen, OLEN_UNBROKEN_OATH)).toBeDefined();
    olen.aiState = 'evade';
    olen.aggroTargetId = null;
    run(f, DT * 2);
    expect(pools(f)).toHaveLength(0);
    expect(aura(olen, OLEN_UNBROKEN_OATH)).toBeUndefined();
    expect(olen.damageImmune).toBe(false);
    expect(olen.bastionFight).toBeUndefined();
  });

  it('killing him without a single rebound earns Hold the Wall; a rebound costs it', () => {
    const clean = olenFight();
    run(clean.f, 1);
    clean.f.sim.ctx.handleDeath(clean.olen, clean.f.tank);
    run(clean.f, DT * 2);
    expect(earned(clean.f, clean.f.tank, OLEN_DEED)).toBe(true);
    const messy = olenFight();
    run(messy.f, 1);
    const st = messy.olen.bastionFight;
    if (st?.kind !== 'olen') throw new Error('no fight');
    st.rebounded = true;
    messy.f.sim.ctx.handleDeath(messy.olen, messy.f.tank);
    run(messy.f, DT * 2);
    expect(earned(messy.f, messy.f.tank, OLEN_DEED)).toBe(false);
  });
});
