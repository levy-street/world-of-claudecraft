import * as THREE from 'three';
import { expect, it } from 'vitest';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';

it('keeps weapon history the same length across frame rates, freezes and rebases teleports', () => {
  const histories: THREE.Vector3[][] = [];
  for (const hz of [30, 60, 144, 240]) {
    const scene = new THREE.Scene(),
      texture = new THREE.Texture();
    const ribbons = new AbilityVfxRibbons(scene, () => null, {
      ribbon: texture,
      noise: texture,
    } as unknown as AbilityVfxTextures);
    const camera = new THREE.Vector3(0, 3, 8);
    let time = 0,
      jump = 0;
    ribbons.spawnTrackedPath(0xccaa88, 0.08, 2, (p) => {
      p.set(time * 4 + jump, 1, 0);
      return true;
    });
    for (let i = 0; i < hz; i++) {
      time = (i + 1) / hz;
      ribbons.update(1 / hz, camera);
    }
    const pool = ribbons as unknown as { arcs: { active: boolean; pts: THREE.Vector3[] }[] };
    const arc = pool.arcs.find((a) => a.active)!;
    const points = arc.pts.map((p) => p.clone());
    histories.push(points);
    expect(points.at(-1)!.x - points[0].x).toBeGreaterThan(0.65);
    expect(points.at(-1)!.x - points[0].x).toBeLessThan(0.8);
    time += 0.5;
    ribbons.update(0, camera);
    expect(arc.pts).toEqual(points);
    jump = 30;
    ribbons.update(1 / hz, camera);
    expect(Math.max(...arc.pts.map((p) => p.x)) - Math.min(...arc.pts.map((p) => p.x))).toBe(0);
    ribbons.dispose();
    texture.dispose();
  }
  for (const points of histories.slice(1))
    for (let i = 0; i < points.length; i++)
      expect(points[i].distanceTo(histories[0][i])).toBeLessThan(0.04);
});
