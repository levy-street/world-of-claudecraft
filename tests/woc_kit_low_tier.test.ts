// The creator's class body asks for the LOW armor file of each set of its kit first
// (woc_armor_dressing.ts prefetchWocKitLowTier): the smallest file lands first and draws as
// the set's stand-in tier while the tier the stage asks for streams in over it. It asks only
// where it helps: never for a set that already draws some tier, never when the stage's own
// tier IS low (the low preset, every phone).
import { afterEach, describe, expect, it, vi } from 'vitest';

const resident = new Set<string>();
const ensured: string[] = [];

vi.mock('../src/render/characters/woc_armor_packs', async (importActual) => {
  const actual = await importActual<typeof import('../src/render/characters/woc_armor_packs')>();
  return {
    ...actual,
    wocArmorPackResident: (url: string) => resident.has(url),
    ensureWocArmorPack: (url: string) => {
      ensured.push(url);
    },
  };
});

async function setup(overrides: { tier: string; constrainedMemory: boolean }) {
  const gfx = await import('../src/render/gfx');
  const restore = gfx.gfxInternalsForTest.overrideSettings(
    overrides as unknown as Parameters<typeof gfx.gfxInternalsForTest.overrideSettings>[0],
  );
  const { prefetchWocKitLowTier } = await import('../src/render/characters/woc_armor_dressing');
  const { VISUALS, playerVisualKey } = await import('../src/render/characters/manifest');
  const { wocArmorPackUrl } = await import('../src/render/characters/woc_armor_core');
  const { wocManifestSets } = await import('../src/render/characters/woc_parts_core');
  const manifest = VISUALS[playerVisualKey('warrior', null)].wocCharacter;
  if (!manifest) throw new Error('the warrior is a WOC body');
  return {
    restore,
    prefetchWocKitLowTier,
    manifest,
    sets: wocManifestSets(manifest),
    wocArmorPackUrl,
  };
}

let restoreGfx: (() => void) | null = null;

afterEach(() => {
  restoreGfx?.();
  restoreGfx = null;
  resident.clear();
  ensured.length = 0;
});

describe('prefetchWocKitLowTier', () => {
  it('asks for the low file of every kit set with nothing resident (a desktop creator)', async () => {
    const s = await setup({ tier: 'high', constrainedMemory: false });
    restoreGfx = s.restore;
    expect(s.sets.length).toBeGreaterThan(0);
    s.prefetchWocKitLowTier(s.manifest, 'crowd');
    expect(ensured).toEqual(s.sets.map((set) => s.wocArmorPackUrl(s.manifest.fit, set, 'low')));
  });

  it('skips a set that already draws some tier (a stand-in is there, or the tier itself)', async () => {
    const s = await setup({ tier: 'high', constrainedMemory: false });
    restoreGfx = s.restore;
    const [first, ...rest] = s.sets;
    resident.add(s.wocArmorPackUrl(s.manifest.fit, first, 'medium'));
    s.prefetchWocKitLowTier(s.manifest, 'full');
    expect(ensured).toEqual(rest.map((set) => s.wocArmorPackUrl(s.manifest.fit, set, 'low')));
  });

  it('asks for nothing where the stage draws low anyway (the low preset, a phone)', async () => {
    for (const profile of [
      { tier: 'low', constrainedMemory: false },
      { tier: 'high', constrainedMemory: true },
    ]) {
      const s = await setup(profile);
      s.prefetchWocKitLowTier(s.manifest, 'crowd');
      s.restore();
      expect(ensured, JSON.stringify(profile)).toEqual([]);
    }
  });
});
