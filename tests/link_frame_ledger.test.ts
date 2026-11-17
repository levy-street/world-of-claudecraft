// Deferred-mode link pacing (src/render/link_frame_ledger.ts): at most one
// admitted compile that creates programs per frame, issued after the frame it
// follows, decided by the shared queue's admission rather than by a scheduler
// of its own. The first block pins the ledger alone; the second drives the REAL
// queue and admission adapter, with a unit standing in for a compile arm (it
// reports its links with the running unit's label, as compile_arms.ts does),
// because the queue's priority order and frame clock are what the pacing rides
// on.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetArrivalCoverForTest, setArrivalCover } from '../src/render/arrival_cover';
import {
  type BackgroundGpuQueue,
  createBackgroundGpuQueue,
  GPU_WORK_PRIORITY,
  runningGpuWorkLabel,
} from '../src/render/background_gpu_queue';
import { createGpuPrepAdmission } from '../src/render/gpu_prep_admission';
import { createGpuPrepBudget } from '../src/render/gpu_prep_budget_core';
import {
  armLinkPacing,
  linkHeldSinceLastFrame,
  linkHoldsCandidate,
  linkPacingActive,
  linkPacingStats,
  noteLink,
  noteLinkFrame,
  noteLinkFrameEnded,
  resetLinkPacingForTests,
  setLinkPacingEnabled,
} from '../src/render/link_frame_ledger';

beforeEach(() => {
  resetLinkPacingForTests();
  resetArrivalCoverForTest();
});

afterEach(() => {
  resetLinkPacingForTests();
  resetArrivalCoverForTest();
});

function arm(): void {
  setLinkPacingEnabled(true);
  armLinkPacing();
}

/** A whole frame passes: its start pays one owed frame back, its task ends. */
function frame(): void {
  noteLinkFrame();
  noteLinkFrameEnded();
}

const VISIBLE = false;
const ACTIONABLE = true;

