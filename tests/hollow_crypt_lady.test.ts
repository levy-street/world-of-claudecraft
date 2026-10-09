// The Lady of the Bonechill on the frost ravine floor (src/sim/encounters/
// hollow_crypt/lady.ts and its lanterns, embrace and ice modules): the frozen
// boss id, the Bride's Lament and the grave lanterns (two to a lantern, dark
// after a Lament, kindling, Lingering Lament), the Frozen Embrace (carried in
// the air, broken by damage and set down, or dropped onto the ice), the Rime
// Path and the slick it leaves, the Bridal Freeze at half health, heroic (two
// held, lanterns burning out), the wipe, the deed and determinism. Full Sim
// ticks in a real claimed Hollow Crypt.

import { describe, expect, it, vi } from 'vitest';
import { MOBS } from '../src/sim/data';
import {
  BONECHILL_RAVINE,
  EMBRACE_LIFT,
  GRAVE_LANTERNS,
  LADY_BRIDAL_FREEZE,
  LADY_BRIDES_LAMENT,
  LADY_DEED,
  LADY_EMBRACE_HOLD,
  LADY_EMBRACED,
  LADY_FROZEN_EMBRACE,
  LADY_FROZEN_FLOOR_TEMPLATE,
  LADY_ID,
  LADY_LAMENT_DREAD,
  LADY_LANTERN_TEMPLATES,
  LADY_LINGERING_LAMENT,
  LADY_RIME_PATCH_TEMPLATE,
  LADY_TUNING,
  lanternShelters,
} from '../src/sim/encounters/hollow_crypt';
import { SLIPPERY_GROUND_AURA } from '../src/sim/slippery_ground';
import { DT, type Entity } from '../src/sim/types';
import {
  aura,
  boss,
  cryptFight,
  earned,
  type Fight,
  put,
  run,
  took,
  until,
} from './helpers/crypt_boss_fight';

vi.setConfig({ testTimeout: 90_000 });

const T = LADY_TUNING;
const KEEP = new Set([LADY_ID]);
const MID = { x: BONECHILL_RAVINE.x, z: BONECHILL_RAVINE.z };

function ladyFight(
  difficulty: 'normal' | 'heroic' = 'normal',
  extra = 3,
  seed = 23,
): { f: Fight; lady: Entity } {
  const f = cryptFight(difficulty, extra, KEEP, seed);
  const lady = boss(f, LADY_ID);
  put(f, lady, MID.x, MID.z);
  put(f, f.tank, MID.x, MID.z - 2.5);
  const spots = [
    [MID.x - 6, MID.z + 4],
    [MID.x + 6, MID.z + 4],
    [MID.x, MID.z + 7],
  ];
  for (const [i, p] of f.others.entries()) put(f, p, spots[i][0], spots[i][1]);
  lady.maxHp = 1e6;
  lady.hp = lady.maxHp;
  f.sim.ctx.aggroMob(lady, f.tank, false);
  return { f, lady };
}

function holdAll(f: Fight, skip: ReadonlySet<number> = new Set()): () => void {
  const hold = [f.tank, ...f.others].map((p) => [p, p.pos.x - f.ox, p.pos.z - f.oz] as const);
  return () => {
    for (const [p, x, z] of hold) if (!skip.has(p.id) && p.carriedBy === undefined) put(f, p, x, z);
  };
}

function objects(f: Fight, templateId: string): Entity[] {
  return f.inst.objectIds
    .map((id) => f.sim.ctx.entities.get(id))
    .filter((e): e is Entity => e?.templateId === templateId);
}

function lanternObj(f: Fight, i: number): Entity {
  const l = GRAVE_LANTERNS[i];
  for (const id of f.inst.objectIds) {
    const e = f.sim.ctx.entities.get(id);
    if (!e) continue;
    if (Math.abs(e.pos.x - f.ox - l.x) < 0.75 && Math.abs(e.pos.z - f.oz - l.z) < 0.75) return e;
  }
  throw new Error(`no lantern ${i}`);
}

function st(lady: Entity) {
  const s = lady.cryptBossFight;
  if (s?.kind !== 'lady') throw new Error('no lady fight');
  return s;
}

