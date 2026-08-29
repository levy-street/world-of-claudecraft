import { describe, expect, it, vi } from 'vitest';
import {
  applyGpuBackendSwitches,
  decideGpuBackendLaunch,
  demoteAfterRepeatedCrashes,
  GPU_BACKEND_ENV,
  GPU_BACKEND_RESCUE_ENV,
  GPU_BACKEND_RUNGS,
  GPU_BACKEND_SETTINGS,
  gpuBackendMemoryAfterHealthySession,
  hasGetGpuInfoEvidence,
  judgeGpuBackendLaunch,
  launchCounterAfterAutoLaunch,
  MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES,
  REPROBE_HIGHER_BACKEND_EVERY_LAUNCHES,
  REPROBE_WITHOUT_PROOF_EVERY_LAUNCHES,
  relaunchOnLowerBackend,
  SESSION_HEALTHY_AFTER_MS,
  TOP_GPU_BACKEND_RUNG,
  VULKAN_BACKEND_SWITCHES,
  VULKAN_PARALLEL_COMPILE_SWITCH,
} from '../electron/gpu_backend.cjs';
import { spawnDetachedSelf } from '../electron/gpu_preference.cjs';

// Real renderer strings as app.getGPUInfo('complete') reports them.
const VULKAN_OK =
  'ANGLE (NVIDIA, Vulkan 1.4.312 (NVIDIA NVIDIA GeForce RTX 3090 (0x00002204)), NVIDIA)';
const VULKAN_SOFTWARE =
  'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
const OPENGL = 'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3090/PCIe/SSE2, OpenGL 4.5.0)';

const VERSION = '0.41.0';
type Rung = (typeof GPU_BACKEND_RUNGS)[number];
type Memory = Parameters<typeof decideGpuBackendLaunch>[0]['prefs'];
const proof = (backend: Rung, appVersion = VERSION, gpuDriver = VULKAN_OK) => ({
  backend,
  appVersion,
  gpuDriver,
});
const linux = (prefs: Memory, env: Record<string, string | undefined> = {}) =>
  decideGpuBackendLaunch({ platform: 'linux', env, prefs, appVersion: VERSION });

describe('GPU backend constants (load-bearing literals)', () => {
  it('pins the ladder, best first, and the settings beside it', () => {
    // The ORDER is the ladder: everything that steps up or down reads it, so a
    // reorder would silently invert every demotion and every climb.
    expect(GPU_BACKEND_RUNGS).toEqual(['vulkan-parallel-compile', 'vulkan-plain', 'opengl']);
    expect(TOP_GPU_BACKEND_RUNG).toBe('vulkan-parallel-compile');
    expect(GPU_BACKEND_SETTINGS).toEqual(['auto', 'vulkan', 'opengl']);
    expect(GPU_BACKEND_ENV).toBe('WOC_GPU_BACKEND');
    expect(GPU_BACKEND_RESCUE_ENV).toBe('WOC_GPU_BACKEND_RESCUED_TO');
  });

  it('pins the three numbers, and that the no-proof cadence is the rarer one', () => {
    expect(MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES).toBe(3);
    expect(REPROBE_HIGHER_BACKEND_EVERY_LAUNCHES).toBe(10);
    expect(REPROBE_WITHOUT_PROOF_EVERY_LAUNCHES).toBe(50);
    expect(SESSION_HEALTHY_AFTER_MS).toBe(60_000);
    // The relation is the point, not the values: a machine that has never run
    // the higher rung must be retried LESS often than one that has.
    expect(REPROBE_WITHOUT_PROOF_EVERY_LAUNCHES).toBeGreaterThan(
      REPROBE_HIGHER_BACKEND_EVERY_LAUNCHES,
    );
    // More than one, or a single transient death demotes a healthy machine,
    // which is the defect this replaces.
    expect(MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES).toBeGreaterThan(1);
  });

  it('pins the three Vulkan switches, the parallel-compile feature apart, and nothing wider', () => {
    // The verified minimal set. --ignore-gpu-blocklist and
    // --disable-gpu-driver-bug-workarounds widen the blast radius on drivers the
    // blocklist exists for, and --disable-vulkan-surface is headless-only. The
    // ANGLE feature is the one that exposes KHR_parallel_shader_compile on the
    // Vulkan backend (opt-in in ANGLE); without it every gate is inert there. It
    // is its own switch because it is its own rung.
    expect(VULKAN_BACKEND_SWITCHES).toEqual([
      ['use-gl', 'angle'],
      ['use-angle', 'vulkan'],
      ['enable-features', 'Vulkan,DefaultANGLEVulkan,VulkanFromANGLE'],
    ]);
    expect(VULKAN_PARALLEL_COMPILE_SWITCH).toEqual([
      'enable-angle-features',
      'enableParallelCompileAndLink',
    ]);
    const names = VULKAN_BACKEND_SWITCHES.map(([name]) => name);
    expect(names).not.toContain('ignore-gpu-blocklist');
    expect(names).not.toContain('disable-gpu-driver-bug-workarounds');
    expect(names).not.toContain('disable-vulkan-surface');
  });
});

