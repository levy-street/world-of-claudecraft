import { describe, expect, it } from 'vitest';
import {
  admitNameplates,
  createNameplateAdmissionScratch,
  NAMEPLATE_CASTING,
  NAMEPLATE_HOSTILE,
  NAMEPLATE_PARTY,
  NAMEPLATE_TARGET,
} from '../src/render/nameplate_budget_core';

describe('nameplate admission budget', () => {
  it('retains actionable plates and caps ordinary plates by stable proximity', () => {
    const admitted: number[] = [];
    const count = admitNameplates(
      [
        { id: 1, flags: NAMEPLATE_TARGET, distanceSq: 900, inViewport: true },
        { id: 2, flags: NAMEPLATE_HOSTILE, distanceSq: 800, inViewport: true },
        { id: 3, flags: NAMEPLATE_CASTING, distanceSq: 700, inViewport: true },
        { id: 4, flags: NAMEPLATE_PARTY, distanceSq: 600, inViewport: true },
        { id: 10, flags: 0, distanceSq: 25, inViewport: true },
        { id: 8, flags: 0, distanceSq: 25, inViewport: true },
        { id: 9, flags: 0, distanceSq: 100, inViewport: true },
      ],
      2,
      admitted,
      createNameplateAdmissionScratch(),
    );
    expect(count).toBe(6);
    expect(admitted).toEqual([1, 2, 3, 4, 8, 10]);
  });

  it('rejects offscreen anchors before actionable classification', () => {
    const admitted: number[] = [];
    admitNameplates(
      [{ id: 1, flags: NAMEPLATE_TARGET, distanceSq: 1, inViewport: false }],
      10,
      admitted,
      createNameplateAdmissionScratch(),
    );
    expect(admitted).toEqual([]);
  });
});