describe('the Lady of the Bonechill: the frozen id carries her and nothing of the spider', () => {
  it('keeps the rimeweb id with her name and no placeholder kit', () => {
    const t = MOBS[LADY_ID];
    expect(LADY_ID).toBe('rimeweb');
    expect(t.name).toBe('Lady of the Bonechill');
    expect(t.family).toBe('undead');
    expect(t.stackPoison).toBeUndefined();
    expect(t.summonAdds).toBeUndefined();
    expect(t.yells).toBeUndefined();
    // The gallery's egg sacs still hatch their spiders (the trash is untouched).
    expect(MOBS.rime_egg_sac.broodEgg?.hatchMobId).toBe('rimeweb_hatchling');
    expect(MOBS.rimeweb_hatchling).toBeDefined();
  });

  it('spawns the three grave lanterns lit, round the ravine floor', () => {
    const { f } = ladyFight();
    for (let i = 0; i < GRAVE_LANTERNS.length; i++) {
      expect(lanternObj(f, i).templateId).toBe(LADY_LANTERN_TEMPLATES.lit);
      const l = GRAVE_LANTERNS[i];
      expect(Math.hypot(l.x - MID.x, l.z - MID.z)).toBeLessThan(BONECHILL_RAVINE.r - 3);
    }
  });
});

describe('the Lady of the Bonechill: the pure lantern shelter', () => {
  it('shelters the nearest two in its light, ties to the lower id', () => {
    const ps = [
      { id: 5, x: 1, z: 0 },
      { id: 2, x: 2, z: 0 },
      { id: 3, x: -1, z: 0 },
      { id: 9, x: 10, z: 0 },
    ];
    expect(lanternShelters(0, 0, ps, 4.5, 2).map((p) => p.id)).toEqual([3, 5]);
    expect(lanternShelters(0, 0, ps, 4.5, 9).map((p) => p.id)).toEqual([3, 5, 2]);
  });
});

