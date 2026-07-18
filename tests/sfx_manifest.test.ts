// Manifest builder tests: verify that buildManifest probes multiple extensions
// so custom recordings committed in non-MP3 formats are not silently dropped
// when the manifest is regenerated. Uses real temp directories (existsSync is
// the tested behaviour; mocking fs defeats the purpose).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error scripts use the repository's untyped Node ESM convention
import * as manifestModule from '../scripts/sfx/manifest.mjs';

const {
  buildSfxManifestData,
  catalogHashForEntries,
  isSfxMobExtensionKey,
  SFX_FIXED_CATALOG_KEYS,
  SFX_MOB_EXTENSION_FAMILIES,
  SFX_MOB_EXTENSION_KEY_PATTERN,
  serializeSfxManifest,
  spatialForSfx,
} = manifestModule;

import {
  buildManifest,
  discoverSfxTracks,
  MOB_ACTIONS,
} from '../scripts/sfx/sfx_manifest_builder.mjs';
import { SFX } from '../scripts/sfx/sfx_prompts.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const realSfxDir = path.join(repoRoot, 'public/audio/sfx');

let sfxDir: string;
let manifestPath: string;

beforeEach(() => {
  sfxDir = mkdtempSync(path.join(tmpdir(), 'woc_sfx_test_'));
  manifestPath = path.join(sfxDir, 'manifest.generated.ts');
});

afterEach(() => {
  rmSync(sfxDir, { recursive: true, force: true });
});

