import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  FIRE_AND_FLY_MONSTER_LOOKS,
  FIRE_AND_FLY_SCENARIO_LOOKS,
  fireAndFlyLookTemplate,
  fireAndFlyRigId,
} from '../src/sim/content/fire_and_fly_looks';
import { FIRE_AND_FLY_SCENARIOS } from '../src/sim/content/fire_and_fly_scenarios';
import { MOBS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';
import { tsFilesUnder } from './helpers/ts_files_under';

const modelOf = (templateId: string): string | undefined =>
  VISUALS[visualKeyFor({ kind: 'mob', templateId } as Entity)]?.url;

const fielded = (scenarioId: string): Set<string> =>
  new Set(
    FIRE_AND_FLY_SCENARIOS.find((s) => s.id === scenarioId)?.waves.flatMap((w) =>
      w.entries.map((e) => e.templateId),
    ),
  );

const DELUGE = 'fire_and_fly_deluge';

describe('Fire and Fly monster looks', () => {
  it('dresses the yeti as the pyre colossus in every scenario, and keeps the wolf a wolf', () => {
    for (const s of FIRE_AND_FLY_SCENARIOS) {
      expect(fireAndFlyLookTemplate('frostmane_yeti', s.id)).toBe('pyre_colossus');
      expect(fireAndFlyLookTemplate('forest_wolf', s.id)).toBe('forest_wolf');
    }
    expect(modelOf('pyre_colossus')).toMatch(/\/pyre_colossus\.glb$/);
  });

  it("dresses the Deluge's diggers as tunnelers, and nowhere else", () => {
    expect(fireAndFlyLookTemplate('tunnel_rat', DELUGE)).toBe('deeprock_kobold');
    expect(modelOf('deeprock_kobold')).toMatch(/\/goblin\.glb$/);
    for (const s of FIRE_AND_FLY_SCENARIOS) {
      if (s.id === DELUGE) continue;
      expect(fireAndFlyLookTemplate('tunnel_rat', s.id), s.id).toBe('tunnel_rat');
      expect(fireAndFlyLookTemplate('deeprock_kobold', s.id), s.id).toBe('deeprock_kobold');
    }
  });

  it('keeps every other template in its own body', () => {
    for (const s of FIRE_AND_FLY_SCENARIOS) {
      for (const id of fielded(s.id)) {
        if (id in FIRE_AND_FLY_MONSTER_LOOKS || id in (FIRE_AND_FLY_SCENARIO_LOOKS[s.id] ?? {})) {
          continue;
        }
        expect(fireAndFlyLookTemplate(id, s.id)).toBe(id);
      }
    }
  });

  it('lends only real templates with a model of their own, to templates the scenario fields', () => {
    const everywhere = new Set(FIRE_AND_FLY_SCENARIOS.flatMap((s) => [...fielded(s.id)]));
    const lends: [string, string, Set<string>][] = [
      ...Object.entries(FIRE_AND_FLY_MONSTER_LOOKS).map(
        ([id, look]): [string, string, Set<string>] => [id, look, everywhere],
      ),
      ...Object.entries(FIRE_AND_FLY_SCENARIO_LOOKS).flatMap(([scenarioId, looks]) =>
        Object.entries(looks).map(([id, look]): [string, string, Set<string>] => [
          id,
          look,
          fielded(scenarioId),
        ]),
      ),
    ];
    expect(lends.length).toBeGreaterThan(1);
    for (const [id, look, scope] of lends) {
      expect(scope.has(id), id).toBe(true);
      expect(MOBS[look], look).toBeDefined();
      expect(modelOf(look), look).toBeDefined();
      expect(modelOf(look), look).not.toBe(modelOf(id));
    }
  });

  it('names a dressed rig apart from the plain one of the same template', () => {
    expect(fireAndFlyRigId('forest_wolf', DELUGE)).toBe('forest_wolf');
    expect(fireAndFlyRigId('tunnel_rat', 'fire_and_fly_standard')).toBe('tunnel_rat');
    expect(fireAndFlyRigId('tunnel_rat', DELUGE)).toBe('tunnel_rat>deeprock_kobold');
    expect(fireAndFlyRigId('frostmane_yeti', 'fire_and_fly_standard')).toBe(
      'frostmane_yeti>pyre_colossus',
    );
  });

  it('is never read by the sim, so a look can change no stat', () => {
    const readers = tsFilesUnder(fileURLToPath(new URL('../src/sim', import.meta.url)))
      .filter((f) => f.file !== 'content/fire_and_fly_looks.ts')
      .filter((f) => readFileSync(f.full, 'utf8').includes('fire_and_fly_looks'))
      .map((f) => f.file);
    expect(readers).toEqual([]);
  });
});
