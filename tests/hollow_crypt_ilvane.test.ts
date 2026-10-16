// Cantor Ilvane and the Hollow Choir on the Choir Loft (src/sim/encounters/
// hollow_crypt/ilvane.ts and ilvane_organ.ts): the Dirge of the Hollow (a real
// Pummel cuts it; completed, it strikes and silences only who can SEE her, the
// choir pillars hiding the rest through the trash engine's G6 nova), Harmony
// with the living Choristers, the Bone Organ's two waves of note lanes,
// Crescendo below 30 percent, heroic Unbroken Verse and Encore, the reset, the
// Hush Now deed and determinism. Full Sim ticks in a real claimed Hollow Crypt.

import { describe, expect, it, vi } from 'vitest';
import { MOBS } from '../src/sim/data';
import {
  CHORISTER_ID,
  dirgeCastIdFor,
  ILVANE_BONE_ORGAN,
  ILVANE_CRESCENDO,
  ILVANE_DEED,
  ILVANE_DIRGE,
  ILVANE_DIRGE_CUT,
  ILVANE_DIRGE_SILENCE,
  ILVANE_HARMONY,
  ILVANE_ID,
  ILVANE_NOTE_BURST_TEMPLATE,
  ILVANE_NOTE_MARK_TEMPLATE,
  ILVANE_TUNING,
  ILVANE_UNBROKEN_DIRGE,
  NOTE_WAVES,
  ORGAN_BENCH,
} from '../src/sim/encounters/hollow_crypt';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
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

vi.setConfig({ testTimeout: 90_000 });

const T = ILVANE_TUNING;
const KEEP = new Set([ILVANE_ID, CHORISTER_ID]);
/** Where she stands in the loft, between the six choir pillars. */
const HER = { x: 0, z: 163 };
/** In plain sight of her, and hidden behind the (8, 158) pillar. */
const SEEN = { x: -4, z: 155 };
const HIDDEN = { x: 14, z: 154.25 };

function ilvaneFight(
  difficulty: 'normal' | 'heroic' = 'normal',
  seed = 23,
): { f: Fight; ilvane: Entity; choir: Entity[] } {
  const f = cryptFight(difficulty, 3, KEEP, seed);
  const ilvane = boss(f, ILVANE_ID);
  const choir = live(f, CHORISTER_ID).filter((c) => f.inst.mobIds.includes(c.id));
  put(f, ilvane, HER.x, HER.z);
  put(f, f.tank, HER.x, HER.z - 2.5);
  put(f, f.others[0], SEEN.x, SEEN.z);
  put(f, f.others[1], HIDDEN.x, HIDDEN.z);
  put(f, f.others[2], -20, 172);
  ilvane.maxHp = 1e6;
  ilvane.hp = ilvane.maxHp;
  for (const c of choir) {
    c.maxHp = 1e6;
    c.hp = c.maxHp;
  }
  f.sim.ctx.aggroMob(ilvane, f.tank, false);
  for (const c of choir) f.sim.ctx.aggroMob(c, f.tank, false);
  return { f, ilvane, choir };
}

function holdAll(f: Fight, extra: Entity[] = []): () => void {
  const hold = [f.tank, ...f.others, ...extra].map(
    (p) => [p, p.pos.x - f.ox, p.pos.z - f.oz] as const,
  );
  return () => {
    for (const [p, x, z] of hold) if (!p.dead) put(f, p, x, z);
  };
}

function st(ilvane: Entity) {
  const s = ilvane.cryptBossFight;
  if (s?.kind !== 'ilvane') throw new Error('no ilvane fight');
  return s;
}

function objects(f: Fight, templateId: string): Entity[] {
  return f.inst.objectIds
    .map((id) => f.sim.ctx.entities.get(id))
    .filter((e): e is Entity => e?.templateId === templateId);
}

/** Every Choir mechanic held off but the one a test drives. */
function quiet(s: ReturnType<typeof st>): void {
  s.dirgeTimer = 999;
  s.organTimer = 999;
}

describe('Cantor Ilvane: her template and the interrupt table', () => {
  it('carries no placeholder bigCast; the Dirge is kickable, the Unbroken Verse is not', () => {
    expect(MOBS[ILVANE_ID].bigCast).toBeUndefined();
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[ILVANE_DIRGE]?.school).toBe('shadow');
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[ILVANE_UNBROKEN_DIRGE]).toBeUndefined();
    expect(dirgeCastIdFor(0, true)).toBe(ILVANE_DIRGE);
    expect(dirgeCastIdFor(2, true)).toBe(ILVANE_UNBROKEN_DIRGE);
    expect(dirgeCastIdFor(2, false)).toBe(ILVANE_DIRGE);
  });
});