describe("the Lady of the Bonechill: Bride's Lament and the grave lanterns", () => {
  it('shelters two to a lit lantern, wails on the rest, darkens the used lanterns and relights them', () => {
    const { f, lady } = ladyFight();
    // Two in lantern 0, one more in it (over the cap), the tank in the open.
    const l0 = GRAVE_LANTERNS[0];
    put(f, f.others[0], l0.x + 0.5, l0.z);
    put(f, f.others[1], l0.x - 0.5, l0.z);
    put(f, f.others[2], l0.x, l0.z + 2.5);
    const keep = holdAll(f);
    expect(
      until(f, () => lady.castingAbility === LADY_BRIDES_LAMENT, T.lamentFirst + 1, keep),
    ).toBe(true);
    run(f, 0.5, keep);
    // The dread warns everyone; its hint names who has room in the light.
    expect(aura(f.others[0], LADY_LAMENT_DREAD)?.value2).toBe(1);
    expect(aura(f.others[2], LADY_LAMENT_DREAD)?.value2).toBe(0);
    expect(aura(f.tank, LADY_LAMENT_DREAD)?.value2).toBe(0);
    const from = f.hits.length;
    expect(until(f, () => lady.castingAbility !== LADY_BRIDES_LAMENT, T.lamentCast, keep)).toBe(
      true,
    );
    expect(took(f, f.others[0], "Bride's Lament", from)).toBe(0);
    expect(took(f, f.others[1], "Bride's Lament", from)).toBe(0);
    expect(took(f, f.others[2], "Bride's Lament", from)).toBeGreaterThan(0);
    expect(took(f, f.tank, "Bride's Lament", from)).toBeGreaterThan(0);
    expect(aura(f.others[2], LADY_LINGERING_LAMENT)?.stacks).toBe(1);
    expect(aura(f.others[0], LADY_LINGERING_LAMENT)).toBeUndefined();
    expect(aura(f.others[0], LADY_LAMENT_DREAD)).toBeUndefined();
    // Lantern 0 sheltered: dark; the other two never did: still lit.
    expect(lanternObj(f, 0).templateId).toBe(LADY_LANTERN_TEMPLATES.dark);
    expect(lanternObj(f, 1).templateId).toBe(LADY_LANTERN_TEMPLATES.lit);
    expect(lanternObj(f, 2).templateId).toBe(LADY_LANTERN_TEMPLATES.lit);
    run(f, T.lanternDark - T.lanternKindle + 0.2, keep);
    expect(lanternObj(f, 0).templateId).toBe(LADY_LANTERN_TEMPLATES.kindling);
    run(f, T.lanternKindle, keep);
    expect(lanternObj(f, 0).templateId).toBe(LADY_LANTERN_TEMPLATES.lit);
  });

  it('a dark lantern shelters nobody, and Lingering Lament makes the next one bite harder', () => {
    const { f, lady } = ladyFight();
    const l0 = GRAVE_LANTERNS[0];
    const victim = f.others[0];
    put(f, victim, MID.x + 3, MID.z + 3);
    const keep = holdAll(f);
    run(f, DT, keep);
    const s = st(lady);
    // First Lament in the open: one stack.
    s.lamentTimer = 0;
    run(f, T.lamentCast + 0.2, keep);
    const first = took(f, victim, "Bride's Lament");
    expect(first).toBeGreaterThan(0);
    // Lantern 0 goes dark by hand; standing in it now shelters nothing.
    s.lanternDark[0] = 999;
    put(f, victim, l0.x, l0.z);
    const keep2 = holdAll(f);
    const from = f.hits.length;
    s.lamentTimer = 0;
    run(f, T.lamentCast + 0.2, keep2);
    const second = took(f, victim, "Bride's Lament", from);
    // Half again on one stack (the rolls span 60 to 75).
    expect(second).toBeGreaterThanOrEqual(Math.floor(T.lamentMin * 1.5));
    expect(aura(victim, LADY_LINGERING_LAMENT)?.stacks).toBe(2);
  });

  it('on heroic a lit lantern burns out on its own and gutters for a while', () => {
    const { f, lady } = ladyFight('heroic');
    const keep = holdAll(f);
    run(f, DT, keep);
    const s = st(lady);
    s.lamentTimer = 999;
    s.embraceTimer = 999;
    run(f, T.lanternLitHeroic + 0.2, keep);
    expect(lanternObj(f, 1).templateId).not.toBe(LADY_LANTERN_TEMPLATES.lit);
    run(f, T.lanternGutter, keep);
    expect(lanternObj(f, 1).templateId).toBe(LADY_LANTERN_TEMPLATES.lit);
  });
});

