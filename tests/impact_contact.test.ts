import { afterEach, expect, it, vi } from 'vitest';
import type { CharacterVisual } from '../src/render/characters/visual';
import { impactContact } from '../src/render/impact_contact';

afterEach(() => vi.unstubAllGlobals());
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
