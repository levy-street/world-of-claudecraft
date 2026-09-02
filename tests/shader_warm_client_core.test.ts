// The shader warm client's policy and bookkeeping
// (src/render/shader_warm_client_core.ts): which gates hold their link for
// the worker, which text is asked for once, what a gate did when it could
// not wait, and when the worker is told to stand down. Host-agnostic, so
// every case here is a plain call: no worker, no DOM, no clock.

import { describe, expect, it } from 'vitest';
import { programSourceHash } from '../src/render/shader_warm_audit_core';
import {
  createShaderWarmHoldRing,
  createShaderWarmOutstandingHolds,
  createShaderWarmPauseState,
  createShaderWarmRequests,
  noteShaderWarmFrame,
  readShaderWarmQuery,
  readShaderWarmReadyDeadline,
  readShaderWarmSetting,
  SHADER_WARM_EVIDENCE_LINKS,
  SHADER_WARM_EXPIRED_SHARE_BREAKER,
  SHADER_WARM_FRAME_PERIOD_MS,
  SHADER_WARM_HOLD_WINDOW,
  SHADER_WARM_PAUSE_ABOVE_MS,
  SHADER_WARM_RESUME_BELOW_MS,
  SHADER_WARM_SETTINGS,
  SHADER_WARM_TIMEOUT_BREAKER,
  type ShaderWarmBypass,
  type ShaderWarmCannotServeInputs,
  type ShaderWarmPolicyInputs,
  type ShaderWarmRequestSource,
  shaderWarmCannotServe,
  shaderWarmDecision,
  shaderWarmModeFor,
} from '../src/render/shader_warm_client_core';

/** The queue's floors, as the host hands them in (GPU_WORK_PRIORITY
 *  LIVE_VIEW and ACTIONABLE_VIEW); the core never imports the queue. */
const LIVE_VIEW = 30;
const ACTIONABLE_VIEW = 40;

function policyInputs(overrides: Partial<ShaderWarmPolicyInputs> = {}): ShaderWarmPolicyInputs {
  return {
    mode: 'reveal',
    available: true,
    armed: true,
    priority: 20,
    imminent: false,
    liveViewPriority: LIVE_VIEW,
    actionablePriority: ACTIONABLE_VIEW,
    ...overrides,
  };
}

function source(vertex: string, fragment = 'precision highp float;', index0Attribute = 'position') {
  return { vertex, fragment, index0Attribute } satisfies ShaderWarmRequestSource;
}

describe('shaderWarmDecision', () => {
  // Every named bypass, each reachable from an otherwise holding gate: a
  // reason that no input can produce is a counter that reads zero forever.
  const bypasses: Array<[ShaderWarmBypass, Partial<ShaderWarmPolicyInputs>]> = [
    ['mode-off', { mode: 'off' }],
    ['unavailable', { available: false }],
    ['before-reveal', { armed: false }],
    ['actionable', { priority: ACTIONABLE_VIEW }],
    ['imminent', { imminent: true }],
    ['live-view', { priority: LIVE_VIEW }],
  ];

  it.each(bypasses)('links as before and reports %s', (bypass, overrides) => {
    expect(shaderWarmDecision(policyInputs(overrides))).toEqual({ hold: false, bypass });
  });

  it('holds a cosmetic gate once the worker is up and the reveal happened', () => {
    expect(shaderWarmDecision(policyInputs())).toEqual({ hold: true });
    expect(shaderWarmDecision(policyInputs({ priority: 0 }))).toEqual({ hold: true });
  });

  it('holds the live-view lane in mode all, and only there', () => {
    // The mode exists so the policy can be measured rather than believed:
    // `all` is the arm that holds every gate below the actionable floor.
    expect(shaderWarmDecision(policyInputs({ priority: LIVE_VIEW, mode: 'all' }))).toEqual({
      hold: true,
    });
    expect(shaderWarmDecision(policyInputs({ priority: LIVE_VIEW, mode: 'reveal' }))).toEqual({
      hold: false,
      bypass: 'live-view',
    });
  });

  it('never holds an actionable gate, in any mode, imminent or not', () => {
    // A gate that must draw NOW gains nothing from waiting and would only
    // add the worker round trip to its hold.
    for (const mode of ['reveal', 'all'] as const) {
      for (const imminent of [true, false]) {
        expect(
          shaderWarmDecision(policyInputs({ mode, imminent, priority: ACTIONABLE_VIEW + 10 })),
        ).toEqual({ hold: false, bypass: 'actionable' });
      }
    }
  });

  it('never holds an imminent gate, however cosmetic its priority', () => {
    expect(shaderWarmDecision(policyInputs({ imminent: true, priority: 0, mode: 'all' }))).toEqual({
      hold: false,
      bypass: 'imminent',
    });
  });

  it('reports the reason that actually applies first, so the readout is not ambiguous', () => {
    // Mode off with a dead worker before the reveal: one gate, one reason,
    // and it is the one furthest up the policy.
    expect(
      shaderWarmDecision(policyInputs({ mode: 'off', available: false, armed: false })),
    ).toEqual({ hold: false, bypass: 'mode-off' });
    expect(shaderWarmDecision(policyInputs({ available: false, armed: false }))).toEqual({
      hold: false,
      bypass: 'unavailable',
    });
    expect(shaderWarmDecision(policyInputs({ armed: false, priority: ACTIONABLE_VIEW }))).toEqual({
      hold: false,
      bypass: 'before-reveal',
    });
  });
});

