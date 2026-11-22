import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { DebtOfLight } from '../src/render/ability_vfx/debt_of_light';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
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
});