describe('link frame ledger', () => {
  it('is inactive until enabled AND armed at a reveal', () => {
    expect(linkPacingActive()).toBe(false);
    setLinkPacingEnabled(true);
    expect(linkPacingActive()).toBe(false);
    armLinkPacing();
    expect(linkPacingActive()).toBe(true);
    setLinkPacingEnabled(false);
    expect(linkPacingActive()).toBe(false);
  });

  it('learns a linking kind under the loading screen but owes nothing there', () => {
    setLinkPacingEnabled(true); // deferred mode, world not revealed yet
    noteLink(3, 'reveal-gate:tavern:1');
    expect(linkPacingStats()).toMatchObject({
      links: 1,
      linkingKinds: ['reveal-gate'],
      owedFrames: 0,
    });
    armLinkPacing();
    // nothing is owed and no frame's task is open, so even the known kind goes
    expect(linkHoldsCandidate('reveal-gate:inn:2', VISIBLE)).toBe(false);
  });

  it('a link owes one frame per program, and each frame pays one back', () => {
    arm();
    noteLink(1, 'live-gate:wolf');
    expect(linkHoldsCandidate('live-gate:boar', VISIBLE)).toBe(true);
    frame();
    expect(linkHoldsCandidate('live-gate:boar', VISIBLE)).toBe(false);

    noteLink(3, 'live-gate:wolf');
    for (let index = 0; index < 2; index++) {
      frame();
      expect(linkHoldsCandidate('live-gate:boar', VISIBLE)).toBe(true);
    }
    frame();
    expect(linkHoldsCandidate('live-gate:boar', VISIBLE)).toBe(false);
  });

  it('links add up: a tail link issued while a frame is owed owes its own frame on top', () => {
    // Tail links (the shadow arm, a second colour target) are not held, so a
    // second link can land while the first still owes: the GPU process then
    // has both queued, and the next admitted link must wait for both.
    arm();
    noteLink(1, 'live-gate:a');
    noteLink(1, null);
    expect(linkPacingStats().owedFrames).toBe(2);
    frame();
    expect(linkHoldsCandidate('live-gate:b', VISIBLE)).toBe(true);
    frame();
    expect(linkHoldsCandidate('live-gate:b', VISIBLE)).toBe(false);
  });

  it('holds a linking kind through the frame task, even with nothing owed', () => {
    // The frame clock ticks at the start of the renderer's frame: a link
    // started before that frame's task ends sits in front of its present.
    arm();
    noteLink(1, 'live-gate:wolf');
    expect(noteLinkFrame()).toBe(true); // paid back, but the task is open
    expect(linkHoldsCandidate('live-gate:boar', VISIBLE)).toBe(true);
    noteLinkFrameEnded();
    expect(linkHoldsCandidate('live-gate:boar', VISIBLE)).toBe(false);
  });

  it('asks for no frame-end hop while pacing is off', () => {
    expect(noteLinkFrame()).toBe(false);
    setLinkPacingEnabled(true);
    expect(noteLinkFrame()).toBe(false); // not revealed yet
    armLinkPacing();
    expect(noteLinkFrame()).toBe(true);
  });

  it('never holds a kind that has not linked, nor actionable work', () => {
    arm();
    noteLink(1, 'live-gate:wolf');
    // an upload or a uniform touch never linked: it is never paced
    expect(linkHoldsCandidate('upload:chunk', VISIBLE)).toBe(false);
    expect(linkHoldsCandidate('touch:program', VISIBLE)).toBe(false);
    // the budget's actionable floor holds for pacing too
    expect(linkHoldsCandidate('live-gate:target', ACTIONABLE)).toBe(false);
    expect(linkPacingStats().holds).toBe(0);
    expect(linkHoldsCandidate('live-gate:boar', VISIBLE)).toBe(true);
    expect(linkPacingStats().holds).toBe(1);
  });

  it('remembers what it held over the last frame, and only that frame', () => {
    arm();
    noteLink(2, 'live-gate:wolf');
    linkHoldsCandidate('live-gate:boar', VISIBLE);
    expect(linkHeldSinceLastFrame('live-gate:boar')).toBe(false); // frame not over
    noteLinkFrame();
    expect(linkHeldSinceLastFrame('live-gate:boar')).toBe(true);
    expect(linkHeldSinceLastFrame('upload:chunk')).toBe(false);
    noteLinkFrameEnded();
    noteLinkFrame(); // a frame in which it was not asked about
    expect(linkHeldSinceLastFrame('live-gate:boar')).toBe(false);
  });

  it('a hold for the frame task alone neither counts nor stops ageing', () => {
    // Every frame's start refuses a pending linking unit here until the hop
    // after the frame. Remembering that made a unit the budget refuses for
    // headroom look link-held every frame, so it never aged toward the
    // starvation bound (seen on the desktop bench as ~6 refusals per frame).
    arm();
    noteLink(1, 'live-gate:wolf');
    frame(); // the link is paid back
    noteLinkFrame(); // the next frame's task is open, nothing owed
    expect(linkHoldsCandidate('live-gate:boar', VISIBLE)).toBe(true);
    expect(linkPacingStats().holds).toBe(0);
    noteLinkFrameEnded();
    noteLinkFrame();
    expect(linkHeldSinceLastFrame('live-gate:boar')).toBe(false);
  });

  it('a link outside any queue unit owes frames but teaches no kind', () => {
    arm();
    noteLink(1, null);
    expect(linkPacingStats()).toMatchObject({ links: 1, linkingKinds: [], owedFrames: 1 });
    noteLink(1, 'live-gate:wolf');
    expect(linkPacingStats().linkingKinds).toEqual(['live-gate']);
  });

  it('ignores a compile that created nothing', () => {
    arm();
    noteLink(0, 'live-gate:wolf');
    noteLink(-1, 'live-gate:wolf');
    noteLink(Number.NaN, 'live-gate:wolf');
    expect(linkPacingStats()).toMatchObject({ links: 0, linkingKinds: [], owedFrames: 0 });
  });

  it('stands down under an arrival cover', () => {
    arm();
    noteLink(1, 'live-gate:wolf');
    setArrivalCover(true);
    expect(linkPacingActive()).toBe(false);
    expect(linkHoldsCandidate('live-gate:boar', VISIBLE)).toBe(false);
    // the cover's frames pay the debt back, and a link under it owes nothing
    expect(noteLinkFrame()).toBe(false);
    noteLink(2, 'live-gate:wolf');
    setArrivalCover(false);
    expect(linkHoldsCandidate('live-gate:boar', VISIBLE)).toBe(false);
  });

  it('enabling again (a new renderer) disarms and drops the debt: its loading screen runs unpaced', () => {
    arm();
    noteLink(2, 'live-gate:wolf');
    noteLinkFrame(); // a frame task left open
    setLinkPacingEnabled(true);
    expect(linkPacingActive()).toBe(false);
    armLinkPacing();
    expect(linkPacingStats().owedFrames).toBe(0);
    expect(linkHoldsCandidate('live-gate:boar', VISIBLE)).toBe(false);
    // the learned kinds survive: the boot that linked them was real
    expect(linkPacingStats().linkingKinds).toEqual(['live-gate']);
  });

  it('keeps the learned kinds bounded, as caller-supplied labels must be', () => {
    arm();
    for (let index = 0; index < 200; index++) noteLink(1, `kind${index}:x`);
    expect(linkPacingStats().linkingKinds).toHaveLength(64);
  });
});