describe('decideGpuBackendLaunch', () => {
  it('leaves every non-Linux platform on its default, whatever the prefs say', () => {
    for (const platform of ['win32', 'darwin', 'freebsd']) {
      const launch = decideGpuBackendLaunch({
        platform,
        env: { [GPU_BACKEND_ENV]: 'vulkan' },
        prefs: { gpuBackend: 'vulkan', gpuBackendProof: proof('vulkan-parallel-compile') },
      });
      expect(launch).toEqual({
        backend: 'default',
        parallel: false,
        rung: 'opengl',
        reprobed: false,
        reason: 'platform default',
      });
    }
  });

  it('starts a first launch on the BEST rung: absent memory is not a demotion', () => {
    // Nothing stored means nothing has been ruled out, so Auto is optimistic and
    // the rescue is what covers a machine that cannot follow.
    const launch = linux({ gpuBackend: 'auto' });
    expect(launch.rung).toBe(TOP_GPU_BACKEND_RUNG);
    expect(launch.parallel).toBe(true);
    expect(launch.backend).toBe('vulkan');
    expect(launch.reprobed).toBe(false);
    // A junk value is read the same way, never as "stay at the bottom".
    expect(linux({ gpuBackend: 'auto', gpuBackendToAttempt: 'nonsense' }).rung).toBe(
      TOP_GPU_BACKEND_RUNG,
    );
  });

  it('runs the remembered rung, and does not climb before its cadence', () => {
    const prefs = {
      gpuBackend: 'auto',
      gpuBackendToAttempt: 'vulkan-plain',
      launchesSinceBackendReprobe: REPROBE_HIGHER_BACKEND_EVERY_LAUNCHES - 1,
      gpuBackendProof: proof('vulkan-parallel-compile'),
    };
    const launch = linux(prefs);
    expect(launch.rung).toBe('vulkan-plain');
    expect(launch.parallel).toBe(false);
    expect(launch.reprobed).toBe(false);
  });

  it('climbs STRAIGHT to the proven rung on the cadence, skipping the rungs between', () => {
    // This is what the proof buys: from the bottom, one launch back to the top
    // instead of one launch per rung.
    const launch = linux({
      gpuBackend: 'auto',
      gpuBackendToAttempt: 'opengl',
      launchesSinceBackendReprobe: REPROBE_HIGHER_BACKEND_EVERY_LAUNCHES,
      gpuBackendProof: proof('vulkan-parallel-compile'),
    });
    expect(launch.rung).toBe('vulkan-parallel-compile');
    expect(launch.reprobed).toBe(true);
    expect(launch.reason).toContain('proven');
  });

  it('climbs ONE rung when there is no valid proof, and only on the rarer cadence', () => {
    const noProof = {
      gpuBackend: 'auto',
      gpuBackendToAttempt: 'opengl',
      launchesSinceBackendReprobe: REPROBE_HIGHER_BACKEND_EVERY_LAUNCHES,
    };
    // The with-proof cadence does NOT fire a machine that has never proven one.
    expect(linux(noProof).rung).toBe('opengl');
    expect(linux(noProof).reprobed).toBe(false);
    const due = { ...noProof, launchesSinceBackendReprobe: REPROBE_WITHOUT_PROOF_EVERY_LAUNCHES };
    expect(linux(due).rung).toBe('vulkan-plain');
    expect(linux(due).reprobed).toBe(true);
  });

  it('treats a proof from another app version as no proof, and re-probes at once', () => {
    // The environment changed, so the counter describes a machine that no longer
    // exists: climb now rather than wait it out, and climb one rung because the
    // stale proof cannot aim.
    const launch = linux({
      gpuBackend: 'auto',
      gpuBackendToAttempt: 'opengl',
      launchesSinceBackendReprobe: 0,
      gpuBackendProof: proof('vulkan-parallel-compile', '0.40.0'),
    });
    expect(launch.rung).toBe('vulkan-plain');
    expect(launch.reprobed).toBe(true);
    expect(launch.reason).not.toContain('proven');
  });

  it('never climbs above the top rung, whatever the counter says', () => {
    const launch = linux({
      gpuBackend: 'auto',
      gpuBackendToAttempt: TOP_GPU_BACKEND_RUNG,
      launchesSinceBackendReprobe: 9999,
      gpuBackendProof: proof(TOP_GPU_BACKEND_RUNG),
    });
    expect(launch.rung).toBe(TOP_GPU_BACKEND_RUNG);
    expect(launch.reprobed).toBe(false);
  });

  it('takes an explicit setting as explicit: the memory is not read at all', () => {
    // The demoted memory below would send Auto to OpenGL; an explicit Vulkan
    // ignores it. The RESCUE is what protects this player, not the memory.
    const demoted = { gpuBackendToAttempt: 'opengl', consecutiveGpuLaunchCrashes: 2 };
    expect(linux({ ...demoted, gpuBackend: 'vulkan' }).rung).toBe(TOP_GPU_BACKEND_RUNG);
    expect(linux({ ...demoted, gpuBackend: 'opengl' }).rung).toBe('opengl');
    expect(linux({ ...demoted, gpuBackend: 'vulkan' }).reprobed).toBe(false);
  });

  it('lets the rescue marker win over everything, including an explicit setting', () => {
    // The parent watched the rung above die seconds ago; re-deciding from the
    // prefs would spawn the same death.
    const env = { [GPU_BACKEND_RESCUE_ENV]: 'opengl' };
    expect(linux({ gpuBackend: 'vulkan' }, env).rung).toBe('opengl');
    expect(linux({ gpuBackend: 'auto' }, env).rung).toBe('opengl');
    expect(linux({ gpuBackend: 'vulkan' }, { ...env, [GPU_BACKEND_ENV]: 'vulkan' }).rung).toBe(
      'opengl',
    );
    expect(linux({ gpuBackend: 'auto' }, env).reason).toContain('rescued to opengl');
    // A junk marker is ignored rather than obeyed.
    expect(linux({ gpuBackend: 'auto' }, { [GPU_BACKEND_RESCUE_ENV]: 'nonsense' }).rung).toBe(
      TOP_GPU_BACKEND_RUNG,
    );
  });

  it('honors the no-GPU-lever rescue env ahead of the stored setting', () => {
    expect(linux({ gpuBackend: 'vulkan' }, { WOC_DISABLE_GPU_FORCE: '1' }).rung).toBe('opengl');
    // The explicit env override still wins over it: that is how Vulkan is tried
    // with every other GPU lever off.
    expect(
      linux({ gpuBackend: 'auto' }, { WOC_DISABLE_GPU_FORCE: '1', [GPU_BACKEND_ENV]: 'vulkan' })
        .rung,
    ).toBe(TOP_GPU_BACKEND_RUNG);
    // Strict '1': a stray value cannot half-arm the rescue.
    expect(linux({ gpuBackend: 'auto' }, { WOC_DISABLE_GPU_FORCE: 'true' }).rung).toBe(
      TOP_GPU_BACKEND_RUNG,
    );
  });

  it('takes the env override as explicit, ahead of the setting, and ignores junk', () => {
    expect(linux({ gpuBackend: 'opengl' }, { [GPU_BACKEND_ENV]: 'vulkan' }).rung).toBe(
      TOP_GPU_BACKEND_RUNG,
    );
    expect(linux({ gpuBackend: 'vulkan' }, { [GPU_BACKEND_ENV]: 'opengl' }).rung).toBe('opengl');
    // An unknown value falls through to the setting rather than picking an arm.
    expect(linux({ gpuBackend: 'opengl' }, { [GPU_BACKEND_ENV]: 'metal' }).rung).toBe('opengl');
  });
});

