// The Gaol Turnkey, the Sunken Gaol's miniboss (src/sim/encounters/sunken_bastion/
// turnkey.ts): the Iron Cage and its button-mash escape (server-validated and
// rate-limited through the interact command), the group breaking the bars, the
// crush, the heroic double cage and brine flood, the wipe and the deed.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { SUNKEN_BASTION_GATES } from '../src/sim/content/sunken_bastion';
import { DUNGEONS, MOBS } from '../src/sim/data';
import {
  bastionWardHitPoints,
  cageDropHeight,
  cageEscapeProgress,
  cageFloodShare,
  GAOL_CAGE_ID,
  TURNKEY_CAGE_MARK,
  TURNKEY_CAGED,
  TURNKEY_ID,
  TURNKEY_IRON_CAGE,
  TURNKEY_TUNING,
} from '../src/sim/encounters/sunken_bastion';
import { DT, type Entity } from '../src/sim/types';
import {
  aura,
  boss,
  earned,
  engage,
  type Fight,
  fight,
  live,
  put,
  run,
  tick,
  took,
} from './helpers/bastion_fight';

// Whole-fight scenarios over many sim ticks: room for a loaded worker.
vi.setConfig({ testTimeout: 60_000 });

// ---------------------------------------------------------------------------
describe('the Gaol Turnkey miniboss: the Iron Cage and the escape', () => {
  function gaol(difficulty: 'normal' | 'heroic' = 'normal'): { f: Fight; turnkey: Entity } {
    const f = fight(difficulty);
    const turnkey = boss(f, TURNKEY_ID);
    put(f, turnkey, -20, 96);
    put(f, f.tank, -18, 94);
    for (const [i, p] of f.others.entries()) put(f, p, -6 + i * 5, 86);
    engage(f, turnkey);
    return { f, turnkey };
  }

  /** Run to the first cage landing; returns the prisoner and the cage. */
  function caged(f: Fight): { prisoner: Entity; cage: Entity } {
    run(f, TURNKEY_TUNING.cageFirst + TURNKEY_TUNING.cageCast + DT * 3);
    const prisoner = f.others.find((p) => aura(p, TURNKEY_CAGED));
    if (!prisoner) throw new Error('nobody caged');
    const cage = f.sim.ctx.entities.get(aura(prisoner, TURNKEY_CAGED)?.sourceId ?? -1);
    if (!cage) throw new Error('no cage');
    return { prisoner, cage };
  }

  it('is a miniboss now: a boss-sized body, its own pull, loot and a finder row', () => {
    const t = MOBS[TURNKEY_ID];
    expect(t.ccImmune).toBe(true);
    expect(t.slowImmune).toBe(true);
    expect(t.loot.filter((l) => l.rollGroup === 'turnkey_guaranteed')).toHaveLength(3);
    const spawns = DUNGEONS.sunken_bastion.spawns.filter((s) => s.mobId === TURNKEY_ID);
    expect(spawns).toHaveLength(1);
    expect(spawns[0].packId).toBe('turnkey');
  });

  it('marks a non-tank for 1.6 s, then drops a cage over them from above', () => {
    const { f, turnkey } = gaol();
    run(f, TURNKEY_TUNING.cageFirst + DT * 2);
    expect(turnkey.castingAbility).toBe(TURNKEY_IRON_CAGE);
    expect(turnkey.castTotal).toBeCloseTo(TURNKEY_TUNING.cageCast, 5);
    const marked = f.others.find((p) => aura(p, TURNKEY_CAGE_MARK));
    expect(marked).toBeDefined();
    expect(aura(f.tank, TURNKEY_CAGE_MARK)).toBeUndefined();
    run(f, TURNKEY_TUNING.cageCast);
    const cage = f.sim.ctx.entities.get(aura(marked as Entity, TURNKEY_CAGED)?.sourceId ?? -1);
    expect(cage?.templateId).toBe(GAOL_CAGE_ID);
    expect(cage?.maxHp).toBe(TURNKEY_TUNING.cageHits);
    // The Caged aura is an unbreakable stun and names the cage.
    const a = aura(marked as Entity, TURNKEY_CAGED);
    expect(a?.kind).toBe('stun');
    expect(a?.unbreakableControl).toBe(true);
    // It fell onto them: pure fall curve, landed after dropSeconds.
    expect(cageDropHeight(0)).toBe(TURNKEY_TUNING.dropHeight);
    expect(cageDropHeight(TURNKEY_TUNING.dropSeconds)).toBe(0);
    run(f, TURNKEY_TUNING.dropSeconds + DT);
    expect(Math.abs((cage as Entity).pos.y - (marked as Entity).pos.y)).toBeLessThan(0.05);
  });

  it('every counted escape press breaks one point; presses closer than the gap are ignored', () => {
    const { f } = gaol();
    const { prisoner, cage } = caged(f);
    const before = cage.hp;
    // A burst of twenty presses inside one tick counts once.
    for (let i = 0; i < 20; i++) f.sim.interact(prisoner.id);
    expect(cage.hp).toBe(before - 1);
    // Pressed every tick for 1.5 s: counted only when the gap has passed.
    const st = cage.bastionFight?.kind === 'cage' ? cage.bastionFight : null;
    const pressed = st?.presses ?? 0;
    for (let k = 0; k < 30; k++) {
      f.sim.interact(prisoner.id);
      tick(f);
    }
    const counted = (st?.presses ?? 0) - pressed;
    expect(counted).toBeLessThanOrEqual(Math.ceil(1.5 / TURNKEY_TUNING.pressGap));
    expect(counted).toBeGreaterThanOrEqual(8);
  });

  it('only the prisoner of a live cage can press it; anyone else interacts as usual', () => {
    const { f } = gaol();
    const { prisoner, cage } = caged(f);
    const helper = f.others.find((p) => p !== prisoner) as Entity;
    const before = cage.hp;
    f.sim.interact(helper.id);
    expect(cage.hp).toBe(before);
    f.sim.interact(prisoner.id);
    expect(cage.hp).toBe(before - 1);
  });

  it('the server runs the same press: its interact command goes straight to sim.interact', () => {
    const game = readFileSync('server/game.ts', 'utf8');
    expect(game).toMatch(/case 'interact':\s*\n\s*sim\.interact\(pid\);/);
  });

  it('mashing breaks the cage out and frees the prisoner', () => {
    const { f } = gaol();
    const { prisoner, cage } = caged(f);
    const cageId = cage.id;
    for (let k = 0; k < 200 && aura(prisoner, TURNKEY_CAGED); k++) {
      f.sim.interact(prisoner.id);
      tick(f);
    }
    expect(aura(prisoner, TURNKEY_CAGED)).toBeUndefined();
    expect(f.sim.ctx.entities.has(cageId)).toBe(false);
  });

  it('the cage mends a point every 0.6 s while nobody presses', () => {
    const { f } = gaol();
    const { prisoner, cage } = caged(f);
    for (let k = 0; k < 18; k++) {
      f.sim.interact(prisoner.id);
      tick(f);
    }
    const low = cage.hp;
    expect(low).toBeLessThan(cage.maxHp);
    run(f, TURNKEY_TUNING.mendEvery * 3 + DT);
    expect(cage.hp).toBe(Math.min(cage.maxHp, low + 3));
    expect(cageEscapeProgress(cage.hp, cage.maxHp)).toBeCloseTo(1 - cage.hp / cage.maxHp, 6);
  });

  it("a teammate's hit breaks two points whatever it would have dealt", () => {
    const { f } = gaol();
    const { prisoner, cage } = caged(f);
    const helper = f.others.find((p) => p !== prisoner) as Entity;
    expect(bastionWardHitPoints(helper, cage)).toBe(TURNKEY_TUNING.helperPoints);
    expect(bastionWardHitPoints(boss(f, TURNKEY_ID), cage)).toBeNull();
    const before = cage.hp;
    f.sim.dealDamage(helper, cage, 5000, true, 'fire', 'Fireball', 'hit', false);
    expect(cage.hp).toBe(before - TURNKEY_TUNING.helperPoints);
    // The group alone smashes it open.
    for (let k = 0; k < 12 && !cage.dead; k++)
      f.sim.dealDamage(f.tank, cage, 30, false, 'physical', 'Strike', 'hit', false);
    run(f, DT * 2);
    expect(aura(prisoner, TURNKEY_CAGED)).toBeUndefined();
  });

  it('left shut for 10 s it crushes its prisoner for 30 percent, bursts, and costs the deed', () => {
    const { f, turnkey } = gaol();
    const { prisoner, cage } = caged(f);
    const from = f.hits.length;
    run(f, TURNKEY_TUNING.cageMax - 0.3);
    expect(aura(prisoner, TURNKEY_CAGED)).toBeDefined();
    expect(took(f, prisoner, 'Crushing Irons', from)).toBe(0);
    const max = prisoner.maxHp;
    run(f, 0.5);
    expect(aura(prisoner, TURNKEY_CAGED)).toBeUndefined();
    expect(f.sim.ctx.entities.has(cage.id)).toBe(false);
    expect(took(f, prisoner, 'Crushing Irons', from)).toBeGreaterThanOrEqual(
      Math.round(max * TURNKEY_TUNING.crushShare) - 1,
    );
    f.sim.ctx.handleDeath(turnkey, f.tank);
    run(f, DT * 2);
    expect(earned(f, f.tank, 'dgn_turnkey_cage')).toBe(false);
  });

  it('heroic: two cages at once, twenty points each, and the brine rises inside', () => {
    const { f } = gaol('heroic');
    run(f, TURNKEY_TUNING.cageFirst + TURNKEY_TUNING.cageCast + DT * 3);
    const prisoners = f.others.filter((p) => aura(p, TURNKEY_CAGED));
    expect(prisoners).toHaveLength(TURNKEY_TUNING.cagesHeroic);
    const cages = live(f, GAOL_CAGE_ID);
    expect(cages).toHaveLength(2);
    for (const c of cages) expect(c.maxHp).toBe(TURNKEY_TUNING.cageHitsHeroic);
    const p = prisoners[0];
    const from = f.hits.length;
    run(f, 2.05);
    // Two flood ticks: 2 then 3 percent of max health.
    const want = Math.round(p.maxHp * cageFloodShare(1)) + Math.round(p.maxHp * cageFloodShare(2));
    expect(took(f, p, 'Brine Flood', from)).toBeGreaterThanOrEqual(want - 2);
  });

  it('a wipe opens every cage; a clean kill earns the deed', () => {
    const { f, turnkey } = gaol();
    const { prisoner, cage } = caged(f);
    turnkey.aiState = 'evade';
    run(f, DT * 2);
    expect(aura(prisoner, TURNKEY_CAGED)).toBeUndefined();
    expect(f.sim.ctx.entities.has(cage.id)).toBe(false);
    const again = gaol();
    const freed = caged(again.f);
    for (let k = 0; k < 200 && aura(freed.prisoner, TURNKEY_CAGED); k++) {
      again.f.sim.interact(freed.prisoner.id);
      tick(again.f);
    }
    again.f.sim.ctx.handleDeath(again.turnkey, again.f.tank);
    run(again.f, DT * 2);
    expect(earned(again.f, again.f.tank, 'dgn_turnkey_cage')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('the Gaol Turnkey keeps the Gaol Grate (the way on to Ossick and the keep)', () => {
  const grate = SUNKEN_BASTION_GATES.find((g) => g.id === 'gaol_grate');
  const spawn = DUNGEONS.sunken_bastion.spawns.find((s) => s.mobId === TURNKEY_ID);

  it('stands squarely in front of the grate, on the gaol side, facing the yard', () => {
    if (!grate || !spawn) throw new Error('no grate or no Turnkey');
    // The grate spans x across z = grate.z; the gaol lies north of it.
    expect(spawn.z).toBeGreaterThan(grate.z);
    expect(spawn.z - grate.z).toBeLessThanOrEqual(8);
    expect(Math.abs(spawn.x - grate.x)).toBeLessThan(grate.hw / 2);
    // Facing the yard the group crosses to reach him (north, sim yaw 0).
    expect(Math.cos(spawn.facing ?? Math.PI)).toBeGreaterThan(0.95);
    // The grate opens only once he (and the yard) are dead.
    expect(grate.packs).toContain('turnkey');
  });

  it('holds his own pull: no other held pack stands within his reach', () => {
    if (!spawn) throw new Error('no Turnkey');
    const reach = (MOBS[TURNKEY_ID].aggroRadius ?? 0) + 4;
    for (const s of DUNGEONS.sunken_bastion.spawns) {
      if (s === spawn || s.patrol || s.packId === undefined) continue;
      if (s.packId === 'turnkey') continue;
      expect(Math.hypot(s.x - spawn.x, s.z - spawn.z), `${s.packId} ${s.mobId}`).toBeGreaterThan(
        reach,
      );
    }
  });

  it('pulled at his gate he fights alone, and walks back to it when the group falls', () => {
    const f = fight('normal', 1);
    const turnkey = boss(f, TURNKEY_ID);
    const home = { x: turnkey.pos.x - f.ox, z: turnkey.pos.z - f.oz };
    expect(home.x).toBeCloseTo(spawn?.x ?? 0, 1);
    expect(home.z).toBeCloseTo(spawn?.z ?? 0, 1);
    put(f, f.tank, home.x, home.z + 6);
    put(f, f.others[0], home.x + 3, home.z + 9);
    engage(f, turnkey);
    run(f, 3);
    expect(turnkey.inCombat).toBe(true);
    // Only the Turnkey answered (the yard's packs were cleared by the harness,
    // and none stands close enough to join anyway).
    const engaged = f.inst.mobIds
      .map((id) => f.sim.ctx.entities.get(id))
      .filter((e): e is Entity => !!e && !e.dead && e.inCombat && e.templateId !== GAOL_CAGE_ID);
    expect(engaged.map((e) => e.templateId)).toEqual([TURNKEY_ID]);
    for (const p of [f.tank, ...f.others]) f.sim.ctx.handleDeath(p, turnkey);
    run(f, 20);
    expect(turnkey.inCombat).toBe(false);
    const at = { x: turnkey.pos.x - f.ox, z: turnkey.pos.z - f.oz };
    expect(Math.hypot(at.x - home.x, at.z - home.z)).toBeLessThan(2);
  });
});
