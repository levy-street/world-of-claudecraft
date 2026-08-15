import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { isOathChainAura } from '../src/render/character_effects';
import { syncPaladinOathChainVisual } from '../src/render/paladin_oath_chain_visual';

describe('Paladin Oath Chain visual', () => {
  it('activates for both the pull and its arrival slow, but not unrelated control', () => {
    expect(isOathChainAura({ id: 'oath_chain_pull', kind: 'forced_move' })).toBe(true);
    expect(isOathChainAura({ id: 'oath_chain_slow', kind: 'slow' })).toBe(true);
    expect(isOathChainAura({ id: 'frostbolt_slow', kind: 'slow' })).toBe(false);
  });

  it('draws interlocking golden links from the caster anchor to the target anchor', () => {
    const parent = new THREE.Group();
    const sourcePos = { x: 0, y: 0, z: 0 };
    const targetPos = { x: 10, y: 0, z: 0 };
    const visual = syncPaladinOathChainVisual(
      null,
      parent,
      sourcePos,
      targetPos,
      1.8,
      1.8,
      true,
      0,
      false,
    );
    expect(visual).not.toBeNull();
    if (!visual) throw new Error('missing Oath Chain visual');

    const links = parent.getObjectByName('paladin-oath-chain-links') as THREE.InstancedMesh;
    expect(links).toBeInstanceOf(THREE.InstancedMesh);
    expect(links.count).toBeGreaterThanOrEqual(25);
    expect((links.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xffc928);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < links.count; index++) {
      links.getMatrixAt(index, matrix);
      position.setFromMatrixPosition(matrix);
      minX = Math.min(minX, position.x);
      maxX = Math.max(maxX, position.x);
    }
    expect(minX).toBeLessThanOrEqual(0.5);
    expect(maxX).toBeGreaterThanOrEqual(9.5);

    const opacity = visual.material.opacity;
    syncPaladinOathChainVisual(visual, parent, sourcePos, targetPos, 1.8, 1.8, true, 0.5, false);
    expect(visual.material.opacity).not.toBe(opacity);
    const reducedOpacity = visual.material.opacity;
    syncPaladinOathChainVisual(visual, parent, sourcePos, targetPos, 1.8, 1.8, true, 0.5, true);
    expect(visual.material.opacity).toBe(reducedOpacity);

    const dispose = vi.spyOn(visual.material, 'dispose');
    expect(
      syncPaladinOathChainVisual(visual, parent, sourcePos, targetPos, 1.8, 1.8, false, 0, false),
    ).toBeNull();
    expect(parent.getObjectByName('paladin-oath-chain')).toBeUndefined();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('is wired into the renderer aura scan and entity visual lifecycle', () => {
    const rendererPath = fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url));
    const renderer = readFileSync(rendererPath, 'utf8');

    expect(renderer).toContain('oathChainSourceId = a.sourceId');
    expect(renderer).toContain('v.paladinOathChainVisual = syncPaladinOathChainVisual(');
    expect(renderer).toContain('this.scene,');
    expect(renderer).toContain('v.paladinOathChainVisual?.dispose()');
  });
});