describe('applyGpuBackendSwitches', () => {
  function fakeApp() {
    const switches: Array<[string, string]> = [];
    return {
      switches,
      app: {
        commandLine: {
          appendSwitch: (name: string, value: string) => switches.push([name, value]),
        },
      },
    };
  }

  it('appends the three Vulkan switches plus the feature on the top rung, three alone below it', () => {
    const { app, switches } = fakeApp();
    applyGpuBackendSwitches(app, {
      backend: 'vulkan',
      parallel: true,
      rung: 'vulkan-parallel-compile',
      reprobed: false,
      reason: 'auto, best rung',
    });
    expect(switches).toEqual([
      ['use-gl', 'angle'],
      ['use-angle', 'vulkan'],
      ['enable-features', 'Vulkan,DefaultANGLEVulkan,VulkanFromANGLE'],
      ['enable-angle-features', 'enableParallelCompileAndLink'],
    ]);
    const plain = fakeApp();
    applyGpuBackendSwitches(plain.app, {
      backend: 'vulkan',
      parallel: false,
      rung: 'vulkan-plain',
      reprobed: false,
      reason: 'auto, remembered rung',
    });
    expect(plain.switches).toEqual([
      ['use-gl', 'angle'],
      ['use-angle', 'vulkan'],
      ['enable-features', 'Vulkan,DefaultANGLEVulkan,VulkanFromANGLE'],
    ]);
  });

  it('appends nothing for a default launch, or for no launch at all', () => {
    const { app, switches } = fakeApp();
    applyGpuBackendSwitches(app, {
      backend: 'default',
      parallel: false,
      rung: 'opengl',
      reprobed: false,
      reason: 'platform default',
    });
    applyGpuBackendSwitches(app, null);
    applyGpuBackendSwitches(app, undefined);
    expect(switches).toEqual([]);
  });
});

