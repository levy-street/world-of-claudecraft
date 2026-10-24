// Sexton Marrow in the Bell Yard (src/sim/encounters/hollow_crypt/marrow.ts):
// Shovelful's locked cone, Measured for the Grave (the mark, the cave-in, the
// persistent pit and its Grave Dirt, the cap), the Burial Toll at 66 and 33
// percent (the stride to the rope, immunity, the peals, the Toll, the dead
// rising from every grave), the heroic Gravedigger's Blow, Grave Vigor and
// Unquiet Earth, the wipe reset, the Tidy Churchyard deed and determinism.
// Full Sim ticks in a real claimed Hollow Crypt.

import { describe, expect, it, vi } from 'vitest';
import { MOBS } from '../src/sim/data';
import {
  BELL_YARD,
  bellRopeSpot,
  MARROW_BELL_PEAL,
  MARROW_BLOW_STACKS,
  MARROW_BONES_ID,
  MARROW_BURIAL_TOLL,
  MARROW_DEED,
  MARROW_DIRT_IN_EYES,
  MARROW_GRAVE_DIRT,
  MARROW_GRAVE_TEMPLATE,
  MARROW_GRAVE_VIGOR,
  MARROW_GRAVEDIGGERS_BLOW,
  MARROW_ID,
  MARROW_MEASURE,
  MARROW_MEASURED,
  MARROW_SHOVELFUL,
  MARROW_TOLLING,
  MARROW_TUNING,
  tollDamageRange,
} from '../src/sim/encounters/hollow_crypt';
import { DT, type Entity } from '../src/sim/types';
import {
  aura,
  boss,
  cryptFight,
  earned,
  type Fight,
  live,
  put,
  run,
  took,
  until,
} from './helpers/crypt_boss_fight';

// The determinism case plays two 52 s fights: about 40 s on a quiet machine,
// past 60 s under load on the base commit too, so the budget matches the real
// kill suites beside it (tests/hollow_crypt_marrow_pace.test.ts).
vi.setConfig({ testTimeout: 240_000 });

const T = MARROW_TUNING;
const KEEP = new Set([MARROW_ID]);
/** The yard's centre, and spots along its rim (instance-local). */
const MID = { x: BELL_YARD.x, z: BELL_YARD.z };

function marrowFight(
  difficulty: 'normal' | 'heroic' = 'normal',
  extra = 3,
  seed = 23,
): { f: Fight; marrow: Entity } {
  const f = cryptFight(difficulty, extra, KEEP, seed);
  const marrow = boss(f, MARROW_ID);
  put(f, marrow, MID.x, MID.z);
  put(f, f.tank, MID.x, MID.z - 2.5);
  // The group spread on the rim, far from him and from each other.
  const rim = [
    [MID.x - 17, MID.z + 6],
    [MID.x + 17, MID.z + 6],
    [MID.x, MID.z + 18],
  ];
  for (const [i, p] of f.others.entries()) put(f, p, rim[i][0], rim[i][1]);
  marrow.maxHp = 1e6;
  marrow.hp = marrow.maxHp;
  f.sim.ctx.aggroMob(marrow, f.tank, false);
  return { f, marrow };
}

function holdAll(f: Fight): () => void {
  const hold = [f.tank, ...f.others].map((p) => [p, p.pos.x - f.ox, p.pos.z - f.oz] as const);
  return () => {
    for (const [p, x, z] of hold) put(f, p, x, z);
  };
}

function graves(f: Fight): Entity[] {
  return f.inst.objectIds
    .map((id) => f.sim.ctx.entities.get(id))
    .filter((e): e is Entity => e?.templateId === MARROW_GRAVE_TEMPLATE);
}

