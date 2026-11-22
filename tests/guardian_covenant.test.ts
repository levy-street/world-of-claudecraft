import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DebtOfLight } from '../src/render/ability_vfx/debt_of_light';
import { GuardianCovenant } from '../src/render/ability_vfx/guardian_covenant';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { setPaladinVfxDetailForTest } from '../src/render/ability_vfx/paladin_vfx_detail';
import type { PaladinVfxDetail } from '../src/render/ability_vfx/paladin_vfx_detail_core';
import { AbilityVfxBudget } from '../src/render/ability_vfx_core';
import {
  AEGIS_CAPACITY,
  AEGIS_FADE,
  AEGIS_SHIELD_VERTICES,
  AEGIS_VERTEX_BUDGET,
  isGuardianCovenantAura,
} from '../src/render/guardian_covenant_core';
import { Renderer } from '../src/render/renderer';

async function fixture(height = 2.4) {
  const anchor = vi.fn((id: number, f: number, out?: THREE.Vector3) =>
    id < 0 || !out ? null : out.set(id * 4, f * height, 0),
  );
  const effect = new GuardianCovenant(new THREE.Scene(), anchor);
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const host = {
    properties: { get: () => ({ programs: new Map([['canvas', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
  return {
    effect,
    anchor,
    prepare: async (debt?: DebtOfLight) => {
      for (const unit of effect.preparation.units(host)) await unit.run();
      if (debt) for (const unit of debt.preparation.units(host)) await unit.run();
    },
  };
}

// Node runs at the Medium preset: pin the authored composition.
beforeEach(() => setPaladinVfxDetailForTest('full'));
afterEach(() => setPaladinVfxDetailForTest(null));

describe('Guardian Covenant Twin Aegis', () => {
  it.each([1.6, 3.2])(
    'composes at height %s and restores standalone Debt when Guardian ends',
    async (height) => {
      const f = await fixture(height);
      const debt = new DebtOfLight(new THREE.Scene(), f.anchor, undefined, f.effect);
      await f.prepare(debt);
      f.effect.hold(1, 0.2, 0);
      debt.hold(1, 1, 0);
      debt.update(0.4, false);
      f.effect.update(0.4, false);
      // Suppress the duplicate face, but retain Debt's gold and ivory outline.
      const alphas = debt.mesh.geometry.getAttribute('aAlpha');
      expect(alphas.getX(0)).toBe(0);
      expect(alphas.getX(3)).toBeGreaterThan(0);
      expect(alphas.getX(9)).toBeGreaterThan(0);
      expect(Array.from(alphas.array).some((a) => a > 0)).toBe(true);
      const p = debt.mesh.geometry.getAttribute('position');
      const centre = f.effect.mesh.geometry.getAttribute('position');
      expect(p.getY(0)).toBeCloseTo(centre.getY(0));
      // Debt sits just ahead of the outer membrane instead of intersecting it.
      expect(p.getZ(0) - centre.getZ(0)).toBeCloseTo(height * 0.035);
      const kinds = f.effect.mesh.geometry.getAttribute('aKind');
      const ys = Array.from({ length: f.effect.mesh.geometry.drawRange.count }, (_, i) => i)
        .filter((i) => kinds.getX(i) === 0)
        .map((i) => centre.getY(i));
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(height * 0.78 * 1.15);
      expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(height * 0.46);
      // Guardian expires first; Debt regains its own independent membrane.
      expect(f.effect.coverage(1, 0.175)).toBeCloseTo(0.5);
      debt.hold(1, 1, 0);
      debt.update(0.175, false);
      f.effect.update(0.175, false);
      expect(alphas.getX(0)).toBeGreaterThan(0);
      expect(f.effect.mesh.visible).toBe(true);
      expect(f.effect.coverage(1, 0.175)).toBe(0);
      debt.hold(1, 1, 0);
      debt.update(0.175, false);
      f.effect.update(0.175, false);
      expect(f.effect.mesh.visible).toBe(false);
      expect(alphas.getX(0)).toBeGreaterThan(0);
      debt.dispose();
      f.effect.dispose();
    },
  );
  it('returns toward the attacker as one aligned shield, then leaves only Guardian', async () => {
    const f = await fixture();
    const debt = new DebtOfLight(new THREE.Scene(), f.anchor, undefined, f.effect);
    await f.prepare(debt);
    f.effect.hold(1, 0.2, 0);
    f.effect.hold(2, 0.2, 0);
    debt.hold(1, 1, 0);
    debt.update(0.4, false);
    f.effect.update(0.4, false);
    expect(debt.answer(1, 0)).toBe(true);
    f.effect.hold(1, 0.2, 0);
    f.effect.hold(2, 0.2, 0);
    debt.update(0.1, false);
    f.effect.update(0.1, false);
    const p = f.effect.mesh.geometry.getAttribute('position');
    expect(p.getX(0)).toBeLessThan(4); // source ward turns toward the real attacker
    expect(p.getX(AEGIS_VERTEX_BUDGET)).toBeCloseTo(8); // ally's ward does not turn
    f.effect.hold(1, 0.2, 0);
    f.effect.hold(2, 0.2, 0);
    debt.update(0.6, false);
    f.effect.update(0.6, false);
    expect(debt.mesh.visible).toBe(false);
    expect(f.effect.mesh.geometry.drawRange.count).toBe(2 * AEGIS_VERTEX_BUDGET);
    expect(p.getX(0)).toBeCloseTo(4);
    // Unused Debt expiry also leaves Guardian alone and produces no return.
    debt.hold(1);
    debt.update(0.1, false);
    debt.update(0.3, false);
    expect(debt.mesh.visible).toBe(false);
    expect(f.effect.mesh.visible).toBe(true);
    debt.dispose();
    f.effect.dispose();
  });
  it('keeps the personal ward in front of the wearer as their facing changes', async () => {
    const f = await fixture();
    await f.prepare();
    for (const facing of [0, Math.PI / 2, Math.PI]) {
      f.effect.hold(1, 0.2, facing);
      f.effect.update(0.4, false);
      const g = f.effect.mesh.geometry;
      const p = g.getAttribute('position');
      const kinds = g.getAttribute('aKind');
      let wisps = 0;
      for (let i = 0; i < g.drawRange.count; i++) {
        expect(p.getY(i)).toBeGreaterThan(0);
        expect(p.getY(i)).toBeLessThan(2.4);
        if (kinds.getX(i) === 1) {
          // Wisps swirl round the wearer rather than sitting in front.
          wisps++;
          expect(Math.hypot(p.getX(i) - 4, p.getZ(i))).toBeLessThan(2.4 * 0.62);
          continue;
        }
        const forward = (p.getX(i) - 4) * Math.sin(facing) + p.getZ(i) * Math.cos(facing);
        expect(forward).toBeGreaterThan(0.6);
      }
      expect(wisps).toBe(AEGIS_VERTEX_BUDGET - AEGIS_SHIELD_VERTICES);
    }
    f.effect.dispose();
  });
  it('prewarms, holds one ward per wearer through refresh and fades on removal', async () => {
    const f = await fixture();
    expect(f.effect.hold(1, 0.2, 0)).toBe(false);
    await f.prepare();
    f.effect.hold(1, 0.2, 0);
    f.effect.hold(1, 0.3, 0);
    f.effect.update(0.1, false);
    expect(f.effect.mesh.geometry.drawRange.count).toBe(AEGIS_VERTEX_BUDGET);
    for (let i = 0; i < 20; i++) {
      f.effect.hold(1, 0.2, 0);
      f.effect.update(0.1, false);
    }
    expect(f.effect.mesh.geometry.drawRange.count).toBe(AEGIS_VERTEX_BUDGET);
    f.effect.update(0.1, false);
    expect(f.effect.mesh.visible).toBe(true);
    f.effect.update(0.4, false);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
  });
  it('bounds recipients, writes finite prefixes and reduces detail without losing protection', async () => {
    const f = await fixture();
    await f.prepare();
    for (let i = 0; i < AEGIS_CAPACITY; i++) expect(f.effect.hold(i, 0.2, Math.PI / 2)).toBe(true);
    expect(f.effect.hold(99, 0.2, 0)).toBe(false);
    f.effect.update(0.1, false);
    const g = f.effect.mesh.geometry,
      n = g.drawRange.count;
    expect(n).toBe(AEGIS_CAPACITY * AEGIS_VERTEX_BUDGET);
    for (const attribute of Object.values(g.attributes)) {
      expect(
        Array.from(attribute.array.slice(0, n * attribute.itemSize)).every(Number.isFinite),
      ).toBe(true);
      expect((attribute as THREE.BufferAttribute).updateRanges).toEqual([
        { start: 0, count: n * attribute.itemSize },
      ]);
    }
    for (let i = 0; i < AEGIS_CAPACITY; i++) f.effect.hold(i, 0.2, 0);
    f.effect.update(0.1, true);
    expect(g.drawRange.count).toBeLessThan(n);
    expect(g.drawRange.count).toBeGreaterThan(0);
    f.effect.clear();
    expect(g.drawRange.count).toBe(0);
    const disposed = vi.spyOn(g, 'dispose');
    f.effect.dispose();
    f.effect.dispose();
    expect(disposed).toHaveBeenCalledOnce();
  });
  it('suppresses obsolete cast/aura companions while playing one release gesture', () => {
    const releaseGesture = vi.fn();
    const painter = Object.assign(Object.create(AbilityVfx.prototype), {
      // The painter reads the cast budget for every Paladin cue.
      budget: new AbilityVfxBudget(),
      castChargeAt: new Map(),
      now: () => 0,
      releaseGesture,
      deps: { fx: { castPaladinShieldSigil: vi.fn() } },
    }) as AbilityVfx;
    const event = { sourceId: 1, targetId: 2, school: 'holy', ability: 'guardian_covenant' };
    expect(painter.handleSpellfx({ ...event, fx: 'selfCast' })).toBe(true);
    expect(painter.handleSpellfx({ ...event, fx: 'paladinAscensionImpact' })).toBe(true);
    expect(releaseGesture).toHaveBeenCalledOnce();
    // No generic renderer collaborator should be touched for this owned aura.
    Renderer.prototype.handleEvent.call({} as Renderer, {
      type: 'aura',
      targetId: 2,
      abilityId: 'guardian_covenant',
      name: 'Guardian Covenant',
      gained: true,
    });
    expect(isGuardianCovenantAura({ id: 'life_covenant', kind: 'buff_dr' })).toBe(false);
    expect(isGuardianCovenantAura({ id: 'guardian_covenant', kind: 'buff_dmg_done' })).toBe(false);
  });
});

describe('Guardian Covenant detail', () => {
  /** Shield and wisp vertices of one ward raised at `detail`, and how long it
   * still draws once the aura stops refreshing it. */
  const ward = async (detail: PaladinVfxDetail) => {
    const f = await fixture();
    await f.prepare();
    setPaladinVfxDetailForTest(detail);
    f.effect.hold(1, 0.2, 0);
    // The ward keeps the detail it was raised with.
    setPaladinVfxDetailForTest('full');
    f.effect.hold(1, 0.2, 0);
    f.effect.update(0.1, false);
    const g = f.effect.mesh.geometry;
    const kinds = g.getAttribute('aKind');
    let shield = 0,
      wisps = 0;
    for (let i = 0; i < g.drawRange.count; i++) kinds.getX(i) ? wisps++ : shield++;
    const coverage = f.effect.coverage(1);
    let tail = 0;
    while (f.effect.mesh.visible && tail < 1) {
      f.effect.update(0.01, false);
      tail += 0.01;
    }
    f.effect.dispose();
    return { shield, wisps, coverage, tail };
  };

  it('keeps the whole shield on every tier and sheds the wisps on lighter ones', async () => {
    const full = await ward('full');
    const light = await ward('light');
    const minimal = await ward('minimal');
    expect(full.shield).toBe(AEGIS_SHIELD_VERTICES);
    expect(full.wisps).toBe(AEGIS_VERTEX_BUDGET - AEGIS_SHIELD_VERTICES);
    // Light: the same shield, the wisps at half their segments.
    expect(light.shield).toBe(full.shield);
    expect(light.wisps).toBe(full.wisps / 2);
    // Minimal: the shield alone, at the reduced-motion tessellation.
    expect(minimal.shield).toBe(full.shield / 2);
    expect(minimal.wisps).toBe(0);
    // A held ward is full coverage on every tier; lighter ones fade out sooner.
    for (const d of [full, light, minimal]) expect(d.coverage).toBe(1);
    expect(full.tail).toBeCloseTo(AEGIS_FADE, 1);
    expect(light.tail).toBeLessThan(full.tail);
    expect(minimal.tail).toBeLessThan(light.tail);
  });
});
