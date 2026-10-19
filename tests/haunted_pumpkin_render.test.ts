import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hauntedPumpkinGlow } from '../src/render/haunted_pumpkin_core';
import { disposeUnsharedMeshResources, isSharedGeometry } from '../src/render/shared_resource';
import { GOURDLIGHT_EVE_ID } from '../src/sim/content/gourdlight_eve';
import type { Entity } from '../src/sim/types';

const kit = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../src/render/seasonal_decor_assets', () => ({ gourdlightAssets: kit.get }));
vi.mock('../src/sim/seasonal', () => ({
  hauntedPumpkinForEntity: (e: { id: number; templateId?: string }) =>
    e.templateId === 'ground_haunted_pumpkin' && e.id === -910000
      ? { id: 'test-pumpkin' }
      : undefined,
}));

import {
  buildHauntedPumpkin,
  buildHauntedPumpkinParts,
  syncHauntedPumpkin,
} from '../src/render/haunted_pumpkin';

const entity = {
  id: -910000,
  templateId: 'ground_haunted_pumpkin',
  pos: { x: 2, y: 3, z: 4 },
} as Entity;

describe('haunted pumpkin personal render state', () => {
  beforeEach(() => kit.get.mockReset());

  it('never requests seasonal assets outside the event, and defers a cold kit', () => {
    expect(
      buildHauntedPumpkin({ activeSeasonalEvent: null, hauntedPumpkinsFound: [] }, entity),
    ).toBeNull();
    expect(kit.get).not.toHaveBeenCalled();
    kit.get.mockReturnValue(null);
    expect(
      buildHauntedPumpkin(
        { activeSeasonalEvent: GOURDLIGHT_EVE_ID, hauntedPumpkinsFound: [] },
        entity,
      ),
    ).toBeNull();
    expect(kit.get).toHaveBeenCalledOnce();
  });

  it.each([THREE.MeshStandardMaterial, THREE.MeshLambertMaterial])(
    'keeps discovery independent from city glow and other viewers on %s',
    (Material) => {
      const source = new Material({ name: 'GourdGlow', emissive: 0xff8800, emissiveIntensity: 9 });
      const hook: THREE.Material['onBeforeCompile'] = () => {};
      source.onBeforeCompile = hook;
      source.customProgramCacheKey = () => 'seasonal-shape-and-haze';
      const geometry = new THREE.BoxGeometry();
      const parts = [{ geometry, material: source }];
      const a = buildHauntedPumpkinParts(parts);
      const b = buildHauntedPumpkinParts(parts);
      const aMaterial = (a.group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      const bMaterial = (b.group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      expect(aMaterial).not.toBe(source);
      expect(aMaterial).not.toBe(bMaterial);
      expect(aMaterial.onBeforeCompile).toBe(hook);
      expect(aMaterial.customProgramCacheKey()).toBe(source.customProgramCacheKey());
      expect(aMaterial.emissiveIntensity).toBe(0);
      syncHauntedPumpkin(a.group, { hauntedPumpkinsFound: ['test-pumpkin'] }, entity);
      expect(aMaterial.emissiveIntensity).toBe(1.4);
      expect(bMaterial.emissiveIntensity).toBe(0);
      expect(source.emissiveIntensity).toBe(9);
      expect(aMaterial.emissive.getHex()).toBe(0xff8800);
      syncHauntedPumpkin(a.group, { hauntedPumpkinsFound: [] }, entity);
      expect(aMaterial.emissiveIntensity).toBe(0);
      expect(isSharedGeometry(geometry)).toBe(true);
      const disposed = vi.fn();
      aMaterial.addEventListener('dispose', disposed);
      expect(disposeUnsharedMeshResources(a.group, { geometries: true, materials: true })).toEqual({
        geometries: 0,
        materials: 1,
      });
      expect(disposed).toHaveBeenCalledOnce();
      disposeUnsharedMeshResources(b.group, { materials: true });
      geometry.dispose();
      source.dispose();
    },
  );

  it('lights a completed pumpkin immediately when its view is recreated', () => {
    const material = new THREE.MeshLambertMaterial({ name: 'GourdInner', emissive: 0xff8800 });
    const geometry = new THREE.BoxGeometry();
    kit.get.mockReturnValue({ decor: { pumpkin_lit: [{ geometry, material }] } });
    const built = buildHauntedPumpkin(
      {
        activeSeasonalEvent: GOURDLIGHT_EVE_ID,
        hauntedPumpkinsFound: ['test-pumpkin'],
      },
      entity,
    );
    expect(built).not.toBeNull();
    if (!built) throw new Error('Expected the ready seasonal kit');
    const clone = (built.group.children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial;
    expect(clone.emissiveIntensity).toBe(1);
    disposeUnsharedMeshResources(built.group, { materials: true });
    geometry.dispose();
    material.dispose();
  });

  it('keeps stems dark and all glow surfaces fully off before discovery', () => {
    for (const name of ['GourdGlow', 'GourdInner', 'GourdFlesh', 'GourdLitSkin']) {
      expect(hauntedPumpkinGlow(name, false)).toBe(0);
      expect(hauntedPumpkinGlow(name, true)).toBeGreaterThan(0);
    }
    expect(hauntedPumpkinGlow('GourdStem', true)).toBe(0);
  });

  it('plays layered ignition once on new discovery, without replay on restored state', () => {
    const fx = { burst: vi.fn(), burstLater: vi.fn(), buffSwirl: vi.fn() };
    const material = new THREE.MeshLambertMaterial({ name: 'GourdGlow' });
    const geometry = new THREE.BoxGeometry();
    const a = buildHauntedPumpkinParts([{ geometry, material }]);
    syncHauntedPumpkin(a.group, { hauntedPumpkinsFound: [] }, entity, 0, false, fx);
    syncHauntedPumpkin(a.group, { hauntedPumpkinsFound: ['test-pumpkin'] }, entity, 1, false, fx);
    syncHauntedPumpkin(a.group, { hauntedPumpkinsFound: ['test-pumpkin'] }, entity, 2, false, fx);
    expect(fx.burst).toHaveBeenCalledOnce();
    expect(fx.buffSwirl).toHaveBeenCalledWith(entity.id, 0x81efbc);
    expect(fx.burstLater).toHaveBeenCalledTimes(2);
    const b = buildHauntedPumpkinParts([{ geometry, material }]);
    syncHauntedPumpkin(b.group, { hauntedPumpkinsFound: ['test-pumpkin'] }, entity, 3, false, fx);
    expect(fx.burst).toHaveBeenCalledOnce();
    const c = buildHauntedPumpkinParts([{ geometry, material }]);
    syncHauntedPumpkin(c.group, { hauntedPumpkinsFound: [] }, entity, 0, true, fx);
    syncHauntedPumpkin(c.group, { hauntedPumpkinsFound: ['test-pumpkin'] }, entity, 4, true, fx);
    expect(fx.burst).toHaveBeenCalledOnce();
    const cMaterial = (c.group.children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial;
    expect(cMaterial.emissiveIntensity).toBe(1.4);
    for (const view of [a, b, c]) disposeUnsharedMeshResources(view.group, { materials: true });
    geometry.dispose();
    material.dispose();
  });

  it('keeps candle motion bounded and preserves a static lit face with reduced motion', () => {
    const values = Array.from({ length: 100 }, (_, i) =>
      hauntedPumpkinGlow('GourdGlow', true, i / 10),
    );
    expect(Math.min(...values)).toBeGreaterThan(1.1);
    expect(Math.max(...values)).toBeLessThan(1.7);
    expect(new Set(values).size).toBeGreaterThan(90);
    expect(hauntedPumpkinGlow('GourdGlow', true, 6, true)).toBe(1.4);
    expect(hauntedPumpkinGlow('GourdLitSkin', true, 6, true)).toBe(0.04);
  });
});