describe('Sexton Marrow: the template carries no placeholder kit', () => {
  it('has no summon waves, charge or yells left on his template', () => {
    const t = MOBS[MARROW_ID];
    expect(t.summonAdds).toBeUndefined();
    expect(t.charge).toBeUndefined();
    expect(t.yells).toBeUndefined();
    expect(MOBS[MARROW_BONES_ID].minLevel).toBe(8);
  });
  it('hangs the bell rope inside the yard, under the tower beam', () => {
    const rope = bellRopeSpot();
    const d = Math.hypot(rope.x - BELL_YARD.x, rope.z - BELL_YARD.z);
    expect(d).toBeLessThan(BELL_YARD.r - 3);
    expect(d).toBeGreaterThan(6);
  });
});

describe('Sexton Marrow: Shovelful', () => {
  it('locks its cone at the bar start and strikes and slows only who stands in front', () => {
    const { f, marrow } = marrowFight();
    // A melee player behind him and one in front (beside the tank).
    put(f, f.others[0], MID.x, MID.z + 3);
    put(f, f.others[1], MID.x + 1, MID.z - 3);
    const keep = holdAll(f);
    expect(
      until(f, () => marrow.castingAbility === MARROW_SHOVELFUL, T.shovelFirst + 1, keep),
    ).toBe(true);
    const st = marrow.cryptBossFight;
    expect(st?.kind === 'marrow' && st.bar?.what).toBe('shovel');
    const yaw = marrow.facing;
    const from = f.hits.length;
    expect(until(f, () => marrow.castingAbility === null, T.shovelCast + 0.2, keep)).toBe(true);
    expect(marrow.facing).toBeCloseTo(yaw, 5);
    expect(took(f, f.tank, 'Shovelful', from)).toBeGreaterThan(0);
    expect(took(f, f.others[1], 'Shovelful', from)).toBeGreaterThan(0);
    expect(took(f, f.others[0], 'Shovelful', from)).toBe(0);
    expect(aura(f.tank, MARROW_DIRT_IN_EYES)?.value).toBe(T.shovelSlow);
    expect(aura(f.others[0], MARROW_DIRT_IN_EYES)).toBeUndefined();
  });
});

describe('Sexton Marrow: Measured for the Grave', () => {
  it('marks a non-tank, opens the grave under them, and the pit burns and slows', () => {
    const { f, marrow } = marrowFight();
    const keep = holdAll(f);
    expect(until(f, () => marrow.castingAbility === MARROW_MEASURE, T.measureFirst + 1, keep)).toBe(
      true,
    );
    const victimId = marrow.castTargetId;
    expect(victimId).not.toBe(f.tank.id);
    const victim = f.others.find((p) => p.id === victimId) as Entity;
    expect(until(f, () => aura(victim, MARROW_MEASURED) !== undefined, 2, keep)).toBe(true);
    expect(aura(victim, MARROW_MEASURED)?.value2).toBe(T.graveRadius);
    const from = f.hits.length;
    expect(until(f, () => graves(f).length === 1, T.markSeconds + 0.3, keep)).toBe(true);
    expect(aura(victim, MARROW_MEASURED)).toBeUndefined();
    expect(took(f, victim, 'Open Grave', from)).toBeGreaterThan(0);
    // Standing in it: Grave Dirt slows and burns once a second.
    const burnFrom = f.hits.length;
    run(f, 2.1, keep);
    expect(aura(victim, MARROW_GRAVE_DIRT)?.value).toBe(T.graveSlow);
    expect(took(f, victim, 'Grave Dirt', burnFrom)).toBeGreaterThan(0);
    // Out of it: the slow drops and the burning stops.
    const out = victim.pos;
    put(f, victim, out.x - f.ox + 6, out.z - f.oz);
    const outKeep = holdAll(f);
    run(f, 0.2, outKeep);
    expect(aura(victim, MARROW_GRAVE_DIRT)).toBeUndefined();
    const after = f.hits.length;
    run(f, 2, outKeep);
    expect(took(f, victim, 'Grave Dirt', after)).toBe(0);
    // The pit stays.
    expect(graves(f)).toHaveLength(1);
  });

  it('fills the oldest grave past the cap', () => {
    const { f, marrow } = marrowFight();
    const keep = holdAll(f);
    run(f, DT, keep);
    const st = marrow.cryptBossFight;
    if (st?.kind !== 'marrow') throw new Error('no fight');
    for (let i = 0; i < T.graveCap + 2; i++) {
      // Walk the mark round the rim so every grave opens somewhere new.
      const victim = f.others[i % f.others.length];
      const a = (i / (T.graveCap + 2)) * Math.PI * 2;
      put(f, victim, MID.x + Math.sin(a) * 16, MID.z + Math.cos(a) * 16);
      st.marks.push({ playerId: victim.id, remaining: DT });
      run(f, DT * 2);
    }
    expect(graves(f)).toHaveLength(T.graveCap);
    expect(st.graves).toHaveLength(T.graveCap);
  });

  it('keeps the Tidy Churchyard deed only when every grave opens at the edge', () => {
    for (const tidy of [true, false]) {
      const { f, marrow } = marrowFight();
      run(f, DT);
      const st = marrow.cryptBossFight;
      if (st?.kind !== 'marrow') throw new Error('no fight');
      const victim = f.others[0];
      if (!tidy) put(f, victim, MID.x + 2, MID.z + 4);
      st.marks.push({ playerId: victim.id, remaining: DT });
      run(f, DT * 2);
      expect(st.tidy).toBe(tidy);
      f.sim.ctx.handleDeath(marrow, f.tank);
      run(f, DT * 2);
      expect(earned(f, f.tank, MARROW_DEED)).toBe(tidy);
      expect(graves(f)).toHaveLength(0);
    }
  });
});

