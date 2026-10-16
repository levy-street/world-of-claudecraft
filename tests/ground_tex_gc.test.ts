// The ground-texture GC must free exactly the rock/cave sets NO placement/cave
// uses, and keep the ones in use. The used keys come from the passed-in
// document arrays (map.placements / map.caves), NOT getActiveWorldContent(),
// because the editor renders from the document while its active WorldContent
// carries placements: [] (reading the registry there freed the set the maker
// was actively using -- the bug this pins).

import { describe, expect, it, vi } from 'vitest';

const rockDisposed: (ReadonlySet<string> | null)[] = [];
const caveDisposed: (ReadonlySet<string> | null)[] = [];

vi.mock('../src/render/rock_gen', () => ({
  disposeUnusedRockGroundMats: (keys: ReadonlySet<string>) => rockDisposed.push(new Set(keys)),
}));
vi.mock('../src/render/cave_mesh', () => ({
  disposeUnusedCaveGroundMats: (keys: ReadonlySet<string>) => caveDisposed.push(new Set(keys)),
}));

const { gcGroundTextureSets } = await import('../src/render/ground_tex_gc');

describe('gcGroundTextureSets', () => {
  it('collects the used rock and cave set keys from the document arrays', () => {
    rockDisposed.length = 0;
    caveDisposed.length = 0;
    gcGroundTextureSets(
      [
        { rockTexId: 'Rock057' },
        { rockTexId: 'Cliff005' },
        { rockTexId: 'Rock057' }, // dedupes
        {}, // no texture: ignored
      ],
      [{ tex: 'Ground102' }, {}, { tex: 'Lava005' }],
    );
    expect(rockDisposed).toHaveLength(1);
    expect([...rockDisposed[0]!].sort()).toEqual(['Cliff005', 'Rock057']);
    expect(caveDisposed).toHaveLength(1);
    expect([...caveDisposed[0]!].sort()).toEqual(['Ground102', 'Lava005']);
  });

  it('passes empty used-key sets when nothing is textured (frees everything)', () => {
    rockDisposed.length = 0;
    caveDisposed.length = 0;
    gcGroundTextureSets([{}, { rockTexId: undefined }], []);
    expect(rockDisposed[0]!.size).toBe(0);
    expect(caveDisposed[0]!.size).toBe(0);
  });
});