describe('link pacing through the queue admission', () => {
  const settle = async (rounds = 16): Promise<void> => {
    for (let index = 0; index < rounds; index++) await Promise.resolve();
  };

  interface PacedQueue {
    queue: BackgroundGpuQueue;
    /** A frame's start: the renderer feeds the queue, then the budget. */
    startFrame: () => void;
    /** The frame's task ended: run the queue's after-frame hop. */
    endFrame: () => void;
    frame: () => void;
  }

  /** The real queue and adapter, with the after-frame hop driven by the test.
   *  The budget is in legacy mode, so it admits everything and every refusal
   *  seen here is the link pacing's own (the pacing answers first, so
   *  `?prep=legacy` keeps it). Call after `arm()`. */
  function pacedQueue(): PacedQueue {
    const budget = createGpuPrepBudget({ targetFrameMs: 16.7 });
    budget.setLegacy(true);
    const hops: Array<() => void> = [];
    const queue = createBackgroundGpuQueue({
      admission: createGpuPrepAdmission(budget),
      afterFrame: (fn) => hops.push(fn),
      slowestLimit: 64,
    });
    let clock = 0;
    const startFrame = (): void => {
      clock += 16;
      // renderer.ts sync(): the queue's clock, then the budget's
      queue.noteFrame(clock);
      budget.noteFrame(16);
    };
    const endFrame = (): void => {
      for (const hop of hops.splice(0)) hop();
    };
    queue.noteFrame(clock);
    endFrame();
    return {
      queue,
      startFrame,
      endFrame,
      frame: () => {
        startFrame();
        endFrame();
      },
    };
  }

  /** A unit standing in for a compile arm: links `programs` in its
   *  synchronous start and reports them with the running unit's label. */
  const linking =
    (ran: string[], name: string, programs = 1) =>
    (): void => {
      ran.push(name);
      noteLink(programs, runningGpuWorkLabel());
    };

  it('starts at most one linking unit per frame', async () => {
    arm();
    const { queue, frame } = pacedQueue();
    const ran: string[] = [];
    const units = ['a', 'b', 'c'].map((name) =>
      queue.run(linking(ran, name), GPU_WORK_PRIORITY.LIVE_VIEW, `live-gate:${name}`),
    );
    await settle();
    // the first of the kind is learned on its link, which owes the next frame
    expect(ran).toEqual(['a']);
    frame();
    await settle();
    expect(ran).toEqual(['a', 'b']);
    frame();
    await Promise.all(units);
    expect(ran).toEqual(['a', 'b', 'c']);
    expect(linkPacingStats().holds).toBeGreaterThan(0);
  });

  it('a freed link waits for the frame task to end, while other work runs in it', async () => {
    // The old pacer released its next caller in a task AFTER the frame: a link
    // issued in the frame's own task lands in front of that frame's present.
    arm();
    const { queue, startFrame, endFrame } = pacedQueue();
    const ran: string[] = [];
    await queue.run(linking(ran, 'a'), GPU_WORK_PRIORITY.LIVE_VIEW, 'live-gate:a');
    const next = queue.run(linking(ran, 'b'), GPU_WORK_PRIORITY.LIVE_VIEW, 'live-gate:b');
    startFrame();
    await settle();
    const upload = queue.run(
      () => {
        ran.push('upload');
      },
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
      'upload:chunk',
    );
    await upload;
    expect(ran).toEqual(['a', 'upload']);
    endFrame();
    await next;
    expect(ran).toEqual(['a', 'upload', 'b']);
  });

  it('a link of several programs keeps the next linking unit back that many frames', async () => {
    arm();
    const { queue, frame } = pacedQueue();
    const ran: string[] = [];
    const first = queue.run(linking(ran, 'a', 3), GPU_WORK_PRIORITY.LIVE_VIEW, 'live-gate:a');
    const second = queue.run(linking(ran, 'b'), GPU_WORK_PRIORITY.LIVE_VIEW, 'live-gate:b');
    await first;
    frame();
    frame();
    await settle();
    expect(ran).toEqual(['a']);
    frame();
    await second;
    expect(ran).toEqual(['a', 'b']);
  });

  it('a held unit does not age toward the budget starvation bound', async () => {
    // A link hold is a wait for the GPU process, not for headroom. Ageing it
    // made the unit starvation-admissible, past the budget's headroom, the
    // moment the hold lifted.
    arm();
    const { queue, frame } = pacedQueue();
    const ran: string[] = [];
    await queue.run(linking(ran, 'a', 4), GPU_WORK_PRIORITY.LIVE_VIEW, 'live-gate:a');
    const held = queue.run(linking(ran, 'b'), GPU_WORK_PRIORITY.LIVE_VIEW, 'live-gate:b');
    for (let index = 0; index < 4; index++) {
      await settle();
      frame();
    }
    await held;
    expect(ran).toEqual(['a', 'b']);
    const stat = queue.stats().slowest.find((unit) => unit.label === 'live-gate:b');
    expect(stat?.deferredFrames).toBe(0);
  });

  it('a linking unit the budget refuses still ages, frame after frame', async () => {
    // The ageing exemption covers the wait for the GPU process only: a unit
    // refused for headroom must keep its path to the starvation bound.
    arm();
    let budgetAdmits = true;
    const budget = createGpuPrepBudget({ targetFrameMs: 16.7 });
    budget.setLegacy(true);
    const inner = createGpuPrepAdmission(budget);
    const hops: Array<() => void> = [];
    const queue = createBackgroundGpuQueue({
      admission: {
        ...inner,
        admit: (candidate) => inner.admit(candidate) && budgetAdmits,
      },
      afterFrame: (fn) => hops.push(fn),
      slowestLimit: 64,
    });
    let clock = 0;
    // Production order: the loop the frame's start wakes re-selects inside the
    // frame's task (where the frame-task hold refuses linking kinds), and only
    // then does the hop after the frame run.
    const frameNow = async (): Promise<void> => {
      clock += 16;
      queue.noteFrame(clock);
      await settle();
      for (const hop of hops.splice(0)) hop();
      await settle();
    };
    await frameNow();
    const ran: string[] = [];
    await queue.run(linking(ran, 'learn'), GPU_WORK_PRIORITY.LIVE_VIEW, 'live-gate:learn');
    await frameNow(); // the learning link is paid back
    budgetAdmits = false;
    const refused = queue.run(
      linking(ran, 'cosmetic', 0),
      GPU_WORK_PRIORITY.BACKGROUND,
      'live-gate:cosmetic',
    );
    for (let index = 0; index < 3; index++) await frameNow();
    budgetAdmits = true;
    await frameNow();
    await refused;
    const stat = queue.stats().slowest.find((unit) => unit.label === 'live-gate:cosmetic');
    expect(stat?.deferredFrames).toBeGreaterThanOrEqual(3);
  });

  it('when the frame frees, the queue priority order picks which linking unit goes', async () => {
    // The old pacer served its waiters first come, first served: a later gate
    // for a closer view waited behind every reveal parked before it.
    arm();
    const { queue, frame } = pacedQueue();
    const ran: string[] = [];
    await queue.run(linking(ran, 'warm'), GPU_WORK_PRIORITY.BACKGROUND, 'live-gate:warm');
    const low = queue.run(linking(ran, 'low'), GPU_WORK_PRIORITY.BACKGROUND, 'live-gate:low');
    const high = queue.run(linking(ran, 'high'), GPU_WORK_PRIORITY.LIVE_VIEW, 'live-gate:high');
    await settle();
    expect(ran).toEqual(['warm']);
    frame();
    await high;
    expect(ran).toEqual(['warm', 'high']);
    frame();
    await low;
    expect(ran).toEqual(['warm', 'high', 'low']);
  });

  it('work of a kind that never linked runs in the same frame as a link', async () => {
    arm();
    const { queue, frame } = pacedQueue();
    const ran: string[] = [];
    await queue.run(linking(ran, 'gate'), GPU_WORK_PRIORITY.LIVE_VIEW, 'live-gate:a');
    const held = queue.run(linking(ran, 'held'), GPU_WORK_PRIORITY.LIVE_VIEW, 'live-gate:b');
    await queue.run(
      () => {
        ran.push('upload');
      },
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
      'upload:chunk',
    );
    expect(ran).toEqual(['gate', 'upload']);
    frame();
    await held;
    expect(ran).toEqual(['gate', 'upload', 'held']);
  });

  it('cache hits of a linking kind flow on while nothing is owed', async () => {
    arm();
    const { queue, frame } = pacedQueue();
    const ran: string[] = [];
    await queue.run(linking(ran, 'learn'), GPU_WORK_PRIORITY.LIVE_VIEW, 'live-gate:learn');
    frame();
    const hits = ['h1', 'h2', 'h3'].map((name) =>
      queue.run(linking(ran, name, 0), GPU_WORK_PRIORITY.LIVE_VIEW, `live-gate:${name}`),
    );
    await Promise.all(hits);
    expect(ran).toEqual(['learn', 'h1', 'h2', 'h3']);
    expect(linkPacingStats().holds).toBe(0);
  });

  it('actionable work is never held behind a link', async () => {
    arm();
    const { queue } = pacedQueue();
    const ran: string[] = [];
    await queue.run(linking(ran, 'reveal'), GPU_WORK_PRIORITY.LIVE_VIEW, 'live-gate:reveal');
    await queue.run(linking(ran, 'target'), GPU_WORK_PRIORITY.ACTIONABLE_VIEW, 'live-gate:target');
    expect(ran).toEqual(['reveal', 'target']);
  });

  it('a link in a released tail owes its frame, so no new linking unit starts in it', async () => {
    arm();
    const { queue, frame } = pacedQueue();
    const ran: string[] = [];
    await queue.run(linking(ran, 'learn'), GPU_WORK_PRIORITY.LIVE_VIEW, 'live-gate:learn');
    frame();
    let linkTail!: () => void;
    const tail = queue.run(
      () =>
        new Promise<void>((resolve) => {
          linkTail = () => {
            // outside the unit's synchronous start: no running label
            noteLink(1, runningGpuWorkLabel());
            resolve();
          };
        }),
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'mount:horse',
      { releaseTail: true },
    );
    await settle();
    linkTail();
    await tail;
    const next = queue.run(linking(ran, 'next'), GPU_WORK_PRIORITY.LIVE_VIEW, 'live-gate:next');
    await settle();
    expect(ran).toEqual(['learn']);
    // the tail's link taught nothing: its unit linked nothing in its start
    expect(linkPacingStats().linkingKinds).toEqual(['live-gate']);
    frame();
    await next;
    expect(ran).toEqual(['learn', 'next']);
  });

  it('paces nothing before the reveal, nor under an arrival cover', async () => {
    setLinkPacingEnabled(true);
    const { queue } = pacedQueue();
    const ran: string[] = [];
    await Promise.all(
      ['a', 'b'].map((name) =>
        queue.run(linking(ran, name), GPU_WORK_PRIORITY.LIVE_VIEW, `live-gate:${name}`),
      ),
    );
    expect(ran).toEqual(['a', 'b']);
    armLinkPacing();
    setArrivalCover(true);
    await Promise.all(
      ['c', 'd'].map((name) =>
        queue.run(linking(ran, name), GPU_WORK_PRIORITY.LIVE_VIEW, `live-gate:${name}`),
      ),
    );
    expect(ran).toEqual(['a', 'b', 'c', 'd']);
    expect(linkPacingStats().holds).toBe(0);
  });
});