describe('Sexton Marrow: the Burial Toll', () => {
  it('at 66 percent strides to the rope immune, rings three peals, and the Toll raises the dead', () => {
    const { f, marrow } = marrowFight();
    const keep = holdAll(f);
    run(f, DT, keep);
    const st = marrow.cryptBossFight;
    if (st?.kind !== 'marrow') throw new Error('no fight');
    // Two graves open on the rim first.
    for (const p of f.others.slice(0, 2)) st.marks.push({ playerId: p.id, remaining: DT });
    run(f, DT * 2, keep);
    expect(graves(f)).toHaveLength(2);
    marrow.hp = Math.floor(marrow.maxHp * 0.65);
    run(f, DT * 2, keep);
    expect(st.toll?.phase).toBe('stride');
    expect(marrow.damageImmune).toBe(true);
    expect(aura(marrow, MARROW_TOLLING)).toBeDefined();
    expect(
      until(f, () => marrow.castingAbility === MARROW_BURIAL_TOLL, T.tollStrideMax + 0.5, keep),
    ).toBe(true);
    const rope = bellRopeSpot();
    expect(Math.hypot(marrow.pos.x - f.ox - rope.x, marrow.pos.z - f.oz - rope.z)).toBeLessThan(
      0.5,
    );
    const cueFrom = f.cues.length;
    const from = f.hits.length;
    expect(until(f, () => st.toll === null, T.tollRing + 0.3, keep)).toBe(true);
    const peals = f.cues.slice(cueFrom).filter((c) => c.ability === MARROW_BELL_PEAL);
    expect(peals).toHaveLength(T.tollPeals - 1);
    expect(f.cues.slice(cueFrom).some((c) => c.ability === MARROW_BURIAL_TOLL)).toBe(true);
    for (const p of [f.tank, ...f.others])
      expect(took(f, p, 'Burial Toll', from)).toBeGreaterThan(0);
    expect(live(f, MARROW_BONES_ID)).toHaveLength(2);
    expect(marrow.damageImmune).toBe(false);
    expect(aura(marrow, MARROW_TOLLING)).toBeUndefined();
    // The second Toll waits for 33 percent.
    run(f, 3, keep);
    expect(st.tolls).toBe(1);
    marrow.hp = Math.floor(marrow.maxHp * 0.32);
    run(f, DT * 2, keep);
    expect(st.tolls).toBe(2);
  });
});