describe('judgeGpuBackendLaunch', () => {
  it('answers the rung that actually bound, not the one that was asked for', () => {
    expect(
      judgeGpuBackendLaunch({ glRenderer: VULKAN_OK, softwareRendering: false, parallel: true }),
    ).toBe('vulkan-parallel-compile');
    // The switches went on but ANGLE did not expose the extension: the rung
    // below is what is really running.
    expect(
      judgeGpuBackendLaunch({
        glRenderer: VULKAN_OK,
        softwareRendering: false,
        parallel: true,
        parallelCompile: false,
      }),
    ).toBe('vulkan-plain');
    // The feature was not asked for: plain Vulkan whatever the page reports.
    expect(
      judgeGpuBackendLaunch({
        glRenderer: VULKAN_OK,
        parallel: false,
        parallelCompile: true,
      }),
    ).toBe('vulkan-plain');
  });

  it('keeps the asked-for rung when the page cannot say (an older game build)', () => {
    expect(
      judgeGpuBackendLaunch({ glRenderer: VULKAN_OK, parallel: true, parallelCompile: undefined }),
    ).toBe('vulkan-parallel-compile');
  });

  it('reads the SwiftShader device as opengl even though its string says Vulkan', () => {
    expect(judgeGpuBackendLaunch({ glRenderer: VULKAN_SOFTWARE, parallel: true })).toBe('opengl');
  });

  it("reads Chromium's software flag as opengl, whatever the string says", () => {
    expect(
      judgeGpuBackendLaunch({ glRenderer: VULKAN_OK, softwareRendering: true, parallel: true }),
    ).toBe('opengl');
  });

  it('reads a non-Vulkan renderer, and a missing one, as opengl', () => {
    expect(judgeGpuBackendLaunch({ glRenderer: OPENGL, parallel: true })).toBe('opengl');
    expect(judgeGpuBackendLaunch({ glRenderer: '', parallel: true })).toBe('opengl');
    expect(judgeGpuBackendLaunch({ parallel: true })).toBe('opengl');
    expect(judgeGpuBackendLaunch({ glRenderer: 42, parallel: true })).toBe('opengl');
  });

  it('matches the Vulkan and SwiftShader tokens case-insensitively', () => {
    expect(judgeGpuBackendLaunch({ glRenderer: 'ANGLE (X, VULKAN 1.3, Y)', parallel: true })).toBe(
      'vulkan-parallel-compile',
    );
    expect(
      judgeGpuBackendLaunch({ glRenderer: 'ANGLE (Vulkan, SWIFTSHADER)', parallel: true }),
    ).toBe('opengl');
  });
});