describe('the Lady of the Bonechill: the Frozen Embrace', () => {
  it('lifts a non-tank into the air stunned, and enough damage makes her set them down gently', () => {
    const { f, lady } = ladyFight();
    const keep = holdAll(f);
    run(f, DT, keep);
    const s = st(lady);
    s.lamentTimer = 999;
    s.embraceTimer = 0;
    expect(until(f, () => lady.castingAbility === LADY_FROZEN_EMBRACE, 1, keep)).toBe(true);
    const victim = f.others.find((p) => p.id === lady.castTargetId) as Entity;
    expect(victim).toBeDefined();
    expect(
      until(f, () => lady.castingAbility === LADY_EMBRACE_HOLD, T.embraceCast + 0.2, keep),
    ).toBe(true);
    const floor = f.sim.ctx.groundPos(victim.pos.x, victim.pos.z).y;
    run(f, T.embraceRise + 0.1, keep);
    expect(victim.carriedBy).toBe(lady.id);
    expect(aura(victim, LADY_EMBRACED)?.kind).toBe('stun');
    expect(victim.pos.y - floor).toBeGreaterThan(T.embraceHeight + EMBRACE_LIFT - 1);
    expect(took(f, victim, 'Frozen Embrace')).toBeGreaterThan(0);
    // The group deals the share: she lets go and sets them down.
    lady.hp -= Math.ceil(lady.maxHp * T.embraceBreakShare);
    const from = f.hits.length;
    run(f, T.embraceSetDown + 0.3, keep);
    expect(victim.carriedBy).toBeUndefined();
    expect(aura(victim, LADY_EMBRACED)).toBeUndefined();
    expect(victim.onGround).toBe(true);
    expect(took(f, victim, 'Shattering Fall', from)).toBe(0);
    expect(st(lady).embrace).toBeNull();
    expect(st(lady).dropped).toBe(false);
  });

  it('drops them onto the ice when the hold runs out, and the impact lands as they land', () => {
    const { f, lady } = ladyFight();
    const keep = holdAll(f);
    run(f, DT, keep);
    const s = st(lady);
    s.lamentTimer = 999;
    s.embraceTimer = 0;
    run(f, T.embraceCast + T.embraceRise + T.embraceHold - 0.3, keep);
    const victim = f.others.find((p) => p.carriedBy === lady.id) as Entity;
    expect(victim).toBeDefined();
    const from = f.hits.length;
    expect(until(f, () => victim.onGround && victim.carriedBy === undefined, 4, keep)).toBe(true);
    run(f, DT * 2, keep);
    expect(took(f, victim, 'Shattering Fall', from)).toBeGreaterThan(0);
    expect(aura(victim, LADY_EMBRACED)).toBeUndefined();
    expect(st(lady).dropped).toBe(true);
    // The deed is spoiled by a drop.
    f.sim.ctx.handleDeath(lady, f.tank);
    run(f, DT * 2);
    expect(earned(f, f.tank, LADY_DEED)).toBe(false);
  });

  it('takes two on heroic', () => {
    const { f, lady } = ladyFight('heroic');
    const keep = holdAll(f);
    run(f, DT, keep);
    const s = st(lady);
    s.lamentTimer = 999;
    s.embraceTimer = 0;
    run(f, T.embraceCast + T.embraceRise, keep);
    expect(f.others.filter((p) => p.carriedBy === lady.id)).toHaveLength(2);
    expect(f.tank.carriedBy).toBeUndefined();
  });
});

describe('the Lady of the Bonechill: nobody stays held', () => {
  function held(difficulty: 'normal' | 'heroic' = 'normal') {
    const { f, lady } = ladyFight(difficulty);
    const keep = holdAll(f);
    run(f, DT, keep);
    const s = st(lady);
    s.lamentTimer = 999;
    s.embraceTimer = 0;
    run(f, T.embraceCast + T.embraceRise + 0.2, keep);
    const victim = f.others.find((p) => p.carriedBy === lady.id) as Entity;
    expect(victim).toBeDefined();
    return { f, lady, keep, victim };
  }

  it('lets go of a player taken out of her reach (a teleport, a summon)', () => {
    const { f, victim } = held();
    put(f, victim, MID.x, MID.z - 60);
    run(f, DT * 3);
    expect(victim.carriedBy).toBeUndefined();
    expect(aura(victim, LADY_EMBRACED)).toBeUndefined();
  });

  it('frees a held player whose carrier is gone (the instance freed under them)', () => {
    const { f, lady, victim } = held();
    f.sim.ctx.dropEntity(lady.id);
    run(f, DT * 3);
    expect(victim.carriedBy).toBeUndefined();
  });

  it('lays a victim who dies in her arms on the ice', () => {
    const { f, lady, victim } = held();
    f.sim.ctx.handleDeath(victim, lady);
    run(f, DT * 2);
    expect(victim.carriedBy).toBeUndefined();
    expect(victim.onGround).toBe(true);
    expect(victim.pos.y).toBeCloseTo(f.sim.ctx.groundPos(victim.pos.x, victim.pos.z).y, 3);
  });

  it('sets her victims down gently when she evades mid-hold, never drops them', () => {
    const { f, lady, victim } = held();
    const from = f.hits.length;
    lady.aggroTargetId = null;
    lady.inCombat = false;
    lady.aiState = 'evade';
    run(f, DT * 3);
    expect(victim.carriedBy).toBeUndefined();
    expect(lady.cryptBossFight).toBeUndefined();
    run(f, 4);
    expect(took(f, victim, 'Shattering Fall', from)).toBe(0);
  });
});