// The owner's heroic playtest of 2026-10-12: the bell hits a tenth harder on
// heroic, and nothing else of his moves. Every damage roll is one
// `ctx.rng.range(min, max)` draw (claim.ts mechanicDamage), so the spy below
// reads the exact base range each mechanic rolled, whatever the seed drew.
describe("Sexton Marrow: the Burial Toll's heroic factor", () => {
  const HEROIC_MULT = 6;

  /** One Toll with one grave caving in beforehand; the base ranges rolled. */
  function tollRolls(difficulty: 'normal' | 'heroic') {
    const { f, marrow } = marrowFight(difficulty);
    const keep = holdAll(f);
    run(f, DT, keep);
    const st = marrow.cryptBossFight;
    if (st?.kind !== 'marrow') throw new Error('no fight');
    const range = vi.spyOn(f.sim.ctx.rng, 'range');
    st.marks.push({ playerId: f.others[0].id, remaining: DT });
    run(f, DT * 2, keep);
    expect(graves(f)).toHaveLength(1);
    const dirtFrom = f.hits.length;
    run(f, 1.2, keep);
    const dirt = f.hits
      .slice(dirtFrom)
      .filter((h) => h.ability === 'Grave Dirt')
      .map((h) => h.amount);
    marrow.hp = Math.floor(marrow.maxHp * 0.65);
    const from = f.hits.length;
    expect(until(f, () => st.tolls === 1 && st.toll === null, 12, keep)).toBe(true);
    const party = [f.tank, ...f.others];
    const tolls = party.map((p) => took(f, p, 'Burial Toll', from));
    const calls = range.mock.calls.map(([min, max]) => [min, max] as const);
    range.mockRestore();
    return { marrow, tolls, dirt, calls, party };
  }

  it('is a tuning field read through one pure helper', () => {
    expect(T.tollHeroicMult).toBe(1.1);
    expect(tollDamageRange(false)).toEqual({ min: 30, max: 38 });
    const heroic = tollDamageRange(true);
    expect(heroic.min).toBeCloseTo(33, 9);
    expect(heroic.max).toBeCloseTo(41.8, 9);
  });

  it('rolls 198 to 251 on everyone on heroic (was 180 to 228)', () => {
    const { marrow, tolls, calls, party } = tollRolls('heroic');
    expect(marrow.mechanicDamageMult).toBe(HEROIC_MULT);
    const heroic = tollDamageRange(true);
    const tollCalls = calls.filter(([min, max]) => min === heroic.min && max === heroic.max);
    expect(tollCalls).toHaveLength(party.length);
    // Never the unscaled base on a heroic claim.
    expect(calls.some(([min, max]) => min === T.tollMin && max === T.tollMax)).toBe(false);
    for (const amount of tolls) {
      expect(amount).toBeGreaterThanOrEqual(198);
      expect(amount).toBeLessThanOrEqual(251);
    }
    expect(Math.round(heroic.min * HEROIC_MULT)).toBe(198);
    expect(Math.round(heroic.max * HEROIC_MULT)).toBe(251);
    expect(Math.round(T.tollMin * HEROIC_MULT)).toBe(180);
    expect(Math.round(T.tollMax * HEROIC_MULT)).toBe(228);
  });

  it('leaves the cave-in and Grave Dirt on the shared heroic factor alone', () => {
    const { calls, dirt } = tollRolls('heroic');
    // The grave caved in on its authored base: no tenth on top.
    expect(calls.some(([min, max]) => min === T.graveOpenMin && max === T.graveOpenMax)).toBe(true);
    expect(
      calls.some(
        ([min, max]) =>
          Math.abs(min - T.graveOpenMin * T.tollHeroicMult) < 1e-6 ||
          Math.abs(max - T.graveOpenMax * T.tollHeroicMult) < 1e-6,
      ),
    ).toBe(false);
    expect(dirt.length).toBeGreaterThan(0);
    for (const amount of dirt) expect(amount).toBe(T.graveDirtPerSecond * HEROIC_MULT);
  });

  it('stays 30 to 38 on normal', () => {
    const { marrow, tolls, calls, party } = tollRolls('normal');
    const mult = marrow.mechanicDamageMult ?? 1;
    const tollCalls = calls.filter(([min, max]) => min === T.tollMin && max === T.tollMax);
    expect(tollCalls).toHaveLength(party.length);
    const heroic = tollDamageRange(true);
    expect(calls.some(([min, max]) => min === heroic.min && max === heroic.max)).toBe(false);
    for (const amount of tolls) {
      expect(amount).toBeGreaterThanOrEqual(Math.round(T.tollMin * mult));
      expect(amount).toBeLessThanOrEqual(Math.round(T.tollMax * mult));
    }
  });
});