describe('Cantor Ilvane: Dirge of the Hollow', () => {
  it('strikes and silences only who can see her: the choir pillar hides the rest', () => {
    const { f, ilvane, choir } = ilvaneFight();
    const keep = holdAll(f, [ilvane, ...choir]);
    run(f, DT, keep);
    const s = st(ilvane);
    quiet(s);
    s.dirgeTimer = 0;
    expect(until(f, () => ilvane.castingAbility === ILVANE_DIRGE, 1, keep)).toBe(true);
    const from = f.hits.length;
    expect(until(f, () => ilvane.castingAbility === null, T.dirgeCast + 0.2, keep)).toBe(true);
    expect(took(f, f.others[0], 'Dirge of the Hollow', from)).toBeGreaterThan(0);
    expect(aura(f.others[0], ILVANE_DIRGE_SILENCE)?.kind).toBe('silence');
    expect(took(f, f.others[1], 'Dirge of the Hollow', from)).toBe(0);
    expect(aura(f.others[1], ILVANE_DIRGE_SILENCE)).toBeUndefined();
    expect(s.struck).toBe(true);
  });

  it('an uncut Dirge runs its full bar and never reads as a kick', () => {
    const { f, ilvane, choir } = ilvaneFight();
    const keep = holdAll(f, [ilvane, ...choir]);
    run(f, DT, keep);
    const s = st(ilvane);
    quiet(s);
    s.dirgeTimer = 0;
    expect(until(f, () => ilvane.castingAbility === ILVANE_DIRGE, 1, keep)).toBe(true);
    run(f, 1, keep);
    expect(ilvane.castRemaining).toBeCloseTo(T.dirgeCast - 1, 1);
    const cues = f.cues.length;
    expect(until(f, () => ilvane.castingAbility === null, T.dirgeCast, keep)).toBe(true);
    expect(s.quiet).toBe(0);
    expect(f.cues.slice(cues).some((c) => c.ability === ILVANE_DIRGE_CUT)).toBe(false);
  });

  it('she stays planted for the whole bar, facing her choir, while her tank backs away', () => {
    const { f, ilvane, choir } = ilvaneFight();
    // Everyone held but her and her tank: the tank backs off down the loft
    // every tick, so a boss that chased would walk after him mid-song.
    const keep = holdAll(f, choir);
    // Her tank at her side (east), so the mob AI turns her off the choir.
    put(f, f.tank, HER.x + 2.5, HER.z);
    const keepAll = holdAll(f, [ilvane, ...choir]);
    run(f, 0.5, keepAll);
    expect(Math.abs(ilvane.facing - Math.PI)).toBeGreaterThan(0.5);
    const s = st(ilvane);
    quiet(s);
    s.dirgeTimer = 0;
    expect(until(f, () => ilvane.castingAbility === ILVANE_DIRGE, 1, keepAll)).toBe(true);
    const at = { x: ilvane.pos.x, y: ilvane.pos.y, z: ilvane.pos.z };
    const facing = ilvane.facing;
    // She turns to the choir she sings to (the Choristers at the rail).
    const cx = (choir[0].pos.x + choir[1].pos.x) / 2;
    const cz = (choir[0].pos.z + choir[1].pos.z) / 2;
    expect(facing).toBeCloseTo(Math.atan2(cx - at.x, cz - at.z), 5);
    let step = 0;
    let moved = 0;
    let turned = 0;
    const from = f.hits.length;
    const landed = until(
      f,
      () => ilvane.castingAbility === null,
      T.dirgeCast + 0.2,
      () => {
        keep();
        step++;
        put(f, f.tank, HER.x + 9 + step * 0.2, HER.z - 8);
        moved = Math.max(moved, Math.hypot(ilvane.pos.x - at.x, ilvane.pos.z - at.z));
        if (Math.abs(ilvane.facing - facing) > 1e-9) turned++;
      },
    );
    expect(landed).toBe(true);
    expect(moved).toBeLessThan(1e-6);
    expect(ilvane.pos.y).toBeCloseTo(at.y, 6);
    expect(turned).toBe(0);
    // Planted, she still lands it on who can see her.
    expect(took(f, f.others[0], 'Dirge of the Hollow', from)).toBeGreaterThan(0);
  });

  it('a real Pummel cuts it: nothing lands, and she falls quiet', () => {
    const { f, ilvane, choir } = ilvaneFight();
    const keep = holdAll(f, [ilvane, ...choir]);
    run(f, DT, keep);
    const s = st(ilvane);
    quiet(s);
    s.dirgeTimer = 0;
    expect(until(f, () => ilvane.castingAbility === ILVANE_DIRGE, 1, keep)).toBe(true);
    run(f, 0.5, keep);
    f.tank.targetId = ilvane.id;
    const cues = f.cues.length;
    f.sim.castAbility('pummel', f.tank.id);
    run(f, DT * 2, keep);
    expect(ilvane.castingAbility).toBeNull();
    expect(f.cues.slice(cues).some((c) => c.ability === ILVANE_DIRGE_CUT)).toBe(true);
    const from = f.hits.length;
    run(f, T.dirgeCast, keep);
    expect(took(f, f.others[0], 'Dirge of the Hollow', from)).toBe(0);
    expect(s.struck).toBe(false);
    // Quiet: no Dirge restarts at once even with its timer due.
    s.dirgeTimer = 0;
    run(f, DT * 2, keep);
    expect(ilvane.castingAbility).toBeNull();
  });
});

