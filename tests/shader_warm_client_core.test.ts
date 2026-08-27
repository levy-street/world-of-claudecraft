// The shader warm client's policy and bookkeeping
// (src/render/shader_warm_client_core.ts): which gates hold their link for
// the worker, which text is asked for once, what a gate did when it could
// not wait, and when the worker is told to stand down. Host-agnostic, so
// every case here is a plain call: no worker, no DOM, no clock.

import { describe, expect, it } from 'vitest';
import { programSourceHash } from '../src/render/shader_warm_audit_core';
import {
  createShaderWarmPauseState,
  createShaderWarmRequests,
  noteShaderWarmFrame,
  readShaderWarmSetting,
  SHADER_WARM_FRAME_PERIOD_MS,
  SHADER_WARM_PAUSE_ABOVE_MS,
  SHADER_WARM_RESUME_BELOW_MS,
  SHADER_WARM_SETTINGS,
  SHADER_WARM_TIMEOUT_BREAKER,
  type ShaderWarmBypass,
  type ShaderWarmPolicyInputs,
  type ShaderWarmRequestSource,
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
  it('resolves auto by the backend: reveal where the compile runs off the presenting thread', () => {
    // Measured 2026-08-28: D3D11 passed, Vulkan had nothing left to warm,
    // every OpenGL cell (Linux NVIDIA, Linux Intel, Android Mali) only
    // relocated the stall into the GPU process.
    expect(shaderWarmModeFor('auto', 'd3d11')).toBe('reveal');
    expect(shaderWarmModeFor('auto', 'vulkan')).toBe('reveal');
    expect(shaderWarmModeFor('auto', 'metal')).toBe('reveal');
    expect(shaderWarmModeFor('auto', 'opengl')).toBe('off');
    expect(shaderWarmModeFor('auto', 'software')).toBe('off');
    expect(shaderWarmModeFor('auto', 'unknown')).toBe('off');
    expect(shaderWarmModeFor('auto', null)).toBe('off');
  });

  it('keeps an explicit setting whatever the backend', () => {
    expect(shaderWarmModeFor('off', 'd3d11')).toBe('off');
    expect(shaderWarmModeFor('reveal', 'opengl')).toBe('reveal');
    expect(shaderWarmModeFor('all', null)).toBe('all');
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