describe('Sexton Marrow: heroic', () => {
  it("stacks Gravedigger's Blow on the tank and swings with Grave Vigor in a grave", () => {
    const { f, marrow } = marrowFight('heroic');
    const keep = holdAll(f);
    expect(
      until(f, () => marrow.castingAbility === MARROW_GRAVEDIGGERS_BLOW, T.blowFirst + 2, keep),
    ).toBe(true);
    expect(
      until(f, () => aura(f.tank, MARROW_BLOW_STACKS) !== undefined, T.blowCast + 0.2, keep),
    ).toBe(true);
    expect(aura(f.tank, MARROW_BLOW_STACKS)?.stacks).toBe(1);
    expect(aura(f.tank, MARROW_BLOW_STACKS)?.value).toBeCloseTo(T.blowVulnPerStack, 5);
    const st = marrow.cryptBossFight;
    if (st?.kind !== 'marrow') throw new Error('no fight');
    st.marks.push({ playerId: f.tank.id, remaining: DT });
    run(f, DT * 3, keep);
    expect(aura(marrow, MARROW_GRAVE_VIGOR)?.value).toBe(T.graveVigorHaste);
  });

  it('raises a Restless Bones under a player who lingers in a grave (Unquiet Earth)', () => {
    const { f, marrow } = marrowFight('heroic');
    const keep = holdAll(f);
    run(f, DT, keep);
    const st = marrow.cryptBossFight;
    if (st?.kind !== 'marrow') throw new Error('no fight');
    st.marks.push({ playerId: f.others[0].id, remaining: DT });
    run(f, T.unquietLinger + 0.3, keep);
    expect(live(f, MARROW_BONES_ID)).toHaveLength(1);
    // The grave rests before it can raise again.
    run(f, T.unquietLinger, keep);
    expect(live(f, MARROW_BONES_ID)).toHaveLength(1);
  });

  it('never raises the dead from a lingering player on normal', () => {
    const { f, marrow } = marrowFight('normal');
    const keep = holdAll(f);
    run(f, DT, keep);
    const st = marrow.cryptBossFight;
    if (st?.kind !== 'marrow') throw new Error('no fight');
    st.marks.push({ playerId: f.others[0].id, remaining: DT });
    run(f, T.unquietLinger * 2, keep);
    expect(live(f, MARROW_BONES_ID)).toHaveLength(0);
  });
});

describe('Sexton Marrow: the wipe', () => {
  it('fills every grave, clears the marks and ends the Toll when the fight resets', () => {
    const { f, marrow } = marrowFight();
    const keep = holdAll(f);
    run(f, DT, keep);
    const st = marrow.cryptBossFight;
    if (st?.kind !== 'marrow') throw new Error('no fight');
    st.marks.push({ playerId: f.others[0].id, remaining: DT });
    st.marks.push({ playerId: f.others[1].id, remaining: 3 });
    run(f, DT * 2, keep);
    expect(graves(f)).toHaveLength(1);
    // Everyone dead: the boss leaves combat and walks home.
    for (const p of [f.tank, ...f.others]) f.sim.ctx.handleDeath(p, marrow);
    run(f, 2);
    expect(marrow.cryptBossFight).toBeUndefined();
    expect(graves(f)).toHaveLength(0);
    expect(aura(f.others[1], MARROW_MEASURED)).toBeUndefined();
    expect(marrow.damageImmune).toBe(false);
  });

  it('a wipe mid-Toll ends it: no Toll lands and no dead rise into the empty yard', () => {
    const { f, marrow } = marrowFight();
    const keep = holdAll(f);
    run(f, DT, keep);
    const st = marrow.cryptBossFight;
    if (st?.kind !== 'marrow') throw new Error('no fight');
    st.marks.push({ playerId: f.others[0].id, remaining: DT });
    run(f, DT * 2, keep);
    marrow.hp = Math.floor(marrow.maxHp * 0.65);
    run(f, DT * 2, keep);
    expect(st.toll).not.toBeNull();
    for (const p of [f.tank, ...f.others]) f.sim.ctx.handleDeath(p, marrow);
    run(f, T.tollStrideMax + T.tollRing + 1);
    expect(marrow.cryptBossFight).toBeUndefined();
    expect(live(f, MARROW_BONES_ID)).toHaveLength(0);
    expect(marrow.damageImmune).toBe(false);
  });
});

