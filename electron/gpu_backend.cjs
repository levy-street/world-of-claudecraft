'use strict';

// The Linux GPU backend lever: "try Vulkan once, verify, remember".
//
// On Linux, Chromium's default WebGL backend is ANGLE over OpenGL, where every shader
// program link resolves on the single GPU-process thread that presents frames: 100 to
// 320 ms hitches per program, which the game cannot schedule around. On ANGLE's Vulkan
// backend a cold link is about 10 ms and the problem disappears (measured on an RTX 3090
// and on an Intel iGPU). Windows already runs D3D11 and macOS Metal, so only Linux needs
// the change. Vulkan is forced with the three Chromium switches below and nothing else:
// no --ignore-gpu-blocklist, no --disable-gpu-driver-bug-workarounds (both widen the
// blast radius on drivers the blocklist exists for), and never --disable-vulkan-surface
// (a headless-only switch that breaks presentation in a windowed shell).
//
// The risk: a forced Vulkan backend has NO OpenGL fallback. On a machine without a
// working Vulkan driver Chromium lands on SwiftShader (software rendering) and the game
// crawls. So with the default 'auto' setting the first launch is a TRIAL: the switches go
// on, the shell reads the renderer the GPU process actually bound (main.cjs logGpuStatus,
// app.getGPUInfo('complete')), records the verdict in the prefs store, and when the trial
// failed relaunches itself on the default backend. Every later launch reads the stored
// verdict and never repeats the trial until the player picks 'auto' again.
//
// Pure functions with injected deps, exercised by tests/electron_gpu_backend.test.ts;
// main.cjs is the only caller and wires process.platform, process.env, the prefs and app.
// The self-relaunch spawn lives in electron/gpu_preference.cjs (spawnDetachedSelf), the
// one shell module sanctioned for process execution.

const { spawnDetachedSelf } = require('./gpu_preference.cjs');

/** What the player can ask for (Options > Interface); 'auto' is the shipped default. */
const GPU_BACKEND_SETTINGS = ['auto', 'vulkan', 'opengl'];

/** What the last Vulkan trial concluded; 'untested' arms exactly one trial. */
const VULKAN_VERDICTS = ['untested', 'ok', 'failed'];

/** The Chromium switches that force ANGLE's Vulkan backend, as [name, value] pairs. */
const VULKAN_BACKEND_SWITCHES = [
  ['use-gl', 'angle'],
  ['use-angle', 'vulkan'],
  ['enable-features', 'Vulkan,DefaultANGLEVulkan,VulkanFromANGLE'],
];

/** Launch-time override, never verified or relaunched: 'vulkan' or 'opengl'. */
const GPU_BACKEND_ENV = 'WOC_GPU_BACKEND';

/**
 * Set on the child spawned after a failed trial. Belt and braces over the stored 'failed'
 * verdict: a marked process never trials (so it can never relaunch again), even when the
 * verdict could not be written to disk, so a loop is impossible whatever the prefs say.
 */
const VULKAN_TRIAL_RELAUNCH_MARKER = 'WOC_VULKAN_TRIAL_RELAUNCHED';

const defaultLaunch = (reason) => ({ backend: 'default', trial: false, reason });
const vulkanLaunch = (trial, reason) => ({ backend: 'vulkan', trial, reason });

/**
 * Which backend THIS launch runs on, and whether it is a trial whose outcome must be
 * judged and stored. Decision table, first match wins:
 * - not Linux: the platform default (D3D11 on Windows, Metal on macOS);
 * - WOC_GPU_BACKEND=opengl | vulkan: that backend, explicit, never verified (it wins
 *   over the rescue below, so Vulkan can be tried with every other GPU lever off);
 * - WOC_DISABLE_GPU_FORCE=1: default, no trial (the documented no-GPU-lever rescue);
 * - setting 'opengl' | 'vulkan': that backend, explicit, never verified;
 * - setting 'auto': the stored verdict decides ('failed' stays on the default, 'ok'
 *   forces Vulkan, 'untested' forces Vulkan as a TRIAL), except that a process the
 *   failed-trial relaunch spawned (marker present) never trials again.
 */
