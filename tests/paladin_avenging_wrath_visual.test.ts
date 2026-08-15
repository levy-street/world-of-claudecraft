import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { syncPaladinAvengingWrathVisual } from '../src/render/paladin_avenging_wrath_visual';

describe('Paladin Avenging Wrath visual', () => {
  it('keeps two physical golden wings visible and freezes their pose for reduced motion', () => {
    const parent = new THREE.Group();
    const visual = syncPaladinAvengingWrathVisual(null, parent, 1.8, true, 0, false);
    expect(visual).not.toBeNull();
    if (!visual) throw new Error('missing Avenging Wrath visual');

    const left = parent.getObjectByName('paladin-avenging-wrath-left-wing');
    const right = parent.getObjectByName('paladin-avenging-wrath-right-wing');
    const feathers = parent.getObjectByName(
      'paladin-avenging-wrath-left-feathers',
    ) as THREE.InstancedMesh;
    expect(left).toBeTruthy();
    expect(right).toBeTruthy();
    expect(feathers).toBeInstanceOf(THREE.InstancedMesh);
    expect(feathers.count).toBe(6);
    expect((feathers.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xffd84a);

    const openPose = left?.rotation.z;
    syncPaladinAvengingWrathVisual(visual, parent, 1.8, true, 0.5, false);
    expect(left?.rotation.z).not.toBe(openPose);
    const reducedPose = left?.rotation.z;
    syncPaladinAvengingWrathVisual(visual, parent, 1.8, true, 0.5, true);
    syncPaladinAvengingWrathVisual(visual, parent, 1.8, true, 0.5, true);
    expect(left?.rotation.z).toBe(reducedPose);

    const dispose = vi.spyOn(visual.material, 'dispose');
    expect(syncPaladinAvengingWrathVisual(visual, parent, 1.8, false, 0, false)).toBeNull();
    expect(parent.getObjectByName('paladin-avenging-wrath')).toBeUndefined();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('is wired into the renderer aura scan and entity visual lifecycle', () => {
    const rendererPath = fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url));
    const renderer = readFileSync(rendererPath, 'utf8');

    expect(renderer).toContain('if (isPaladinWingAura(a)) hasPaladinWings = true');
    expect(renderer).toContain('v.paladinAvengingWrathVisual = syncPaladinAvengingWrathVisual(');
    expect(renderer).toContain('v.paladinAvengingWrathVisual?.dispose()');
    expect(renderer).toContain('!e.dead && hasPaladinWings');
  });
});