describe('Sexton Marrow: determinism', () => {
  it('two runs on one seed take the same victims and deal the same damage', () => {
    const trace = () => {
      const { f, marrow } = marrowFight('normal', 3, 41);
      const keep = holdAll(f);
      run(f, 40, keep);
      marrow.hp = Math.floor(marrow.maxHp * 0.6);
      run(f, 12, keep);
      return JSON.stringify({
        hits: f.hits.map((h) => [h.targetId, h.amount, h.ability]),
        graves: graves(f).map((g) => [Math.round(g.pos.x), Math.round(g.pos.z)]),
      });
    };
    expect(trace()).toBe(trace());
  });
});

describe('Sexton Marrow: planted for every bar', () => {
  const BARS = [
    { what: 'shovel', id: MARROW_SHOVELFUL, cast: T.shovelCast, mode: 'normal' },
    { what: 'measure', id: MARROW_MEASURE, cast: T.measureCast, mode: 'normal' },
    { what: 'blow', id: MARROW_GRAVEDIGGERS_BLOW, cast: T.blowCast, mode: 'heroic' },
  ] as const;
  for (const bar of BARS) {
    it(`stays on the spot his ${bar.what} bar began while his tank backs away`, () => {
      const { f, marrow } = marrowFight(bar.mode);
      const keep = holdAll(f);
      run(f, 0.3, keep);
      const s = marrow.cryptBossFight;
      if (s?.kind !== 'marrow') throw new Error('no marrow fight');
      s.shovelTimer = bar.what === 'shovel' ? 0 : 99;
      s.measureTimer = bar.what === 'measure' ? 0 : 99;
      s.blowTimer = bar.what === 'blow' ? 0 : 99;
      expect(until(f, () => marrow.castingAbility === bar.id, 1, keep)).toBe(true);
      const at = { x: marrow.pos.x, y: marrow.pos.y, z: marrow.pos.z };
      const facing = marrow.facing;
      let step = 0;
      let moved = 0;
      let turned = 0;
      // The tank backs off across the yard every tick: a boss that chased
      // would walk after him mid-bar (7 yd a second).
      const landed = until(
        f,
        () => marrow.castingAbility === null,
        bar.cast + 0.2,
        () => {
          keep();
          step++;
          put(f, f.tank, MID.x + 6 + step * 0.25, MID.z - 9);
          moved = Math.max(moved, Math.hypot(marrow.pos.x - at.x, marrow.pos.z - at.z));
          if (Math.abs(marrow.facing - facing) > 1e-9) turned++;
        },
      );
      expect(landed).toBe(true);
      expect(moved).toBeLessThan(1e-6);
      expect(marrow.pos.y).toBeCloseTo(at.y, 6);
      if (bar.what === 'blow') {
        // The blow keeps turning to the tank it swings at (only his feet stay).
        expect(turned).toBeGreaterThan(0);
      } else {
        // The cone keeps its aim; the mark keeps turning to its victim (who
        // stands still here), so neither turns.
        expect(turned).toBe(0);
      }
      expect(marrow.castHold).toBeUndefined();
    });
  }
});