describe('buildManifest', () => {
  it('includes a key whose only file is a .wav (non-mp3 survives rebuild)', () => {
    writeFileSync(path.join(sfxDir, 'cast_lightning_bolt.wav'), '');
    const { count } = buildManifest([{ key: 'cast_lightning_bolt' }], sfxDir, manifestPath);
    expect(count).toBe(1);
    const manifest = readFileSync(manifestPath, 'utf8');
    expect(manifest).toContain('cast_lightning_bolt.wav');
  });

  it('includes a key whose only file is an AIFF lossless master', () => {
    writeFileSync(path.join(sfxDir, 'cast_lightning_bolt.aiff'), '');
    const { count } = buildManifest([{ key: 'cast_lightning_bolt' }], sfxDir, manifestPath);
    expect(count).toBe(1);
    expect(readFileSync(manifestPath, 'utf8')).toContain('cast_lightning_bolt.aiff');
  });

  it('never promotes a source master into the rich runtime manifest', () => {
    const runtimeSfxDirectory = path.join(sfxDir, 'public/audio/sfx');
    mkdirSync(runtimeSfxDirectory, { recursive: true });
    writeFileSync(path.join(runtimeSfxDirectory, 'amb_water.m4a'), 'source master');

    expect(() => buildSfxManifestData(sfxDir, { requireComplete: false })).toThrow(
      /runtime sampled SFX must be MP3.*amb_water\.m4a/,
    );
  });

  it('includes a key whose only file is a .mp3', () => {
    writeFileSync(path.join(sfxDir, 'melee_swing.mp3'), '');
    const { count } = buildManifest([{ key: 'melee_swing' }], sfxDir, manifestPath);
    expect(count).toBe(1);
    const manifest = readFileSync(manifestPath, 'utf8');
    expect(manifest).toContain('melee_swing.mp3');
  });

  it('prefers .mp3 over .wav when both exist for the same bare key', () => {
    writeFileSync(path.join(sfxDir, 'melee_swing.mp3'), '');
    writeFileSync(path.join(sfxDir, 'melee_swing.wav'), '');
    buildManifest([{ key: 'melee_swing' }], sfxDir, manifestPath);
    const manifest = readFileSync(manifestPath, 'utf8');
    // Only the mp3 entry should appear; wav should not since mp3 is probed first.
    const urls = JSON.parse(manifest.split('=\n')[1].replace(/ as const;/, ''));
    expect(urls.melee_swing.urls).toEqual(['/audio/sfx/melee_swing.mp3']);
  });

  it('groups numbered variants under their base key', () => {
    writeFileSync(path.join(sfxDir, 'foot_grass_1.mp3'), '');
    writeFileSync(path.join(sfxDir, 'foot_grass_2.mp3'), '');
    const { count } = buildManifest([{ key: 'foot_grass' }], sfxDir, manifestPath);
    expect(count).toBe(1);
    const manifest = readFileSync(manifestPath, 'utf8');
    expect(manifest).toContain('foot_grass_1.mp3');
    expect(manifest).toContain('foot_grass_2.mp3');
  });

  it('uses numbered variants instead of a bare file when both exist', () => {
    writeFileSync(path.join(sfxDir, 'foot_grass.mp3'), 'bare');
    writeFileSync(path.join(sfxDir, 'foot_grass_1.mp3'), 'one');
    writeFileSync(path.join(sfxDir, 'foot_grass_2.mp3'), 'two');

    const discovered = discoverSfxTracks([{ key: 'foot_grass' }], sfxDir);

    expect(discovered.entries.foot_grass.tracks).toEqual([
      {
        id: '1',
        filename: 'foot_grass_1.mp3',
        url: '/audio/sfx/foot_grass_1.mp3',
      },
      {
        id: '2',
        filename: 'foot_grass_2.mp3',
        url: '/audio/sfx/foot_grass_2.mp3',
      },
    ]);
  });

  it('rejects gapped or noncanonical fixed-catalog take ids instead of dropping files', () => {
    writeFileSync(path.join(sfxDir, 'foot_grass.mp3'), 'bare');
    writeFileSync(path.join(sfxDir, 'foot_grass_2.mp3'), 'orphan');
    writeFileSync(path.join(sfxDir, 'foot_grass_03.mp3'), 'noncanonical');

    const discovered = discoverSfxTracks([{ key: 'foot_grass' }], sfxDir);

    expect(discovered.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('invalid SFX variant id'),
        expect.stringContaining('noncontiguous SFX variants'),
      ]),
    );
    expect(discovered.entries.foot_grass.tracks.map((take) => take.filename)).toEqual([
      'foot_grass_2.mp3',
    ]);
  });

  it('omits keys with no matching file on disk', () => {
    const { count } = buildManifest([{ key: 'ghost_key' }], sfxDir, manifestPath);
    expect(count).toBe(0);
  });

  it('honours the loop flag from the catalog entry', () => {
    writeFileSync(path.join(sfxDir, 'amb_wind.mp3'), '');
    buildManifest([{ key: 'amb_wind', loop: true }], sfxDir, manifestPath);
    const manifest = readFileSync(manifestPath, 'utf8');
    const data = JSON.parse(manifest.split('=\n')[1].replace(/ as const;/, ''));
    expect(data.amb_wind.loop).toBe(true);
  });

  // Decisive regression pin: a key present on disk but missing from the SFX
  // catalog is silently dropped from every rebuild (the loop only visits
  // catalog entries). cast_lightning_bolt was lost this way; pin it, and any
  // future catalog omission, against the REAL catalog and REAL disk so this
  // class of bug fails loudly instead of shipping silent.
  it('rebuilds the real manifest from the real catalog without dropping any on-disk key', () => {
    const { count } = buildManifest(SFX, realSfxDir, manifestPath);
    expect(count).toBeGreaterThan(0);
    const manifest = readFileSync(manifestPath, 'utf8');
    expect(manifest).toContain('cast_lightning_bolt');
  });

  it('keeps the release catalog and all 27 UI cues in one 172-key inventory', () => {
    const keys = new Set(SFX.map((entry) => entry.key));
    expect(keys.size).toBe(172);
    expect([...keys].filter((key) => key.startsWith('ui_'))).toHaveLength(27);
    for (const key of [
      'cast_lightning_bolt',
      'mob_mudfin_attack',
      'mob_burrower_attack',
      'mob_reptile_attack',
      'mob_beast_hurt',
      'mob_dragonkin_hurt',
      'mob_reptile_hurt',
      'quest_ready',
      'lockpick_success',
      'ui_achievement',
      'wand_arcane',
      'wand_holy',
      'wand_shadow',
    ]) {
      expect(keys.has(key), key).toBe(true);
    }
    expect(keys.has('mob_murloc_attack')).toBe(false);
    expect(keys.has('mob_kobold_attack')).toBe(false);
    // Every mob family (13, including reptile) now generates all 5 actions
    // (aggro/attack/death/hurt/idle): pin the count so a future family
    // addition can't silently drop coverage again. Subfamily keys
    // (mob_beast_wolf_*, etc.) never appear in the static catalog, they are
    // purely filesystem-discovered.
    const mobFamilyKeys = [...keys].filter((key) => key.startsWith('mob_'));
    expect(mobFamilyKeys).toHaveLength(65); // 13 families x 5 actions
    expect(SFX_FIXED_CATALOG_KEYS).toHaveLength(172);
  });
});