describe('demoteAfterRepeatedCrashes', () => {
  it('counts, and only steps down at the threshold', () => {
    const prefs = { gpuBackend: 'auto', gpuBackendToAttempt: 'vulkan-parallel-compile' };
    let memory: Record<string, unknown> = { ...prefs, consecutiveGpuLaunchCrashes: 0 };
    for (let i = 1; i < MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES; i++) {
      const next = demoteAfterRepeatedCrashes({ prefs: memory, rung: memory.gpuBackendToAttempt });
      expect(next).toEqual({ consecutiveGpuLaunchCrashes: i });
      // toEqual ignores an undefined-valued key, so the proof is checked by
      // absence: this branch must not carry it either.
      expect(next).not.toHaveProperty('gpuBackendProof');
      memory = { ...memory, ...next };
      // The rung has NOT moved yet: one death is not a verdict.
      expect(memory.gpuBackendToAttempt).toBe('vulkan-parallel-compile');
    }
    const stepped = demoteAfterRepeatedCrashes({ prefs: memory, rung: memory.gpuBackendToAttempt });
    expect(stepped).toEqual({
      gpuBackendToAttempt: 'vulkan-plain',
      consecutiveGpuLaunchCrashes: 0,
    });
  });

  it('never touches the proof: a crash does not un-prove a healthy session', () => {
    const memory = {
      gpuBackend: 'auto',
      gpuBackendToAttempt: 'vulkan-parallel-compile',
      consecutiveGpuLaunchCrashes: MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES - 1,
      gpuBackendProof: proof('vulkan-parallel-compile'),
    };
    const next = demoteAfterRepeatedCrashes({ prefs: memory, rung: 'vulkan-parallel-compile' });
    expect(next).not.toHaveProperty('gpuBackendProof');
  });

  it('says nothing about a rung the memory was not attempting', () => {
    // A death on a re-probed rung above the remembered one, or under an explicit
    // setting, tells us nothing about the remembered rung.
    const memory = { gpuBackend: 'auto', gpuBackendToAttempt: 'opengl' };
    expect(demoteAfterRepeatedCrashes({ prefs: memory, rung: 'vulkan-plain' })).toBeNull();
    expect(demoteAfterRepeatedCrashes({ prefs: memory, rung: 'nonsense' })).toBeNull();
  });

  it('counts on at the bottom rung rather than stepping off the ladder', () => {
    const memory = {
      gpuBackend: 'auto',
      gpuBackendToAttempt: 'opengl',
      consecutiveGpuLaunchCrashes: MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES - 1,
    };
    const next = demoteAfterRepeatedCrashes({ prefs: memory, rung: 'opengl' });
    expect(next).toEqual({ consecutiveGpuLaunchCrashes: MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES });
    expect(next).not.toHaveProperty('gpuBackendToAttempt');
  });
});

