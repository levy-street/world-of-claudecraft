import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';

interface PoolSlot {
  entityId: number;
  active: boolean;
  mesh: { visible: boolean };
}

interface FxProbe {
  windups: Map<number, unknown>;
  orbits: Map<number, unknown[]>;
  orbitBandCount: number;
  shells: { slots: PoolSlot[] };
  groundAuras: { slots: PoolSlot[] };
  glows: Map<number, unknown>;
}

function installCanvasStub(): void {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const context = {
    arc: noop,
    beginPath: noop,
    clip: noop,
    closePath: noop,
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    ellipse: noop,
    fill: noop,
    fillRect: noop,
    lineTo: noop,
    moveTo: noop,
    putImageData: noop,
    rect: noop,
    restore: noop,
    rotate: noop,
    save: noop,
    scale: noop,
    stroke: noop,
    translate: noop,
  };
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AbilityVfxFx presentation sleep', () => {
  it('disposes every pooled primitive and ignores late updates idempotently', () => {
    installCanvasStub();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld();
    const fx = new AbilityVfxFx(
      scene,
      camera,
      () => new THREE.Vector3(0, 0, -5),
      () => 0,
    );
    fx.prewarmSpawn(0, 1, 0, 7);

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    scene.traverse((object) => {
      const drawable = object as THREE.Mesh | THREE.Line | THREE.Points;
      if (drawable.geometry) geometries.add(drawable.geometry);
      const material = drawable.material;
      if (material) {
        for (const entry of Array.isArray(material) ? material : [material]) materials.add(entry);
      }
    });
    const geometryDisposals = [...geometries].map((geometry) => vi.spyOn(geometry, 'dispose'));
    const materialDisposals = [...materials].map((material) => vi.spyOn(material, 'dispose'));

    fx.dispose();

    expect(scene.children).toHaveLength(0);
    for (const dispose of geometryDisposals) expect(dispose).toHaveBeenCalledOnce();
    for (const dispose of materialDisposals) expect(dispose).toHaveBeenCalledOnce();

    fx.dispose();
    fx.update(1);
    expect(scene.children).toHaveLength(0);
    for (const dispose of geometryDisposals) expect(dispose).toHaveBeenCalledOnce();
    for (const dispose of materialDisposals) expect(dispose).toHaveBeenCalledOnce();
  });

  it('releases only the sleeping entity from every held render pool immediately', () => {
    installCanvasStub();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld();
    const fx = new AbilityVfxFx(
      new THREE.Scene(),
      camera,
      () => new THREE.Vector3(0, 0, -5),
      () => 0,
    );
    const applyGlow = vi.fn();
    fx.setDelegates(vi.fn(), vi.fn(), vi.fn(), applyGlow);

    for (const entityId of [7, 8]) {
      expect(fx.windup(entityId, 0xff0000, 0.5)).toBe(true);
      expect(fx.orbit(entityId, 'runes', 0xff0000)).toBe(true);
      fx.holdShell(entityId, 0xff0000);
      expect(fx.holdGroundAura(entityId, 0, 0xff0000, true)).toBe(true);
      fx.bodyGlow(entityId, 0xff0000, 1, false);
    }
    fx.update(0.1);
    const probe = fx as unknown as FxProbe;
    expect(probe.orbitBandCount).toBe(2);
    expect(fx.groundAuraCountOf(7)).toBe(1);
    expect(applyGlow).toHaveBeenCalledWith(7, 0xff0000, expect.any(Number));

    fx.sleepEntity(7);

    expect(probe.windups.has(7)).toBe(false);
    expect(probe.windups.has(8)).toBe(true);
    expect(probe.orbits.has(7)).toBe(false);
    expect(probe.orbits.has(8)).toBe(true);
    expect(probe.orbitBandCount).toBe(1);
    expect(probe.shells.slots.some((slot) => slot.entityId === 7 && slot.active)).toBe(false);
    expect(probe.shells.slots.some((slot) => slot.entityId === 8 && slot.active)).toBe(true);
    expect(probe.groundAuras.slots.some((slot) => slot.entityId === 7 && slot.active)).toBe(false);
    expect(probe.groundAuras.slots.some((slot) => slot.entityId === 8 && slot.active)).toBe(true);
    expect(fx.groundAuraCountOf(7)).toBe(0);
    expect(fx.groundAuraCountOf(8)).toBe(1);
    expect(probe.glows.has(7)).toBe(false);
    expect(probe.glows.has(8)).toBe(true);
    expect(applyGlow).toHaveBeenCalledWith(7, 0xff0000, 0);
  });
});