describe('readShaderWarmSetting', () => {
  it('reads the four settings off the query string, which wins over the stored option', () => {
    expect(readShaderWarmSetting('?shaderwarm=off', 'reveal')).toBe('off');
    expect(readShaderWarmSetting('?shaderwarm=reveal', 'off')).toBe('reveal');
    expect(readShaderWarmSetting('?shaderwarm=all')).toBe('all');
    expect(readShaderWarmSetting('?shaderwarm=auto', 'all')).toBe('auto');
    expect(readShaderWarmSetting('?perf&shaderwarm=all')).toBe('all');
    expect(readShaderWarmSetting('?shaderwarm=off&perf')).toBe('off');
    expect(readShaderWarmSetting('?shaderwarm=%6fff')).toBe('off');
    // The corpus arm's original spellings, one grammar for both readers.
    expect(readShaderWarmSetting('?shaderwarm=0', 'all')).toBe('off');
    expect(readShaderWarmSetting('?shaderwarm=1', 'off')).toBe('all');
    expect(readShaderWarmQuery('?shaderwarm=0')).toBe('off');
    expect(readShaderWarmQuery('?shaderwarm=1')).toBe('all');
    expect(readShaderWarmQuery('?shaderwarm=reveal')).toBe('reveal');
    expect(readShaderWarmQuery('?shaderwarm=maybe')).toBeNull();
    expect(readShaderWarmQuery('?perf')).toBeNull();
  });

  it('takes the stored graphics option when the query names nothing, else OFF', () => {
    // A probe typo measures the stored arm, never a half arm it would read
    // as the baseline; an entry with no stored option at all (the editor,
    // the guide viewer) gets OFF, never a worker context it never asked for.
    expect(readShaderWarmSetting('', 'off')).toBe('off');
    expect(readShaderWarmSetting('', 'auto')).toBe('auto');
    expect(readShaderWarmSetting('?perf', 'all')).toBe('all');
    expect(readShaderWarmSetting('?shaderwarm=', 'reveal')).toBe('reveal');
    expect(readShaderWarmSetting('?shaderwarm=ALL', 'auto')).toBe('auto');
    expect(readShaderWarmSetting('?shaderwarmish=reveal')).toBe('off');
    expect(readShaderWarmSetting('shaderwarm=reveal')).toBe('off');
    expect(readShaderWarmSetting('', 'bogus')).toBe('off');
    expect(readShaderWarmSetting('', null)).toBe('off');
    expect(SHADER_WARM_SETTINGS).toEqual(['auto', 'off', 'reveal', 'all']);
  });
});