describe('gpuBackendMemoryAfterHealthySession', () => {
  it('writes the first proof there ever was, and clears the streak', () => {
    const next = gpuBackendMemoryAfterHealthySession({
      prefs: { gpuBackend: 'auto', consecutiveGpuLaunchCrashes: 2 },
      rung: 'vulkan-plain',
      appVersion: VERSION,
      gpuDriver: VULKAN_OK,
    });
    expect(next).toEqual({
      gpuBackendToAttempt: 'vulkan-plain',
      consecutiveGpuLaunchCrashes: 0,
      gpuBackendProof: { backend: 'vulkan-plain', appVersion: VERSION, gpuDriver: VULKAN_OK },
    });
  });

  it('raises the proof when a higher rung proves out', () => {
    const next = gpuBackendMemoryAfterHealthySession({
      prefs: { gpuBackend: 'auto', gpuBackendProof: proof('vulkan-plain') },
      rung: 'vulkan-parallel-compile',
      appVersion: VERSION,
      gpuDriver: VULKAN_OK,
    });
    expect(next?.gpuBackendProof).toEqual(proof('vulkan-parallel-compile'));
  });

  it('does NOT lower the proof when a lower rung proves out on the same machine', () => {
    // A session on OpenGL does not un-prove that Vulkan ran here; keeping the
    // higher proof is what lets the climb aim straight back at it.
    const stored = proof('vulkan-parallel-compile');
    const next = gpuBackendMemoryAfterHealthySession({
      prefs: { gpuBackend: 'auto', gpuBackendProof: stored },
      rung: 'opengl',
      appVersion: VERSION,
      gpuDriver: VULKAN_OK,
    });
    expect(next).toEqual({ gpuBackendToAttempt: 'opengl', consecutiveGpuLaunchCrashes: 0 });
    expect(next).not.toHaveProperty('gpuBackendProof');
  });

  it('REPLACES a proof that describes another machine, even with a lower rung', () => {
    // A different driver means the old proof is about hardware that is no longer
    // here; keeping it would aim the climb at a rung this machine cannot run.
    const stored = proof('vulkan-parallel-compile', VERSION, 'ANGLE (Old GPU, Vulkan 1.1, Old)');
    const next = gpuBackendMemoryAfterHealthySession({
      prefs: { gpuBackend: 'auto', gpuBackendProof: stored },
      rung: 'opengl',
      appVersion: VERSION,
      gpuDriver: OPENGL,
    });
    expect(next?.gpuBackendProof).toEqual({
      backend: 'opengl',
      appVersion: VERSION,
      gpuDriver: OPENGL,
    });
  });

  it('replaces a proof from another app version the same way', () => {
    const next = gpuBackendMemoryAfterHealthySession({
      prefs: { gpuBackend: 'auto', gpuBackendProof: proof('vulkan-parallel-compile', '0.40.0') },
      rung: 'vulkan-plain',
      appVersion: VERSION,
      gpuDriver: VULKAN_OK,
    });
    expect(next?.gpuBackendProof).toEqual(proof('vulkan-plain'));
  });

  it('answers null for a rung that is not on the ladder', () => {
    expect(
      gpuBackendMemoryAfterHealthySession({
        prefs: {},
        rung: 'nonsense',
        appVersion: VERSION,
        gpuDriver: VULKAN_OK,
      }),
    ).toBeNull();
  });
});

describe('launchCounterAfterAutoLaunch', () => {
  const climb = { reprobed: true } as never;
  const plain = { reprobed: false } as never;

  it('counts up on an ordinary Auto launch and resets on a climb', () => {
    expect(
      launchCounterAfterAutoLaunch({
        prefs: { gpuBackend: 'auto', launchesSinceBackendReprobe: 4 },
        launch: plain,
      }),
    ).toEqual({ launchesSinceBackendReprobe: 5 });
    expect(
      launchCounterAfterAutoLaunch({
        prefs: { gpuBackend: 'auto', launchesSinceBackendReprobe: 12 },
        launch: climb,
      }),
    ).toEqual({ launchesSinceBackendReprobe: 0 });
  });

  it('does not count an explicit setting: the memory is not its business', () => {
    for (const gpuBackend of ['vulkan', 'opengl']) {
      expect(
        launchCounterAfterAutoLaunch({
          prefs: { gpuBackend, launchesSinceBackendReprobe: 4 },
          launch: plain,
        }),
      ).toBeNull();
    }
  });

  it('answers null rather than a no-op write when the count would not move', () => {
    expect(
      launchCounterAfterAutoLaunch({
        prefs: { gpuBackend: 'auto', launchesSinceBackendReprobe: 0 },
        launch: climb,
      }),
    ).toBeNull();
  });
});

