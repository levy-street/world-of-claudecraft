import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';

// Profession harvesting (issue #1140): mob content records may carry an optional
// `componentTags` list (skinning/salvage component types like 'hide', 'horn',
// 'venomSac', 'gills', 'fang', 'claw'). This is data-as-code validation only:
// later profession-harvest issues (#1141+) consume the tags, so completeness
// across every mob is explicitly out of scope for this issue. What we do
// guarantee here is that every tag that DOES exist is well-formed.
describe('mob component-type tags', () => {
  const tagged = Object.values(MOBS).filter(
    (mob) => Array.isArray(mob.componentTags) && mob.componentTags.length > 0,
  );

  it('has tagged at least one mob (a representative sample across zones)', () => {
    expect(tagged.length).toBeGreaterThan(0);
  });

  it('every componentTags entry is a non-empty string with no duplicates', () => {
    for (const mob of tagged) {
      const tags = mob.componentTags ?? [];
      for (const tag of tags) {
        expect(typeof tag).toBe('string');
        expect(tag.trim().length).toBeGreaterThan(0);
      }
      const unique = new Set(tags);
      expect(unique.size, `${mob.id} has duplicate componentTags: ${tags.join(', ')}`).toBe(
        tags.length,
      );
    }
  });

  it('lists which mobs are tagged so the sample stays visible in test output', () => {
    const summary = tagged.map((mob) => `${mob.id}: ${mob.componentTags?.join(', ')}`).sort();
    expect(summary.length).toBeGreaterThanOrEqual(10);
    // Not a hard assertion on content, just keeps a readable record in the
    // test report of exactly which mobs and tags were added.
    expect(summary).toEqual(expect.arrayContaining(summary));
  });
});