// Mob subfamily file scanning: mob_<family>_<sub>_<action>_N.mp3 on disk gets
// added under the key mob_<family>_<sub>_<action> so hud.ts can prefer it over
// the family-level fallback via sfx.hasVariants().
describe('mob subfamily scanning', () => {
  it('adds a subfamily key from mob_<family>_<sub>_<action>_N.mp3', () => {
    writeFileSync(path.join(sfxDir, 'mob_beast_wolf_attack_1.mp3'), '');
    const { count } = buildManifest([], sfxDir, manifestPath);
    expect(count).toBe(1);
    const data = JSON.parse(
      readFileSync(manifestPath, 'utf8')
        .split('=\n')[1]
        .replace(/ as const;/, ''),
    );
    expect(data.mob_beast_wolf_attack).toBeDefined();
    expect(data.mob_beast_wolf_attack.urls).toEqual(['/audio/sfx/mob_beast_wolf_attack_1.mp3']);
  });

  // Regression: MOB_ACTIONS gained 'idle' (#1887) but SFX_MOB_EXTENSION_KEY_PATTERN
  // was never updated to match, so a subfamily-level idle recording (e.g. a
  // dedicated wolf idle take distinct from the beast family default) could never
  // be added: the action-token scan finds 'idle' fine, but the stricter grammar
  // check right after it rejects the resulting key, forever.
  it('adds a subfamily key from mob_<family>_<sub>_idle_N.mp3', () => {
    writeFileSync(path.join(sfxDir, 'mob_beast_wolf_idle_1.mp3'), '');
    const { count, errors } = buildManifest([], sfxDir, manifestPath);
    expect(errors).toEqual([]);
    expect(count).toBe(1);
    const data = JSON.parse(
      readFileSync(manifestPath, 'utf8')
        .split('=\n')[1]
        .replace(/ as const;/, ''),
    );
    expect(data.mob_beast_wolf_idle).toBeDefined();
    expect(data.mob_beast_wolf_idle.urls).toEqual(['/audio/sfx/mob_beast_wolf_idle_1.mp3']);
  });

  it('groups multiple numbered variants under the same subfamily key (sorted)', () => {
    writeFileSync(path.join(sfxDir, 'mob_beast_wolf_attack_2.mp3'), '');
    writeFileSync(path.join(sfxDir, 'mob_beast_wolf_attack_1.mp3'), '');
    buildManifest([], sfxDir, manifestPath);
    const data = JSON.parse(
      readFileSync(manifestPath, 'utf8')
        .split('=\n')[1]
        .replace(/ as const;/, ''),
    );
    expect(data.mob_beast_wolf_attack.urls).toEqual([
      '/audio/sfx/mob_beast_wolf_attack_1.mp3',
      '/audio/sfx/mob_beast_wolf_attack_2.mp3',
    ]);
  });

  it('sorts subfamily takes numerically and preserves multi-token subfamilies', () => {
    writeFileSync(path.join(sfxDir, 'mob_beast_dire_wolf_hurt_10.mp3'), 'ten');
    writeFileSync(path.join(sfxDir, 'mob_beast_dire_wolf_hurt_2.mp3'), 'two');
    writeFileSync(path.join(sfxDir, 'mob_beast_dire_wolf_hurt_1.mp3'), 'one');

    const discovered = discoverSfxTracks([], sfxDir);

    expect(discovered.errors).toEqual([]);
    expect(discovered.entries.mob_beast_dire_wolf_hurt.tracks.map((track) => track.id)).toEqual([
      '1',
      '2',
      '10',
    ]);
  });

  it('rejects noncanonical or unsafe mob extension variant ids', () => {
    for (const id of ['0', '01', String(Number.MAX_SAFE_INTEGER + 1)]) {
      writeFileSync(path.join(sfxDir, `mob_beast_wolf_hurt_${id}.mp3`), id);
    }

    const discovered = discoverSfxTracks([], sfxDir);

    expect(discovered.entries).toEqual({});
    expect(discovered.errors).toHaveLength(3);
    expect(discovered.errors.every((error) => error.includes('invalid mob sfx variant id'))).toBe(
      true,
    );
  });

  it('reports an error and sets errors[] for an unrecognized action token', () => {
    writeFileSync(path.join(sfxDir, 'mob_beast_wolf_bogus_1.mp3'), '');
    const { count, errors } = buildManifest([], sfxDir, manifestPath);
    expect(count).toBe(0); // bogus file produces no valid key
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('mob_beast_wolf_bogus_1.mp3');
  });

  it('rejects a syntactically valid extension for an unsupported mob family', () => {
    writeFileSync(path.join(sfxDir, 'mob_unknown_wolf_attack_1.mp3'), '');
    const discovered = discoverSfxTracks([], sfxDir);
    expect(discovered.entries).toEqual({});
    expect(discovered.errors).toEqual([expect.stringContaining('unsupported mob family')]);
  });

  it('skips family-level mob files (fewer than 5 parts), covered by catalog loop', () => {
    // mob_beast_attack_1.mp3 has only 4 parts: mob + beast + attack + 1
    writeFileSync(path.join(sfxDir, 'mob_beast_attack_1.mp3'), '');
    const catalog = [{ key: 'mob_beast_attack' }];
    const { count } = buildManifest(catalog, sfxDir, manifestPath);
    // The catalog loop picks it up; the mob scanner does not add a duplicate.
    const data = JSON.parse(
      readFileSync(manifestPath, 'utf8')
        .split('=\n')[1]
        .replace(/ as const;/, ''),
    );
    expect(count).toBe(1);
    expect(Object.keys(data)).toEqual(['mob_beast_attack']);
  });

  // Decisive regression pin: a mob_*.mp3 file that matches neither a real
  // catalog entry nor a valid numbered subfamily pattern used to be silently
  // ignored (a `continue` with no error), the same silent-omission class as
  // the cast_lightning_bolt bug. It must now fail loudly instead.
  it('reports an error for a bare subfamily file missing its numbered suffix', () => {
    // mob_beast_wolf_hurt.mp3 has no _<N> suffix and no matching catalog
    // entry, so it is neither a valid subfamily file nor a catalog match.
    writeFileSync(path.join(sfxDir, 'mob_beast_wolf_hurt.mp3'), '');
    const { count, errors } = buildManifest([], sfxDir, manifestPath);
    expect(count).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('mob_beast_wolf_hurt.mp3');
    expect(errors[0]).toContain('unrecognized mob sfx file');
  });

  it('reports an error for a family-level mob file with no matching catalog entry', () => {
    // No catalog entry for 'mob_reptile_aggro' exists, so this bare file
    // matches nothing: not the catalog loop, not the subfamily scanner.
    writeFileSync(path.join(sfxDir, 'mob_reptile_aggro.mp3'), '');
    const { count, errors } = buildManifest([], sfxDir, manifestPath);
    expect(count).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('mob_reptile_aggro.mp3');
    expect(errors[0]).toContain('unrecognized mob sfx file');
  });

  it('does not flag a family-level file that legitimately matches a catalog entry', () => {
    // Same shape as the two error cases above, but this time a catalog entry
    // exists, so it must be consumed silently and cleanly, no error.
    writeFileSync(path.join(sfxDir, 'mob_ogre_hurt.mp3'), '');
    const catalog = [{ key: 'mob_ogre_hurt' }];
    const { count, errors } = buildManifest(catalog, sfxDir, manifestPath);
    expect(count).toBe(1);
    expect(errors).toEqual([]);
  });

  it('MOB_ACTIONS covers the five expected vocalization types', () => {
    expect(MOB_ACTIONS.has('aggro')).toBe(true);
    expect(MOB_ACTIONS.has('attack')).toBe(true);
    expect(MOB_ACTIONS.has('death')).toBe(true);
    expect(MOB_ACTIONS.has('hurt')).toBe(true);
    expect(MOB_ACTIONS.has('idle')).toBe(true);
    expect(MOB_ACTIONS.size).toBe(5);
  });

  it('exports one constrained grammar for runtime mob extension keys', () => {
    expect(SFX_MOB_EXTENSION_FAMILIES).toContain('beast');
    expect(SFX_MOB_EXTENSION_KEY_PATTERN.source).toBe(
      '^mob_([a-z0-9]+)_([a-z0-9]+(?:_[a-z0-9]+)*)_(aggro|attack|death|hurt|idle)$',
    );
    expect(isSfxMobExtensionKey('mob_beast_dire_wolf_hurt')).toBe(true);
    expect(isSfxMobExtensionKey('mob_beast_dire_wolf_idle')).toBe(true);
    expect(isSfxMobExtensionKey('mob_unknown_dire_wolf_hurt')).toBe(false);
    expect(isSfxMobExtensionKey('mob_beast_attack')).toBe(false);
    expect(isSfxMobExtensionKey('mob_beast_dire_wolf_bogus')).toBe(false);
  });

  it('keeps the fixed catalog hash stable when mob extensions change', () => {
    const fixed = catalogHashForEntries({});
    const withExtension = catalogHashForEntries({
      mob_beast_dire_wolf_hurt: {
        loop: false,
        category: 'voices',
        preload: 'lazy',
        spatial: true,
      },
    });
    expect(withExtension).toBe(fixed);
  });

  it('emits the fixed-key and mob-extension contract for the browser loader', () => {
    const serialized = serializeSfxManifest({});
    expect(serialized).toContain('export const SFX_FIXED_CATALOG_KEYS =');
    expect(serialized).toContain('export const SFX_MOB_EXTENSION_FAMILIES =');
    expect(serialized).toContain('export const SFX_MOB_EXTENSION_KEY_SOURCE = "^mob_([a-z0-9]+)');
  });

  it('marks point ambience spatial but keeps the global water bed non-spatial', () => {
    expect(spatialForSfx('amb_campfire')).toBe(true);
    expect(spatialForSfx('amb_forge')).toBe(true);
    expect(spatialForSfx('amb_water')).toBe(false);
  });
});