describe('shaderWarmModeFor', () => {
  it('resolves auto by the backend: the full policy where the worker is worth its cost', () => {
    // Measured 2026-08-28: D3D11 passed, every OpenGL cell (Linux NVIDIA,
    // Linux Intel, Android Mali) only relocated the stall into the GPU
    // process. Measured 2026-08-30 on Vulkan (RTX 3060, RTX 3090, Intel
    // iGPU): a cold link costs 8 to 25 ms and the first draw 0 ms, while the
    // worker's own links cost three to six times more, so there is nothing
    // to warm and the worker is a net cost: off. The full policy holds the
    // live view too: its stand-in already shows what is there, so a longer
    // stand-in beats a frozen frame (settled 2026-08-28).
    expect(shaderWarmModeFor('auto', 'd3d11')).toBe('all');
    expect(shaderWarmModeFor('auto', 'vulkan')).toBe('off');
    // Metal: the Vulkan profile on its one datapoint (11 ms cold) and no
    // in-game measurement; the explicit arm is how it gets one.
    expect(shaderWarmModeFor('auto', 'metal')).toBe('off');
    expect(shaderWarmModeFor('auto', 'opengl')).toBe('off');
    expect(shaderWarmModeFor('auto', 'software')).toBe('off');
    expect(shaderWarmModeFor('auto', 'unknown')).toBe('off');
    expect(shaderWarmModeFor('auto', null)).toBe('off');
  });

  it('keeps an explicit setting whatever the backend', () => {
    expect(shaderWarmModeFor('off', 'd3d11')).toBe('off');
    // The explicit arm is how Vulkan stays measurable.
    expect(shaderWarmModeFor('all', 'vulkan')).toBe('all');
    expect(shaderWarmModeFor('reveal', 'opengl')).toBe('reveal');
    expect(shaderWarmModeFor('all', null)).toBe('all');
    expect(shaderWarmModeFor('all', 'opengl', 'android')).toBe('all');
  });

  it('is off on iOS whatever the setting: a second context is a process-ceiling risk there', () => {
    expect(shaderWarmModeFor('all', 'metal', 'ios')).toBe('off');
    expect(shaderWarmModeFor('reveal', 'metal', 'ios')).toBe('off');
    expect(shaderWarmModeFor('auto', 'metal', 'ios')).toBe('off');
    expect(shaderWarmModeFor('all', 'metal', 'other')).toBe('all');
    expect(shaderWarmModeFor('auto', 'd3d11', 'other')).toBe('all');
  });
});