describe('Cantor Ilvane: Harmony', () => {
  it('takes 30 percent off her damage per living Chorister', () => {
    const { f, ilvane, choir } = ilvaneFight();
    const keep = holdAll(f, [ilvane]);
    run(f, DT, keep);
    quiet(st(ilvane));
    expect(choir).toHaveLength(2);
    expect(aura(ilvane, ILVANE_HARMONY)?.value).toBeCloseTo(0.6, 9);
    f.sim.ctx.handleDeath(choir[0], f.tank);
    run(f, DT * 2, keep);
    expect(aura(ilvane, ILVANE_HARMONY)?.value).toBeCloseTo(0.3, 9);
    const before = ilvane.hp;
    f.sim.ctx.dealDamage(f.tank, ilvane, 1000, false, 'physical', 'test', 'hit', true);
    expect(before - ilvane.hp).toBe(700);
    f.sim.ctx.handleDeath(choir[1], f.tank);
    run(f, DT * 2, keep);
    expect(aura(ilvane, ILVANE_HARMONY)).toBeUndefined();
  });
});

describe('Cantor Ilvane: the Bone Organ', () => {
  it('walks to the keys and plays two waves of note lanes; each lane bursts on who stands in it', () => {
    const { f, ilvane, choir } = ilvaneFight();
    // One player in a first-wave lane, one in a second-wave lane, the tank between.
    put(f, f.others[0], NOTE_WAVES[0][2], 160);
    put(f, f.others[1], NOTE_WAVES[1][2], 160);
    put(f, f.tank, -6, 160);
    const keep = holdAll(f, choir);
    run(f, DT, keep);
    const s = st(ilvane);
    quiet(s);
    s.organTimer = 0;
    expect(
      until(f, () => ilvane.castingAbility === ILVANE_BONE_ORGAN, T.organStrideMax + 0.5, keep),
    ).toBe(true);
    expect(
      Math.hypot(ilvane.pos.x - f.ox - ORGAN_BENCH.x, ilvane.pos.z - f.oz - ORGAN_BENCH.z),
    ).toBeLessThan(0.5);
    run(f, T.organWaveAt[0] + 0.1, keep);
    expect(objects(f, ILVANE_NOTE_MARK_TEMPLATE)).toHaveLength(NOTE_WAVES[0].length);
    const from = f.hits.length;
    run(f, T.organGather, keep);
    expect(objects(f, ILVANE_NOTE_BURST_TEMPLATE)).toHaveLength(NOTE_WAVES[0].length);
    expect(took(f, f.others[0], 'Bone Organ', from)).toBeGreaterThan(0);
    expect(took(f, f.others[1], 'Bone Organ', from)).toBe(0);
    const mid = f.hits.length;
    expect(until(f, () => s.organ === null, T.organPlay + 1, keep)).toBe(true);
    expect(took(f, f.others[1], 'Bone Organ', mid)).toBeGreaterThan(0);
    expect(took(f, f.tank, 'Bone Organ')).toBe(0);
    expect(objects(f, ILVANE_NOTE_MARK_TEMPLATE)).toHaveLength(0);
    expect(objects(f, ILVANE_NOTE_BURST_TEMPLATE)).toHaveLength(0);
  });
});

describe('Cantor Ilvane: Crescendo', () => {
  it('below 30 percent she sings faster: a shorter Dirge and a third wave', () => {
    const { f, ilvane, choir } = ilvaneFight();
    const keep = holdAll(f, [ilvane, ...choir]);
    run(f, DT, keep);
    const s = st(ilvane);
    quiet(s);
    ilvane.hp = Math.floor(ilvane.maxHp * 0.29);
    run(f, DT * 2, keep);
    expect(s.crescendo).toBe(true);
    expect(aura(ilvane, ILVANE_CRESCENDO)).toBeDefined();
    s.dirgeTimer = 0;
    expect(until(f, () => ilvane.castingAbility === ILVANE_DIRGE, 1, keep)).toBe(true);
    expect(ilvane.castTotal).toBeCloseTo(T.dirgeCastCrescendo, 9);
  });
});