describe('hasGetGpuInfoEvidence', () => {
  it('counts a non-empty renderer string as evidence, whatever it says', () => {
    expect(hasGetGpuInfoEvidence({ glRenderer: VULKAN_OK, softwareRendering: false })).toBe(true);
    expect(hasGetGpuInfoEvidence({ glRenderer: OPENGL })).toBe(true);
    expect(hasGetGpuInfoEvidence({ glRenderer: VULKAN_SOFTWARE, softwareRendering: false })).toBe(
      true,
    );
  });

  it("counts Chromium's software flag as evidence even without a renderer string", () => {
    expect(hasGetGpuInfoEvidence({ glRenderer: '', softwareRendering: true })).toBe(true);
    expect(hasGetGpuInfoEvidence({ softwareRendering: true })).toBe(true);
  });

  it('reads an empty or missing renderer string with no software flag as NO evidence', () => {
    // The live Linux reading: a healthy ANGLE Vulkan session whose getGPUInfo
    // glRenderer is empty. Judging it would call a working GPU a failure.
    expect(hasGetGpuInfoEvidence({ glRenderer: '', softwareRendering: false })).toBe(false);
    expect(hasGetGpuInfoEvidence({ glRenderer: undefined })).toBe(false);
    expect(hasGetGpuInfoEvidence({ glRenderer: 42, softwareRendering: 'yes' })).toBe(false);
    expect(hasGetGpuInfoEvidence({})).toBe(false);
    expect(hasGetGpuInfoEvidence(null)).toBe(false);
    expect(hasGetGpuInfoEvidence(undefined)).toBe(false);
  });
});

