import { describe, expect, it } from 'vitest';
import {
  InputTickSampler,
  MAX_CATCHUP_FRAMES_PER_ADVANCE,
  STALE_DEADLINE_RESEED_MS,
} from '../src/game/input_tick_sampler';
import { emptyMoveInput, type MoveInput } from '../src/sim/types';

function sample(forward: boolean, facing: number | null): { mi: MoveInput; facing: number | null } {
  return { mi: { ...emptyMoveInput(), forward }, facing };
}

describe('InputTickSampler', () => {
  it('pins the stale reseed and per-advance catch-up bounds', () => {
    expect(STALE_DEADLINE_RESEED_MS).toBe(250);
    expect(MAX_CATCHUP_FRAMES_PER_ADVANCE).toBe(2);
  });

  it('emits fixed ticks across irregular render frame times', () => {
    const sampler = new InputTickSampler();
    sampler.reset(0);
    const frames = [20, 60, 150, 160].flatMap((now) =>
      sampler.advance(now, () => sample(true, 0.5)),
    );

    expect(frames).toHaveLength(3);
    expect(frames.map((frame) => frame.ct)).toEqual([0, 1, 2]);
    expect(frames.every((frame) => frame.mi.forward && frame.facing === 0.5)).toBe(true);
  });

  it('keeps client ticks monotone across advance calls', () => {
    const sampler = new InputTickSampler();
    sampler.reset(0);

    expect(sampler.advance(50, () => sample(true, 0)).map((frame) => frame.ct)).toEqual([0]);
    expect(sampler.advance(150, () => sample(false, null)).map((frame) => frame.ct)).toEqual([
      1, 2,
    ]);
  });

  it('emits at exact 60 Hz deadline instants without a one-frame delay', () => {
    const sampler = new InputTickSampler();
    sampler.reset(0);

    expect(sampler.advance(1000 / 60, () => sample(true, 0))).toEqual([]);
    expect(sampler.advance((2 * 1000) / 60, () => sample(true, 0))).toEqual([]);
    expect(
      sampler.advance((3 * 1000) / 60, () => sample(true, 0)).map((frame) => frame.ct),
    ).toEqual([0]);
  });

  it('does not drift over twenty seconds of 60 Hz frames', () => {
    const sampler = new InputTickSampler();
    sampler.reset(0);
    const emitted: number[] = [];

    for (let frame = 1; frame <= 1200; frame++) {
      emitted.push(
        ...sampler
          .advance((frame * 1000) / 60, () => sample(true, 0))
          .map((sampledFrame) => sampledFrame.ct),
      );
    }

    expect(emitted).toHaveLength(400);
    expect(emitted.at(-1)).toBe(399);
  });

  it('ramps interpolation alpha from zero to one within each tick', () => {
    const sampler = new InputTickSampler();
    sampler.reset(0);

    sampler.advance(50, () => sample(true, 0));
    expect(sampler.interpolationAlpha).toBe(0);

    sampler.advance(62.5, () => sample(true, 0));
    expect(sampler.interpolationAlpha).toBeCloseTo(0.25, 10);

    sampler.advance(75, () => sample(true, 0));
    expect(sampler.interpolationAlpha).toBeCloseTo(0.5, 10);

    sampler.advance(100, () => sample(true, 0));
    expect(sampler.interpolationAlpha).toBe(0);
  });

  it('samples intent separately for every emitted tick', () => {
    const sampler = new InputTickSampler();
    sampler.reset(0);
    let sampleIndex = 0;
    const frames = sampler.advance(151, () => sample(sampleIndex++ % 2 === 0, sampleIndex));

    expect(sampleIndex).toBe(MAX_CATCHUP_FRAMES_PER_ADVANCE);
    expect(frames.map(({ mi, facing }) => ({ forward: mi.forward, facing }))).toEqual([
      { forward: true, facing: 1 },
      { forward: false, facing: 2 },
    ]);
    expect(sampler.catchupBacklogDrops).toBe(1);
  });

  it('reseeds after a stale deadline and emits exactly one current frame', () => {
    const sampler = new InputTickSampler();
    sampler.reset(0);

    const resumedAt = 1000;
    const resumed = sampler.advance(resumedAt, () => sample(true, 0.5));

    expect(resumed.map((frame) => frame.ct)).toEqual([0]);
    expect(sampler.staleDeadlineReseeds).toBe(1);
    expect(sampler.catchupBacklogDrops).toBe(0);
    expect(sampler.advance(resumedAt + 50, () => sample(false, null))[0].ct).toBe(1);
  });

  it('caps catch-up work per advance and keeps client ticks monotone', () => {
    const sampler = new InputTickSampler();
    sampler.reset(0);

    const first = sampler.advance(151, () => sample(true, 0));
    const second = sampler.advance(201, () => sample(false, null));
    const ticks = [...first, ...second].map((frame) => frame.ct);

    expect(first).toHaveLength(MAX_CATCHUP_FRAMES_PER_ADVANCE);
    expect(sampler.catchupBacklogDrops).toBe(1);
    expect(ticks.every((tick, index) => index === 0 || tick > ticks[index - 1])).toBe(true);
  });

  it('emits at most two frames after a 90 ms render frame', () => {
    const sampler = new InputTickSampler();
    sampler.reset(0);
    sampler.advance(50, () => sample(true, 0));

    expect(sampler.advance(140, () => sample(true, 0)).length).toBeLessThanOrEqual(
      MAX_CATCHUP_FRAMES_PER_ADVANCE,
    );
  });

  it('is deterministic for the same deltas and sampled intent', () => {
    const run = () => {
      const sampler = new InputTickSampler();
      sampler.reset(0);
      let sampleIndex = 0;
      return [17, 51, 132, 138, 251].flatMap((now) =>
        sampler.advance(now, () => {
          const index = sampleIndex++;
          return sample(index % 2 === 0, index * 0.1);
        }),
      );
    };

    expect(run()).toEqual(run());
  });

  it('emits one immediate neutral frame and resets the connection tick sequence', () => {
    const sampler = new InputTickSampler();
    sampler.reset(0);
    expect(sampler.advance(50, () => sample(true, 0))[0].ct).toBe(0);

    expect(sampler.emitNeutralFrame(75)).toEqual({ ct: 1, mi: emptyMoveInput(), facing: null });
    expect(sampler.advance(124, () => sample(false, null))).toEqual([]);
    expect(sampler.advance(125, () => sample(false, null))[0].ct).toBe(2);

    sampler.reset(200);
    expect(sampler.advance(249, () => sample(false, null))).toEqual([]);
    expect(sampler.advance(250, () => sample(false, null))[0].ct).toBe(0);
  });
});