describe('Cantor Ilvane: heroic', () => {
  it('every third Dirge is the Unbroken Verse: a Pummel cannot cut it', () => {
    const { f, ilvane, choir } = ilvaneFight('heroic');
    const keep = holdAll(f, [ilvane, ...choir]);
    run(f, DT, keep);
    const s = st(ilvane);
    quiet(s);
    s.dirges = 2;
    s.dirgeTimer = 0;
    expect(until(f, () => ilvane.castingAbility === ILVANE_UNBROKEN_DIRGE, 1, keep)).toBe(true);
    run(f, 0.4, keep);
    f.tank.targetId = ilvane.id;
    f.sim.castAbility('pummel', f.tank.id);
    run(f, DT * 2, keep);
    expect(ilvane.castingAbility).toBe(ILVANE_UNBROKEN_DIRGE);
    const from = f.hits.length;
    run(f, T.dirgeCast, keep);
    expect(took(f, f.others[0], 'Dirge of the Hollow', from)).toBeGreaterThan(0);
  });

  it('Encore: a Chorister dead too long while its partner lives rises again', () => {
    const { f, ilvane, choir } = ilvaneFight('heroic');
    const keep = holdAll(f, [ilvane]);
    run(f, DT, keep);
    quiet(st(ilvane));
    f.sim.ctx.handleDeath(choir[0], f.tank);
    run(f, T.encoreSeconds - 1, keep);
    expect(st(ilvane).choristerIds.filter((id) => !f.sim.ctx.entities.get(id)?.dead)).toHaveLength(
      1,
    );
    run(f, 1.5, keep);
    const standing = st(ilvane).choristerIds.filter((id) => {
      const e = f.sim.ctx.entities.get(id);
      return e && !e.dead;
    });
    expect(standing).toHaveLength(2);
    expect(aura(ilvane, ILVANE_HARMONY)?.value).toBeCloseTo(0.6, 9);
  });

  it('no Encore when both fall together', () => {
    const { f, ilvane, choir } = ilvaneFight('heroic');
    const keep = holdAll(f, [ilvane]);
    run(f, DT, keep);
    quiet(st(ilvane));
    f.sim.ctx.handleDeath(choir[0], f.tank);
    run(f, 3, keep);
    f.sim.ctx.handleDeath(choir[1], f.tank);
    run(f, T.encoreSeconds + 1, keep);
    expect(live(f, CHORISTER_ID)).toHaveLength(0);
    expect(aura(ilvane, ILVANE_HARMONY)).toBeUndefined();
  });

  it('never rises on normal', () => {
    const { f, ilvane, choir } = ilvaneFight('normal');
    const keep = holdAll(f, [ilvane]);
    run(f, DT, keep);
    quiet(st(ilvane));
    f.sim.ctx.handleDeath(choir[0], f.tank);
    run(f, T.encoreSeconds + 1, keep);
    expect(live(f, CHORISTER_ID)).toHaveLength(1);
  });
});

describe('Cantor Ilvane: the reset and the deed', () => {
  it('clears the notes and her harmony when the fight resets', () => {
    const { f, ilvane, choir } = ilvaneFight();
    const keep = holdAll(f, choir);
    run(f, DT, keep);
    const s = st(ilvane);
    quiet(s);
    s.organTimer = 0;
    run(f, T.organStrideMax + 1, keep);
    for (const p of [f.tank, ...f.others]) f.sim.ctx.handleDeath(p, ilvane);
    run(f, 3);
    expect(ilvane.cryptBossFight).toBeUndefined();
    expect(objects(f, ILVANE_NOTE_MARK_TEMPLATE)).toHaveLength(0);
    expect(aura(ilvane, ILVANE_HARMONY)).toBeUndefined();
  });

  it('grants Hush Now only when no Dirge ever struck anyone', () => {
    for (const strike of [false, true]) {
      const { f, ilvane, choir } = ilvaneFight();
      const keep = holdAll(f, [ilvane, ...choir]);
      run(f, DT, keep);
      const s = st(ilvane);
      quiet(s);
      if (strike) {
        s.dirgeTimer = 0;
        run(f, T.dirgeCast + 0.3, keep);
      }
      f.sim.ctx.handleDeath(ilvane, f.tank);
      run(f, DT * 2);
      expect(earned(f, f.tank, ILVANE_DEED)).toBe(!strike);
    }
  });
});

describe('Cantor Ilvane: determinism', () => {
  it('two runs on one seed deal the same damage', () => {
    const trace = () => {
      const { f, ilvane, choir } = ilvaneFight('heroic', 61);
      const keep = holdAll(f, choir);
      run(f, 40, keep);
      ilvane.hp = Math.floor(ilvane.maxHp * 0.25);
      run(f, 15, keep);
      return JSON.stringify(f.hits.map((h) => [h.targetId, h.amount, h.ability]));
    };
    expect(trace()).toBe(trace());
  });
});
