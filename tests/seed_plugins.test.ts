// The first-party seed catalog (server/plugins_seed/) must hold itself to the
// same bar community submissions face: every seed source passes the submit
// validators, screens CLEAN in the reviewer pre-screen (a seed that trips a
// flag would teach authors the flags are noise), and every manifest field
// passes the metadata normalizers. This keeps the seeds honest as living
// documentation of the woc API.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { screenPluginSource } from '../server/plugin_screen';
import {
  isPluginCategory,
  MAX_PLUGIN_SOURCE_BYTES,
  MAX_SUMMARY_LENGTH,
  normalizePluginName,
  validatePluginSource,
} from '../server/plugins';
import { SEED_PLUGINS } from '../server/plugins_seed/manifest';

const seedDir = fileURLToPath(new URL('../server/plugins_seed', import.meta.url));

function sourceOf(file: string): string {
  return readFileSync(join(seedDir, file), 'utf8');
}

describe('plugin store seeds', () => {
  it('ships a non-trivial catalog with unique slugs and files', () => {
    expect(SEED_PLUGINS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(SEED_PLUGINS.map((seed) => seed.slug)).size).toBe(SEED_PLUGINS.length);
    expect(new Set(SEED_PLUGINS.map((seed) => seed.file)).size).toBe(SEED_PLUGINS.length);
  });

  for (const seed of SEED_PLUGINS) {
    describe(seed.slug, () => {
      it('has metadata that passes the community submit validators', () => {
        expect(normalizePluginName(seed.name)).toBe(seed.name);
        expect(seed.summary.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH);
        expect(seed.summary.trim()).toBe(seed.summary);
        expect(isPluginCategory(seed.category)).toBe(true);
        expect(seed.description.length).toBeGreaterThan(0);
        // The store slug shape: url-safe lowercase with hyphens.
        expect(seed.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      });

      it('has source that parses, fits the cap, and uses only the woc API', () => {
        const source = sourceOf(seed.file);
        expect(validatePluginSource(source)).toBeNull();
        expect(Buffer.byteLength(source, 'utf8')).toBeLessThanOrEqual(MAX_PLUGIN_SOURCE_BYTES);
        // Seeds must screen clean: no dynamic code, no network, no browser
        // storage, no global DOM reach, no credential text, no obfuscation.
        expect(screenPluginSource(source)).toEqual([]);
        // Belt and braces on top of the screen: the only sanctioned surface.
        expect(source).not.toMatch(/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b/);
      });
    });
  }
});
