// The Smith's Heart's painted boss ability art (src/ui/boss_ability_art.ts): the
// census (every ability the Adventure Journal lists for the raid wears a painting,
// its own or the raid aura painting of the same mechanic, and every other journal
// keeps its procedural glyph), the shipping files (128px opaque WebP within the 6 KB
// budget, each painting distinct), and the provenance (public/ui/boss-abilities/
// mapping.json and the accepted manifest in parity with the registry and the bytes).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  BOSS_ABILITY_IMAGE_IDS,
  BOSS_ABILITY_REUSED_ART,
  bossAbilityImageUrl,
} from '../src/ui/boss_ability_art';
import { JOURNAL_INSTANCES } from '../src/ui/hud/journal/journal_catalog';
import { journalHitIconId } from '../src/ui/hud/journal/journal_hit_icons';
import { hasExplicitAbilityIcon, iconDataUrl } from '../src/ui/icons';

const ROOT = process.cwd();
const ART_DIR = path.join(ROOT, 'public/ui/boss-abilities');
const MANIFEST = 'docs/achievements/boss-ability-art-2026-11-28/accepted-boss-ability-art.json';
const MAX_BYTES = 6144;
const SIZE = 128;

/** Every journal icon id per instance (mechanics, both tiers). */
function journalIconIds(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const instance of JOURNAL_INSTANCES) {
    const ids = out.get(instance.id) ?? new Set<string>();
    for (const bossKey of instance.source.bossKeys)
      for (const tier of ['normal', 'heroic'] as const)
        for (const phase of instance.source.view(bossKey, tier).phases)
          for (const m of phase.mechanics) ids.add(m.iconId);
    out.set(instance.id, ids);
  }
  return out;
}

const HEART_IDS = journalIconIds().get('smith_heart') ?? new Set<string>();

describe("boss ability art: the Smith's Heart census", () => {
  it('reads the live journal (the census is not vacuous)', () => {
    expect(HEART_IDS.size).toBeGreaterThan(90);
  });

  it('paints every ability the journal lists for the raid', () => {
    const unpainted = [...HEART_IDS].filter((id) => bossAbilityImageUrl(id) === null);
    expect(unpainted).toEqual([]);
  });

  it('serves the painting through the ability icon path every surface draws', () => {
    for (const id of HEART_IDS)
      expect(iconDataUrl('ability', id, 32), id).toBe(bossAbilityImageUrl(id));
  });

  it('covers only journal ids of the raid, each once', () => {
    const painted = new Set(BOSS_ABILITY_IMAGE_IDS);
    expect(painted.size).toBe(BOSS_ABILITY_IMAGE_IDS.length);
    const reused = Object.keys(BOSS_ABILITY_REUSED_ART);
    expect(reused.filter((id) => painted.has(id))).toEqual([]);
    expect([...painted, ...reused].filter((id) => !HEART_IDS.has(id))).toEqual([]);
  });

  it('keeps every other journal on its procedural glyph', () => {
    for (const [instance, ids] of journalIconIds()) {
      if (instance === 'smith_heart') continue;
      for (const id of ids) {
        if (HEART_IDS.has(id)) continue;
        expect(bossAbilityImageUrl(id), `${instance} ${id}`).toBeNull();
      }
    }
  });

  it('keeps a procedural recipe under every painting (the fallback layer)', () => {
    expect([...HEART_IDS].filter((id) => !hasExplicitAbilityIcon(id))).toEqual([]);
  });

  it("gives the Heat's Soft Enrage its own id, apart from the Hammer's", () => {
    expect(HEART_IDS.has('dgn_heart_soft_enrage')).toBe(true);
    expect(HEART_IDS.has('dgn_heart_soft_enrage_heat')).toBe(true);
    expect(bossAbilityImageUrl('dgn_heart_soft_enrage_heat')).not.toBe(
      bossAbilityImageUrl('dgn_heart_soft_enrage'),
    );
  });

  it("draws the death recap's Hammer's Weight blow with the journal painting", () => {
    const iconId = journalHitIconId("Hammer's Weight", 'heart_hammer_guardian');
    expect(iconId).toBe('dgn_heart_hammers_weight');
    expect(iconDataUrl('ability', iconId ?? '', 36)).toBe('/ui/auras/heart_hammers_weight.webp');
  });
});