function decideGpuBackendLaunch({ platform, env, prefs }) {
  if (platform !== 'linux') return defaultLaunch('platform default');
  const environment = env ?? {};
  const override = environment[GPU_BACKEND_ENV];
  if (override === 'opengl') return defaultLaunch(`${GPU_BACKEND_ENV}=opengl`);
  if (override === 'vulkan') return vulkanLaunch(false, `${GPU_BACKEND_ENV}=vulkan`);
  if (environment.WOC_DISABLE_GPU_FORCE === '1') return defaultLaunch('WOC_DISABLE_GPU_FORCE=1');
  const setting = prefs?.gpuBackend;
  if (setting === 'opengl') return defaultLaunch('setting opengl');
  if (setting === 'vulkan') return vulkanLaunch(false, 'setting vulkan');
  const verdict = prefs?.vulkanVerdict;
  if (verdict === 'failed') return defaultLaunch('auto, last Vulkan trial failed');
  if (verdict === 'ok') return vulkanLaunch(false, 'auto, Vulkan trial passed');
  if (environment[VULKAN_TRIAL_RELAUNCH_MARKER] === '1') {
    return defaultLaunch('auto, relaunched after a failed Vulkan trial');
  }
  return vulkanLaunch(true, 'auto, Vulkan trial');
}

/**
 * Append the Vulkan switches for a 'vulkan' launch; nothing for 'default'. Must run
 * before app 'ready' (Chromium reads its command line there), which is why main.cjs calls
 * it at module scope right after the discrete-GPU force.
 */
function applyGpuBackendSwitches(app, launch) {
  if (launch?.backend !== 'vulkan') return;
  for (const [name, value] of VULKAN_BACKEND_SWITCHES) {
    app.commandLine.appendSwitch(name, value);
  }
}

/**
 * The trial's verdict from what the GPU process actually bound. 'ok' only when Chromium
 * does not report software rendering AND the renderer string names Vulkan AND is not the
 * SwiftShader device (whose own renderer string also says "Vulkan"); anything else,
 * including a missing renderer string, is 'failed'. Real strings the tests pin:
 *   ok:       "ANGLE (NVIDIA, Vulkan 1.4.312 (NVIDIA NVIDIA GeForce RTX 3090 (...)), NVIDIA)"
 *   software: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (...)), SwiftShader driver)"
 *   opengl:   "ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3090/PCIe/SSE2, OpenGL 4.5.0)"
 */
function judgeVulkanLaunch({ glRenderer, softwareRendering }) {
  if (softwareRendering === true) return 'failed';
  if (typeof glRenderer !== 'string' || glRenderer === '') return 'failed';
  const renderer = glRenderer.toLowerCase();
  if (!renderer.includes('vulkan')) return 'failed';
  if (renderer.includes('swiftshader')) return 'failed';
  return 'ok';
}

/**
 * Whether an app.getGPUInfo('complete') auxAttributes reading can judge the trial at all.
 * On Linux the GPU process can report a healthy Vulkan session (feature status
 * `vulkan: enabled_on`, WebGL on ANGLE Vulkan) while glRenderer is EMPTY, so an absent
 * string is "no evidence", never "failed": the verdict then waits for the renderer string
 * the game reports itself (desktop-report-gpu-renderer). Chromium's own softwareRendering
 * flag is evidence on its own (a failed trial), as is any non-empty renderer string.
 */
function hasGetGpuInfoEvidence(aux) {
  if (aux?.softwareRendering === true) return true;
  return typeof aux?.glRenderer === 'string' && aux.glRenderer !== '';
}

/**
 * Re-exec this process on the default backend after a failed trial: same binary (the
 * outer AppImage when running from one), same argv, detached, with the relaunch marker on
 * the child. Returns true when a child was spawned, in which case the caller exits this
 * process (app.exit(0)); false when the marker is already present (never relaunch twice,
 * whatever the prefs say) or when the spawn itself fails, in which case this process keeps
 * running on whatever renderer it has rather than leaving the player with nothing.
 */
function relaunchAfterFailedTrial(deps = {}) {
  const env = deps.env ?? process.env;
  const log = deps.log;
  if (env[VULKAN_TRIAL_RELAUNCH_MARKER] === '1') return false;
  const argv = deps.argv ?? process.argv.slice(1);
  try {
    const spawnTarget = spawnDetachedSelf({
      env: { ...env, [VULKAN_TRIAL_RELAUNCH_MARKER]: '1' },
      argv,
      execPath: deps.execPath ?? process.execPath,
      spawn: deps.spawn,
    });
    log?.info?.('[gpu] relaunching on the default GL backend after a failed Vulkan trial', {
      spawnTarget,
    });
    return true;
  } catch (err) {
    log?.warn?.('[gpu] could not relaunch after the failed Vulkan trial', err);
    return false;
  }
}

module.exports = {
  GPU_BACKEND_ENV,
  GPU_BACKEND_SETTINGS,
  VULKAN_BACKEND_SWITCHES,
  VULKAN_TRIAL_RELAUNCH_MARKER,
  VULKAN_VERDICTS,
  applyGpuBackendSwitches,
  decideGpuBackendLaunch,
  hasGetGpuInfoEvidence,
  judgeVulkanLaunch,
  relaunchAfterFailedTrial,
};
