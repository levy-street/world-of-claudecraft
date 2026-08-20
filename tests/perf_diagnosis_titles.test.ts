import { describe, expect, it } from 'vitest';
import { perfFindingHasTitle } from '../src/game/perf_diagnosis_i18n';
import { emptyByCause } from '../src/render/scene_census_core';

describe('perf diagnosis finding titles', () => {
  it('every hitch cause the tracker can file has its own finding title', () => {
    const causes = Object.keys(emptyByCause());
    expect(causes.length).toBeGreaterThanOrEqual(7);
    for (const cause of causes) {
      expect(perfFindingHasTitle(`hitch-${cause}`), `hitch-${cause}`).toBe(true);
    }
  });

  it('an unknown finding id has no title of its own', () => {
    expect(perfFindingHasTitle('hitch-not-a-cause')).toBe(false);
  });
});
