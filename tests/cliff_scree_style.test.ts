// A map can switch the high-tier cliff rubble off (TerrainStyle.scree).
// Deepglass: the ring city is carved into terraces, which the scree probes
// read as cliff faces, so on ultra the streets filled with boulders (SPACEY:
// "the ultra graphics shouldn't have random rock clutter rendered around
// city circle"). Off, the pure placement source yields nothing at all, so
// the tier-gated dressing cannot cost a draw either.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { newFlatCustomMap } from '../src/editor/custom_map';
import { screeSpotsInBounds } from '../src/render/cliff_scree_core';
import { BUILTIN_WORLD, getActiveWorldContent, setActiveWorldContent } from '../src/sim/data';
import { sanitizeMapDoc } from '../src/sim/map_doc';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

const BOUNDS = { minX: -900, maxX: 900, minZ: -400, maxZ: 2400 };

function sourceOf(relativePath: string): string {
  return codeWithoutLineComments(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

describe('terrain style: scree', () => {
  afterEach(() => setActiveWorldContent(BUILTIN_WORLD));

  it('keeps only an explicit off through the sanitizer', () => {
    const map = newFlatCustomMap('Scree Test', 'map_scree_test', 1752710400000, {
      width: 60,
      height: 60,
    });
    map.terrainStyle = { scree: false };
    const off = sanitizeMapDoc(JSON.parse(JSON.stringify(map)));
    expect(off?.terrainStyle).toEqual({ scree: false });
    map.terrainStyle = { scree: true };
    const on = sanitizeMapDoc(JSON.parse(JSON.stringify(map)));
    expect(on?.terrainStyle).toBeUndefined();
  });

  it('places no rubble anywhere while the active map has it off', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    const seed = 7;
    const withRocks = screeSpotsInBounds(seed, BOUNDS);
    expect(withRocks.length).toBeGreaterThan(0);
    setActiveWorldContent({ ...getActiveWorldContent(), terrainStyle: { scree: false } });
    expect(screeSpotsInBounds(seed, BOUNDS)).toEqual([]);
    // and the shipped world (no style at all) keeps its look
    setActiveWorldContent(BUILTIN_WORLD);
    expect(screeSpotsInBounds(seed, BOUNDS).length).toBe(withRocks.length);
  });

  it('is authored from the Studio biome panel', () => {
    const app = sourceOf('../src/editor/app.ts');
    expect(app).toContain('if (merged.scree === false) next.scree = false');
    expect(app).toContain('scree: this.map.terrainStyle?.scree !== false');
    const inspector = sourceOf('../src/editor/inspector.ts');
    expect(inspector).toContain("checkbox(t('editor.biome.autoScree'), style.scree");
  });
});