describe('createShaderWarmRequests', () => {
  it('sends one program per distinct text and answers both askers', async () => {
    // The dedupe is the point: two gates carrying the same material must not
    // make the worker link the same GLSL twice.
    const requests = createShaderWarmRequests();
    const first = requests.request([source('void main() {}')], 20);
    const second = requests.request([source('void main() {}')], 30);

    expect(first.ids).toEqual([1]);
    expect(second.ids).toEqual([1]);
    expect(first.toSend).toEqual([
      {
        id: 1,
        vertex: 'void main() {}',
        fragment: 'precision highp float;',
        index0Attribute: 'position',
        priority: 20,
      },
    ]);
    expect(second.toSend).toEqual([]);

    const both = Promise.all([requests.whenSettled(first.ids), requests.whenSettled(second.ids)]);
    requests.settle(1, 'warmed');
    expect(await both).toEqual([['warmed'], ['warmed']]);
    expect(requests.stats()).toMatchObject({ asked: 2, sent: 1, deduped: 1, warmed: 1, failed: 0 });
  });

  it('raises a pending program to the higher priority a later asker names', () => {
    // A catalog asked first at its own priority; the live view that names the
    // same text next must not wait behind the catalog's place in the worker's
    // queue, so the dedupe hands the host the promotion to post.
    const requests = createShaderWarmRequests();
    const catalog = requests.request([source('void main() {}')], 20);
    expect(catalog.toPromote).toEqual([]);
    const live = requests.request([source('void main() {}')], 60);
    expect(live.toSend).toEqual([]);
    expect(live.toPromote).toEqual([{ id: 1, priority: 60 }]);
    // Equal or lower asks change nothing; a second higher one moves it again.
    expect(requests.request([source('void main() {}')], 60).toPromote).toEqual([]);
    expect(requests.request([source('void main() {}')], 10).toPromote).toEqual([]);
    expect(requests.request([source('void main() {}')], 80).toPromote).toEqual([
      { id: 1, priority: 80 },
    ]);
    expect(requests.stats()).toMatchObject({ asked: 5, sent: 1, deduped: 4, promoted: 2 });
  });

  it('promotes nothing that already settled: a warm program needs no place in line', () => {
    const requests = createShaderWarmRequests();
    requests.request([source('void main() {}')], 20);
    requests.settle(1, 'warmed');
    expect(requests.request([source('void main() {}')], 90).toPromote).toEqual([]);
    expect(requests.stats().promoted).toBe(0);
  });

  it('counts the location-0 bind as part of the program identity', () => {
    // The bind is part of the browser cache key, so the same GLSL bound
    // differently is a different program to warm, not a dedupe hit.
    const requests = createShaderWarmRequests();
    const plain = requests.request([source('void main() {}', 'f', 'position')], 20);
    const other = requests.request([source('void main() {}', 'f', 'instanceStart')], 20);

    expect(plain.ids).toEqual([1]);
    expect(other.ids).toEqual([2]);
    expect(other.toSend.map((item) => item.index0Attribute)).toEqual(['instanceStart']);
    expect(requests.stats()).toMatchObject({ asked: 2, sent: 2, deduped: 0 });
    // The identity is the hash of both stages plus the bind, not the object.
    expect(programSourceHash('void main() {}', 'f')).toBe(programSourceHash('void main() {}', 'f'));
  });

  it('resolves a set in the order it was asked for, whatever order it settles in', async () => {
    // The gate reads "every outcome warmed"; an out-of-order answer would
    // attribute one program's failure to another.
    const requests = createShaderWarmRequests();
    const { ids } = requests.request([source('a'), source('b'), source('c')], 20);
    const settled = requests.whenSettled(ids);

    requests.settle(ids[2], 'failed');
    requests.settle(ids[0], 'warmed');
    requests.settle(ids[1], 'warmed');

    expect(await settled).toEqual(['warmed', 'warmed', 'failed']);
    expect(requests.stats()).toMatchObject({ warmed: 2, failed: 1 });
  });

  it('answers an unknown id as failed rather than waiting forever', async () => {
    const requests = createShaderWarmRequests();
    expect(await requests.whenSettled([404])).toEqual(['failed']);
  });

  it('keeps the first outcome of a program the worker answers twice', async () => {
    const requests = createShaderWarmRequests();
    const { ids } = requests.request([source('a')], 20);
    requests.settle(ids[0], 'warmed');
    requests.settle(ids[0], 'failed');

    expect(await requests.whenSettled(ids)).toEqual(['warmed']);
    expect(requests.stats()).toMatchObject({ warmed: 1, failed: 0 });
  });

  it('fails only the unsettled ones when the worker dies', async () => {
    // No held gate may wait on a dead worker; the ones already warmed keep
    // their answer, because their program really is in the cache.
    const requests = createShaderWarmRequests();
    const { ids } = requests.request([source('a'), source('b')], 20);
    requests.settle(ids[0], 'warmed');
    const settled = requests.whenSettled(ids);

    requests.failAll();
    requests.failAll();

    expect(await settled).toEqual(['warmed', 'failed']);
    expect(requests.stats()).toMatchObject({ warmed: 1, failed: 1 });
  });

  it('counts every hold and every bypass, so the readout says what the worker was not', async () => {
    const requests = createShaderWarmRequests();
    requests.noteHeld(true, false, 12);
    requests.noteHeld(false, true, 30);
    // A clock that went backwards must not subtract from the total.
    requests.noteHeld(false, false, -5);
    for (const bypass of [
      'mode-off',
      'unavailable',
      'before-reveal',
      'actionable',
      'live-view',
      'imminent',
      'piece-mismatch',
      'nothing-to-warm',
    ] as const) {
      requests.noteBypass(bypass);
    }
    requests.noteBypass('live-view');

    const stats = requests.stats();
    expect(stats).toMatchObject({ held: 3, heldWarm: 1, heldTimedOut: 1, holdMs: 42 });
    expect(stats.bypassed).toEqual({
      'mode-off': 1,
      unavailable: 1,
      'before-reveal': 1,
      actionable: 1,
      'live-view': 2,
      imminent: 1,
      'piece-mismatch': 1,
      'nothing-to-warm': 1,
    });
  });

  it('counts the requests someone is still waiting on', async () => {
    // The pause policy reads this: a request that is out has a held gate
    // behind it, and pausing the worker there only delays that gate's reveal.
    const requests = createShaderWarmRequests();
    expect(requests.pendingCount()).toBe(0);

    const { ids } = requests.request([source('a'), source('b')], 20);
    expect(requests.pendingCount()).toBe(2);
    // A second asker for the same text is not a second thing to wait for.
    requests.request([source('a')], 20);
    expect(requests.pendingCount()).toBe(2);

    requests.settle(ids[0], 'warmed');
    expect(requests.pendingCount()).toBe(1);
    // Neither a repeat answer nor an answer for a program it never sent.
    requests.settle(ids[0], 'failed');
    requests.settle(404, 'warmed');
    expect(requests.pendingCount()).toBe(1);

    requests.failAll();
    expect(requests.pendingCount()).toBe(0);
    expect(await requests.whenSettled(ids)).toEqual(['warmed', 'failed']);
  });

  it('counts the gates own dry assembly and the worker own link times', () => {
    // Both are what a capture divides: the assembly is main-thread queue
    // work the gate pays per piece, the link times are the GPU process's
    // answer under that load.
    const requests = createShaderWarmRequests();
    requests.noteAssembly(4);
    requests.noteAssembly(6.5);
    // A clock that went backwards adds nothing rather than subtracting.
    requests.noteAssembly(-3);
    requests.noteLink(12);
    requests.noteLink(140);
    requests.noteLink(30);
    requests.noteLink(-5);

    const stats = requests.stats();
    expect(stats.dryAssembleMs).toBe(10.5);
    expect(stats.links).toEqual({ count: 4, sumMs: 182, maxMs: 140 });
  });

  it('hands out a copy of its counters, so a reader cannot move them', () => {
    const requests = createShaderWarmRequests();
    requests.noteBypass('actionable');
    requests.noteLink(20);
    const stats = requests.stats();
    stats.held = 99;
    stats.bypassed.actionable = 99;
    // The link block is nested: a shallow copy would hand out the live one.
    stats.links.count = 99;
    stats.links.maxMs = 99;

    expect(requests.stats()).toMatchObject({ held: 0 });
    expect(requests.stats().bypassed.actionable).toBe(1);
    expect(requests.stats().links).toEqual({ count: 1, sumMs: 20, maxMs: 20 });
  });
});

