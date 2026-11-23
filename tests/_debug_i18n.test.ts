import { it } from 'vitest';
import { missingEntityTranslationsForGroups } from '../src/ui/entity_i18n';

it('debug missing entity translations', () => {
  const world = missingEntityTranslationsForGroups(['world']);
  const brood = world.filter((m: any) => JSON.stringify(m).includes('broodling'));
  console.log('world-group missing total:', world.length);
  console.log('broodling-related missing:', JSON.stringify(brood, null, 2).slice(0, 2000));
  const items = missingEntityTranslationsForGroups(['item']);
  console.log('item-group missing ids:', [...new Set(items.map((m: any) => m.id))].slice(0, 50));
});
