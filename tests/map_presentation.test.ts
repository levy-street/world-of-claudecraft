import { describe, expect, it } from 'vitest';
import {
  interiorPresentationMode,
  isAuthoredMapPresentation,
  usesPlainTerrainMaterial,
  usesProceduralOverworldFoliage,
} from '../src/sim/map_presentation';

describe('map presentation', () => {
  it('uses untextured ground for every authored map presentation', () => {
    expect(usesPlainTerrainMaterial(undefined)).toBe(false);
    expect(usesPlainTerrainMaterial('blank')).toBe(true);
    expect(usesPlainTerrainMaterial('dungeon')).toBe(true);
    expect(usesPlainTerrainMaterial('temple')).toBe(true);
    expect(usesPlainTerrainMaterial('nythraxis')).toBe(true);
    expect(usesPlainTerrainMaterial('delve')).toBe(true);
    expect(usesPlainTerrainMaterial('yumiMaze')).toBe(true);
    expect(usesPlainTerrainMaterial('sowfield')).toBe(false);
    expect(isAuthoredMapPresentation('delve')).toBe(true);
    expect(isAuthoredMapPresentation('sowfield')).toBe(true);
    expect(usesProceduralOverworldFoliage(undefined)).toBe(true);
    expect(usesProceduralOverworldFoliage('sowfield')).toBe(false);
    expect(usesProceduralOverworldFoliage('delve')).toBe(false);
  });

  it('keeps outdoor authored environments out of the interior lighting path', () => {
    expect(interiorPresentationMode('sowfield')).toBeNull();
    expect(interiorPresentationMode('yumiMaze')).toBe('yumiMaze');
  });
});