describe('the breaker the client retires a worker on', () => {
  it('pins how many held gates may expire in a row', () => {
    // Each expiry is a reveal delayed by the whole hold cap, so three is
    // already one too many to be one slow link.
    expect(SHADER_WARM_TIMEOUT_BREAKER).toBe(3);
  });

  it('pins the expired share that retires a worker too slow for the demand', () => {
    // Half of the last eight holds: a worker answering someone while most
    // holds still pay the cap costs more than none.
    expect(SHADER_WARM_HOLD_WINDOW).toBe(8);
    expect(SHADER_WARM_EXPIRED_SHARE_BREAKER).toBe(4);
  });

  it('keeps the last few holds, and counts the expiries among them', () => {
    const ring = createShaderWarmHoldRing(3);
    expect(ring.expired()).toBe(0);
    ring.note(true);
    ring.note(true);
    ring.note(false);
    expect(ring.expired()).toBe(2);
    expect(ring.size()).toBe(3);
    // The oldest expiry rolls out.
    ring.note(false);
    expect(ring.expired()).toBe(1);
    ring.note(false);
    expect(ring.expired()).toBe(0);
  });
});

describe('a cancelled request in the counters', () => {
  it('counts a drop on the client word apart from a link the worker could not do', async () => {
    const requests = createShaderWarmRequests();
    const { ids } = requests.request([source('a'), source('b')], 20);
    const settled = requests.whenSettled(ids);
    requests.settle(1, 'failed', true);
    requests.settle(2, 'failed');
    expect(await settled).toEqual(['failed', 'failed']);
    expect(requests.stats()).toMatchObject({ failed: 1, cancelled: 1, warmed: 0 });
  });
});

