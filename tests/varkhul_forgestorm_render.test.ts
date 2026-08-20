import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  buildVarkhulForgestormTelegraph,
  VarkhulForgestormVisuals,
} from '../src/render/varkhul_forgestorm_visual';
import type { ActiveVarkhulForgestormWarning } from '../src/sim/varkhul_forgestorm';

const WARNING: ActiveVarkhulForgestormWarning = {
  id: 42_100_210,
  sourceId: 42,
  x: 7,
  z: -5,
  radius: 4,
  duration: 2.5,
  remaining: 2.5,
};

describe('Varkhul Forgestorm rendering', () => {
  it('builds the authoritative radius as tier-independent actionable geometry', () => {
    const low = buildVarkhulForgestormTelegraph(WARNING, 3);
    const ultra = buildVarkhulForgestormTelegraph(WARNING, 3);
    for (const visual of [low, ultra]) {
      expect(visual.userData).toMatchObject({
        actionable: true,
        warningId: WARNING.id,
        sourceId: WARNING.sourceId,
        radius: WARNING.radius,
      });
      expect(visual.position.toArray()).toEqual([WARNING.x, 3.09, WARNING.z]);
      const rim = visual.getObjectByName('varkhul-forgestorm-rim') as THREE.Mesh;
      const positions = rim.geometry.getAttribute('position');
      let maxRadius = 0;
      for (let index = 0; index < positions.count; index++) {
        maxRadius = Math.max(maxRadius, Math.hypot(positions.getX(index), positions.getZ(index)));
      }
      expect(maxRadius).toBeCloseTo(WARNING.radius, 5);
    }
  });

  it('reconciles snapshots by stable id and advances the countdown without reallocating', () => {
    const scene = new THREE.Scene();
    const groundY = vi.fn(() => 2);
    const visuals = new VarkhulForgestormVisuals(scene, groundY);
    visuals.sync([WARNING]);
    const group = scene.getObjectByName('varkhul-forgestorm-warning') as THREE.Group;
    visuals.sync([{ ...WARNING, remaining: 1.25 }]);
    visuals.update(0.1);
    expect(scene.getObjectByName('varkhul-forgestorm-warning')).toBe(group);
    expect(groundY).toHaveBeenCalledOnce();
    const countdown = group.getObjectByName('varkhul-forgestorm-countdown') as THREE.Mesh;
    expect(countdown.scale.x).toBeCloseTo(0.5);
    expect(countdown.scale.z).toBeCloseTo(0.5);
  });

  it('removes stale authoritative warnings and disposes the remaining set', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulForgestormVisuals(scene, () => 0);
    visuals.sync([WARNING, { ...WARNING, id: WARNING.id + 1, x: 12 }]);
    expect(scene.children).toHaveLength(2);
    visuals.sync([{ ...WARNING, id: WARNING.id + 1, x: 12 }]);
    expect(scene.children).toHaveLength(1);
    visuals.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('keeps countdown progress but settles the decorative rim pulse for reduced motion', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulForgestormVisuals(scene, () => 0);
    visuals.sync([{ ...WARNING, remaining: 1.25 }]);
    const group = scene.getObjectByName('varkhul-forgestorm-warning') as THREE.Group;
    const rim = group.getObjectByName('varkhul-forgestorm-rim') as THREE.Mesh;
    const countdown = group.getObjectByName('varkhul-forgestorm-countdown') as THREE.Mesh;

    visuals.update(0.5, true);
    const firstOpacity = (rim.material as THREE.Material).opacity;
    visuals.update(0.5, true);

    expect((rim.material as THREE.Material).opacity).toBe(firstOpacity);
    expect(countdown.scale.x).toBeCloseTo(0.5);
    expect(countdown.scale.z).toBeCloseTo(0.5);
  });

  it('reconciles the world projection in both renderer frame paths', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(
      renderer.match(
        /this\.varkhulForgestormVisuals\?\.sync\(this\.sim\.activeVarkhulForgestormWarnings\)/g,
      ),
    ).toHaveLength(2);
    expect(renderer).toContain('new VarkhulForgestormVisuals(this.scene');
  });
});
