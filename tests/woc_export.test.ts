import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import accepted from '../scripts/assets/woc_character/export_split.json';
import { VISUALS } from '../src/render/characters/manifest';
import {
  WOC_ANATOMY_TOP,
  WOC_ARMOR_TIERS,
  wocAnimsUrl,
  wocArmorPackUrl,
  wocBaseUrl,
} from '../src/render/characters/woc_armor_core';
import { wocManifestSets } from '../src/render/characters/woc_parts_core';

// The accepted WOC character delivery, split the way the artist delivers it (the 2026-09-25
// character size gameplan, step 4): one base and one animation library per body fit, per set
// and fit a low file, a medium file and the top mip level of each of the medium file's maps
// (2026-10-03: the high tier is the medium file with the top file laid over it), and the
// under-armor atlases. The pin is written by scripts/assets/woc_character/build_woc_split.mjs
// only after a whole build passes its check against the assembled references, and every served
// byte must match it.
describe('the September 2026 WOC character delivery (the 51-clip animation rig, split)', () => {
  const files = Object.entries(accepted.files);

  it('ships exactly the files the character defs load: two bases, two libraries, every set at every tier', () => {
    expect(accepted.armInterface).toBe('WOC_Anim_v01_20260924');
    // 55 until 2026-09-30, when the unused two-hand *_2H set left the library
    expect(accepted.clips).toBe(51);
    // the build's armor files are what the runtime names each tier's pack by: low, medium,
    // and the top file for high
    expect(accepted.armorFiles).toEqual(['low', 'medium', 'top']);
    expect(
      WOC_ARMOR_TIERS.map(
        (tier) => /_([a-z]+)\.glb$/.exec(wocArmorPackUrl('male', 'mage', tier))?.[1],
      ),
    ).toEqual(accepted.armorFiles);
    const expected = new Set<string>();
    for (const def of Object.values(VISUALS)) {
      const manifest = def.wocCharacter;
      if (!manifest) continue;
      expected.add(wocBaseUrl(manifest.fit));
      expected.add(wocAnimsUrl(manifest.fit));
      expect(def.url).toBe(wocBaseUrl(manifest.fit));
      expect(def.animUrls).toEqual([wocAnimsUrl(manifest.fit)]);
      for (const set of wocManifestSets(manifest)) {
        for (const tier of WOC_ARMOR_TIERS) expected.add(wocArmorPackUrl(manifest.fit, set, tier));
      }
      // an under-armor atlas ships as its KTX2 only (the url names the PNG the skin
      // convention's way; the masters stay in the character source export)
      if (manifest.underArmorAtlas) {
        expected.add(manifest.underArmorAtlas.url.replace(/\.png$/, '.ktx2'));
      }
    }
    // 2 fits x (base + library) + 2 fits x 9 sets x 3 armor files + 16 atlases
    expect(expected.size).toBe(4 + 54 + 16);
    expect(files.map(([file]) => file).sort()).toEqual([...expected].sort());
    // the retired whole-high-tier files are gone from the delivery
    expect(files.filter(([file]) => file.endsWith('_high.glb'))).toEqual([]);
  });

  it('normalizes each body by the crown the build measured before it stripped the original head', () => {
    // A base ships no head (the modular head packs are the head): the build measures the
    // handoff's original face, records its crown here and strips it, and the runtime holds
    // that crown as the top every body is normalized by (WOC_ANATOMY_TOP). The two measures
    // differ only by mesh quantization (the runtime's is taken on the shipped files), far
    // under a tenth of a percent of a body's height; a real change of either is a different
    // character size and must move both.
    expect(Object.keys(accepted.anatomyTop).sort()).toEqual(['female', 'male']);
    for (const fit of ['male', 'female'] as const) {
      const built = accepted.anatomyTop[fit];
      expect(built, fit).toBeGreaterThan(1);
      expect(Math.abs(WOC_ANATOMY_TOP[fit] - built) / built, fit).toBeLessThan(1e-3);
    }
    // literals: the size every character has drawn at since the head packs landed
    expect(WOC_ANATOMY_TOP).toEqual({ male: 1.1806127832469875, female: 1.1940103157300836 });
  });

  it('serves every file byte for byte as the build accepted it', () => {
    for (const [file, sha256] of files) {
      const bytes = readFileSync(path.resolve(__dirname, '../public', file));
      expect(createHash('sha256').update(bytes).digest('hex'), file).toBe(sha256);
    }
  });
});
