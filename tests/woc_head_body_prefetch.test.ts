// A WOC player's head files ride its body's request (src/render/characters/index.ts
// createCharacterVisual): while the base and animation library still stream, the world
// view already fetches the player's OWN head files (the type's core, its hairstyle and its
// facial hair), never the rest of the split library, so the head lands with the body. A
// speculative request (fetchStreamed: false, the zone prewarm) for a body that is still
// streaming fetches none of them (a build that does run hangs what is resident and kicks
// the type's core, as the whole pack was kicked before the split).
import { describe, expect, it, vi } from 'vitest';
import type { Entity } from '../src/sim/types';

const DIR = 'models/chars/players/woc';

function mockLoader(calls: string[]): void {
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn((url: string) => {
      calls.push(url);
      return new Promise(() => undefined);
    }),
    loadTexture: vi.fn(() => new Promise(() => undefined)),
    loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
    releaseGltf: vi.fn(),
  }));
}

const player = (app: Record<string, unknown>): Entity =>
  ({
    kind: 'player',
    id: 7,
    templateId: 'warrior',
    color: 0xffffff,
    skin: 0,
    mainhandItemId: null,
    offhandItemId: null,
    auras: [],
    modularAppearance: app,
  }) as unknown as Entity;

const headCalls = (calls: string[]): string[] =>
  [...new Set(calls.filter((u) => u.includes('/head_type_')))].sort();

describe('a WOC player fetches its own head files beside its streaming body', () => {
  it('kicks exactly the look it wears: the core, its hairstyle and its facial hair', async () => {
    vi.resetModules();
    const calls: string[] = [];
    mockLoader(calls);
    const { createCharacterVisual } = await import('../src/render/characters/index');
    const { DEFAULT_APPEARANCE } = await import('../src/render/characters/modular');
    const app = { ...DEFAULT_APPEARANCE, headHair: 'mohawk', headBeard: 'handlebar' };
    // nothing lands in this case, so the build is the logged miss of a body with no base;
    // what is pinned here is what it asked for on the way
    const miss = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(createCharacterVisual(player(app))).toBeNull();
    expect(headCalls(calls)).toEqual(
      [
        `${DIR}/head_type_a_core.glb`,
        `${DIR}/head_type_a_hair_mohawk.glb`,
        `${DIR}/head_type_a_beard_handlebar.glb`,
      ].sort(),
    );
    // a Type B player: its own core and style, clean shaven needing no beard file
    const female = { ...DEFAULT_APPEARANCE, gender: 'female', headHair: 'bob', headBeard: 'none' };
    calls.length = 0;
    expect(createCharacterVisual(player(female))).toBeNull();
    expect(headCalls(calls)).toEqual(
      [`${DIR}/head_type_b_core.glb`, `${DIR}/head_type_b_hair_bob.glb`].sort(),
    );
    miss.mockRestore();
  });

  it('a speculative request for a streaming body fetches no head file', async () => {
    vi.resetModules();
    const calls: string[] = [];
    mockLoader(calls);
    const { createCharacterVisual } = await import('../src/render/characters/index');
    const { DEFAULT_APPEARANCE } = await import('../src/render/characters/modular');
    createCharacterVisual(player({ ...DEFAULT_APPEARANCE, headHair: 'quiff' }), undefined, {
      fetchStreamed: false,
    });
    expect(headCalls(calls)).toEqual([]);
  });
});
