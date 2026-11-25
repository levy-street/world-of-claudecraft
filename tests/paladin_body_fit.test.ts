import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { DebtOfLight } from '../src/render/ability_vfx/debt_of_light';
import { GuardianCovenant } from '../src/render/ability_vfx/guardian_covenant';
import { PaladinCastSigil } from '../src/render/ability_vfx/paladin_cast_sigil';
import { syncPaladinAvengingWrathVisual } from '../src/render/paladin_avenging_wrath_visual';
import { configurePaladinBodyFit } from '../src/render/paladin_body_fit';

afterEach(() => configurePaladinBodyFit(false));
const height = 2.86;
const anchor = (_id: number, fraction: number, out = new THREE.Vector3()) =>
  out.set(0, fraction * height, 0);

it('fits both shield layers between boots and crown without losing their separation', () => {
  configurePaladinBodyFit(true);
  const scene = new THREE.Scene();
  const covenant = new GuardianCovenant(scene, anchor);
  const debt = new DebtOfLight(scene, anchor, undefined, covenant);
  vi.spyOn(covenant.preparation, 'ready').mockReturnValue(true);
  vi.spyOn(debt.preparation, 'ready').mockReturnValue(true);
  covenant.hold(1, 0.2, 0);
  debt.hold(1, 1, 0);
  debt.update(0.4, true);
  covenant.update(0.4, true);
  const p = covenant.mesh.geometry.getAttribute('position');
  const kind = covenant.mesh.geometry.getAttribute('aKind');
  const points = Array.from({ length: covenant.mesh.geometry.drawRange.count }, (_, i) => i).filter(
    (i) => kind.getX(i) === 0,
  );
  const ys = points.map((i) => p.getY(i));
  expect(Math.min(...ys)).toBeGreaterThan(height * 0.05);
  expect(Math.max(...ys)).toBeGreaterThan(height * 0.97);
  expect(Math.max(...ys)).toBeLessThan(height * 1.02);
  expect(Math.max(...points.map((i) => Math.abs(p.getX(i))))).toBeLessThan(height * 0.34);
  const d = debt.mesh.geometry.getAttribute('position');
  expect(d.getZ(0) - p.getZ(0)).toBeCloseTo(height * 0.035);
  expect(d.getY(0)).toBeCloseTo(p.getY(0));
  covenant.dispose();
  debt.dispose();
});

it('attaches wing roots at the native shoulders while keeping the rune band on the floor', () => {
  configurePaladinBodyFit(true);
  const parent = new THREE.Group();
  const wings = syncPaladinAvengingWrathVisual(null, parent, height, true, 1, true, [
    { id: 'avenging_wrath', kind: 'buff_damage' },
  ])!;
  parent.updateMatrixWorld(true);
  const shoulder = wings.rightWing.getWorldPosition(new THREE.Vector3());
  // Native shoulder joint is .791h; feather root sits just below it.
  expect(shoulder.y / height).toBeGreaterThan(0.78);
  expect(shoulder.y / height).toBeLessThan(0.82);
  expect(shoulder.z).toBeLessThan(0);
  expect(wings.runeBand.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(0.05);
  wings.dispose();
});

it('keeps the cast sigil close to the actual raised offhand on the taller rig', () => {
  configurePaladinBodyFit(true);
  const hand = new THREE.Vector3(0.3, height + 0.3, 0);
  const effect = new PaladinCastSigil(
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    anchor,
    (_id, _which, out) => {
      out.copy(hand);
      return true;
    },
  );
  vi.spyOn(effect.preparation, 'ready').mockReturnValue(true);
  effect.cast(1);
  effect.update(0.4);
  const p = effect.mesh.geometry.getAttribute('position');
  const ys = Array.from({ length: 6 }, (_, i) => p.getY(i));
  expect((Math.min(...ys) + Math.max(...ys)) / 2 - hand.y).toBeCloseTo(height * 0.26);
  expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(height * 0.68);
  effect.dispose();
});
