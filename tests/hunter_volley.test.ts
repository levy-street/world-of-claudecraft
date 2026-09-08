import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { drawHunterVolley } from '../src/render/ability_vfx/hunter_volley';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import { AbilityVfxRibbons, type PathMotion } from '../src/render/ability_vfx/ribbons';

function harness() {
  const scene = new THREE.Scene();
  const tex = { ribbon: new THREE.Texture(), noise: new THREE.Texture() } as AbilityVfxTextures;
  const ribbons = new AbilityVfxRibbons(scene, () => null, tex);
  const paths: { points: THREE.Vector3[]; motion: PathMotion }[] = [];
  const fx = {
    groundYAt: (x: number, z: number) => x * 0.1 + z * 0.05,
    facingAt: () => 0.4,
    burstAt: vi.fn(),
    pathRibbon: vi.fn((color, width, life, fill, brushed, motion, preserveActive) => {
      return ribbons.spawnPath(
        color,
        width,
        life,
        (pts) => {
          const n = fill(pts);
          paths.push({ points: pts, motion });
          return n;
        },
        brushed,
        motion,
        preserveActive,
      );
    }),
  } as unknown as AbilityVfxFx;
  return { ribbons, scene, fx, paths, camera: new THREE.Vector3(15, 12, 20) };
}

describe('Hunter arrow rain on the existing ribbon pool', () => {
  it('keeps the live melee trail when several Hunters exhaust the cosmetic slots', () => {
    const { ribbons, fx, camera, paths } = harness();
    const weapon = vi.fn((out: THREE.Vector3) => {
      out.set(0, 1, 0);
      return true;
    });
    ribbons.spawnTrackedPath(0xffffff, 0.1, 0.4, weapon);
    expect(drawHunterVolley(fx, 4, 9, 8, 1, 0, 0)).toBe(14);
    expect(drawHunterVolley(fx, 4, 9, 8, 2, 0, 0)).toBe(5);
    expect(drawHunterVolley(fx, 4, 9, 8, 3, 0, 0)).toBe(0);
    expect(paths).toHaveLength(19);
    ribbons.update(0.1, camera);
    expect(weapon).toHaveBeenCalledTimes(2);
    ribbons.dispose();
  });
  it('fires each admitted landing exactly once when one frame crosses arrival and expiry', () => {
    const { ribbons, fx, camera, paths } = harness();
    drawHunterVolley(fx, 4, 9, 8, 1, 0, 0);
    ribbons.update(0.1, camera);
    ribbons.update(0.35, camera);
    expect(fx.burstAt).toHaveBeenCalledTimes(paths.length);
    ribbons.update(0.4, camera);
    expect(fx.burstAt).toHaveBeenCalledTimes(paths.length);
    ribbons.dispose();
  });
  it('uses only a short terrain accent when decorative budget is exhausted', () => {
    const { ribbons, fx, paths } = harness();
    expect(drawHunterVolley(fx, 4, 9, 8, 1, 0, 2)).toBe(1);
    expect(paths).toHaveLength(0);
    expect(fx.burstAt).toHaveBeenCalledOnce();
    ribbons.dispose();
  });
  it.each([0, 1])(
    'moves downward, lands throughout the real area, and clears before the next pulse at tier %i',
    (tier) => {
      const { ribbons, scene, fx, paths, camera } = harness();
      drawHunterVolley(fx, 4, 9, 8, 1, 2, tier);
      const initialY = paths.map((p) => p.points[1].y);
      ribbons.update(0.07, camera);
      expect(paths[0].points[1].y).toBeLessThan(initialY[0]);
      expect(fx.burstAt).not.toHaveBeenCalled();
      for (let i = 0; i < 28; i++) ribbons.update(0.01, camera);
      expect(fx.burstAt).toHaveBeenCalledTimes(paths.length);
      const contact = vi.mocked(fx.burstAt).mock.calls;
      for (const [x, y, z] of contact) {
        expect(Math.hypot(x - 4, z - 9)).toBeLessThan(8);
        expect(y).toBeCloseTo(fx.groundYAt(x, z) + 0.08);
      }
      expect(Math.max(...contact.map(([x, , z]) => Math.hypot(x - 4, z - 9)))).toBeGreaterThan(6);
      for (let i = 0; i < 20; i++) ribbons.update(0.01, camera);
      expect((scene.children[0] as THREE.Mesh).geometry.drawRange.count).toBe(0);
      ribbons.dispose();
    },
  );
  it('does not retain rain motion or contact callbacks when its slot is reused by a normal path', () => {
    const { ribbons, fx, camera, paths } = harness();
    drawHunterVolley(fx, 4, 9, 8, 1, 2, 0);
    ribbons.clear();
    ribbons.spawnPath(0xffffff, 0.1, 0.4, (pts) => {
      for (const [i, p] of pts.entries()) p.set(i, 1, 0);
      return pts.length;
    });
    ribbons.update(0.2, camera);
    expect(paths[0].points[0].y).toBe(1);
    expect(fx.burstAt).not.toHaveBeenCalled();
    ribbons.dispose();
  });
  it('routes six real pulses without starting the old fountain or an autonomous channel timer', () => {
    const { ribbons, fx, paths, camera } = harness();
    let now = 0;
    const spawnAoeRing = vi.fn();
    const sequenceInstantAt = vi.fn();
    Object.assign(fx, { sequenceInstantAt, setQuality: vi.fn(), setDelegates: vi.fn() });
    const paint = new AbilityVfx(
      { fx, spawnAoeRing, localPlayerId: () => 1 } as unknown as AbilityVfxDeps,
      () => now,
    );
    for (let pulse = 0; pulse < 6; pulse++) {
      paint.handleSpellfxAt({
        sourceId: 1,
        ability: 'volley',
        school: 'physical',
        fx: 'nova',
        x: 4,
        z: 9,
        radius: 8,
      });
      now += 0.5;
      for (let frame = 0; frame < 30; frame++) ribbons.update(1 / 60, camera);
    }
    expect(spawnAoeRing).toHaveBeenCalledTimes(6);
    expect(sequenceInstantAt).not.toHaveBeenCalled();
    expect(paths.length).toBe(84);
    const count = paths.length;
    ribbons.update(3, camera);
    expect(paths).toHaveLength(count);
    ribbons.dispose();
  });
});
