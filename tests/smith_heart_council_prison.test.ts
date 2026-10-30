// The Hammer Council's Stone Prison over a REAL Sim claim: the Slabwright's bar shuts
// players in real targets, breaking one frees its player, a block out of time crushes
// them, the counts and the time per difficulty, it stops with the Slabwright, and a
// wipe clears it.

import { describe, expect, it } from 'vitest';
import { prisonBlockScale } from '../src/render/smith_heart_fx/council_fx_core';
import { MOBS } from '../src/sim/data';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_DIFFICULTY,
  COUNCIL_NAMES,
  COUNCIL_PRISON,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import type { Entity } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { type CouncilFight, councilFight } from './helpers/council_fight';

const ticks = (s: number) => Math.round(s * 20);

function pulled(tier?: 'heroic' | 'mythic'): CouncilFight {
  const f = councilFight(6, 17);
  f.dev('/dev heart council pull');
  f.tick();
  if (tier) expect(f.dev(`/dev heart council ${tier} on`)).toBe(true);
  const st = f.state();
  if (!st) throw new Error('the council did not pull');
  st.weightTimer = 999;
  st.wakeTimer = 999;
  st.rockTimer = 999;
  st.boltTimer = 999;
  st.songTimer = 999;
  st.songDue = null;
  st.prisonTimer = 999;
  st.energy = 0;
  return f;
}

function imprison(f: CouncilFight): void {
  expect(f.dev('/dev heart council prison')).toBe(true);
  const slab = f.bodies().slabwright as Entity;
  expect(slab.castingAbility).toBe(COUNCIL_CASTS.prison);
  f.tick(ticks(T.prisonCast) + 2);
}

const prisoned = (e: Entity) => e.auras.find((a) => a.id === COUNCIL_AURAS.prisoned);

