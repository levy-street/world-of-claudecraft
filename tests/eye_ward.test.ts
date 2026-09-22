// The standing eye ward and the blind window (src/sim/mob/eye_ward.ts).
//
// The claims worth pinning are the ones a screenshot cannot show. The ward has to actually
// CHANGE the damage a raid deals (a buff that renders on his frame while doing nothing is
// the invisible failure), the blind has to actually remove it for exactly its window, and
// the seal has to refuse a second blind, because a chain-blindable boss has no ward at all
// in practice. Godmode stays banned here like the sibling suites: dealDamage is the
// instrument this whole file measures with.
import { beforeEach, describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import {
  blindEyeWard,
  EYE_WARD_AURA_ID,
  EYE_WARD_BLINDED_AURA_ID,
  eyeWardBlinded,
  eyeWardVulnerable,
  tickEyeWard,
} from '../src/sim/mob/eye_ward';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const BALGATH = 'balgath_cyclops';

describe('the opt-in', () => {
  it('is declared by the world boss with a window shorter than its seal', () => {
    const def = MOBS[BALGATH]?.eyeWard;
    expect(def).toBeDefined();
    if (!def) return;
    // The rhythm the numbers encode: a window, the ward re-forms, a forced lull. A seal
    // shorter than the window would let two pokes overlap into a permanent blind.
    expect(def.refractorySeconds).toBeGreaterThan(def.blindSeconds);
    expect(def.reduction).toBeGreaterThan(0.4);
    expect(def.reduction).toBeLessThan(0.8);
  });

  it('is declared by nobody else', () => {
    const others = Object.entries(MOBS).filter(([id, m]) => id !== BALGATH && m.eyeWard);
    expect(others.map(([id]) => id)).toEqual([]);
  });
});

describe('the ward in a live world', () => {
  let sim: Sim;
  let boss: Entity;
  let ctx: SimContext;

  beforeEach(() => {
    sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    const id = (
      sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss(BALGATH, 0, 390);
    const e = sim.entities.get(id);
    if (!e) throw new Error('no boss');
    boss = e;
    boss.pos.y = groundHeight(0, 390, sim.cfg.seed);
    boss.prevPos = { ...boss.pos };
    ctx = (sim as unknown as { ctx: SimContext }).ctx;
    // Out of his reach so the subject of every assertion is the ward, not his fists.
    sim.player.pos.x = 200;
    sim.player.pos.z = 390;
    sim.player.prevPos = { ...sim.player.pos };
    sim.tick();
  });

  const dmg = (amount: number): number => {
    const before = boss.hp;
    (sim as unknown as { dealDamage(...a: unknown[]): number }).dealDamage(
      sim.player,
      boss,
      amount,
      false,
      'physical',
      'Test Strike',
      'hit',
      true,
    );
    return before - boss.hp;
  };

  it('forms on his first alive tick without being asked', () => {
    expect(boss.auras.some((a) => a.id === EYE_WARD_AURA_ID)).toBe(true);
  });

  it('actually turns damage away while it stands', () => {
    const def = MOBS[BALGATH]?.eyeWard;
    if (!def) throw new Error('no def');
    const landed = dmg(1000);
    expect(landed).toBe(Math.round(1000 * (1 - def.reduction)));
  });

  it('a blind drops the ward, opens the full-damage window, and stamps the timer debuff', () => {
    expect(blindEyeWard(ctx, boss)).toBe(true);
    sim.tick();
    expect(boss.auras.some((a) => a.id === EYE_WARD_AURA_ID)).toBe(false);
    expect(boss.auras.some((a) => a.id === EYE_WARD_BLINDED_AURA_ID)).toBe(true);
    expect(eyeWardBlinded(ctx, boss)).toBe(true);
    expect(dmg(1000)).toBe(1000);
  });

  it('the ward re-forms by itself when the window closes', () => {
    const def = MOBS[BALGATH]?.eyeWard;
    if (!def) throw new Error('no def');
    blindEyeWard(ctx, boss);
    for (let i = 0; i < 20 * (def.blindSeconds + 1); i++) sim.tick();
    expect(eyeWardBlinded(ctx, boss)).toBe(false);
    expect(boss.auras.some((a) => a.id === EYE_WARD_AURA_ID)).toBe(true);
    expect(dmg(1000)).toBeLessThan(1000);
  });

  it('refuses a second blind through the window AND the seal, then allows one', () => {
    const def = MOBS[BALGATH]?.eyeWard;
    if (!def) throw new Error('no def');
    expect(blindEyeWard(ctx, boss)).toBe(true);
    // Mid-window: refused.
    expect(blindEyeWard(ctx, boss)).toBe(false);
    // Window over, seal running: still refused.
    for (let i = 0; i < 20 * (def.blindSeconds + 2); i++) sim.tick();
    expect(eyeWardVulnerable(ctx, boss)).toBe(false);
    expect(blindEyeWard(ctx, boss)).toBe(false);
    // Seal expired: the fight breathes and the next window is earnable.
    for (let i = 0; i < 20 * def.refractorySeconds; i++) sim.tick();
    expect(eyeWardVulnerable(ctx, boss)).toBe(true);
    expect(blindEyeWard(ctx, boss)).toBe(true);
  });

  it('draws no rng, so the ward cannot fork the world', () => {
    const rng = (sim as unknown as { rng: object }).rng;
    const before = JSON.stringify(rng);
    blindEyeWard(ctx, boss);
    expect(JSON.stringify(rng)).toBe(before);
  });

  it('does nothing for a mob without the template field', () => {
    const id = (
      sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss('bogtoad', 30, 390);
    const toad = sim.entities.get(id);
    if (!toad) throw new Error('no toad');
    sim.tick();
    expect(toad.auras.some((a) => a.id === EYE_WARD_AURA_ID)).toBe(false);
    expect(blindEyeWard(ctx, toad)).toBe(false);
  });
});

describe('the auras are pure presentation of the two clocks', () => {
  // The module header promises the auras cannot drift from the timestamps. That held for the
  // ward and NOT for the Blinded aura, which only the blind itself ever applied. Since the
  // on-boss state cues (the badge over his head, his body aura) read that aura, the hole was
  // worse than cosmetic: anything stripping it mid-window left him genuinely vulnerable with
  // every indicator saying otherwise.
  const makeSim = () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    const id = (
      sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss('balgath_cyclops', 0, 390);
    const boss = sim.entities.get(id);
    if (!boss) throw new Error('no boss');
    return { sim, boss, ctx: (sim as unknown as { ctx: SimContext }).ctx };
  };
  const ids = (boss: Entity) => boss.auras.map((a) => a.id).sort();

  it('re-derives the Blinded aura from the clock, not just from the blind that set it', () => {
    const { sim, boss, ctx } = makeSim();
    boss.eyeWardDownUntil = ctx.time + 10;
    boss.eyeWardSealedUntil = ctx.time + 50;
    // No call to blindEyeWard at all: the clock alone says he is blinded.
    tickEyeWard(ctx, boss);
    expect(ids(boss)).toContain('eye_ward_blinded');
    expect(ids(boss)).not.toContain('eye_ward');
    void sim;
  });

  it('puts the Blinded aura back if something strips it mid-window', () => {
    const { boss, ctx } = makeSim();
    expect(blindEyeWard(ctx, boss)).toBe(true);
    expect(ids(boss)).toContain('eye_ward_blinded');
    // A cleanse, a wipe, any aura sweep.
    boss.auras = [];
    tickEyeWard(ctx, boss);
    expect(ids(boss)).toEqual(['eye_ward_blinded']);
  });

  it('never lets the Blinded aura outlive the window it mirrors', () => {
    const { boss, ctx } = makeSim();
    expect(blindEyeWard(ctx, boss)).toBe(true);
    // The window closes but the aura is still sitting there (a long remaining, a paused
    // timer, anything): the reconcile is what makes the timestamp the authority.
    boss.eyeWardDownUntil = ctx.time - 1;
    tickEyeWard(ctx, boss);
    expect(ids(boss)).not.toContain('eye_ward_blinded');
    expect(ids(boss)).toContain('eye_ward');
  });

  it('re-derives a window remaining that matches the clock, not the authored full duration', () => {
    // A re-derive mid-window must not silently restart the timer the raid is reading.
    const { boss, ctx } = makeSim();
    boss.eyeWardDownUntil = ctx.time + 4;
    boss.auras = [];
    tickEyeWard(ctx, boss);
    const aura = boss.auras.find((a) => a.id === 'eye_ward_blinded');
    expect(aura?.remaining).toBeCloseTo(4, 1);
  });
});