describe('the pause signal the frame time drives', () => {
  it('pins the display bounds it is written in, and their hysteresis', () => {
    // The bounds are the display's, not a machine's: two vsync periods up,
    // a period and a half down, so a pause is never one frame from a resume.
    expect(SHADER_WARM_FRAME_PERIOD_MS).toBeCloseTo(16.667, 2);
    expect(SHADER_WARM_PAUSE_ABOVE_MS).toBeCloseTo(33.333, 2);
    expect(SHADER_WARM_RESUME_BELOW_MS).toBeCloseTo(25, 6);
    expect(SHADER_WARM_RESUME_BELOW_MS).toBeLessThan(SHADER_WARM_PAUSE_ABOVE_MS);
  });

  it('starts unpaused at one period, so nothing is stood down before a frame is read', () => {
    expect(createShaderWarmPauseState()).toEqual({
      emaMs: SHADER_WARM_FRAME_PERIOD_MS,
      paused: false,
    });
  });

  it('pauses only once the average crosses two periods, then stays paused', () => {
    const state = createShaderWarmPauseState();
    const transitions = Array.from({ length: 9 }, () => noteShaderWarmFrame(state, 40));

    // Five 40 ms frames are not yet an average past the bound; the sixth is.
    expect(transitions).toEqual([null, null, null, null, null, 'pause', null, null, null]);
    expect(state.paused).toBe(true);
    expect(state.emaMs).toBeGreaterThan(SHADER_WARM_PAUSE_ABOVE_MS);
  });

  it('does not flap on a single long frame', () => {
    // One late frame among healthy ones is the ordinary case; standing the
    // worker down for it would cost the whole warm lane for nothing.
    const state = createShaderWarmPauseState();
    expect(noteShaderWarmFrame(state, 50)).toBeNull();
    expect(noteShaderWarmFrame(state, 16)).toBeNull();
    expect(state.paused).toBe(false);
  });

  it('resumes only once the average falls under a period and a half', () => {
    const state = createShaderWarmPauseState();
    for (let frame = 0; frame < 9; frame++) noteShaderWarmFrame(state, 40);
    expect(state.paused).toBe(true);

    // The first fast frames do not lift the pause: that gap is the hysteresis.
    const transitions = Array.from({ length: 6 }, () => noteShaderWarmFrame(state, 16));
    expect(transitions).toEqual([null, null, null, 'resume', null, null]);
    expect(state.paused).toBe(false);
    expect(state.emaMs).toBeLessThan(SHADER_WARM_RESUME_BELOW_MS);
  });

  it('reads a garbage frame time as zero and a runaway one as the clamp', () => {
    // The reading comes from a browser clock: NaN after a tab restore, a
    // negative delta across a clock change, minutes after a hidden tab.
    const garbage = createShaderWarmPauseState();
    const zero = createShaderWarmPauseState();
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -100]) {
      noteShaderWarmFrame(garbage, value);
      noteShaderWarmFrame(zero, 0);
    }
    expect(garbage.emaMs).toBe(zero.emaMs);
    expect(garbage.paused).toBe(false);

    const runaway = createShaderWarmPauseState();
    const clamped = createShaderWarmPauseState();
    noteShaderWarmFrame(runaway, 60_000);
    noteShaderWarmFrame(clamped, 250);
    expect(runaway.emaMs).toBe(clamped.emaMs);
  });
});

describe('abandoning a request', () => {
  it('drops an id only when no other request still waits for it', () => {
    // Two gates carrying the same material share one id: the first to give
    // up must not cancel the link the second is still holding for.
    const requests = createShaderWarmRequests();
    const first = requests.request([source('void main() {}')], 20);
    const second = requests.request([source('void main() {}')], 30);
    expect(second.ids).toEqual(first.ids);

    expect(requests.abandon(first.ids)).toEqual([]);
    expect(requests.abandon(second.ids)).toEqual([1]);
    // Once, and an unknown id is nobody's.
    expect(requests.abandon([1, 99])).toEqual([]);
  });

  it('never drops an id the worker already settled', () => {
    const requests = createShaderWarmRequests();
    const { ids } = requests.request([source('void main() {}')], 20);
    requests.settle(1, 'warmed');
    expect(requests.abandon(ids)).toEqual([]);
  });

  it('asks again for the same text once it was dropped, as a fresh id', async () => {
    // A dropped link never lands; a later gate must get its own request,
    // not a wait on the cancelled one.
    const requests = createShaderWarmRequests();
    const first = requests.request([source('void main() {}')], 20);
    expect(requests.abandon(first.ids)).toEqual([1]);
    const again = requests.request([source('void main() {}')], 20);
    expect(again.ids).toEqual([2]);
    expect(again.toSend.map((item) => item.id)).toEqual([2]);

    // The worker's cancel answer settles the old id for whoever kept waiting.
    const old = requests.whenSettled(first.ids);
    requests.settle(1, 'failed');
    expect(await old).toEqual(['failed']);
    expect(requests.stats()).toMatchObject({ sent: 2, deduped: 0, failed: 1 });
  });
});

