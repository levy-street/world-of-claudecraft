import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const assetsSrc = readFileSync(new URL('../src/render/characters/assets.ts', import.meta.url), 'utf8');
const visualSrc = readFileSync(new URL('../src/render/characters/visual.ts', import.meta.url), 'utf8');

// Hardening for "skin N needs a relog": when an alternate skin atlas exists but
// has not finished loading, skinTexture() returns null and the body silently
// shows the embedded default. setSkin must load the atlas on demand and re-apply
// the materials once it arrives, guarded so a newer skin change still wins.
describe('skin texture load-retry hardening', () => {
  it('assets.ts exposes ensureSkinTexture for on-demand atlas loading', () => {
    expect(assetsSrc).toContain('export function ensureSkinTexture');
  });

  it('setSkin re-applies materials once the atlas finishes loading', () => {
    expect(visualSrc).toContain('ensureSkinTexture');
    // guard: only re-apply if this is still the requested skin
    expect(visualSrc).toMatch(/this\.skinIndex === skinIndex/);
  });
});
