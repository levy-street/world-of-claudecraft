// The party ping cues (scripts/sfx/ping_sfx.mjs, built by
// scripts/sfx/build_ping_sfx.mjs): every ping kind has its own custom cue, every
// layer reads a checked-in CC0 source inside that source's length, every source
// is credited, and the filter graph carries what each layer asks for.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SFX_CONFORMANCE_FFPROBE_PATH } from '../scripts/sfx/ffmpeg_paths.mjs';
import { PING_RECIPES, PING_SFX, PING_SOURCES, pingFilterGraph } from '../scripts/sfx/ping_sfx.mjs';
import { SFX } from '../scripts/sfx/sfx_prompts.mjs';
import { PING_SOUNDS } from '../src/ui/hud/pings/ping_feed_core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCES = join(ROOT, 'scripts/sfx/sources/pings');

function durationOf(file: string): number {
  const result = spawnSync(
    SFX_CONFORMANCE_FFPROBE_PATH,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  );
  return Number(result.stdout.trim());
}

describe('party ping cues', () => {
  it('gives every ping kind its own custom cue, recipe and published master', () => {
    const keys = PING_SFX.map((entry) => entry.key);
    const played = Object.values(PING_SOUNDS).map((sound) => sound.key);
    expect([...keys].sort()).toEqual([...played].sort());
    expect(Object.keys(PING_RECIPES).sort()).toEqual([...keys].sort());
    const catalog = new Map(SFX.map((entry) => [entry.key, entry]));
    for (const key of keys) {
      expect(catalog.get(key)?.custom, key).toBe(true);
      expect(existsSync(join(ROOT, 'public/audio/sfx', `${key}.mp3`)), key).toBe(true);
    }
  });

  it('reads every layer from a checked-in source, inside its length', () => {
    const lengths = new Map<string, number>();
    for (const [key, recipe] of Object.entries(PING_RECIPES)) {
      expect(recipe.layers.length, key).toBeGreaterThan(0);
      for (const layer of recipe.layers) {
        const file = PING_SOURCES[layer.src];
        expect(file, `${key} ${layer.src}`).toBeTruthy();
        const path = join(SOURCES, file as string);
        expect(existsSync(path), path).toBe(true);
        if (!lengths.has(path)) lengths.set(path, durationOf(path));
        expect(layer.start).toBeGreaterThanOrEqual(0);
        expect(layer.end).toBeGreaterThan(layer.start);
        expect(layer.end, `${key} ${layer.src} end`).toBeLessThanOrEqual(
          (lengths.get(path) ?? 0) + 0.001,
        );
      }
    }
  });

  it('credits every source by its Freesound id', () => {
    const credits = readFileSync(join(ROOT, 'CREDITS.md'), 'utf8');
    const readme = readFileSync(join(SOURCES, 'README.md'), 'utf8');
    for (const file of Object.values(PING_SOURCES)) {
      const id = file.split('_')[0];
      expect(credits, file).toContain(`/sounds/${id}/`);
      expect(readme, file).toContain(file);
    }
  });

  it('keeps only the sources a recipe plays', () => {
    // A layer dropped from a recipe must take its source, its README row and its
    // CREDITS row with it, or the repo ships and credits a sound no ping plays.
    const used = new Set(
      Object.values(PING_RECIPES).flatMap((recipe) => recipe.layers.map((layer) => layer.src)),
    );
    expect([...used].sort()).toEqual(Object.keys(PING_SOURCES).sort());
    const onDisk = readdirSync(SOURCES).filter((name) => name !== 'README.md');
    expect(onDisk.sort()).toEqual(Object.values(PING_SOURCES).sort());
  });

  it('builds each layer and the master chain into the filter graph', () => {
    const recipe = PING_RECIPES.ui_ping_warning;
    if (!recipe) throw new Error('missing the warning recipe');
    const inputs = [...new Set(recipe.layers.map((layer) => layer.src))];
    const graph = pingFilterGraph(recipe, inputs);
    for (let index = 0; index < recipe.layers.length; index++)
      expect(graph).toContain(`[l${index}]`);
    expect(graph).toContain(`amix=inputs=${recipe.layers.length}:normalize=0`);
    expect(graph).toContain(`volume=${recipe.driveDb}dB`);
    expect(graph).toContain('tremolo=f=12:d=0.35');
    expect(graph).toContain('curve=qua');
    expect(graph).toMatch(/asetrate=\d+(\.\d+)?,aresample=44100/);
    expect(graph.endsWith('[out]')).toBe(true);
    expect(() => pingFilterGraph(recipe, ['glass'])).toThrow('is not an input');
  });
});
