import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HAUNTED_PUMPKIN_BEACON_MID,
  HAUNTED_PUMPKIN_BEACON_PERIOD,
  HAUNTED_PUMPKIN_BEACON_RIND_SHARE,
  HAUNTED_PUMPKIN_BEACON_SWING,
  HAUNTED_PUMPKIN_HEIGHT,
  HAUNTED_PUMPKIN_SCALE,
  hauntedPumpkinBeacon,
  hauntedPumpkinGlow,
} from '../src/render/haunted_pumpkin_core';
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
      // Still to find: the beacon at its mid level (time 0) in the kit's own warm
      // tint, the source and the other viewer never touched.
      syncHauntedPumpkin(a.group, { hauntedPumpkinsFound: [] }, entity);
      expect(aMaterial.emissiveIntensity).toBe(HAUNTED_PUMPKIN_BEACON_MID);
      expect(aMaterial.emissive.getHex()).toBe(0xff8800);
      expect(bMaterial.emissiveIntensity).toBe(0);
      expect(source.emissive.getHex()).toBe(0xff8800);
      // Found again: the lit level comes back.
      syncHauntedPumpkin(a.group, { hauntedPumpkinsFound: ['test-pumpkin'] }, entity);
      expect(aMaterial.emissiveIntensity).toBe(1.4);
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

  it('keeps stems dark, the carved face softer before discovery, and the rind carrying the beacon', () => {
    for (const name of ['GourdGlow', 'GourdInner', 'GourdFlesh']) {
      const beacon = hauntedPumpkinGlow(name, false, 0, true);
      expect(beacon).toBeGreaterThan(0);
      expect(beacon).toBeLessThan(hauntedPumpkinGlow(name, true, 0, true));
    }
    // the rind is what reads from behind: a real share while still to find, the
    // faint candle bleed once lit
    const rindBeacon = hauntedPumpkinGlow('GourdLitSkin', false, 0, true);
    expect(rindBeacon).toBeCloseTo(
      (HAUNTED_PUMPKIN_BEACON_RIND_SHARE / 1.4) * HAUNTED_PUMPKIN_BEACON_MID,
      10,
    );
    expect(rindBeacon).toBeGreaterThan(0.3);
    expect(hauntedPumpkinGlow('GourdLitSkin', true, 0, true)).toBe(0.04);
    expect(hauntedPumpkinGlow('GourdStem', false)).toBe(0);
    expect(hauntedPumpkinGlow('GourdStem', true)).toBe(0);
    // the candle core carries the beacon itself; the rest keep their share of it
    expect(hauntedPumpkinGlow('GourdGlow', false, 0.7)).toBe(hauntedPumpkinBeacon(0.7));
    expect(hauntedPumpkinGlow('GourdInner', false, 0.7)).toBeCloseTo(
      hauntedPumpkinBeacon(0.7) / 1.4,
      10,
    );
  });

  it('breathes the undiscovered beacon slowly and softly, and holds it still with reduced motion', () => {
    const values = Array.from({ length: 280 }, (_, i) => hauntedPumpkinBeacon(i / 100));
    expect(Math.min(...values)).toBeCloseTo(
      HAUNTED_PUMPKIN_BEACON_MID - HAUNTED_PUMPKIN_BEACON_SWING,
      3,
    );
    expect(Math.max(...values)).toBeCloseTo(
      HAUNTED_PUMPKIN_BEACON_MID + HAUNTED_PUMPKIN_BEACON_SWING,
      3,
    );
    expect(Math.min(...values)).toBeGreaterThan(0.3);
    expect(Math.max(...values)).toBeLessThan(1.4);
    // one slow period, never a flicker
    expect(HAUNTED_PUMPKIN_BEACON_PERIOD).toBeGreaterThanOrEqual(2);
    expect(hauntedPumpkinBeacon(1.1 + HAUNTED_PUMPKIN_BEACON_PERIOD)).toBeCloseTo(
      hauntedPumpkinBeacon(1.1),
      10,
    );
    expect(hauntedPumpkinBeacon(HAUNTED_PUMPKIN_BEACON_PERIOD / 4)).toBeCloseTo(
      HAUNTED_PUMPKIN_BEACON_MID + HAUNTED_PUMPKIN_BEACON_SWING,
      10,
    );
    for (const t of [0, 0.3, 1.7, 9.2]) {
      expect(hauntedPumpkinBeacon(t, true)).toBe(HAUNTED_PUMPKIN_BEACON_MID);
    }
  });

  it('stands well above the city kit pumpkin, with the pick group and nameplate height scaled together', () => {
    expect(HAUNTED_PUMPKIN_SCALE).toBeGreaterThanOrEqual(2);
    expect(HAUNTED_PUMPKIN_HEIGHT).toBeCloseTo(0.9 * HAUNTED_PUMPKIN_SCALE, 10);
    const material = new THREE.MeshLambertMaterial({ name: 'GourdGlow', emissive: 0xff8800 });
    const geometry = new THREE.BoxGeometry();
    const built = buildHauntedPumpkinParts([{ geometry, material }]);
    expect(built.group.scale.toArray()).toEqual([
      HAUNTED_PUMPKIN_SCALE,
      HAUNTED_PUMPKIN_SCALE,
      HAUNTED_PUMPKIN_SCALE,
    ]);
    expect(built.height).toBe(HAUNTED_PUMPKIN_HEIGHT);
    // the size lives on the group: the mesh keeps the shared kit geometry, unscaled
    const mesh = built.group.children[0] as THREE.Mesh;
    expect(mesh.geometry).toBe(geometry);
    expect(mesh.scale.toArray()).toEqual([1, 1, 1]);
    kit.get.mockReturnValue({ decor: { pumpkin_lit: [{ geometry, material }] } });
    const live = buildHauntedPumpkin(
      { activeSeasonalEvent: GOURDLIGHT_EVE_ID, hauntedPumpkinsFound: [] },
      entity,
    );
    expect(live?.height).toBe(HAUNTED_PUMPKIN_HEIGHT);
    expect(live?.group.scale.x).toBe(HAUNTED_PUMPKIN_SCALE);
    for (const view of [built, live]) {
      if (view) disposeUnsharedMeshResources(view.group, { materials: true });
    }
    geometry.dispose();
    material.dispose();
  });

  it('breathes per frame before discovery on the personal clone only', () => {
    const material = new THREE.MeshStandardMaterial({ name: 'GourdGlow', emissive: 0xff8800 });
    const geometry = new THREE.BoxGeometry();
    const a = buildHauntedPumpkinParts([{ geometry, material }]);
    const clone = (a.group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    syncHauntedPumpkin(a.group, { hauntedPumpkinsFound: [] }, entity, 0);
    const atRest = clone.emissiveIntensity;
    syncHauntedPumpkin(
      a.group,
      { hauntedPumpkinsFound: [] },
      entity,
      HAUNTED_PUMPKIN_BEACON_PERIOD / 4,
    );
    expect(clone.emissiveIntensity).toBeGreaterThan(atRest);
    expect(clone.emissiveIntensity).toBe(hauntedPumpkinBeacon(HAUNTED_PUMPKIN_BEACON_PERIOD / 4));
    syncHauntedPumpkin(a.group, { hauntedPumpkinsFound: [] }, entity, 5, true);
    expect(clone.emissiveIntensity).toBe(HAUNTED_PUMPKIN_BEACON_MID);
    expect(material.emissiveIntensity).toBe(1);
    expect(material.emissive.getHex()).toBe(0xff8800);
    disposeUnsharedMeshResources(a.group, { materials: true });
    geometry.dispose();
    material.dispose();
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
    // the flame and its wisps rise with the pumpkin's size, so they stay in its cavity
    const flameAt = fx.burst.mock.calls[0][0] as THREE.Vector3;
    expect(flameAt.y).toBeCloseTo(entity.pos.y + 0.28 * HAUNTED_PUMPKIN_SCALE, 10);
    expect(fx.burstLater.mock.calls[0][2]).toBeCloseTo(
      entity.pos.y + 0.45 * HAUNTED_PUMPKIN_SCALE,
      10,
    );
    expect(fx.burstLater.mock.calls[1][2]).toBeCloseTo(
      entity.pos.y + 0.62 * HAUNTED_PUMPKIN_SCALE,
      10,
    );
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
