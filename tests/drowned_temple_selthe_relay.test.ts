import { describe, expect, it } from 'vitest';
import { SELTHE_ID } from '../src/sim/encounters/drowned_temple';
import {
  resetScore,
  resetScoreRun,
  startScore,
} from '../src/sim/encounters/drowned_temple/selthe_score';
import type { Entity } from '../src/sim/types';
import { aura, boss, engage, fight, put, tick } from './helpers/temple_fight';

const SPENT = 'temple_spent_voice';
function setup(difficulty: 'normal' | 'heroic' = 'normal', extra = 1, index = 0) {
  const f = fight(difficulty, extra);
  const b = boss(f, SELTHE_ID);
  put(f, f.tank, 3, 4);
  for (const p of f.others) put(f, p, -10, -6);
  engage(f, b);
  tick(f);
  const st = b.templeFight;
  if (st?.kind !== 'selthe') throw new Error('missing encounter');
  st.chorusTimer = st.soloTimer = st.surgeTimer = st.ariaTimer = 999;
  startScore(f.sim.ctx, f.inst, b, st, index);
  while (st.score?.phase === 'melody') tick(f);
  const sc = st.score;
  if (!sc) throw new Error('missing score');
  const step = (p: Entity, tile: number) => {
    put(f, p, 3, 4);
    tick(f);
    put(f, p, st.tiles[tile].x, st.tiles[tile].z);
    tick(f);
  };
  return { f, b, st, sc, step };
}

