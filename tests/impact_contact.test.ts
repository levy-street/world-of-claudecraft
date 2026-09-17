import { afterEach, expect, it, vi } from 'vitest';
import type { CharacterVisual } from '../src/render/characters/visual';
import { impactContact } from '../src/render/impact_contact';

afterEach(() => vi.unstubAllGlobals());
it('matches each Red Harvest wound to its strike and limits recoil to its explicit contacts', () => {
  const visual = { respondToElement: vi.fn(), holdFrame: vi.fn(), receiveHarvestImpact: vi.fn() };
  const target = visual as unknown as CharacterVisual;
  const source = { x: 2, z: 5 };
  for (let beat = 0; beat < 3; beat++)
    impactContact(target, 'physical', 2, false, false, 'red_harvest', false, beat, source);
  expect(visual.respondToElement.mock.calls.map((call) => call[2].angle)).toEqual([-0.66, 0.58, 0]);
  expect(visual.respondToElement.mock.calls.map((call) => call[2].height)).toEqual([
    0.51, 0.64, 0.455,
  ]);
  expect(visual.receiveHarvestImpact.mock.calls).toEqual([
    [0, source],
    [1, source],
    [2, source],
  ]);
  visual.receiveHarvestImpact.mockClear();
  impactContact(target, 'physical', 2, false, true, 'red_harvest', false, 2, source);
  impactContact(target, 'physical', 2, false, false, 'red_harvest');
  impactContact(target, 'physical', 2, false, false, 'raging_gale', false, 1, source);
  expect(visual.receiveHarvestImpact).not.toHaveBeenCalled();
});
it('keeps target feedback while respecting reduced motion and haptics opt-out', () => {
  const visual = { respondToElement: vi.fn(), holdFrame: vi.fn() };
  const vibrate = vi.fn();
  vi.stubGlobal('navigator', { vibrate });
  vi.stubGlobal('localStorage', { getItem: () => '0' });
  impactContact(visual as unknown as CharacterVisual, 'physical', 2, true, false);
  expect(visual.respondToElement.mock.calls[0][0]).toBe('physical');
  expect(visual.respondToElement.mock.calls[0][1]).toBeCloseTo(0.85);
  expect(visual.holdFrame).toHaveBeenCalledOnce();
  expect(vibrate).not.toHaveBeenCalled();
  visual.holdFrame.mockClear();
  impactContact(visual as unknown as CharacterVisual, 'holy', 2, true, true);
  expect(visual.respondToElement.mock.calls[1][0]).toBe('holy');
  expect(visual.respondToElement.mock.calls[1][1]).toBeCloseTo(0.85);
  expect(visual.holdFrame).not.toHaveBeenCalled();
});
