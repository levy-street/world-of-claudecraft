// Manifest builder tests: verify that buildManifest probes multiple extensions
// so custom recordings committed in non-MP3 formats are not silently dropped
// when the manifest is regenerated. Uses real temp directories (existsSync is
// the tested behaviour; mocking fs defeats the purpose).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildManifest, MOB_ACTIONS } from '../scripts/sfx/sfx_manifest_builder.mjs';
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
    expect(urls['melee_swing'].urls).toEqual(['/audio/sfx/melee_swing.mp3']);
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

  it('omits keys with no matching file on disk', () => {
    const { count } = buildManifest([{ key: 'ghost_key' }], sfxDir, manifestPath);
    expect(count).toBe(0);
  });

  it('honours the loop flag from the catalog entry', () => {
    writeFileSync(path.join(sfxDir, 'amb_wind.mp3'), '');
    buildManifest([{ key: 'amb_wind', loop: true }], sfxDir, manifestPath);
    const manifest = readFileSync(manifestPath, 'utf8');
    const data = JSON.parse(manifest.split('=\n')[1].replace(/ as const;/, ''));
    expect(data['amb_wind'].loop).toBe(true);
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

  it('reports an error and sets errors[] for an unrecognized action token', () => {
    writeFileSync(path.join(sfxDir, 'mob_beast_wolf_bogus_1.mp3'), '');
    const { count, errors } = buildManifest([], sfxDir, manifestPath);
    expect(count).toBe(0); // bogus file produces no valid key
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('mob_beast_wolf_bogus_1.mp3');
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

  it('MOB_ACTIONS covers the four expected vocalization types', () => {
    expect(MOB_ACTIONS.has('aggro')).toBe(true);
    expect(MOB_ACTIONS.has('attack')).toBe(true);
    expect(MOB_ACTIONS.has('death')).toBe(true);
    expect(MOB_ACTIONS.has('hurt')).toBe(true);
    expect(MOB_ACTIONS.size).toBe(4);
  });
});
