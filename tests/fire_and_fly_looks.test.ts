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
import {
  FIRE_AND_FLY_SCENARIOS,
  TURRET_SCENARIOS,
} from '../src/sim/content/fire_and_fly_scenarios';
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
  it('dresses the yeti as the pyre colossus unless a mission dresses it otherwise, and keeps the wolf a wolf', () => {
    for (const s of FIRE_AND_FLY_SCENARIOS) {
      const own = FIRE_AND_FLY_SCENARIO_LOOKS[s.id]?.frostmane_yeti ?? 'pyre_colossus';
      expect(fireAndFlyLookTemplate('frostmane_yeti', s.id)).toBe(own);
      expect(fireAndFlyLookTemplate('forest_wolf', s.id)).toBe('forest_wolf');
    }
    expect(fireAndFlyLookTemplate('frostmane_yeti', 'fire_and_fly_pack')).toBe('old_greyjaw');
    expect(modelOf('pyre_colossus')).toMatch(/\/pyre_colossus\.glb$/);
  });

  it('keeps the trials in their own bodies, the yeti aside', () => {
    for (const s of TURRET_SCENARIOS) {
      expect(FIRE_AND_FLY_SCENARIO_LOOKS[s.id], s.id).toBeUndefined();
      for (const id of fielded(s.id)) {
        if (id === 'frostmane_yeti') continue;
        expect(fireAndFlyLookTemplate(id, s.id), `${s.id} ${id}`).toBe(id);
      }
    }
  });

  it("dresses the Deluge's diggers as tunnelers", () => {
    expect(fireAndFlyLookTemplate('tunnel_rat', DELUGE)).toBe('deeprock_kobold');
    expect(modelOf('deeprock_kobold')).toMatch(/\/goblin\.glb$/);
    expect(fireAndFlyLookTemplate('tunnel_rat', 'fire_and_fly_standard')).toBe('tunnel_rat');
  });

  it('never shows two monsters of one scenario in the same model', () => {
    for (const s of FIRE_AND_FLY_SCENARIOS) {
      const models = [...fielded(s.id)].map((id) => modelOf(fireAndFlyLookTemplate(id, s.id)));
      expect(new Set(models).size, s.id).toBe(models.length);
    }
  });

  it('lends only bodies that walk, strike, flinch and die in the arena', () => {
    const looks = new Set([
      ...Object.values(FIRE_AND_FLY_MONSTER_LOOKS),
      ...Object.values(FIRE_AND_FLY_SCENARIO_LOOKS).flatMap((looks) => Object.values(looks)),
    ]);
    for (const look of looks) {
      const clips = VISUALS[visualKeyFor({ kind: 'mob', templateId: look } as Entity)]?.clips;
      for (const clip of ['walk', 'attack', 'hit', 'death'] as const) {
        expect(clips?.[clip], `${look} ${clip}`).toBeDefined();
      }
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
    const sim = tsFilesUnder(fileURLToPath(new URL('../src/sim', import.meta.url)));
    expect(sim.map((f) => f.file)).toContain('content/fire_and_fly_looks.ts');
    expect(sim.map((f) => f.file)).toContain('minigames/turret_defense.ts');
    const readers = sim
      .filter((f) => f.file !== 'content/fire_and_fly_looks.ts')
      .filter((f) => readFileSync(f.full, 'utf8').includes('fire_and_fly_looks'))
      .map((f) => f.file);
    expect(readers).toEqual([]);
  });
});