describe('relaunchOnLowerBackend', () => {
  function fakeSpawn() {
    const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const unref = vi.fn();
    const spawn = vi.fn((command: string, args: string[], options?: unknown) => {
      calls.push({ command, args, options: options as Record<string, unknown> });
      return { unref };
    });
    return { spawn, calls, unref };
  }

  it('re-execs the same binary and argv, detached, with the target rung on the child', () => {
    const { spawn, calls, unref } = fakeSpawn();
    const info = vi.fn();
    const result = relaunchOnLowerBackend(
      {
        spawn,
        env: { UNRELATED: 'x', WOC_PRIME_RELAUNCHED: '1' },
        execPath: '/usr/bin/world-of-claudecraft',
        argv: ['--some-flag', '--ozone-platform=x11'],
        log: { info },
      },
      'vulkan-parallel-compile',
    );
    expect(result).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('/usr/bin/world-of-claudecraft');
    // Argv passes through untouched: the PRIME-relaunched child's explicit
    // ozone flag survives, so the child does not re-exec for PRIME either.
    expect(calls[0].args).toEqual(['--some-flag', '--ozone-platform=x11']);
    // Full options pin: the env is the parent's (PRIME marker included) plus the
    // rescue marker, which names the rung in full rather than a code.
    expect(calls[0].options).toEqual({
      env: {
        UNRELATED: 'x',
        WOC_PRIME_RELAUNCHED: '1',
        [GPU_BACKEND_RESCUE_ENV]: 'vulkan-plain',
      },
      stdio: 'inherit',
      detached: true,
    });
    expect(unref).toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('vulkan-plain'), {
      spawnTarget: '/usr/bin/world-of-claudecraft',
    });
  });

  it('spawns the outer AppImage (env.APPIMAGE), never execPath, inside an AppImage', () => {
    const { spawn, calls } = fakeSpawn();
    relaunchOnLowerBackend(
      {
        spawn,
        env: { APPIMAGE: '/home/p/Applications/world-of-claudecraft.AppImage' },
        execPath: '/tmp/.mount_worldXYZ/binary',
        argv: [],
      },
      'vulkan-plain',
    );
    expect(calls[0].command).toBe('/home/p/Applications/world-of-claudecraft.AppImage');
  });

  it('ignores a non-absolute APPIMAGE value and falls back to execPath', () => {
    const { spawn, calls } = fakeSpawn();
    relaunchOnLowerBackend(
      { spawn, env: { APPIMAGE: 'relative/evil.AppImage' }, execPath: '/usr/bin/woc', argv: [] },
      'vulkan-plain',
    );
    expect(calls[0].command).toBe('/usr/bin/woc');
  });

  it('walks the ladder down one rung at a time and stops at the bottom', () => {
    const { spawn, calls } = fakeSpawn();
    const base = { env: { HOME: '/h' }, argv: ['--x'], execPath: '/bin/app', spawn };
    expect(relaunchOnLowerBackend(base, 'vulkan-parallel-compile')).toBe(true);
    expect((calls[0].options.env as Record<string, string>)[GPU_BACKEND_RESCUE_ENV]).toBe(
      'vulkan-plain',
    );
    // The rescued child may go one rung further, to OpenGL.
    const plainChild = { ...base, env: { [GPU_BACKEND_RESCUE_ENV]: 'vulkan-plain' } };
    expect(relaunchOnLowerBackend(plainChild, 'vulkan-plain')).toBe(true);
    expect((calls[1].options.env as Record<string, string>)[GPU_BACKEND_RESCUE_ENV]).toBe('opengl');
    // There is nothing below OpenGL, so the chain ends rather than looping.
    expect(relaunchOnLowerBackend(base, 'opengl')).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('never sends a child to a rung this chain has already run', () => {
    const { spawn } = fakeSpawn();
    // A process already rescued to OpenGL cannot spawn another OpenGL child.
    expect(
      relaunchOnLowerBackend(
        { spawn, env: { [GPU_BACKEND_RESCUE_ENV]: 'opengl' }, execPath: '/bin/w', argv: [] },
        'vulkan-plain',
      ),
    ).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    // Nor can a plain-Vulkan child be sent back up to plain Vulkan.
    expect(
      relaunchOnLowerBackend(
        { spawn, env: { [GPU_BACKEND_RESCUE_ENV]: 'vulkan-plain' }, execPath: '/bin/w', argv: [] },
        'vulkan-parallel-compile',
      ),
    ).toBe(false);
    // A junk marker is not a marker: the rescue still runs.
    expect(
      relaunchOnLowerBackend(
        { spawn, env: { [GPU_BACKEND_RESCUE_ENV]: 'yes' }, execPath: '/bin/w', argv: [] },
        'vulkan-plain',
      ),
    ).toBe(true);
  });

  it('refuses a rung that is not on the ladder', () => {
    const { spawn } = fakeSpawn();
    expect(relaunchOnLowerBackend({ spawn, env: {}, execPath: '/b', argv: [] }, 'nonsense')).toBe(
      false,
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('does not mutate the environment object passed in', () => {
    const { spawn } = fakeSpawn();
    const env = { UNRELATED: 'x' };
    relaunchOnLowerBackend({ spawn, env, execPath: '/usr/bin/woc', argv: [] }, 'vulkan-plain');
    expect(env).toEqual({ UNRELATED: 'x' });
  });

  it('returns false and logs a warning when spawn itself throws', () => {
    const spawn = vi.fn(() => {
      throw new Error('spawn EACCES');
    });
    const warn = vi.fn();
    const result = relaunchOnLowerBackend(
      { spawn, env: {}, execPath: '/usr/bin/woc', argv: [], log: { warn } },
      'vulkan-plain',
    );
    expect(result).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});

describe('spawnDetachedSelf (the shared self-relaunch spawn)', () => {
  it('spawns detached with inherited stdio, unrefs, and answers the target it chose', () => {
    const unref = vi.fn();
    const spawn = vi.fn(() => ({ unref }));
    const target = spawnDetachedSelf({
      env: { APPIMAGE: '/apps/woc.AppImage', A: '1' },
      argv: ['--x'],
      execPath: '/mount/binary',
      spawn,
    });
    expect(target).toBe('/apps/woc.AppImage');
    expect(spawn).toHaveBeenCalledWith('/apps/woc.AppImage', ['--x'], {
      env: { APPIMAGE: '/apps/woc.AppImage', A: '1' },
      stdio: 'inherit',
      detached: true,
    });
    expect(unref).toHaveBeenCalled();
  });

  it('tolerates a child handle without unref and propagates a spawn failure', () => {
    expect(spawnDetachedSelf({ env: {}, argv: [], execPath: '/bin/woc', spawn: () => ({}) })).toBe(
      '/bin/woc',
    );
    expect(() =>
      spawnDetachedSelf({
        env: {},
        argv: [],
        execPath: '/bin/woc',
        spawn: () => {
          throw new Error('spawn ENOENT');
        },
      }),
    ).toThrow('spawn ENOENT');
  });
});
