import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  activeGpuAdapterKey,
  applyGpuBackendSwitches,
  backendDidNotBind,
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
  requestedBackendUnavailable,
  SESSION_HEALTHY_AFTER_MS,
  shouldRescueMissingGpu,
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

// The active adapter as app.getGPUInfo lists it (an RTX 3090), the proof's machine key.
const ADAPTER = '0x10de:0x2204';
const OTHER_ADAPTER = '0x8086:0x7d67';

const VERSION = '0.41.0';
type Rung = (typeof GPU_BACKEND_RUNGS)[number];
type Memory = Parameters<typeof decideGpuBackendLaunch>[0]['prefs'];
const proof = (backend: Rung, appVersion = VERSION, gpuAdapter = ADAPTER) => ({
  backend,
  appVersion,
  gpuAdapter,
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
        ladder: false,
        auto: false,
        rescued: false,
      });
    }
  });

  it('flags the launches the memory owns, and only those', () => {
    // The shell keys every memory write on `auto`, never on the setting: the
    // setting reads Auto under every env override, and both overrides used to
    // be remembered (WOC_DISABLE_GPU_FORCE=1 demoted the next ordinary launch).
    expect(linux({ gpuBackend: 'auto' })).toMatchObject({
      ladder: true,
      auto: true,
      rescued: false,
    });
    expect(linux({ gpuBackend: 'auto', gpuBackendToAttempt: 'opengl' }).auto).toBe(true);
    expect(linux({})).toMatchObject({ auto: true });
    for (const explicit of [
      linux({ gpuBackend: 'vulkan' }),
      linux({ gpuBackend: 'opengl' }),
      linux({ gpuBackend: 'auto' }, { [GPU_BACKEND_ENV]: 'vulkan' }),
      linux({ gpuBackend: 'auto' }, { [GPU_BACKEND_ENV]: 'opengl' }),
      linux({ gpuBackend: 'auto' }, { WOC_DISABLE_GPU_FORCE: '1' }),
    ]) {
      expect(explicit).toMatchObject({ ladder: true, auto: false, rescued: false });
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

  it('keeps the rarer cadence when the proof is not ABOVE the attempt', () => {
    // The machine whose Vulkan dies every time: the rescue chain ends on OpenGL,
    // that child runs healthy and writes an `opengl` proof, and the memory
    // settles on opengl. A proof at the attempt says nothing about the climb, so
    // reading "any proof" as the frequent cadence cost this machine a rescue
    // relaunch every ten launches for good.
    const settled = {
      gpuBackend: 'auto',
      gpuBackendToAttempt: 'opengl',
      gpuBackendProof: proof('opengl'),
      launchesSinceBackendReprobe: REPROBE_HIGHER_BACKEND_EVERY_LAUNCHES,
    };
    expect(linux(settled).rung).toBe('opengl');
    expect(linux(settled).reprobed).toBe(false);
    const due = { ...settled, launchesSinceBackendReprobe: REPROBE_WITHOUT_PROOF_EVERY_LAUNCHES };
    expect(linux(due).rung).toBe('vulkan-plain');
    expect(linux(due).reprobed).toBe(true);
    expect(linux(due).reason).not.toContain('proven');
    // Same with a proof AT the attempt one rung up.
    const plain = {
      ...settled,
      gpuBackendToAttempt: 'vulkan-plain',
      gpuBackendProof: proof('vulkan-plain'),
    };
    expect(linux(plain).reprobed).toBe(false);
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
    // A rescued child knows it is one, and inherits the MODE of the chain it
    // prolongs: an explicit chain stays out of the memory down to its last child.
    expect(linux({ gpuBackend: 'auto' }, env)).toMatchObject({ rescued: true, auto: true });
    expect(linux({ gpuBackend: 'vulkan' }, env)).toMatchObject({ rescued: true, auto: false });
    expect(linux({ gpuBackend: 'auto' }, { ...env, [GPU_BACKEND_ENV]: 'vulkan' })).toMatchObject({
      rescued: true,
      auto: false,
    });
    expect(linux({ gpuBackend: 'auto' }, { ...env, WOC_DISABLE_GPU_FORCE: '1' }).auto).toBe(false);
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
      ladder: true,
      auto: true,
      rescued: false,
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
      ladder: true,
      auto: true,
      rescued: false,
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
      ladder: false,
      auto: false,
      rescued: false,
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

describe('shouldRescueMissingGpu', () => {
  const at = (rung: string, hardwareWebgl?: boolean) =>
    shouldRescueMissingGpu({ rung, hardwareWebgl });

  it('rescues a Vulkan rung that never got a GPU at all', () => {
    // The gap this closes: the other two triggers both need the GPU process to
    // have LIVED (one watches it die, the other reads the renderer the page
    // reports). A Vulkan rung with no usable driver never starts one, so it
    // cannot die and nothing can report, and the ladder stayed on the rung that
    // failed while the player looked at a page that could not make a context.
    expect(at('vulkan-parallel-compile', false)).toBe(true);
    expect(at('vulkan-plain', false)).toBe(true);
  });

  it('does not fire from the bottom rung: there is nothing below it to try', () => {
    // A machine with no GPU at all stops here rather than looping, and OpenGL
    // carries none of our switches, so there is nothing of ours to blame.
    expect(at('opengl', false)).toBe(false);
  });

  it('does not fire while there IS hardware WebGL', () => {
    for (const rung of GPU_BACKEND_RUNGS) expect(at(rung, true)).toBe(false);
  });

  it('does not fire on an unknown reading, or a rung off the ladder', () => {
    // The status could not be read: absence of evidence is not evidence, and
    // rescuing on it would step a healthy machine down for a failed API call.
    expect(at('vulkan-parallel-compile', undefined)).toBe(false);
    expect(at('nonsense', false)).toBe(false);
    expect(at('', false)).toBe(false);
  });
});

describe('requestedBackendUnavailable', () => {
  const at = (setting: string, boundRung: string, judged = true) =>
    requestedBackendUnavailable({ setting, judged, boundRung });

  it('survives the rescue chain, because it reads the SETTING not the launch', () => {
    // The regression this exists for: a rescue chain ends on a process whose own
    // launch SUCCEEDED (it asked for opengl and got it). Comparing against that
    // launch's rung went quiet on exactly the machine the message is for, so a
    // player who picked Vulkan, watched three processes try, and ended on OpenGL
    // was told nothing at all.
    expect(at('vulkan', 'opengl')).toBe(true);
  });

  it('says nothing while Vulkan IS what is running, whichever Vulkan rung', () => {
    // The picker offers Auto, Vulkan and OpenGL: a session on vulkan-plain is the
    // Vulkan the player asked for, and only the ANGLE feature they never picked
    // is missing. "Unable to enable Vulkan" there would be false.
    expect(at('vulkan', 'vulkan-parallel-compile')).toBe(false);
    expect(at('vulkan', 'vulkan-plain')).toBe(false);
  });

  it('says nothing on Auto: the player chose nothing to fall short of', () => {
    for (const rung of GPU_BACKEND_RUNGS) expect(at('auto', rung)).toBe(false);
  });

  it('says nothing for a player who picked OpenGL and got it', () => {
    expect(at('opengl', 'opengl')).toBe(false);
  });

  it('says nothing before the launch is judged, or on a rung off the ladder', () => {
    // Unjudged means the reading is the rung that was ASKED for, which would make
    // every Vulkan launch announce its own failure for the first second.
    expect(at('vulkan', 'opengl', false)).toBe(false);
    expect(at('vulkan', '')).toBe(false);
    expect(at('vulkan', 'nonsense')).toBe(false);
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

  it('holds the streak at the threshold at the bottom rung, never counting past it', () => {
    // A machine that keeps dying on OpenGL has nowhere to go; the stored value
    // stays readable rather than growing for the life of the profile, and a
    // death that changes nothing writes nothing.
    const memory = {
      gpuBackend: 'auto',
      gpuBackendToAttempt: 'opengl',
      consecutiveGpuLaunchCrashes: MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES,
    };
    expect(demoteAfterRepeatedCrashes({ prefs: memory, rung: 'opengl' })).toBeNull();
    expect(
      demoteAfterRepeatedCrashes({
        prefs: { ...memory, consecutiveGpuLaunchCrashes: MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES + 5 },
        rung: 'opengl',
      }),
    ).toEqual({ consecutiveGpuLaunchCrashes: MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES });
  });
});

describe('gpuBackendMemoryAfterHealthySession', () => {
  it('writes the first proof there ever was, and clears the streak', () => {
    const next = gpuBackendMemoryAfterHealthySession({
      prefs: { gpuBackend: 'auto', consecutiveGpuLaunchCrashes: 2 },
      rung: 'vulkan-plain',
      appVersion: VERSION,
      gpuAdapter: ADAPTER,
      rescued: false,
    });
    expect(next).toEqual({
      gpuBackendToAttempt: 'vulkan-plain',
      consecutiveGpuLaunchCrashes: 0,
      gpuBackendProof: { backend: 'vulkan-plain', appVersion: VERSION, gpuAdapter: ADAPTER },
    });
  });

  it('lets a RESCUED child write the proof it earned, and nothing else', () => {
    // Its parent's death already counted against the attempt; the child runs a
    // rung the parent chose. Writing the attempt here demoted Auto on the very
    // first death (through the child rather than the counter) and cleared the
    // streak the parent had just started, so the threshold was unreachable.
    const first = gpuBackendMemoryAfterHealthySession({
      prefs: { gpuBackend: 'auto', consecutiveGpuLaunchCrashes: 1 },
      rung: 'vulkan-plain',
      appVersion: VERSION,
      gpuAdapter: ADAPTER,
      rescued: true,
    });
    expect(first).toEqual({ gpuBackendProof: proof('vulkan-plain') });
    // Nothing to write when the stored proof already sits higher on this machine.
    expect(
      gpuBackendMemoryAfterHealthySession({
        prefs: { gpuBackend: 'auto', gpuBackendProof: proof('vulkan-parallel-compile') },
        rung: 'opengl',
        appVersion: VERSION,
        gpuAdapter: ADAPTER,
        rescued: true,
      }),
    ).toBeNull();
  });

  it('keeps the proof across backends of the SAME adapter: the key is not the renderer string', () => {
    // The ANGLE string names the backend ("Vulkan 1.4.312" on one launch, "OpenGL
    // 4.5.0" on the next, same card), so keying on it read a rescue that ended on
    // OpenGL as another machine and replaced the top-rung proof.
    const next = gpuBackendMemoryAfterHealthySession({
      prefs: { gpuBackend: 'auto', gpuBackendProof: proof('vulkan-parallel-compile') },
      rung: 'opengl',
      appVersion: VERSION,
      gpuAdapter: ADAPTER,
      rescued: false,
    });
    expect(next).not.toHaveProperty('gpuBackendProof');
    // An unknown adapter (getGPUInfo listed none) reads as the same machine, on
    // either side: the app version alone decides.
    for (const [stored, seen] of [
      ['', ADAPTER],
      [ADAPTER, ''],
      ['', ''],
    ]) {
      expect(
        gpuBackendMemoryAfterHealthySession({
          prefs: {
            gpuBackend: 'auto',
            gpuBackendProof: proof('vulkan-parallel-compile', VERSION, stored),
          },
          rung: 'opengl',
          appVersion: VERSION,
          gpuAdapter: seen,
          rescued: false,
        }),
      ).not.toHaveProperty('gpuBackendProof');
    }
  });

  it('raises the proof when a higher rung proves out', () => {
    const next = gpuBackendMemoryAfterHealthySession({
      prefs: { gpuBackend: 'auto', gpuBackendProof: proof('vulkan-plain') },
      rung: 'vulkan-parallel-compile',
      appVersion: VERSION,
      gpuAdapter: ADAPTER,
      rescued: false,
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
      gpuAdapter: ADAPTER,
      rescued: false,
    });
    expect(next).toEqual({ gpuBackendToAttempt: 'opengl', consecutiveGpuLaunchCrashes: 0 });
    expect(next).not.toHaveProperty('gpuBackendProof');
  });

  it('REPLACES a proof that describes another machine, even with a lower rung', () => {
    // A different adapter means the old proof is about hardware that is no longer
    // here; keeping it would aim the climb at a rung this machine cannot run.
    const stored = proof('vulkan-parallel-compile', VERSION, OTHER_ADAPTER);
    const next = gpuBackendMemoryAfterHealthySession({
      prefs: { gpuBackend: 'auto', gpuBackendProof: stored },
      rung: 'opengl',
      appVersion: VERSION,
      gpuAdapter: ADAPTER,
      rescued: false,
    });
    expect(next?.gpuBackendProof).toEqual({
      backend: 'opengl',
      appVersion: VERSION,
      gpuAdapter: ADAPTER,
    });
  });

  it('replaces a proof from another app version the same way', () => {
    const next = gpuBackendMemoryAfterHealthySession({
      prefs: { gpuBackend: 'auto', gpuBackendProof: proof('vulkan-parallel-compile', '0.40.0') },
      rung: 'vulkan-plain',
      appVersion: VERSION,
      gpuAdapter: ADAPTER,
      rescued: false,
    });
    expect(next?.gpuBackendProof).toEqual(proof('vulkan-plain'));
  });

  it('answers null for a rung that is not on the ladder', () => {
    expect(
      gpuBackendMemoryAfterHealthySession({
        prefs: {},
        rung: 'nonsense',
        appVersion: VERSION,
        gpuAdapter: ADAPTER,
        rescued: false,
      }),
    ).toBeNull();
  });
});

describe('launchCounterAfterAutoLaunch', () => {
  const climb = { auto: true, rescued: false, reprobed: true } as never;
  const plain = { auto: true, rescued: false, reprobed: false } as never;

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

  it('does not count an explicit launch, nor a rescued child', () => {
    // Explicit: the memory is not its business (the launch's flag, not the
    // setting, which reads Auto under an env override). Rescued: a chain is one
    // launch to the player, and a re-probe's zero used to be followed at once
    // by its rescued child's one.
    const explicit = { auto: false, rescued: false, reprobed: false } as never;
    const rescuedChild = { auto: true, rescued: true, reprobed: false } as never;
    for (const launch of [explicit, rescuedChild]) {
      expect(
        launchCounterAfterAutoLaunch({
          prefs: { gpuBackend: 'auto', launchesSinceBackendReprobe: 4 },
          launch,
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

describe('backendDidNotBind', () => {
  it('fires only when a Vulkan rung bound something that is not Vulkan', () => {
    expect(backendDidNotBind('vulkan-parallel-compile', 'opengl')).toBe(true);
    expect(backendDidNotBind('vulkan-plain', 'opengl')).toBe(true);
    expect(backendDidNotBind('opengl', 'opengl')).toBe(false);
  });

  it('does NOT fire on a parallel-compile launch that bound plain Vulkan', () => {
    // The page reported the extension absent: the window is healthy Vulkan, and
    // re-exec'ing it onto plain Vulkan would kill it to land on the backend it is
    // already on. The missing feature is the memory's business, never a rescue.
    expect(backendDidNotBind('vulkan-parallel-compile', 'vulkan-plain')).toBe(false);
    expect(backendDidNotBind('vulkan-plain', 'vulkan-parallel-compile')).toBe(false);
  });

  it('answers false for anything off the ladder', () => {
    expect(backendDidNotBind('vulkan-plain', 'nonsense')).toBe(false);
    expect(backendDidNotBind('nonsense', 'opengl')).toBe(false);
    expect(backendDidNotBind(undefined, 'opengl')).toBe(false);
  });
});

describe('activeGpuAdapterKey', () => {
  it('names the ACTIVE adapter by vendor and device id, whatever else is listed', () => {
    expect(
      activeGpuAdapterKey([
        { vendorId: '0x8086', deviceId: '0x7d67', active: false },
        { vendorId: '0x10de', deviceId: '0x2204', active: true },
      ]),
    ).toBe(ADAPTER);
  });

  it('answers empty with no active adapter, no list, or ids that are not strings', () => {
    expect(activeGpuAdapterKey([{ vendorId: '0x10de', deviceId: '0x2204', active: false }])).toBe(
      '',
    );
    expect(activeGpuAdapterKey([])).toBe('');
    expect(activeGpuAdapterKey(undefined)).toBe('');
    expect(activeGpuAdapterKey([{ vendorId: 4318, deviceId: 8708, active: true }])).toBe('');
    // The device summary pads a missing id to 0x0000: two cards with no ids must
    // not read as the same one, so that reads as unknown too.
    expect(activeGpuAdapterKey([{ vendorId: '0x0000', deviceId: '0x0000', active: true }])).toBe(
      '',
    );
    expect(activeGpuAdapterKey([{ vendorId: '0x10de', deviceId: '0x0000', active: true }])).toBe(
      '0x10de:',
    );
  });
});

describe('the memory across one launch-time death and its rescue chain', () => {
  // The composite the unit pins missed: a parent on the top rung dies once, the
  // rescued child runs healthy. The attempt and the streak must be where the
  // PARENT left them, or one death still demotes (through the child).
  function merge(memory: Record<string, unknown>, next: Record<string, unknown> | null) {
    return next ? { ...memory, ...next } : memory;
  }

  it('leaves one death as one death: the child neither demotes nor clears the streak', () => {
    let memory: Record<string, unknown> = { gpuBackend: 'auto' };
    const parent = linux(memory);
    expect(parent).toMatchObject({ rung: TOP_GPU_BACKEND_RUNG, auto: true, rescued: false });
    memory = merge(memory, launchCounterAfterAutoLaunch({ prefs: memory, launch: parent }));
    // The parent's GPU process dies at launch: its death counts, once.
    memory = merge(memory, demoteAfterRepeatedCrashes({ prefs: memory, rung: parent.rung }));
    expect(memory.consecutiveGpuLaunchCrashes).toBe(1);
    // The rescued child comes up on plain Vulkan and runs healthy.
    const child = linux(memory, { [GPU_BACKEND_RESCUE_ENV]: 'vulkan-plain' });
    expect(child).toMatchObject({ rung: 'vulkan-plain', auto: true, rescued: true });
    expect(launchCounterAfterAutoLaunch({ prefs: memory, launch: child })).toBeNull();
    memory = merge(
      memory,
      gpuBackendMemoryAfterHealthySession({
        prefs: memory,
        rung: child.rung,
        appVersion: VERSION,
        gpuAdapter: ADAPTER,
        rescued: child.rescued,
      }),
    );
    expect(memory.gpuBackendToAttempt).toBeUndefined();
    expect(memory.consecutiveGpuLaunchCrashes).toBe(1);
    expect(memory.gpuBackendProof).toEqual(proof('vulkan-plain'));
    // The next launch is the top rung again, and only the threshold steps it down.
    expect(linux(memory).rung).toBe(TOP_GPU_BACKEND_RUNG);
    for (let i = 1; i < MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES; i++) {
      memory = merge(
        memory,
        demoteAfterRepeatedCrashes({ prefs: memory, rung: TOP_GPU_BACKEND_RUNG }),
      );
    }
    expect(memory).toMatchObject({
      gpuBackendToAttempt: 'vulkan-plain',
      consecutiveGpuLaunchCrashes: 0,
    });
  });

  it('re-probes a stale proof on every launch until one session runs the healthy minute', () => {
    // The corner the stale-proof arm accepts: the app version changed, the
    // higher rung still dies, and the player quits inside the minute, so no
    // fresh proof is written and the next launch re-probes again, whatever
    // the launch counter says. One healthy minute on ANY rung (the rescued
    // child included) writes the proof for this version and ends it.
    let memory: Record<string, unknown> = {
      gpuBackend: 'auto',
      gpuBackendToAttempt: 'opengl',
      gpuBackendProof: proof('vulkan-parallel-compile', '0.40.0'),
    };
    for (let launchNo = 0; launchNo < 3; launchNo++) {
      const parent = linux(memory);
      expect(parent).toMatchObject({ rung: 'vulkan-plain', reprobed: true });
      memory = merge(memory, launchCounterAfterAutoLaunch({ prefs: memory, launch: parent }));
      // Dies above the remembered rung: counts nothing.
      expect(demoteAfterRepeatedCrashes({ prefs: memory, rung: parent.rung })).toBeNull();
      const child = linux(memory, { [GPU_BACKEND_RESCUE_ENV]: 'opengl' });
      expect(child).toMatchObject({ rung: 'opengl', rescued: true });
      // Quit inside the minute: nothing written.
    }
    // A re-probe zeroes the counter, and zero on a fresh memory is no write.
    expect(memory.launchesSinceBackendReprobe ?? 0).toBe(0);
    // The rescued child runs a full minute on OpenGL.
    memory = merge(
      memory,
      gpuBackendMemoryAfterHealthySession({
        prefs: memory,
        rung: 'opengl',
        appVersion: VERSION,
        gpuAdapter: ADAPTER,
        rescued: true,
      }),
    );
    expect(memory.gpuBackendProof).toEqual(proof('opengl'));
    // A proof this version knows, at the attempt: the rare cadence, no re-probe.
    const settled = linux(memory);
    expect(settled).toMatchObject({ rung: 'opengl', reprobed: false });
    expect(
      linux({ ...memory, launchesSinceBackendReprobe: REPROBE_HIGHER_BACKEND_EVERY_LAUNCHES })
        .reprobed,
    ).toBe(false);
  });

  it('counts a re-probe chain on the rung it lands back on: the remembered one', () => {
    // A climb dies above the attempt (nothing to count: that rung was not the
    // memory's guess), and its rescued child lands ON the attempt. If that child
    // dies too, the remembered rung just failed, and the shell counts it: the
    // rung compare inside demoteAfterRepeatedCrashes is what tells the two
    // children apart, so the shell needs no rescued-child guard of its own.
    let memory: Record<string, unknown> = {
      gpuBackend: 'auto',
      gpuBackendToAttempt: 'vulkan-plain',
      gpuBackendProof: proof('vulkan-parallel-compile'),
      launchesSinceBackendReprobe: REPROBE_HIGHER_BACKEND_EVERY_LAUNCHES,
      consecutiveGpuLaunchCrashes: 0,
    };
    const climb = linux(memory);
    expect(climb).toMatchObject({ rung: 'vulkan-parallel-compile', reprobed: true, auto: true });
    expect(demoteAfterRepeatedCrashes({ prefs: memory, rung: climb.rung })).toBeNull();
    const child = linux(memory, { [GPU_BACKEND_RESCUE_ENV]: 'vulkan-plain' });
    expect(child).toMatchObject({ rung: 'vulkan-plain', rescued: true, auto: true });
    memory = merge(memory, demoteAfterRepeatedCrashes({ prefs: memory, rung: child.rung }));
    expect(memory.consecutiveGpuLaunchCrashes).toBe(1);
    // Whereas a parent's OWN death on the attempt, then its child one rung
    // below, is one death: the child's rung is not the attempt.
    const parent = linux({ gpuBackend: 'auto' });
    let fresh: Record<string, unknown> = { gpuBackend: 'auto' };
    fresh = merge(fresh, demoteAfterRepeatedCrashes({ prefs: fresh, rung: parent.rung }));
    expect(demoteAfterRepeatedCrashes({ prefs: fresh, rung: 'vulkan-plain' })).toBeNull();
    expect(fresh.consecutiveGpuLaunchCrashes).toBe(1);
  });

  it('settles a machine with no Vulkan on OpenGL, then re-probes on the RARE cadence only', () => {
    let memory: Record<string, unknown> = { gpuBackend: 'auto' };
    // Every Vulkan rung dies; the chain ends on OpenGL, whose child proves opengl.
    const chain = () => {
      const parent = linux(memory);
      memory = merge(memory, launchCounterAfterAutoLaunch({ prefs: memory, launch: parent }));
      memory = merge(memory, demoteAfterRepeatedCrashes({ prefs: memory, rung: parent.rung }));
      const child = linux(memory, { [GPU_BACKEND_RESCUE_ENV]: 'opengl' });
      memory = merge(
        memory,
        gpuBackendMemoryAfterHealthySession({
          prefs: memory,
          rung: 'opengl',
          appVersion: VERSION,
          gpuAdapter: ADAPTER,
          rescued: child.rescued,
        }),
      );
    };
    for (let i = 0; i < MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES * 2; i++) chain();
    expect(memory).toMatchObject({
      gpuBackendToAttempt: 'opengl',
      gpuBackendProof: proof('opengl'),
    });
    // From here Auto runs OpenGL, and the opengl proof does not earn the frequent
    // climb: the first re-probe comes when the counter reaches the RARE cadence.
    const counted = memory.launchesSinceBackendReprobe as number;
    let launches = 0;
    for (;;) {
      const launch = linux(memory);
      if (launch.reprobed) break;
      launches++;
      memory = merge(memory, launchCounterAfterAutoLaunch({ prefs: memory, launch }));
    }
    expect(launches).toBe(REPROBE_WITHOUT_PROOF_EVERY_LAUNCHES - counted);
    expect(launches).toBeGreaterThan(REPROBE_HIGHER_BACKEND_EVERY_LAUNCHES);
  });
});

describe('relaunchOnLowerBackend', () => {
  /** A child handle with Node's event surface: the test decides whether and
   *  when it reports 'spawn' or 'error', as a real ChildProcess does, later. */
  function fakeSpawn() {
    const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const children: EventEmitter[] = [];
    const unref = vi.fn();
    const spawn = vi.fn((command: string, args: string[], options?: unknown) => {
      calls.push({ command, args, options: options as Record<string, unknown> });
      const child = Object.assign(new EventEmitter(), { unref });
      children.push(child);
      return child;
    });
    return { spawn, calls, children, unref };
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
    expect(info).toHaveBeenCalledWith(
      '[gpu] the GPU process died on vulkan-parallel-compile; starting a relaunch on vulkan-plain',
      { spawnTarget: '/usr/bin/world-of-claudecraft' },
    );
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

  it('runs onSpawned only once a child HAS spawned, and never on a refused or failed spawn', () => {
    // The shell hands the single-instance lock over there and exits; doing
    // either while this process keeps running (a refused rescue, a spawn that
    // threw) would let the next launch open a second game beside it, and
    // doing it before the child exists would leave the player with nothing.
    const { spawn, calls, children } = fakeSpawn();
    const order: string[] = [];
    const onSpawned = vi.fn(() => order.push(`spawned:${calls.length}`));
    const base = { env: {}, argv: [], execPath: '/bin/app', spawn, onSpawned };
    expect(relaunchOnLowerBackend(base, 'vulkan-plain')).toBe(true);
    // spawn() returning is not the child: nothing until its 'spawn' event.
    expect(order).toEqual([]);
    children[0]?.emit('spawn');
    expect(order).toEqual(['spawned:1']);
    // No lower rung, a spent chain: not called.
    expect(relaunchOnLowerBackend(base, 'opengl')).toBe(false);
    expect(
      relaunchOnLowerBackend(
        { ...base, env: { [GPU_BACKEND_RESCUE_ENV]: 'opengl' } },
        'vulkan-plain',
      ),
    ).toBe(false);
    // A spawn that throws: the process keeps running, so it keeps its lock.
    const throwing = vi.fn(() => {
      throw new Error('ENOENT');
    });
    expect(
      relaunchOnLowerBackend({ ...base, spawn: throwing as never, log: {} }, 'vulkan-plain'),
    ).toBe(false);
    expect(onSpawned).toHaveBeenCalledTimes(1);
  });

  it('reports a child that never started through onSpawnFailed, and never through onSpawned', () => {
    // The async failure: spawn() returned a handle, then the target could not
    // be started (ENOENT on an AppImage swapped under the running session).
    // Node reports it as an 'error' event; unheard, it is an uncaught
    // exception in the one process still running the game.
    const { spawn, children } = fakeSpawn();
    const onSpawned = vi.fn();
    const onSpawnFailed = vi.fn();
    const warn = vi.fn();
    const result = relaunchOnLowerBackend(
      { env: {}, argv: [], execPath: '/bin/app', spawn, onSpawned, onSpawnFailed, log: { warn } },
      'vulkan-plain',
    );
    expect(result).toBe(true);
    const failure = new Error('spawn ENOENT');
    expect(() => children[0]?.emit('error', failure)).not.toThrow();
    expect(onSpawned).not.toHaveBeenCalled();
    expect(onSpawnFailed).toHaveBeenCalledWith(failure);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('never started'), failure);
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

  it('wires the child events to the callers: spawn to onSpawned, error to onSpawnFailed', () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const onSpawned = vi.fn();
    const onSpawnFailed = vi.fn();
    spawnDetachedSelf({
      env: {},
      argv: [],
      execPath: '/bin/woc',
      spawn: () => child,
      onSpawned,
      onSpawnFailed,
    });
    expect(onSpawned).not.toHaveBeenCalled();
    child.emit('spawn');
    expect(onSpawned).toHaveBeenCalledWith('/bin/woc');
    const failure = new Error('spawn EACCES');
    child.emit('error', failure);
    expect(onSpawnFailed).toHaveBeenCalledWith(failure, '/bin/woc');
    // Both are once: a second event is not a second rescue.
    child.emit('spawn');
    expect(onSpawned).toHaveBeenCalledTimes(1);
  });

  it('hears an error event with no callback given, rather than letting it throw', () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    spawnDetachedSelf({ env: {}, argv: [], execPath: '/bin/woc', spawn: () => child });
    expect(() => child.emit('error', new Error('spawn ENOENT'))).not.toThrow();
  });

  it('tolerates a child handle without unref and propagates a spawn failure', () => {
    // A handle with no event surface fires neither callback: nothing is
    // known about that child, and nothing is claimed.
    const onSpawned = vi.fn();
    const onSpawnFailed = vi.fn();
    expect(
      spawnDetachedSelf({
        env: {},
        argv: [],
        execPath: '/bin/woc',
        spawn: () => ({}),
        onSpawned,
        onSpawnFailed,
      }),
    ).toBe('/bin/woc');
    expect(onSpawned).not.toHaveBeenCalled();
    expect(onSpawnFailed).not.toHaveBeenCalled();
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