describe('Selthe shared notes', () => {
  it('blocks consecutive correct and wrong entries without damage or reset, then transfers on a correct note', () => {
    const { f, st, sc, step } = setup();
    const a = f.tank;
    const b = f.others[0];
    step(a, sc.order[0]);
    expect(aura(a, SPENT)).toMatchObject({ value: 0, undispellable: true });
    const before = f.hits.filter((h) => h.ability === 'False Note').length;
    step(a, sc.order[1]);
    step(
      a,
      st.tiles.findIndex((_, i) => !sc.order.includes(i)),
    );
    expect(sc.progress).toBe(1);
    expect(f.hits.filter((h) => h.ability === 'False Note')).toHaveLength(before);
    step(b, sc.order[1]);
    expect(sc.progress).toBe(2);
    expect(aura(a, SPENT)).toBeUndefined();
    expect(aura(b, SPENT)).toBeDefined();
    step(a, sc.order[2]);
    expect(st.score).toBeNull();
    expect(aura(a, SPENT)).toBeUndefined();
    expect(aura(b, SPENT)).toBeUndefined();
  });

  it.each(['normal', 'heroic'] as const)(
    'allows two players to alternate four notes on %s',
    (difficulty) => {
      const { f, st, sc, step } = setup(difficulty, 1, 1);
      sc.order.forEach((tile, i) => {
        step(i % 2 ? f.others[0] : f.tank, tile);
      });
      expect(st.score).toBeNull();
      expect(f.hits.some((h) => h.ability === 'False Note')).toBe(false);
    },
  );

  it('keeps the last correct singer blocked after another player makes a mistake', () => {
    const { f, st, sc, step } = setup();
    step(f.tank, sc.order[0]);
    step(
      f.others[0],
      st.tiles.findIndex((_, i) => !sc.order.includes(i)),
    );
    expect(sc.progress).toBe(0);
    expect(aura(f.tank, SPENT)).toBeDefined();
    step(f.tank, sc.order[0]);
    expect(sc.progress).toBe(0);
  });

  it('does not let removing the display aura bypass the rule', () => {
    const { f, sc, step } = setup();
    step(f.tank, sc.order[0]);
    f.tank.auras = f.tank.auras.filter((a) => a.id !== SPENT);
    step(f.tank, sc.order[1]);
    expect(sc.progress).toBe(1);
    expect(aura(f.tank, SPENT)).toBeDefined();
  });

  it('shows the restriction even through slow immunity without changing damage taken', () => {
    const { f, b, sc, step } = setup();
    f.sim.ctx.applyAura(f.tank, {
      id: 'test_slow_immunity',
      name: 'Test',
      kind: 'slow_immunity',
      school: 'frost',
      value: 1,
      duration: 30,
      remaining: 30,
      sourceId: f.tank.id,
    });
    step(f.tank, sc.order[0]);
    expect(aura(f.tank, SPENT)).toMatchObject({ kind: 'vulnerability', value: 0 });
    const hp = f.tank.hp;
    f.sim.ctx.dealDamage(b, f.tank, 100, false, 'frost', 'Test', 'hit', true);
    expect(hp - f.tank.hp).toBe(100);
    step(f.tank, sc.order[1]);
    expect(sc.progress).toBe(1);
  });

  it('lifts the restriction for the sole survivor and restores it when someone revives', () => {
    const { f, sc, step } = setup();
    step(f.tank, sc.order[0]);
    f.others[0].dead = true;
    tick(f);
    expect(aura(f.tank, SPENT)).toBeUndefined();
    step(f.tank, sc.order[1]);
    expect(sc.progress).toBe(2);
    f.others[0].dead = false;
    tick(f);
    expect(aura(f.tank, SPENT)).toBeDefined();
    step(f.tank, sc.order[2]);
    expect(sc.progress).toBe(2);
  });

  it('allows a solo player to finish and never shows a pointless restriction', () => {
    const { f, st, sc, step } = setup('heroic', 0, 1);
    for (const tile of sc.order) {
      step(f.tank, tile);
      expect(aura(f.tank, SPENT)).toBeUndefined();
    }
    expect(st.score).toBeNull();
  });

  it('ignores a blocked wrong entry in the same tick that someone else releases them', () => {
    const { f, st, sc, step } = setup();
    step(f.tank, sc.order[0]);
    put(f, f.tank, 3, 4);
    tick(f);
    const spare = st.tiles.findIndex((_, i) => !sc.order.includes(i));
    put(f, f.tank, st.tiles[spare].x, st.tiles[spare].z);
    put(f, f.others[0], st.tiles[sc.order[1]].x, st.tiles[sc.order[1]].z);
    const from = f.hits.length;
    tick(f);
    expect(sc.progress).toBe(2);
    expect(f.hits.slice(from).some((h) => h.ability === 'False Note')).toBe(false);
    expect(aura(f.tank, SPENT)).toBeUndefined();
    expect(aura(f.others[0], SPENT)).toBeDefined();
  });

  it('requires a fresh entry after a blocked next-tile entry, even when released in that tick', () => {
    const { f, st, sc, step } = setup();
    step(f.tank, sc.order[0]);
    put(f, f.tank, 3, 4);
    tick(f);
    put(f, f.tank, st.tiles[sc.order[2]].x, st.tiles[sc.order[2]].z);
    put(f, f.others[0], st.tiles[sc.order[1]].x, st.tiles[sc.order[1]].z);
    tick(f);
    expect(sc.progress).toBe(2);
    tick(f);
    expect(sc.progress).toBe(2);
    step(f.tank, sc.order[2]);
    expect(st.score).toBeNull();
  });

  it.each(['death', 'evade'] as const)('clears the player mark on boss %s', (ending) => {
    const { f, b, st, sc, step } = setup();
    step(f.tank, sc.order[0]);
    expect(aura(f.tank, SPENT)).toBeDefined();
    if (ending === 'death') f.sim.ctx.handleDeath(b, f.tank);
    else resetScore(f.sim.ctx, f.inst, b, st);
    tick(f);
    expect(aura(f.tank, SPENT)).toBeUndefined();
  });

  it('clears the mark on timeout and on a dev reset even if the holder left the instance', () => {
    const s = setup();
    s.step(s.f.tank, s.sc.order[0]);
    s.sc.timer = 0;
    tick(s.f);
    expect(aura(s.f.tank, SPENT)).toBeUndefined();
    const t = setup();
    t.step(t.f.tank, t.sc.order[0]);
    put(t.f, t.f.tank, 500, 500);
    resetScoreRun(t.f.sim.ctx, t.b, t.st);
    expect(aura(t.f.tank, SPENT)).toBeUndefined();
  });
});
