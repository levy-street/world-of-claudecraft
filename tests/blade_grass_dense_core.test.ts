import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  activateDenseSlot,
  type DenseSlotState,
  deactivateDenseSlot,
} from '../src/render/blade_grass_dense_core';

describe('blade grass dense submission', () => {
  it('keeps active logical slots in a dense prefix under swap-removal', () => {
    const state: DenseSlotState = {
      count: 0,
      slotToDense: new Int32Array(5).fill(-1),
      denseToSlot: new Int32Array(5).fill(-1),
    };

    expect(activateDenseSlot(state, 3)).toBe(0);
    expect(activateDenseSlot(state, 1)).toBe(1);
    expect(activateDenseSlot(state, 4)).toBe(2);
    expect(activateDenseSlot(state, 1)).toBe(1);
    expect(deactivateDenseSlot(state, 1)).toBe(4);
    expect(state.count).toBe(2);
    expect([...state.denseToSlot.slice(0, state.count)]).toEqual([3, 4]);
    expect([...state.slotToDense]).toEqual([-1, -1, -1, 0, 1]);
    expect(deactivateDenseSlot(state, 4)).toBe(-1);
    expect(deactivateDenseSlot(state, 0)).toBe(-2);
    expect(state.count).toBe(1);
  });

  it('wires the dense prefix into the existing single blade-grass draw', () => {
    const source = readFileSync(new URL('../src/render/blade_grass.ts', import.meta.url), 'utf8');

    expect(source.match(/new THREE\.InstancedMesh\(/g)).toHaveLength(1);
    expect(source).toContain('const dense = activateDenseSlot(denseSlots, slot);');
    expect(source).toContain('im.getMatrixAt(denseSlots.count, movedMatrix);');
    expect(source).toContain('im.setColorAt(removedDense, movedColor);');
  });

  it('builds the initial dense prefix before rendering and skips all steady-state uploads', () => {
    const source = readFileSync(new URL('../src/render/blade_grass.ts', import.meta.url), 'utf8');
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

    expect(source).toMatch(
      /buildBladeGrass\(\s*seed: number,\s*initialPx: number,\s*initialPz: number,/,
    );
    expect(renderer).toMatch(
      /buildBladeGrass\(\s*this\.sim\.cfg\.seed,\s*this\.sim\.player\.pos\.x,\s*this\.sim\.player\.pos\.z,/,
    );
    expect(source).toContain(
      'scanTargetBlock(initialBaseI, initialBaseJ, Number.POSITIVE_INFINITY);',
    );

    const updateStart = source.indexOf('update(px: number, pz: number): void {');
    const updateSource = source.slice(updateStart);
    const steadyReturn = updateSource.indexOf(
      'if (baseI === lastBaseI && baseJ === lastBaseJ && !pending) return;',
    );
    expect(updateStart).toBeGreaterThan(0);
    expect(steadyReturn).toBeGreaterThan(0);
    for (const transitionWork of [
      'scanTargetBlock(baseI, baseJ, PLACE_BUDGET)',
      'im.count = denseSlots.count;',
      'im.instanceMatrix.needsUpdate = true;',
      'im.instanceColor.needsUpdate = true;',
    ]) {
      expect(updateSource.indexOf(transitionWork)).toBeGreaterThan(steadyReturn);
    }
  });
});