describe('boss ability art: the shipping files', () => {
  it('ships every painting as a 128px opaque WebP within the budget', async () => {
    for (const id of BOSS_ABILITY_IMAGE_IDS) {
      const file = path.join(ART_DIR, `${id}.webp`);
      expect(existsSync(file), file).toBe(true);
      const bytes = readFileSync(file);
      expect(bytes.length, id).toBeLessThanOrEqual(MAX_BYTES);
      const meta = await sharp(bytes).metadata();
      expect([meta.format, meta.width, meta.height, meta.hasAlpha], id).toEqual([
        'webp',
        SIZE,
        SIZE,
        false,
      ]);
    }
  });

  it('reuses only aura paintings that exist', () => {
    for (const [id, file] of Object.entries(BOSS_ABILITY_REUSED_ART)) {
      expect(existsSync(path.join(ROOT, 'public/ui/auras', `${file}.webp`)), id).toBe(true);
      expect(bossAbilityImageUrl(id)).toBe(`/ui/auras/${file}.webp`);
    }
  });

  it('holds nothing but the registered paintings and the mapping', () => {
    const files = readdirSync(ART_DIR).sort();
    const expected = [...BOSS_ABILITY_IMAGE_IDS.map((id) => `${id}.webp`), 'mapping.json'].sort();
    expect(files).toEqual(expected);
  });

  it('paints every id distinctly (no two files share their bytes)', () => {
    const seen = new Map<string, string>();
    for (const id of BOSS_ABILITY_IMAGE_IDS) {
      const sha = createHash('sha256')
        .update(readFileSync(path.join(ART_DIR, `${id}.webp`)))
        .digest('hex');
      expect(seen.get(sha), `${id} repeats ${seen.get(sha)}`).toBeUndefined();
      seen.set(sha, id);
    }
  });
});

interface MappingAsset {
  iconId: string;
  output: string;
  acceptedSha256: string;
  acceptedBytes: number;
  acceptedArtManifest: string;
}
interface MappingReuse {
  iconId: string;
  runtimeUrl: string;
}

describe('boss ability art: provenance', () => {
  const mapping = JSON.parse(readFileSync(path.join(ART_DIR, 'mapping.json'), 'utf8')) as {
    family: string;
    iconSize: number;
    runtimeDir: string;
    acceptedArtManifest: string;
    assets: MappingAsset[];
    reused: MappingReuse[];
  };
  const manifest = JSON.parse(readFileSync(path.join(ROOT, MANIFEST), 'utf8')) as {
    assets: { iconId: string; acceptedSha256: string; acceptedBytes: number; prompt: string }[];
    reused: { iconId: string; reuseFile: string }[];
  };

  it('keeps mapping.json in parity with the registry and the bytes', () => {
    expect(mapping.family).toBe('boss-abilities');
    expect(mapping.iconSize).toBe(SIZE);
    expect(mapping.runtimeDir).toBe('public/ui/boss-abilities');
    expect(mapping.acceptedArtManifest).toBe(MANIFEST);
    expect(mapping.assets.map((a) => a.iconId).sort()).toEqual([...BOSS_ABILITY_IMAGE_IDS].sort());
    for (const a of mapping.assets) {
      const bytes = readFileSync(path.join(ART_DIR, a.output));
      expect(a.output).toBe(`${a.iconId}.webp`);
      expect(a.acceptedBytes, a.iconId).toBe(bytes.length);
      expect(a.acceptedSha256, a.iconId).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(a.acceptedArtManifest).toBe(MANIFEST);
    }
    expect(Object.fromEntries(mapping.reused.map((r) => [r.iconId, r.runtimeUrl]))).toEqual(
      Object.fromEntries(
        Object.entries(BOSS_ABILITY_REUSED_ART).map(([id, file]) => [id, `/ui/auras/${file}.webp`]),
      ),
    );
  });

  it('keeps the accepted manifest in parity with mapping.json', () => {
    const byId = new Map(mapping.assets.map((a) => [a.iconId, a]));
    expect(manifest.assets.map((a) => a.iconId).sort()).toEqual([...byId.keys()].sort());
    for (const a of manifest.assets) {
      expect(a.acceptedSha256, a.iconId).toBe(byId.get(a.iconId)?.acceptedSha256);
      expect(a.acceptedBytes, a.iconId).toBe(byId.get(a.iconId)?.acceptedBytes);
      expect(a.prompt.length, a.iconId).toBeGreaterThan(100);
    }
    expect(Object.fromEntries(manifest.reused.map((r) => [r.iconId, r.reuseFile]))).toEqual(
      Object.fromEntries(
        Object.entries(BOSS_ABILITY_REUSED_ART).map(([id, file]) => [
          id,
          `public/ui/auras/${file}.webp`,
        ]),
      ),
    );
  });
});
