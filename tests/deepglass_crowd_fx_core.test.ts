import { describe, expect, it } from 'vitest';
import {
  CHEER_GAP_MAX,
  CHEER_GAP_MIN,
  firstCheerTime,
  nextCheerTime,
  pickCheerEmote,
} from '../src/render/deepglass_crowd_fx_core';

// Twenty-three bodies with the same three cheer clips. The whole job of this
// module is to make sure they never do it in unison, and that the same body
// behaves the same way every session.
const IDS = Array.from({ length: 23 }, (_, i) => 1_000_000_200 + i);

describe('crowd cheer cadence', () => {
  it('keeps every gap inside the authored window', () => {
    for (const id of IDS) {
      for (let round = 1; round <= 6; round++) {
        const gap = nextCheerTime(id, 100, round) - 100;
        expect(gap, `id ${id} round ${round}`).toBeGreaterThanOrEqual(CHEER_GAP_MIN);
        expect(gap, `id ${id} round ${round}`).toBeLessThanOrEqual(CHEER_GAP_MAX);
      }
    }
  });

  it('staggers the first cheer across the crowd instead of opening in unison', () => {
    const firsts = IDS.map((id) => firstCheerTime(id, 0));
    // No two bodies share a beat, and they are spread across the window rather
    // than bunched: a spread this wide cannot read as a synchronised clap.
    expect(new Set(firsts.map((t) => t.toFixed(4))).size).toBe(IDS.length);
    expect(Math.max(...firsts) - Math.min(...firsts)).toBeGreaterThan(CHEER_GAP_MAX * 0.5);
  });

  it('does not lock a body into one gap forever', () => {
    // Successive rounds must differ, or a spectator becomes a metronome.
    for (const id of IDS.slice(0, 8)) {
      const gaps = [1, 2, 3, 4, 5].map((r) => nextCheerTime(id, 0, r));
      expect(new Set(gaps.map((g) => g.toFixed(4))).size, `id ${id}`).toBeGreaterThan(1);
    }
  });

  it('varies the emote, and only ever picks a Cheer-family one', () => {
    const seen = new Set<string>();
    for (const id of IDS) {
      for (let round = 1; round <= 8; round++) seen.add(pickCheerEmote(id, round));
    }
    expect(seen.size).toBeGreaterThan(1);
    for (const e of seen) expect(['cheer', 'clap', 'roar', 'wave']).toContain(e);
  });

  it('is deterministic: the same body cheers on the same beat every session', () => {
    for (const id of IDS.slice(0, 5)) {
      expect(nextCheerTime(id, 12.5, 3)).toBe(nextCheerTime(id, 12.5, 3));
      expect(pickCheerEmote(id, 3)).toBe(pickCheerEmote(id, 3));
    }
  });
});