describe('the Lady of the Bonechill: the Rime Path and the Bridal Freeze', () => {
  it('leaves rime where she drifts, and whoever stands on it walks on slippery ground', () => {
    const { f, lady } = ladyFight();
    run(f, DT);
    const s = st(lady);
    s.lamentTimer = 999;
    s.embraceTimer = 999;
    // Drag her across the floor.
    for (let i = 0; i < 40; i++) {
      put(f, lady, MID.x - 8 + i * 0.4, MID.z);
      run(f, DT);
    }
    const patches = objects(f, LADY_RIME_PATCH_TEMPLATE);
    expect(patches.length).toBeGreaterThanOrEqual(5);
    const on = f.others[0];
    put(f, on, patches[1].pos.x - f.ox, patches[1].pos.z - f.oz);
    run(f, DT * 2);
    expect(aura(on, SLIPPERY_GROUND_AURA)?.value2).toBe(T.iceGrip);
    put(f, on, MID.x, MID.z + 15);
    run(f, DT * 2);
    expect(aura(on, SLIPPERY_GROUND_AURA)).toBeUndefined();
    // Patches melt away.
    run(f, T.rimeSeconds + 1);
    expect(objects(f, LADY_RIME_PATCH_TEMPLATE).length).toBeLessThan(patches.length);
  });

  it('at half health freezes the whole ravine floor: everyone on it is on the ice', () => {
    const { f, lady } = ladyFight();
    const keep = holdAll(f);
    run(f, DT, keep);
    lady.hp = Math.floor(lady.maxHp * 0.49);
    expect(until(f, () => lady.castingAbility === LADY_BRIDAL_FREEZE, 1, keep)).toBe(true);
    expect(until(f, () => st(lady).frozen, T.freezeCast + 0.2, keep)).toBe(true);
    expect(objects(f, LADY_FROZEN_FLOOR_TEMPLATE)).toHaveLength(1);
    run(f, DT * 2, keep);
    for (const p of [f.tank, ...f.others]) expect(aura(p, SLIPPERY_GROUND_AURA)).toBeDefined();
    // Once only.
    run(f, 5, keep);
    expect(objects(f, LADY_FROZEN_FLOOR_TEMPLATE)).toHaveLength(1);
  });
});

describe('the Lady of the Bonechill: the wipe and the deed', () => {
  it('thaws, relights and sets down whoever she held when the fight resets', () => {
    const { f, lady } = ladyFight();
    const keep = holdAll(f);
    run(f, DT, keep);
    const s = st(lady);
    s.lanternDark[2] = 20;
    s.lamentTimer = 999;
    s.embraceTimer = 0;
    run(f, T.embraceCast + T.embraceRise + 0.2, keep);
    expect(f.others.some((p) => p.carriedBy === lady.id)).toBe(true);
    lady.hp = Math.floor(lady.maxHp * 0.4);
    for (const p of [f.tank, ...f.others]) f.sim.ctx.handleDeath(p, lady);
    run(f, 2);
    expect(lady.cryptBossFight).toBeUndefined();
    for (const p of f.others) expect(p.carriedBy).toBeUndefined();
    expect(lanternObj(f, 2).templateId).toBe(LADY_LANTERN_TEMPLATES.lit);
    expect(objects(f, LADY_RIME_PATCH_TEMPLATE)).toHaveLength(0);
    expect(objects(f, LADY_FROZEN_FLOOR_TEMPLATE)).toHaveLength(0);
  });

  it('grants Nobody Left Hanging when nobody was dropped', () => {
    const { f, lady } = ladyFight();
    run(f, 1);
    f.sim.ctx.handleDeath(lady, f.tank);
    run(f, DT * 2);
    expect(earned(f, f.tank, LADY_DEED)).toBe(true);
  });
});

describe('the Lady of the Bonechill: determinism', () => {
  it('two runs on one seed take the same victims and deal the same damage', () => {
    const trace = () => {
      const { f, lady } = ladyFight('heroic', 3, 77);
      const keep = holdAll(f);
      run(f, 45, keep);
      lady.hp = Math.floor(lady.maxHp * 0.45);
      run(f, 15, keep);
      return JSON.stringify(f.hits.map((h) => [h.targetId, h.amount, h.ability]));
    };
    expect(trace()).toBe(trace());
  });
});
