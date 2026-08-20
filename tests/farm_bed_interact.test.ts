import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decideFarmBedAction, nearestInteractableBed } from '../src/game/farm_bed_interact';
import { INTERACT_RANGE } from '../src/sim/types';
import type { FarmPatchDef, FarmPlotStatus, FarmPlotView } from '../src/world_api/farming';

function patch(id: string, beds: readonly { id: string; x: number; z: number }[]): FarmPatchDef {
  return { id, zoneId: 'eastbrook_vale', tier: 1, x: 0, z: 0, beds };
}

function plot(bedId: string, status: FarmPlotStatus): FarmPlotView {
  return {
    bedId,
    cropId: 'vale_wheat',
    plantedAtMs: 0,
    readyAtMs: 1000,
    compost: false,
    watch: false,
    tonic: false,
    notified: false,
    status,
  };
}

const ORIGIN = { x: 0, y: 0, z: 0 };

describe('nearestInteractableBed', () => {
  it('picks the nearest bed in range across patches', () => {
    const patches = [
      patch('patch_far', [{ id: 'bed_far', x: 4, z: 0 }]),
      patch('patch_near', [{ id: 'bed_near', x: 0, z: 2 }]),
    ];
    expect(nearestInteractableBed(patches, ORIGIN)).toBe('bed_near');
  });

  it('returns null when every bed is out of range', () => {
    const patches = [patch('patch_a', [{ id: 'bed_a', x: 6, z: 0 }])];
    expect(nearestInteractableBed(patches, ORIGIN)).toBeNull();
  });

  it('includes the exact INTERACT_RANGE boundary, mirroring the sim deny', () => {
    // The sim refuses only distToBed > INTERACT_RANGE, so a bed at exactly
    // the range must still be offered; one step past it must not.
    const atBoundary = [patch('patch_a', [{ id: 'bed_edge', x: INTERACT_RANGE, z: 0 }])];
    expect(nearestInteractableBed(atBoundary, ORIGIN)).toBe('bed_edge');
    const pastBoundary = [patch('patch_a', [{ id: 'bed_past', x: INTERACT_RANGE + 0.001, z: 0 }])];
    expect(nearestInteractableBed(pastBoundary, ORIGIN)).toBeNull();
  });

  it('breaks an exact distance tie by content order', () => {
    const patches = [
      patch('patch_a', [
        { id: 'bed_first', x: 3, z: 0 },
        { id: 'bed_second', x: -3, z: 0 },
      ]),
    ];
    expect(nearestInteractableBed(patches, ORIGIN)).toBe('bed_first');
  });

  it('measures reach with the sim`s own distToBed, not a re-derived walk', () => {
    // Phase 14 replaced the comment-contract mirror with the shared export:
    // the module must import distToBed from the sim's farming module and use
    // it as the one distance read, so the reach math can never drift from the
    // deny it mirrors. Behavior is pinned by the boundary arms above; this pin
    // exists so a future re-derivation (dropping the import) reds loudly.
    const source = readFileSync(path.join(process.cwd(), 'src/game/farm_bed_interact.ts'), 'utf8');
    const importLine = "import { distToBed } from '../sim/professions/farming';";
    expect(source.split(importLine).length - 1).toBe(1);
    expect(source.split('distToBed(playerPos, bed)').length - 1).toBe(1);
  });
});

describe('decideFarmBedAction', () => {
  it.each(['ready', 'withered', 'growing'] as const)(
    'picks harvest when my plot occupies the bed (status %s is never read)',
    (status) => {
      const world = { farmPatches: [], myFarmPlots: [plot('bed_a', status)] };
      expect(decideFarmBedAction(world, 'bed_a')).toBe('harvest');
    },
  );

  it('picks plant when no plot of mine occupies the bed', () => {
    const world = { farmPatches: [], myFarmPlots: [plot('bed_other', 'ready')] };
    expect(decideFarmBedAction(world, 'bed_a')).toBe('plant');
  });
});