describe('readShaderWarmReadyDeadline', () => {
  it('pins the ready deadline off the query for a probe, and keeps the default otherwise', () => {
    expect(readShaderWarmReadyDeadline('?perf&shaderwarmready=15000', 3_000)).toBe(15_000);
    expect(readShaderWarmReadyDeadline('?shaderwarmready=2500.5', 3_000)).toBe(2_500.5);
    expect(readShaderWarmReadyDeadline('?perf', 3_000)).toBe(3_000);
    expect(readShaderWarmReadyDeadline('', 3_000)).toBe(3_000);
    // Not a positive finite number: the default, never a disabled deadline.
    expect(readShaderWarmReadyDeadline('?shaderwarmready=0', 3_000)).toBe(3_000);
    expect(readShaderWarmReadyDeadline('?shaderwarmready=-5', 3_000)).toBe(3_000);
    expect(readShaderWarmReadyDeadline('?shaderwarmready=abc', 3_000)).toBe(3_000);
    expect(readShaderWarmReadyDeadline('?shaderwarmready=Infinity', 3_000)).toBe(3_000);
  });
});

describe("the cannot-serve rule (the worker measured against the caller's cap)", () => {
  // The RTX 4070 laptop capture: links about 560 ms each, the window open to
  // four, and the boot burst leaves dozens of programs queued ahead of the
  // hold that has waited longest.
  const LAPTOP: ShaderWarmCannotServeInputs = {
    linkCount: 5,
    linkSumMs: 5 * 560,
    windowLinks: 4,
    aheadOfOldest: 32,
    capMs: 5_000,
    waitedMs: 2_000,
  };

  it('retires when the queue ahead of the oldest hold outruns its remaining cap', () => {
    // 32 links at 560 ms, four at a time, is 4480 ms of service for a hold
    // with 3000 ms of its cap left: that hold is already lost, and so is
    // every hold behind it.
    expect(shaderWarmCannotServe(LAPTOP)).toBe(true);
  });

  it('keeps a worker whose links are ten times shorter, same queue', () => {
    // The RTX 3060 desktop shape: 32 x 50 ms over four is 400 ms, well inside
    // the same remaining cap. The rule is relative to the worker's own wall,
    // so no machine constant decides it.
    expect(shaderWarmCannotServe({ ...LAPTOP, linkSumMs: 5 * 50 })).toBe(false);
  });

  it('keeps a worker whose queue fits the remaining cap, at the same wall', () => {
    // Four links at 560 ms over a window of four is one link's wall.
    expect(shaderWarmCannotServe({ ...LAPTOP, aheadOfOldest: 4 })).toBe(false);
  });

  it('says nothing before three links: no evidence is not evidence of slowness', () => {
    for (let count = 0; count < SHADER_WARM_EVIDENCE_LINKS; count++) {
      expect(shaderWarmCannotServe({ ...LAPTOP, linkCount: count, linkSumMs: count * 560 })).toBe(
        false,
      );
    }
    expect(
      shaderWarmCannotServe({
        ...LAPTOP,
        linkCount: SHADER_WARM_EVIDENCE_LINKS,
        linkSumMs: SHADER_WARM_EVIDENCE_LINKS * 560,
      }),
    ).toBe(true);
  });

  it('reads a missing window as one link at a time, the honest worst case', () => {
    // Before the worker's first stats message there is no window to read, and
    // the fallback never claims more parallelism than was observed: six links
    // at 560 ms is 3360 ms one at a time (past the 3000 ms left) and 840 ms
    // four at a time.
    const six = { ...LAPTOP, aheadOfOldest: 6 };
    expect(shaderWarmCannotServe({ ...six, windowLinks: 1 })).toBe(true);
    expect(shaderWarmCannotServe({ ...six, windowLinks: Number.NaN })).toBe(true);
    expect(shaderWarmCannotServe({ ...six, windowLinks: 0 })).toBe(true);
    expect(shaderWarmCannotServe(six)).toBe(false);
  });

  it('never fires on an empty queue, or on a hold that has already outrun its cap alone', () => {
    // Nothing ahead is nothing to wait for, whatever the wall.
    expect(shaderWarmCannotServe({ ...LAPTOP, aheadOfOldest: 0 })).toBe(false);
    // A hold past its own cap is the caller's business (it gives up itself);
    // this rule still answers on the queue, not on the overrun.
    expect(shaderWarmCannotServe({ ...LAPTOP, waitedMs: 6_000 })).toBe(true);
  });

  it('answers false on garbage rather than retiring a working worker', () => {
    expect(shaderWarmCannotServe({ ...LAPTOP, linkSumMs: Number.NaN })).toBe(false);
    expect(shaderWarmCannotServe({ ...LAPTOP, linkSumMs: 0 })).toBe(false);
    expect(shaderWarmCannotServe({ ...LAPTOP, capMs: Number.NaN })).toBe(false);
    expect(shaderWarmCannotServe({ ...LAPTOP, waitedMs: Number.POSITIVE_INFINITY })).toBe(false);
    expect(shaderWarmCannotServe({ ...LAPTOP, aheadOfOldest: Number.NaN })).toBe(false);
  });
});

