// Inert stand-ins for the three character render modules, for happy-dom suites
// whose imports reach src/render/characters/assets.ts without testing it.
//
// Importing assets.ts starts every character model download (its preload loop).
// Under happy-dom the vitest virtual server answers from public/, so the bytes
// really stream, and Three's FileLoader builds a ProgressEvent per chunk. A
// download still in flight when the file's environment tears down finds that
// global deleted: the read rejects unhandled, and a run whose tests all passed
// fails on "ProgressEvent is not defined". Mocking the three modules the HUD
// and the portrait chip reach the preload through keeps it from ever starting.
//
// Import this ABOVE the vi.mock calls and every other relative import: the
// factories run when the mocked modules are first imported, and read this
// binding then.
//
//   import { inertCharacters } from './helpers/inert_characters';
//   vi.mock('../src/render/characters', () => inertCharacters.barrel());
//   vi.mock('../src/render/characters/assets', () => inertCharacters.assets());
//   vi.mock('../src/render/characters/portrait', () => inertCharacters.portrait());
//
// Each stand-in answers what the real module answers while the models are still
// loading: no look, no portrait, never ready. A name left out throws on access
// (the vitest partial-mock guard), so a suite that starts needing one says so.

export const inertCharacters = {
  barrel: () => ({
    CharacterPreview: class {},
    modularLookFor: () => null,
  }),
  assets: () => ({
    preloadMechAssets: () => Promise.resolve(),
  }),
  portrait: () => ({
    cachedPortraitByKey: () => null,
    isComposedPortraitKey: () => false,
    modularPortraitDataUrl: () => null,
    onPortraitsReady: () => undefined,
    onPortraitUpdate: () => undefined,
    playerPortraitDataUrl: () => null,
    portraitsReady: () => false,
    visualPortraitDataUrl: () => null,
  }),
};
