import { expect, it } from 'vitest';
import { isExcludedDecoration } from '../src/sim/decoration_exclusions';

it('preserves the original clearing and excludes only the cannon lane tree', () => {
  expect(isExcludedDecoration(2.456450840458274, 211.33819991815835)).toBe(true);
  expect(isExcludedDecoration(442.06173, 1003.16146)).toBe(true);
  expect(isExcludedDecoration(442.06173 + 1.21, 1003.16146)).toBe(false);
  expect(isExcludedDecoration(430, 1000)).toBe(false);
});
