// Pure-leaf pins for the Soul Rend release (src/sim/nythraxis_soul_rend.ts):
// the aura id the encounter applies and the release helper's contract. The
// live trigger (Bone Storm beginning over live marks) is exercised against a
// real Sim in tests/nythraxis_phase_three.test.ts.

import { describe, expect, it } from 'vitest';
import {
  NYTHRAXIS_SOUL_REND_AURA_ID,
  NYTHRAXIS_SOUL_REND_SETTLE_SECONDS,
  releaseNythraxisSoulRendMarks,
} from '../src/sim/nythraxis_soul_rend';
import type { Entity } from '../src/sim/types';

function bearer(id: number, auraIds: string[]): Entity {
  return {
    id,
    auras: auraIds.map((auraId) => ({ id: auraId, sourceId: 1 })),
  } as unknown as Entity;
}

describe('Nythraxis Soul Rend release leaf', () => {
  it('pins the aura id the encounter applies', () => {
    expect(NYTHRAXIS_SOUL_REND_AURA_ID).toBe('nythraxis_soul_rend');
  });

  it('pins the settle to the major gap the other majors keep', () => {
    expect(NYTHRAXIS_SOUL_REND_SETTLE_SECONDS).toBe(6);
  });

  it('strips only the Soul Rend aura from each live bearer and skips a missing one', () => {
    const marked = bearer(10, ['nythraxis_soul_rend', 'other_buff']);
    const alreadyClean = bearer(11, ['other_buff']);
    const entities = new Map<number, Entity>([
      [marked.id, marked],
      [alreadyClean.id, alreadyClean],
    ]);
    releaseNythraxisSoulRendMarks(entities, [
      { playerId: 10, remaining: 4 },
      { playerId: 11, remaining: 4 },
      { playerId: 99, remaining: 4 },
    ]);
    expect(marked.auras.map((a) => a.id)).toEqual(['other_buff']);
    expect(alreadyClean.auras.map((a) => a.id)).toEqual(['other_buff']);
  });

  it('is a no-op with no live marks', () => {
    const untouched = bearer(10, ['nythraxis_soul_rend']);
    const entities = new Map<number, Entity>([[untouched.id, untouched]]);
    releaseNythraxisSoulRendMarks(entities, []);
    expect(untouched.auras.map((a) => a.id)).toEqual(['nythraxis_soul_rend']);
  });
});
