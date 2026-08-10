import { describe, expect, it } from 'vitest';
import { runSlicedBuild } from '../src/render/grass_build_slicer_core';

// A controllable clock plus a job whose every sub-unit costs a fixed amount of
// simulated time. The job records the order its sub-units ran in, so the pins
// below can assert exact counts (the budget check runs BEFORE each sub-unit)
// and exact order (slicing is timing-only).
const makeClock = (start = 0) => {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
};

const makeJob = (totalSteps: number, costMs: number, clock: { advance: (ms: number) => void }) => {
  const executed: number[] = [];
  return {
    executed,
    job: {
      step: () => {
        executed.push(executed.length);
        clock.advance(costMs);
        return executed.length < totalSteps;
      },
    },
  };
};

describe('grass build slicer core: the budget check precedes the cost', () => {
  it('runs zero sub-units when the deadline has already passed (mutant: check-after runs one)', () => {
    // Arrange: the clock sits at 10, past a deadline of 5.
    const clock = makeClock(10);
    const { job, executed } = makeJob(8, 2, clock);

    // Act
    const outcome = runSlicedBuild(job, 5, clock.now);

    // Assert: not a single sub-unit of work started. Moving the deadline
    // check after the step (the old check-after-build shape) executes one
    // sub-unit here and turns this red.
    expect(executed).toEqual([]);
    expect(outcome).toBe('paused');
  });

  it('runs zero sub-units at the exact deadline boundary (now === deadline is exhausted)', () => {
    const clock = makeClock(5);
    const { job, executed } = makeJob(8, 2, clock);

    expect(runSlicedBuild(job, 5, clock.now)).toBe('paused');
    expect(executed).toEqual([]);
  });

  it('stops starting sub-units once the simulated work exhausts the budget (exact counts)', () => {
    // Arrange: each sub-unit costs 2ms of simulated work against a 3ms budget.
    const clock = makeClock(0);
    const { job, executed } = makeJob(10, 2, clock);

    // Act: checks run at t=0 (run, t->2) and t=2 (run, t->4); the t=4 check
    // refuses a third sub-unit.
    const outcome = runSlicedBuild(job, 3, clock.now);

    // Assert
    expect(executed).toEqual([0, 1]);
    expect(outcome).toBe('paused');

    // A resume whose budget is already exhausted continues NO work.
    expect(runSlicedBuild(job, clock.now(), clock.now)).toBe('paused');
    expect(executed).toEqual([0, 1]);

    // A resume with fresh budget picks up exactly where the job paused.
    expect(runSlicedBuild(job, clock.now() + 5, clock.now)).toBe('paused');
    expect(executed).toEqual([0, 1, 2, 3, 4]);
  });

  it('completes a job that fits the budget and never calls step past completion', () => {
    const clock = makeClock(0);
    const { job, executed } = makeJob(3, 0.1, clock);

    const outcome = runSlicedBuild(job, 100, clock.now);

    expect(outcome).toBe('completed');
    expect(executed).toEqual([0, 1, 2]);
  });

  it('executes the identical sub-unit sequence however the budget divides the work', () => {
    // Arrange: the unsliced reference run (one generous budget).
    const wholeClock = makeClock(0);
    const whole = makeJob(25, 1, wholeClock);
    expect(runSlicedBuild(whole.job, 1e9, wholeClock.now)).toBe('completed');

    // Act: the same job resumed under a stingy 3ms budget per call.
    const slicedClock = makeClock(0);
    const sliced = makeJob(25, 1, slicedClock);
    let calls = 0;
    for (; calls < 100; calls++) {
      if (runSlicedBuild(sliced.job, slicedClock.now() + 3, slicedClock.now) === 'completed') break;
    }

    // Assert: many resumes were needed (the slicing really happened), and the
    // concatenated execution order is the unsliced order exactly.
    expect(calls).toBeGreaterThan(5);
    expect(calls).toBeLessThan(100);
    expect(sliced.executed).toEqual(whole.executed);
  });
});