describe('Hammer Council: Stone Prison', () => {
  it('the rules: 2, 2 and 3 prisoners, Mythic tougher and shorter', () => {
    const { normal, heroic, mythic } = COUNCIL_DIFFICULTY;
    expect([normal.prisonMarks, heroic.prisonMarks, mythic.prisonMarks]).toEqual([2, 2, 3]);
    expect(mythic.prisonHpMult).toBeGreaterThan(heroic.prisonHpMult);
    expect(mythic.prisonSeconds).toBeLessThan(heroic.prisonSeconds);
  });

  for (const [tier, n] of [
    [undefined, 2],
    ['heroic', 2],
    ['mythic', 3],
  ] as const) {
    it(`${tier ?? 'normal'}: shuts ${n} in stunned, each with a real block over them`, () => {
      const f = pulled(tier);
      imprison(f);
      const st = f.state();
      expect(st?.prisons.length).toBe(n);
      for (const pr of st?.prisons ?? []) {
        const p = f.sim.ctx.entities.get(pr.playerId) as Entity;
        const block = f.sim.ctx.entities.get(pr.blockId) as Entity;
        expect(prisoned(p)?.kind).toBe('stun');
        expect(block.kind).toBe('mob');
        expect(block.templateId).toBe(COUNCIL_PRISON);
        expect(Math.hypot(block.pos.x - p.pos.x, block.pos.z - p.pos.z)).toBeLessThan(0.1);
      }
    });
  }

  it('never takes the tank while others stand', () => {
    const f = pulled();
    const tankId = (f.bodies().slabwright as Entity).aggroTargetId;
    imprison(f);
    for (const pr of f.state()?.prisons ?? []) expect(pr.playerId).not.toBe(tankId);
  });

  it('breaking a block frees its player, and they live', () => {
    const f = pulled();
    imprison(f);
    const st = f.state();
    if (!st) throw new Error('no fight');
    const [pr] = st.prisons;
    const p = f.sim.ctx.entities.get(pr.playerId) as Entity;
    const block = f.sim.ctx.entities.get(pr.blockId) as Entity;
    f.sim.ctx.dealDamage(
      f.players[0],
      block,
      block.maxHp * 2,
      false,
      'physical',
      'test',
      'hit',
      true,
    );
    f.tick(2);
    expect(prisoned(p)).toBeUndefined();
    expect(st.prisons.some((x) => x.playerId === p.id)).toBe(false);
    f.tick(ticks(COUNCIL_DIFFICULTY.normal.prisonSeconds) + 2);
    expect(p.dead).toBe(false);
  });

  it('a block out of time crushes its player', () => {
    const f = pulled();
    imprison(f);
    const st = f.state();
    if (!st) throw new Error('no fight');
    const ps = st.prisons.map((pr) => f.sim.ctx.entities.get(pr.playerId) as Entity);
    const blocks = st.prisons.map((pr) => pr.blockId);
    f.tick(ticks(COUNCIL_DIFFICULTY.normal.prisonSeconds) + 2);
    for (const p of ps) expect(p.dead).toBe(true);
    expect(st.prisons).toEqual([]);
    for (const id of blocks) expect(f.sim.ctx.entities.get(id)).toBeUndefined();
  });

  it('mythic blocks are tougher and run out sooner', () => {
    const f = pulled('mythic');
    imprison(f);
    const st = f.state();
    if (!st) throw new Error('no fight');
    const block = f.sim.ctx.entities.get(st.prisons[0].blockId) as Entity;
    expect(block.maxHp).toBeGreaterThan(MOBS[COUNCIL_PRISON].hpBase);
    expect(st.prisons[0].remaining).toBeLessThanOrEqual(COUNCIL_DIFFICULTY.mythic.prisonSeconds);
  });

  it('stops with the Slabwright, but the blocks standing still count down', () => {
    const f = pulled();
    imprison(f);
    const st = f.state();
    if (!st) throw new Error('no fight');
    const ps = st.prisons.map((pr) => f.sim.ctx.entities.get(pr.playerId) as Entity);
    const slab = f.bodies().slabwright as Entity;
    slab.hp = 0;
    slab.dead = true;
    f.tick(ticks(COUNCIL_DIFFICULTY.normal.prisonSeconds) + 2);
    for (const p of ps) expect(p.dead).toBe(true);
    expect(f.dev('/dev heart council prison')).toBe(true);
    expect(f.state()?.prisons).toEqual([]);
  });

  it('a reset clears every block and frees everyone', () => {
    const f = pulled();
    imprison(f);
    const st = f.state();
    if (!st) throw new Error('no fight');
    const pairs = st.prisons.map((pr) => ({ ...pr }));
    f.dev('/dev heart council reset');
    for (const pr of pairs) {
      expect(prisoned(f.sim.ctx.entities.get(pr.playerId) as Entity)).toBeUndefined();
      expect(f.sim.ctx.entities.get(pr.blockId)).toBeUndefined();
    }
  });

  it('warns the raid, names itself and says what it does', () => {
    const f = pulled();
    expect(f.dev('/dev heart council prison')).toBe(true);
    const ev = f.tick(ticks(T.prisonCast) + 2);
    expect(
      ev.filter((e) => e.type === 'chat' && e.textKey === 'hudChrome.council.warn.prison').length,
    ).toBeGreaterThan(0);
    expect(t('hudChrome.council.warn.prison' as never, { players: 'A' } as never)).toContain('A');
    const d = auraEffectDescriptor({ id: COUNCIL_AURAS.prisoned, kind: 'stun', value: 0 });
    expect(t(d?.key as never, d?.nums as never)).toContain('stone');
    expect(localizeSimAuraName(COUNCIL_NAMES.prison)).toBe(COUNCIL_NAMES.prison);
    expect(t(`abilityUi.cast.${COUNCIL_CASTS.prison}` as never)).toBe('Stone Prison');
    expect(MOBS[COUNCIL_PRISON].name).toBe('Stone Prison');
  });

  it('the block shrinks as it breaks', () => {
    expect(prisonBlockScale(1)).toBeGreaterThan(prisonBlockScale(0.1));
    expect(prisonBlockScale(0)).toBeGreaterThan(0);
  });
});
