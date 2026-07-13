// End-to-end bout coverage for the balance simulator harness: real duels and
// real PvE kills on the real Sim, deterministic per seed, with the arena world
// swapped back afterwards so no other suite in the worker sees it.
import { describe, expect, it } from 'vitest';
import { runDuelBout, runPveBout } from '../scripts/balance_sim/bout';
import { specByKey } from '../scripts/balance_sim/spec_catalog';
import { BUILTIN_WORLD, getActiveWorldContent } from '../src/sim/data';

const spec = (key: string) => {
  const s = specByKey(key);
  if (!s) throw new Error(`missing spec ${key}`);
  return s;
};

describe('duel bouts', () => {
  it('a melee vs caster duel completes with a decided winner and real casts', () => {
    const r = runDuelBout({ spec: spec('arms_warrior') }, { spec: spec('frost_mage') }, 1001);
    expect(r.endReason).toBe('duelEnd');
    expect(['a', 'b']).toContain(r.winner);
    expect(r.seconds).toBeGreaterThan(3);
    expect(r.a.damageDone).toBeGreaterThan(0);
    expect(r.b.damageDone).toBeGreaterThan(0);
    // Both fighters actually played their kit, not just auto-attacks.
    expect(Object.keys(r.a.castsByAbility).length).toBeGreaterThan(0);
    expect(r.b.castsByAbility.frostbolt ?? 0).toBeGreaterThan(0);
    // The mage's roots register as control pressure.
    expect(r.b.controlTicksInflicted).toBeGreaterThan(0);
  }, 30000);

  it('is byte-deterministic for the same seed and diverges across seeds', () => {
    const one = runDuelBout({ spec: spec('feral_druid') }, { spec: spec('shadow_priest') }, 77);
    const two = runDuelBout({ spec: spec('feral_druid') }, { spec: spec('shadow_priest') }, 77);
    expect(two).toEqual(one);
    const other = runDuelBout({ spec: spec('feral_druid') }, { spec: spec('shadow_priest') }, 78);
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(one));
  }, 60000);

  it('restores the built-in world content after the bout', () => {
    runDuelBout({ spec: spec('arms_warrior') }, { spec: spec('holy_priest') }, 5, 30);
    expect(getActiveWorldContent()).toBe(BUILTIN_WORLD);
  }, 30000);

  it('a passive healer mirror trips the stalemate guard well before the cap', () => {
    const r = runDuelBout({ spec: spec('holy_priest') }, { spec: spec('holy_priest') }, 1, 600);
    expect(r.winner).toBe('draw');
    expect(r.endReason).toBe('stalemate');
    expect(r.seconds).toBeCloseTo(30, 1);
  }, 60000);

  it('a contested healer mirror resolves with healing on both sides', () => {
    const r = runDuelBout({ spec: spec('holy_priest') }, { spec: spec('holy_priest') }, 9, 600);
    expect(r.winner).toBe('a');
    expect(r.endReason).toBe('duelEnd');
    expect(r.a.healingDone).toBeGreaterThan(0);
    expect(r.b.healingDone).toBeGreaterThan(0);
  }, 60000);

  it('counts a real death behind the duel 1 hp guard in the bout metrics', () => {
    // Seed observed in a full experiment run: the in-flight-shot hole lands a
    // killing blow on the same tick the duel ends.
    const r = runDuelBout(
      { spec: spec('arms_warrior') },
      { spec: spec('protection_paladin') },
      1465967083,
    );
    expect(r.winner).toBe('b');
    expect(r.a.diedForReal || r.b.diedForReal).toBe(true);
  }, 60000);
});

describe('pve bouts', () => {
  it('a dps spec kills the standard at-level target', () => {
    const r = runPveBout(
      { spec: spec('fury_warrior') },
      { key: 'standard', templateId: 'forest_wolf' },
      2002,
    );
    expect(r.killed).toBe(true);
    expect(r.playerDied).toBe(false);
    expect(r.seconds).toBeGreaterThan(0);
    expect(r.dps).toBeGreaterThan(0);
    expect(r.fighter.damageDone).toBeGreaterThan(0);
  }, 30000);

  it('elite kills take longer than standard kills for the same spec and seed', () => {
    const standard = runPveBout(
      { spec: spec('beast_mastery_hunter') },
      { key: 'standard', templateId: 'forest_wolf' },
      31,
    );
    const elite = runPveBout(
      { spec: spec('beast_mastery_hunter') },
      { key: 'elite', templateId: 'ogre_crusher' },
      31,
    );
    expect(standard.killed).toBe(true);
    expect(elite.killed).toBe(true);
    expect(elite.seconds).toBeGreaterThan(standard.seconds);
  }, 60000);

  it('rejects an unknown mob template', () => {
    expect(() =>
      runPveBout({ spec: spec('fury_warrior') }, { key: 'x', templateId: 'no_such_mob' }, 1),
    ).toThrow(/unknown mob template/);
  });
});
