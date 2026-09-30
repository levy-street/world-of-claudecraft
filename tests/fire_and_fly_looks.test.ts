import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  FIRE_AND_FLY_MONSTER_LOOKS,
  fireAndFlyLookTemplate,
} from '../src/sim/content/fire_and_fly_looks';
import { FIRE_AND_FLY_SCENARIOS } from '../src/sim/content/fire_and_fly_scenarios';
import { MOBS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';
import { tsFilesUnder } from './helpers/ts_files_under';

const modelOf = (templateId: string): string | undefined =>
  VISUALS[visualKeyFor({ kind: 'mob', templateId } as Entity)]?.url;

const scenarioTemplates = new Set(
  FIRE_AND_FLY_SCENARIOS.flatMap((s) => s.waves.flatMap((w) => w.entries.map((e) => e.templateId))),
);

describe('Fire and Fly monster looks', () => {
  it('dresses the yeti as the pyre colossus and keeps the wolf a wolf', () => {
    expect(fireAndFlyLookTemplate('frostmane_yeti')).toBe('pyre_colossus');
    expect(modelOf(fireAndFlyLookTemplate('frostmane_yeti'))).toMatch(/\/pyre_colossus\.glb$/);
    expect(fireAndFlyLookTemplate('forest_wolf')).toBe('forest_wolf');
  });

  it('keeps every other template in its own body', () => {
    for (const id of scenarioTemplates) {
      if (id in FIRE_AND_FLY_MONSTER_LOOKS) continue;
      expect(fireAndFlyLookTemplate(id)).toBe(id);
    }
  });

  it('lends only real templates with a model of their own, to templates the scenarios field', () => {
    expect(Object.keys(FIRE_AND_FLY_MONSTER_LOOKS).length).toBeGreaterThan(0);
    for (const [id, look] of Object.entries(FIRE_AND_FLY_MONSTER_LOOKS)) {
      expect(scenarioTemplates.has(id), id).toBe(true);
      expect(MOBS[look], look).toBeDefined();
      expect(modelOf(look), look).toBeDefined();
      expect(modelOf(look), look).not.toBe(modelOf(id));
    }
  });

  it('is never read by the sim, so a look can change no stat', () => {
    const readers = tsFilesUnder(fileURLToPath(new URL('../src/sim', import.meta.url)))
      .filter((f) => f.file !== 'content/fire_and_fly_looks.ts')
      .filter((f) => readFileSync(f.full, 'utf8').includes('fire_and_fly_looks'))
      .map((f) => f.file);
    expect(readers).toEqual([]);
  });
});
