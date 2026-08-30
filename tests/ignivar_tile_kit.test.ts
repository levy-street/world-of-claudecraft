import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IGNIVAR_TILE_KINDS,
  IGNIVAR_TILE_PREFIX,
  ignivarTileKind,
  isIgnivarInterior,
} from '../src/render/ignivar_tile_kit';

describe('Ignivar raid-only tile kit', () => {
  it('remaps exactly the structural kinds, only for the ignivar variant', () => {
    for (const kind of IGNIVAR_TILE_KINDS) {
      expect(ignivarTileKind('ignivar', kind)).toBe(`${IGNIVAR_TILE_PREFIX}${kind}`);
      // every other dungeon keeps the shared kit untouched
      expect(ignivarTileKind('crypt', kind)).toBe(kind);
      expect(ignivarTileKind('bastion', kind)).toBe(kind);
      expect(ignivarTileKind('delve_marsh', kind)).toBe(kind);
    }
    // non-structural kinds stay shared even inside the raid
    for (const kind of ['torch_mounted', 'banner_red', 'chest', 'floor_tile_grate']) {
      expect(ignivarTileKind('ignivar', kind)).toBe(kind);
    }
  });

  it('ships a raid-only GLB for every remapped kind, with exactly two texture carriers', () => {
    const glbImageCount = (file: string): number => {
      const buf = fs.readFileSync(file);
      const jsonLen = buf.readUInt32LE(12);
      const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString());
      return (json.images ?? []).length;
    };
    const carriers: string[] = [];
    for (const kind of IGNIVAR_TILE_KINDS) {
      const file = path.resolve(
        process.cwd(),
        `public/models/dungeon/${IGNIVAR_TILE_PREFIX}${kind}.glb`,
      );
      expect(fs.existsSync(file), `missing ${file}`).toBe(true);
      // a real mesh, never an empty stub
      expect(fs.statSync(file).size).toBeGreaterThan(2000);
      if (glbImageCount(file) > 0) carriers.push(kind);
    }
    // the whole kit references TWO shared textures: one floor carrier, one
    // wall carrier, plus the pillars' tiny swatch atlas; every other module
    // is geometry-only and rides the carrier pack materials
    expect(carriers.sort()).toEqual(
      ['floor_tile_large', 'pillar', 'pillar_decorated', 'wall'].sort(),
    );
  });

  it('covers all three raid rooms and nothing else', () => {
    expect(isIgnivarInterior('ignivar')).toBe(true);
    expect(isIgnivarInterior('ignivar_approach')).toBe(true);
    expect(isIgnivarInterior('ignivar_depths')).toBe(true);
    expect(isIgnivarInterior('nythraxis')).toBe(false);
    expect(isIgnivarInterior('crypt')).toBe(false);
  });
});
