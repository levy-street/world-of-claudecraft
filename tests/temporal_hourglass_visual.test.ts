import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  syncTemporalHourglassVisual,
  TemporalHourglassGroundVisuals,
  TemporalHourglassVisual,
} from '../src/render/temporal_hourglass_visual';

describe('Temporal Hourglass visual', () => {
  it('builds a small original physical hourglass on the ground', () => {
    const visual = new TemporalHourglassVisual(false);
    visual.update('protective', 1);

    expect(visual.group.visible).toBe(true);
    expect(visual.group.getObjectByName('temporal-hourglass-top')).toBeInstanceOf(THREE.Mesh);
    expect(visual.group.getObjectByName('temporal-hourglass-bottom')).toBeInstanceOf(THREE.Mesh);
    expect(visual.group.getObjectByName('temporal-hourglass-upper-glass')).toBeInstanceOf(
      THREE.Mesh,
    );
    const bounds = new THREE.Box3().setFromObject(visual.group);
    expect(bounds.min.y).toBeGreaterThanOrEqual(0);
    expect(bounds.max.y).toBeLessThan(1);
  });

  it('shows a rotating clock over the affected unit until cleanup', () => {
    const visual = new TemporalHourglassVisual();
    visual.update('hostile', 0.25, 2);
    const clock = visual.group.getObjectByName('temporal-hourglass-overhead-clock');
    expect(clock).toBeInstanceOf(THREE.Sprite);
    expect(clock?.position.y).toBeCloseTo(2.65);
    const rotation = (clock as THREE.Sprite).material.rotation;

    visual.update('hostile', 0.25, 2);
    expect((clock as THREE.Sprite).material.rotation).not.toBe(rotation);
    visual.update(null, 0.1, 2);
    expect(visual.group.visible).toBe(false);
  });

  it('mirrors and immediately removes persistent ground hourglasses', () => {
    const scene = new THREE.Scene();
    const visuals = new TemporalHourglassGroundVisuals(scene, () => 4);
    visuals.sync([{ id: '1:2', x: 3, z: 5, radius: 1.75, duration: 30, remaining: 30 }]);
    const hourglass = scene.getObjectByName('temporal-hourglass-visual');
    expect(hourglass?.position).toMatchObject({ x: 3, y: 4.04, z: 5 });

    visuals.sync([]);
    expect(scene.getObjectByName('temporal-hourglass-visual')).toBeUndefined();
  });

  it('distinguishes protective and hostile modes and hides immediately on cleanup', () => {
    const visual = new TemporalHourglassVisual();
    visual.update('protective', 0.1);
    expect(visual.currentMode()).toBe('protective');
    const protectiveRotation = visual.group.rotation.y;

    visual.update('hostile', 0.1);
    expect(visual.currentMode()).toBe('hostile');
    expect(visual.group.rotation.y).not.toBe(protectiveRotation);
    visual.update(null, 0.1);
    expect(visual.group.visible).toBe(false);
  });

  it('is created lazily from the authoritative aura-derived renderer mode', () => {
    const parent = new THREE.Group();
    let visual = syncTemporalHourglassVisual(null, parent, null, 0.1);
    expect(visual).toBeNull();
    visual = syncTemporalHourglassVisual(visual, parent, 'hostile', 0.1);
    expect(parent.children).toEqual([visual?.group]);
    const first = visual;
    visual = syncTemporalHourglassVisual(visual, parent, null, 0.1);
    expect(visual).toBe(first);
    expect(visual?.group.visible).toBe(false);
  });

  it('is wired to both Hourglass aura modes without turning allied stasis into Ice Block', () => {
    const path = fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url));
    const source = readFileSync(path, 'utf8');

    expect(source).toContain("if (a.id === 'ice_block' && a.kind === 'stasis')");
    expect(source).toContain("if (a.kind === 'stasis') temporalHourglassMode = 'protective'");
    expect(source).toContain("if (a.kind === 'incapacitate') temporalHourglassMode = 'hostile'");
    expect(source).toContain('v.temporalHourglassVisual = syncTemporalHourglassVisual(');
    expect(source).toContain('v.temporalHourglassVisual?.dispose()');
  });
});
