import { expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { BUDDY_PORTRAIT_URLS } from '../src/ui/target_portrait_view';

it('does not register Sapling as a live companion visual or portrait', () => {
  expect(VISUALS).not.toHaveProperty('buddy_sapling');
  expect(BUDDY_PORTRAIT_URLS).not.toHaveProperty('sapling');
});