describe('the outstanding holds book', () => {
  it('answers the hold that started earliest, and forgets a closed one', () => {
    const holds = createShaderWarmOutstandingHolds();
    const first = holds.open({ startedAtMs: 100, capMs: 5_000, priority: 20, highestId: 4 });
    const second = holds.open({ startedAtMs: 40, capMs: 5_000, priority: 20, highestId: 9 });
    expect(holds.size()).toBe(2);
    // Earliest by clock, not by the order the calls arrived.
    expect(holds.oldest()).toBe(second);
    holds.close(second);
    expect(holds.oldest()).toBe(first);
    holds.close(first);
    expect(holds.oldest()).toBeNull();
    // Closing twice, or closing what was never opened, is a no-op.
    holds.close(first);
    expect(holds.size()).toBe(0);
  });

  it('drops everything at once when the worker goes', () => {
    const holds = createShaderWarmOutstandingHolds();
    holds.open({ startedAtMs: 1, capMs: 5_000, priority: 20, highestId: 1 });
    holds.open({ startedAtMs: 2, capMs: 5_000, priority: 20, highestId: 2 });
    holds.clear();
    expect(holds.size()).toBe(0);
    expect(holds.oldest()).toBeNull();
  });
});

describe('the requests the worker has yet to reach', () => {
  it('counts the unsettled requests of one priority up to an id, the queue ahead of a hold', () => {
    const requests = createShaderWarmRequests();
    requests.request([source('a'), source('b'), source('c'), source('d')], 20);
    expect(requests.unsettledAhead(20, 3)).toBe(3);
    expect(requests.unsettledAhead(20, 4)).toBe(4);

    // A settled one is behind the worker, not ahead of the hold.
    requests.settle(2, 'warmed');
    expect(requests.unsettledAhead(20, 4)).toBe(3);
    // And a request the worker has not been asked for yet is not counted.
    expect(requests.unsettledAhead(20, 1)).toBe(1);
  });

  it('reads the worker order: priority first, arrival only within one priority', () => {
    // The worker inserts a new request ahead of every pending one of LOWER
    // priority (shader_warm_worker_core.ts), so an id compare alone charges a
    // live view for a backlog the worker serves after it.
    const requests = createShaderWarmRequests();
    const backlog = requests.request([source('a'), source('b'), source('c')], 20);
    const live = requests.request([source('d')], 30);
    const liveId = live.ids[0];

    // The live hold is served first: only its own request is ahead of it.
    expect(requests.unsettledAhead(30, liveId)).toBe(1);
    // The cosmetic hold behind it IS charged for the live view, whatever the
    // ids say, plus its own arrivals.
    expect(requests.unsettledAhead(20, backlog.ids[2])).toBe(4);
    // A later cosmetic arrival is behind the earlier ones and not counted.
    const later = requests.request([source('e')], 20);
    expect(requests.unsettledAhead(20, backlog.ids[0])).toBe(2);
    expect(requests.unsettledAhead(20, later.ids[0])).toBe(5);
  });

  it('forgets a request nobody waits for any more', () => {
    // An abandoned request is on its way to the worker's cancel; charging a
    // hold for it would retire a worker over links that will never run.
    const requests = createShaderWarmRequests();
    const asked = requests.request([source('a'), source('b')], 20);
    expect(requests.unsettledAhead(20, asked.ids[1])).toBe(2);
    requests.abandon([asked.ids[0]]);
    expect(requests.unsettledAhead(20, asked.ids[1])).toBe(1);
  });
});
