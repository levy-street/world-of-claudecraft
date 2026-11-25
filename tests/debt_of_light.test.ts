import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DebtOfLight } from '../src/render/ability_vfx/debt_of_light';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { setPaladinVfxDetailForTest } from '../src/render/ability_vfx/paladin_vfx_detail';
import type { PaladinVfxDetail } from '../src/render/ability_vfx/paladin_vfx_detail_core';
import { AbilityVfxBudget } from '../src/render/ability_vfx_core';
import {
  DEBT_CAPACITY,
  DEBT_VERTEX_BUDGET,
  debtSpikeGrowth,
} from '../src/render/debt_of_light_core';
import { Renderer } from '../src/render/renderer';

async function fixture() {
  const scene = new THREE.Scene();
  const anchor = vi.fn((id: number, f: number, out?: THREE.Vector3) =>
    id < 0 || !out ? null : out.set(id * 2, f * 2.4, 0),
  );
  const effect = new DebtOfLight(scene, anchor);
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const host = {
    properties: { get: () => ({ programs: new Map([['canvas', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
  return {
    effect,
    anchor,
    prepare: async () => {
      for (const unit of effect.preparation.units(host)) await unit.run();
    },
  };
}
describe('Debt of Light', () => {
  // Node runs at the Medium preset: pin the authored composition.
  beforeEach(() => setPaladinVfxDetailForTest('full'));
  afterEach(() => setPaladinVfxDetailForTest(null));
  it('suppresses generic aura swirls for Debt while preserving other buffs', () => {
    const buffSwirl = vi.fn();
    const renderer = {
      sim: { entities: new Map([[1, { kind: 'player', auras: [] }]]) },
      abilityVfx: { onWarriorControlAura: () => false },
      // The release's generic aura arm draws through Vfx.spellBuffSwirl.
      vfx: { spellBuffSwirl: buffSwirl },
    } as unknown as Renderer;
    for (const abilityId of ['faithforged_guard', undefined])
      Renderer.prototype.handleEvent.call(renderer, {
        type: 'aura',
        targetId: 1,
        abilityId,
        name: 'Debt of Light',
        gained: true,
      });
    expect(buffSwirl).not.toHaveBeenCalled();
    Renderer.prototype.handleEvent.call(renderer, {
      type: 'aura',
      targetId: 1,
      abilityId: 'test_buff',
      name: 'Other buff',
      gained: true,
    });
    expect(buffSwirl).toHaveBeenCalledOnce();
  });
  it('places the shield ahead of facing and grows attached spikes to the attacker', async () => {
    const f = await fixture();
    await f.prepare();
    f.effect.hold(1, 1, Math.PI / 2);
    f.effect.update(0.05, false);
    const g = f.effect.mesh.geometry;
    const p = g.getAttribute('position').array;
    const shapes = g.getAttribute('aShape');
    // Shape 6 is the swirling wisps, which circle the wearer on purpose.
    const shieldXs: number[] = [],
      wispXs: number[] = [];
    for (let i = 0; i < g.drawRange.count; i++)
      (shapes.getX(i) === 6 ? wispXs : shieldXs).push(p[i * 3]);
    expect(Math.min(...shieldXs)).toBeGreaterThan(2.6);
    expect(Math.max(...shieldXs)).toBeLessThan(4);
    expect(wispXs.length).toBeGreaterThan(0);
    expect(Math.min(...wispXs)).toBeLessThan(2);
    expect(Math.max(...wispXs)).toBeGreaterThan(2);
    // Return turns toward an attacker behind the previous facing.
    expect(f.effect.answer(1, 0)).toBe(true);
    f.effect.update(0.1, false);
    const after = Array.from(p.slice(0, g.drawRange.count * 3)).filter((_, i) => i % 3 === 0);
    expect(Math.min(...after)).toBeLessThan(0.2);
    expect(debtSpikeGrowth(0, false)).toBe(0);
    expect(debtSpikeGrowth(0.045, false)).toBeGreaterThan(0.5);
    expect(debtSpikeGrowth(0.09, false)).toBe(1);
    expect(debtSpikeGrowth(0, true)).toBe(1);
    f.effect.dispose();
  });
  it('prepares before drawing, refreshes one guard and expires without return geometry', async () => {
    const f = await fixture();
    expect(f.effect.hold(1)).toBe(false);
    await f.prepare();
    for (let i = 0; i < 8; i++) {
      f.effect.hold(1);
      f.effect.update(0.05, false);
    }
    expect(f.effect.mesh.geometry.drawRange.count).toBeGreaterThan(0);
    f.effect.update(0.25, false);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
  });
  it.each([false, true])(
    'keeps retaliation geometry outside the wearer (reduced motion: %s)',
    async (reduced) => {
      const f = await fixture();
      await f.prepare();
      // Source x=2, attacker x=8: the shield faces +X. The former source
      // star emitted vertices at and behind x=2, inside the Paladin's torso.
      expect(f.effect.answer(1, 4)).toBe(true);
      for (const dt of [0.02, 0.08, 0.2, 0.2]) {
        f.effect.update(dt, reduced);
        const geometry = f.effect.mesh.geometry;
        const positions = geometry.getAttribute('position');
        let maxX = -Infinity;
        expect(geometry.drawRange.count).toBeGreaterThan(0);
        for (let i = 0; i < geometry.drawRange.count; i++) {
          expect(positions.getX(i)).toBeGreaterThan(2.6);
          maxX = Math.max(maxX, positions.getX(i));
        }
        // The enemy's impact star remains beyond its centre.
        expect(maxX).toBeGreaterThan(8.5);
      }
      f.effect.dispose();
    },
  );
  it('bounds combined pools, writes finite prefixes, reduces detail and clears/disposes', async () => {
    const f = await fixture();
    await f.prepare();
    for (let i = 0; i < DEBT_CAPACITY + 8; i++) f.effect.answer(i + 100, i + 200);
    for (let i = 0; i < DEBT_CAPACITY + 8; i++) f.effect.hold(i + 1, 1.5);
    f.effect.update(0.05, false);
    const g = f.effect.mesh.geometry,
      n = g.drawRange.count;
    expect(n).toBeLessThanOrEqual(DEBT_CAPACITY * DEBT_VERTEX_BUDGET * 2);
    expect(n).toBeGreaterThan(DEBT_CAPACITY * DEBT_VERTEX_BUDGET);
    for (const attr of Object.values(g.attributes)) {
      expect(Array.from(attr.array.slice(0, n * attr.itemSize)).every(Number.isFinite)).toBe(true);
      expect((attr as THREE.BufferAttribute).updateRanges).toEqual([
        { start: 0, count: n * attr.itemSize },
      ]);
    }
    for (let i = 0; i < DEBT_CAPACITY; i++) f.effect.hold(i + 1);
    f.effect.update(0.05, true);
    expect(g.drawRange.count).toBeLessThan(n);
    f.effect.update(1, false);
    expect(f.effect.mesh.visible).toBe(false);
    const dispose = vi.spyOn(g, 'dispose');
    f.effect.dispose();
    f.effect.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it('removes the guard on repayment, rejects missing/self recipients', async () => {
    const f = await fixture();
    await f.prepare();
    f.effect.hold(1);
    f.effect.update(0.1, false);
    expect(f.effect.answer(1, -1)).toBe(false);
    expect(f.effect.answer(1, 1)).toBe(false);
    expect(f.effect.answer(1, 2)).toBe(true);
    f.effect.update(0.05, false);
    expect(f.effect.mesh.geometry.drawRange.count).toBeLessThanOrEqual(DEBT_VERTEX_BUDGET);
    f.effect.update(0.6, false);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
  });
  it('claims companions without false hits and handles the old display-name return event', () => {
    const fx = { debtOfLightReturn: vi.fn(), castPaladinShieldSigil: vi.fn() },
      receiveHit = vi.fn();
    const p = Object.assign(Object.create(AbilityVfx.prototype), {
      // The painter reads the cast budget for every Paladin cue.
      budget: new AbilityVfxBudget(),
      castChargeAt: new Map(),
      now: () => 0,
      deps: { fx, receiveHit },
      releaseGesture: vi.fn(),
    }) as AbilityVfx;
    expect(
      p.handleSpellfx({
        sourceId: 1,
        targetId: 1,
        ability: 'faithforged_guard',
        school: 'holy',
        fx: 'selfCast',
      }),
    ).toBe(true);
    expect(p.releaseGesture).toHaveBeenCalledExactlyOnceWith(1, 'faithforged_guard');
    const ev = {
      sourceId: 1,
      targetId: 2,
      ability: 'Debt of Light',
      school: 'holy',
      kind: 'hit',
      amount: 80,
      crit: false,
    };
    p.onDamage(ev);
    p.onDamage({ ...ev, amount: 0, absorbed: 40 });
    p.onDamage({ ...ev, amount: 0, kind: 'evade' });
    expect(fx.debtOfLightReturn.mock.calls).toEqual([
      [1, 2, false],
      [1, 2, true],
    ]);
    expect(receiveHit).toHaveBeenCalledOnce();
  });
  it('draws a lighter Debt on lower detail: the shield, spikes and flare stay, layers thin out', async () => {
    const shapesAt = async (detail: PaladinVfxDetail, answer: boolean) => {
      setPaladinVfxDetailForTest(detail);
      const f = await fixture();
      await f.prepare();
      if (answer) f.effect.answer(1, 4);
      else f.effect.hold(1);
      f.effect.update(0.05, false);
      const g = f.effect.mesh.geometry;
      const shape = g.getAttribute('aShape');
      const total = g.drawRange.count;
      const counts = new Map<number, number>();
      for (let i = 0; i < g.drawRange.count; i++)
        counts.set(shape.getX(i), (counts.get(shape.getX(i)) ?? 0) + 1);
      // The answer's lingering shield: still up at 0.4 s only at full.
      f.effect.update(0.35, false);
      const lingers = f.effect.mesh.visible;
      f.effect.dispose();
      return { total, counts, lingers };
    };
    const held = {
      full: await shapesAt('full', false),
      light: await shapesAt('light', false),
      minimal: await shapesAt('minimal', false),
    };
    expect(held.light.total).toBeLessThan(held.full.total);
    expect(held.minimal.total).toBeLessThan(held.light.total);
    // Core: membrane (1), rim (3), spike cones (4) and the sun heart (5) on every tier.
    for (const tier of Object.values(held))
      for (const core of [1, 3, 4, 5]) expect(tier.counts.get(core) ?? 0).toBeGreaterThan(0);
    // Secondary: the wisps (6) keep on light, drop on minimal.
    expect(held.full.counts.get(6) ?? 0).toBeGreaterThan(0);
    expect(held.light.counts.get(6)).toBe(held.full.counts.get(6));
    expect(held.minimal.counts.get(6) ?? 0).toBe(0);
    // Accents: the boss ring and rays (lines, 0) go below full.
    expect(held.light.counts.get(0) ?? 0).toBeLessThan(held.full.counts.get(0) ?? 0);
    const answered = {
      full: await shapesAt('full', true),
      minimal: await shapesAt('minimal', true),
    };
    expect(answered.minimal.total).toBeLessThan(answered.full.total);
    // The attacker's impact flare (7) still lands; the shield lingers less.
    expect(answered.minimal.counts.get(7) ?? 0).toBeGreaterThan(0);
    expect(answered.full.lingers).toBe(true);
    expect(answered.minimal.lingers).toBe(false);
  });
});
