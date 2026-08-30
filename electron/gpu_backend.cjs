'use strict';

// The Linux GPU backend lever: "run the best backend this machine has proven it can
// run, rescue the session when it dies, and climb back when the machine changes".
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
// The risk: a forced Vulkan backend has NO OpenGL fallback of its own. On a machine
// without a working Vulkan driver Chromium lands on SwiftShader and the game crawls, or
// the GPU process dies and the page is left blocked from WebGL for the rest of the
// session, which is a game that never renders. So the shell runs a LADDER of rungs, and
// two mechanisms that used to be one:
//
//   THE MEMORY answers "what should Auto start on". It is a guess that improves.
//   THE RESCUE answers "what do we do when the GPU process dies at launch". It runs in
//   EVERY mode, including an explicit player choice, because a player who picked Vulkan
//   on a machine that cannot run it must still get a game rather than a dead screen they
//   cannot click out of.
//
// Keeping them separate is what fixes the two defects of the verdict this replaces: one
// GPU-process death used to demote a healthy machine for good, and an explicit choice
// had no rescue at all.
//
// Pure functions with injected deps, exercised by tests/electron_gpu_backend.test.ts;
// main.cjs is the only caller and wires process.platform, process.env, the prefs and app.
// The self-relaunch spawn lives in electron/gpu_preference.cjs (spawnDetachedSelf), the
// one shell module sanctioned for process execution.

const { spawnDetachedSelf } = require('./gpu_preference.cjs');

/** What the player can ask for (Graphics > System); 'auto' is the shipped default. */
const GPU_BACKEND_SETTINGS = ['auto', 'vulkan', 'opengl'];

/**
 * The ladder, BEST FIRST. Index 0 is the top rung; a rung "below" another is later in
 * this list. Named for what each one actually is, so a stored value reads without a
 * decoder: 'vulkan-plain' is Vulkan WITHOUT the parallel-compile feature, which is a
 * materially different backend from the rung above it, not a variant of it.
 */
const GPU_BACKEND_RUNGS = ['vulkan-parallel-compile', 'vulkan-plain', 'opengl'];
const TOP_GPU_BACKEND_RUNG = GPU_BACKEND_RUNGS[0];

/** The Chromium switches that force ANGLE's Vulkan backend, as [name, value] pairs. */
const VULKAN_BACKEND_SWITCHES = [
  ['use-gl', 'angle'],
  ['use-angle', 'vulkan'],
  ['enable-features', 'Vulkan,DefaultANGLEVulkan,VulkanFromANGLE'],
];

/**
 * The ANGLE feature that exposes KHR_parallel_shader_compile on the Vulkan backend.
 * ANGLE gates the extension on `enableParallelCompileAndLink` (vk_caps_utils.cpp),
 * opt-in since it was introduced in 2023 and never flipped on by default, so a Vulkan
 * launch without it links every program synchronously on the GPU-process thread and
 * the renderer's whole async-compile policy (compileAsync, every gate) is inert.
 * Verified 2026-08-28 on Chrome 151 and Electron 43, NVIDIA and Intel: with the switch
 * the extension is listed and COMPLETION_STATUS_KHR answers false for 13 to 22 frames
 * before true on a heavy link; in the game the RTX 3090's Vulkan sweep stalls (3.4 s of
 * slow frames) vanished and the curtain lost 2.8 s. Still opt-in upstream, with one
 * rare GPU-process crash seen on Intel/Mesa, which is why it is its own rung.
 */
const VULKAN_PARALLEL_COMPILE_SWITCH = ['enable-angle-features', 'enableParallelCompileAndLink'];

/** Launch-time override, never judged and never remembered: 'vulkan' or 'opengl'. */
const GPU_BACKEND_ENV = 'WOC_GPU_BACKEND';

/**
 * Set on the child a rescue spawns, naming the rung that child must run, in full
 * (`vulkan-plain`, `opengl`). It wins over every other input including the player's own
 * setting: the parent watched the rung above it die seconds ago, so re-deciding from the
 * prefs would spawn the same death. Its presence is also what caps the chain: a rescue
 * may only ever go BELOW the marker it carries, and the ladder is three rungs deep.
 */
const GPU_BACKEND_RESCUE_ENV = 'WOC_GPU_BACKEND_RESCUED_TO';

/**
 * How many CONSECUTIVE launch-time GPU-process deaths on the attempted rung it takes to
 * step the memory down. Three, not one: the previous design demoted on a single death,
 * and a single death is exactly what a transient compositor or driver hiccup produces,
 * so a healthy machine walked itself down to the slowest backend and stayed there. A
 * choice with its reason, not a measurement.
 */
const MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES = 3;

/**
 * How many Auto launches between attempts to climb back, WITH a valid proof: something
 * on this machine used to work and stopped, so retrying often is worth one rescued
 * launch when it does not.
 */
const REPROBE_HIGHER_BACKEND_EVERY_LAUNCHES = 10;

/**
 * The same, with NO valid proof: this machine has never run the higher rung, so a retry
 * is a rescue relaunch spent on a machine that has told us the answer. Rare, but never
 * never: a driver does eventually get updated, and the app version does change.
 */
const REPROBE_WITHOUT_PROOF_EVERY_LAUNCHES = 50;

/**
 * How long a session must run, after the page has reported its renderer, before its rung
 * counts as PROVEN. Long enough that a launch-time death cannot slip past it (those land
 * within a second or two of the window appearing) and short enough that a player who
 * quits after one look still teaches the memory something. A choice with its reason.
 */
const SESSION_HEALTHY_AFTER_MS = 60_000;

const rungIndex = (rung) => GPU_BACKEND_RUNGS.indexOf(rung);

/** The rung one step down, or null at the bottom. */
function rungBelow(rung) {
  const at = rungIndex(rung);
  if (at < 0) return null;
  return GPU_BACKEND_RUNGS[at + 1] ?? null;
}

/** The rung one step up, or null at the top. */
function rungAbove(rung) {
  const at = rungIndex(rung);
  if (at <= 0) return null;
  return GPU_BACKEND_RUNGS[at - 1];
}

/** True when `rung` sits ABOVE `other` on the ladder (both must be real rungs). */
function isHigherRung(rung, other) {
  const a = rungIndex(rung);
  const b = rungIndex(other);
  return a >= 0 && b >= 0 && a < b;
}

/**
 * The launch a rung describes: which switches, the rung itself for the judge, and four
 * flags the shell keys its behavior off, so no caller has to parse `reason`:
 * - `ladder`: the rungs apply at all (Linux). Off it, nothing is rescued, counted or
 *   remembered, and a GPU-process death is only logged.
 * - `auto`: this launch belongs to the Auto MEMORY: it reads it and, once judged, writes
 *   it. False for every explicit input (the setting, WOC_GPU_BACKEND, the no-lever env),
 *   which are never remembered: explicit means the player decided, not that we learned
 *   something about the machine.
 * - `rescued`: a rescue spawned this process. It inherits `auto` from the chain it
 *   prolongs, but the ATTEMPT and the crash streak are the parent's to move: a rescued
 *   child that runs healthy writes the proof it earned and nothing else, otherwise one
 *   launch-time death would still walk Auto down a rung (through the child instead of
 *   the counter).
 * - `reprobed`: an Auto CLIMB (a rung above the remembered one, tried on the cadence);
 *   what the launch counter resets on, so it measures launches since the last attempt.
 */
function launchForRung(rung, reason, flags = {}) {
  return {
    backend: rung === 'opengl' ? 'default' : 'vulkan',
    parallel: rung === 'vulkan-parallel-compile',
    rung,
    reprobed: flags.reprobed === true,
    reason,
    ladder: flags.ladder !== false,
    auto: flags.auto === true,
    rescued: flags.rescued === true,
  };
}

/** A stored proof is only about THIS app version; a version change re-opens the ladder. */
function validProof(prefs, appVersion) {
  const proof = prefs?.gpuBackendProof;
  if (!proof || rungIndex(proof.backend) < 0) return null;
  if (typeof appVersion === 'string' && appVersion !== '' && proof.appVersion !== appVersion) {
    return null;
  }
  return proof;
}

/**
 * Which backend THIS launch runs on. Decision table, first match wins:
 * - not Linux: the platform default (D3D11 on Windows, Metal on macOS);
 * - the rescue marker: the rung the parent rescued to, ahead of everything, because the
 *   parent watched the rung above it die;
 * - WOC_GPU_BACKEND=opengl | vulkan: that backend, explicit (it wins over the no-lever
 *   rescue below, so Vulkan can be tried with every other GPU lever off);
 * - WOC_DISABLE_GPU_FORCE=1: OpenGL (the documented no-GPU-lever rescue);
 * - setting 'opengl' | 'vulkan': that rung, explicit; the memory is not read and not
 *   written, but the RESCUE still applies to this launch;
 * - setting 'auto': `gpuBackendToAttempt`, or the top rung when nothing is stored, with
 *   a periodic climb back up (see reprobe below).
 */
function decideGpuBackendLaunch({ platform, env, prefs, appVersion }) {
  if (platform !== 'linux') return launchForRung('opengl', 'platform default', { ladder: false });
  const environment = env ?? {};
  const explicit = explicitGpuBackendLaunch(environment, prefs);
  const rescued = environment[GPU_BACKEND_RESCUE_ENV];
  if (rungIndex(rescued) >= 0) {
    // The chain's mode is decided by what the PARENT ran on; the marker only names the
    // rung. An explicit chain stays out of the memory down to its last child.
    return launchForRung(rescued, `rescued to ${rescued}`, {
      rescued: true,
      auto: explicit === null,
    });
  }
  if (explicit) return explicit;
  const auto = { auto: true };

  const stored = prefs?.gpuBackendToAttempt;
  const attempt = rungIndex(stored) >= 0 ? stored : TOP_GPU_BACKEND_RUNG;
  if (attempt === TOP_GPU_BACKEND_RUNG) return launchForRung(attempt, 'auto, best rung', auto);

  // The climb back. Two cadences, and the proof is what tells them apart: a machine that
  // once ran a HIGHER rung than the one remembered is worth retrying often, a machine
  // that never has is not. A proof at or below the attempt (a rescued child proving the
  // bottom rung on a machine whose Vulkan dies every time) says nothing about the climb,
  // so it keeps the rare cadence.
  const proof = validProof(prefs, appVersion);
  const staleProof =
    !!prefs?.gpuBackendProof && !proof && rungIndex(prefs.gpuBackendProof.backend) >= 0;
  const provenAbove = proof !== null && isHigherRung(proof.backend, attempt);
  const every = provenAbove
    ? REPROBE_HIGHER_BACKEND_EVERY_LAUNCHES
    : REPROBE_WITHOUT_PROOF_EVERY_LAUNCHES;
  const since = Number.isInteger(prefs?.launchesSinceBackendReprobe)
    ? prefs.launchesSinceBackendReprobe
    : 0;
  // An app version the proof does not know is a changed environment: re-probe now
  // rather than waiting out a counter that describes the old one. The proof stays
  // stale until a session runs SESSION_HEALTHY_AFTER_MS, so a machine whose higher
  // rung dies re-probes (and takes the rescue) on every launch a player quits inside
  // that minute; one full minute on any rung writes a fresh proof and ends it.
  if (!staleProof && since < every) return launchForRung(attempt, 'auto, remembered rung', auto);
  const target = provenAbove ? proof.backend : rungAbove(attempt);
  if (!target) return launchForRung(attempt, 'auto, remembered rung', auto);
  return launchForRung(
    target,
    provenAbove ? `auto, re-probing the proven ${target}` : `auto, re-probing ${target}`,
    { ...auto, reprobed: true },
  );
}

/**
 * The explicit inputs, first match wins, or null when the launch is Auto's to decide.
 * None of these is ever judged into the memory or remembered.
 */
function explicitGpuBackendLaunch(environment, prefs) {
  const override = environment[GPU_BACKEND_ENV];
  if (override === 'opengl') return launchForRung('opengl', `${GPU_BACKEND_ENV}=opengl`);
  if (override === 'vulkan') {
    return launchForRung(TOP_GPU_BACKEND_RUNG, `${GPU_BACKEND_ENV}=vulkan`);
  }
  if (environment.WOC_DISABLE_GPU_FORCE === '1') {
    return launchForRung('opengl', 'WOC_DISABLE_GPU_FORCE=1');
  }
  const setting = prefs?.gpuBackend;
  if (setting === 'opengl') return launchForRung('opengl', 'setting opengl');
  if (setting === 'vulkan') return launchForRung(TOP_GPU_BACKEND_RUNG, 'setting vulkan');
  return null;
}

/**
 * Append the Vulkan switches for a 'vulkan' launch, plus the parallel-compile feature
 * for a `parallel` one; nothing for 'default'. Must run before app 'ready' (Chromium
 * reads its command line there), which is why main.cjs calls it at module scope right
 * after the discrete-GPU force.
 */
function applyGpuBackendSwitches(app, launch) {
  if (launch?.backend !== 'vulkan') return;
  for (const [name, value] of VULKAN_BACKEND_SWITCHES) {
    app.commandLine.appendSwitch(name, value);
  }
  if (launch.parallel === true) {
    app.commandLine.appendSwitch(...VULKAN_PARALLEL_COMPILE_SWITCH);
  }
}

/**
 * The rung this launch ACTUALLY bound, from what the GPU process reports. Vulkan bound
 * only when Chromium does not report software rendering AND the renderer string names
 * Vulkan AND is not the SwiftShader device (whose own renderer string also says
 * "Vulkan"); anything else, including a missing renderer string, reads as 'opengl'. A
 * bound Vulkan is the parallel-compile rung only when that rung was asked for and the
 * page did not report the extension ABSENT (an unknown `parallelCompile`, from an older
 * game build reporting the string alone, keeps the rung). Real strings the tests pin:
 *   vulkan-parallel-compile: "ANGLE (NVIDIA, Vulkan 1.4.312 (NVIDIA NVIDIA GeForce RTX 3090 (...)), NVIDIA)"
 *   opengl (software):       "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (...)), SwiftShader driver)"
 *   opengl:                  "ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3090/PCIe/SSE2, OpenGL 4.5.0)"
 */
function judgeGpuBackendLaunch({ glRenderer, softwareRendering, parallel, parallelCompile }) {
  if (softwareRendering === true) return 'opengl';
  if (typeof glRenderer !== 'string' || glRenderer === '') return 'opengl';
  const renderer = glRenderer.toLowerCase();
  if (!renderer.includes('vulkan')) return 'opengl';
  if (renderer.includes('swiftshader')) return 'opengl';
  if (parallel !== true) return 'vulkan-plain';
  return parallelCompile === false ? 'vulkan-plain' : 'vulkan-parallel-compile';
}

/**
 * Whether the backend a launch asked for failed to come up, judged by FAMILY: a Vulkan
 * rung that bound anything but Vulkan (SwiftShader, OpenGL). That is what the in-launch
 * rescue is for. The exact rung is NOT compared: a parallel-compile launch whose page
 * reports the extension absent is running healthy Vulkan, and re-exec'ing it onto plain
 * Vulkan would kill a working window to land on the backend it is already on, minus a
 * switch that was doing nothing. The missing feature is the memory's business (the
 * healthy session remembers the rung that actually bound), never the rescue's.
 */
function backendDidNotBind(askedRung, boundRung) {
  if (rungIndex(askedRung) < 0 || rungIndex(boundRung) < 0) return false;
  return askedRung.startsWith('vulkan') && !boundRung.startsWith('vulkan');
}

/**
 * What identifies THIS machine in a proof: the active adapter's vendor and device ids
 * from app.getGPUInfo (`0x10de:0x2204` for an RTX 3090), which read the same on every
 * backend. The ANGLE renderer string cannot serve: it names the backend ("Vulkan
 * 1.4.312" vs "OpenGL 4.5.0" for the same card), so a rescue ending on OpenGL would
 * read as another machine and replace a top-rung proof with an OpenGL one. Empty when
 * no adapter is reported active, or when the active one carries no ids (the summary
 * pads a missing id to `0x0000`, and two unknown cards must not read as one), which
 * the proof reads as "unknown, assume the same machine": the app version alone then
 * decides.
 */
function activeGpuAdapterKey(devices) {
  const active = (Array.isArray(devices) ? devices : []).find((d) => d?.active === true);
  if (!active) return '';
  const id = (value) => (typeof value === 'string' && value !== '0x0000' ? value : '');
  const vendorId = id(active.vendorId);
  const deviceId = id(active.deviceId);
  return vendorId === '' && deviceId === '' ? '' : `${vendorId}:${deviceId}`;
}

/**
 * Whether an app.getGPUInfo('complete') auxAttributes reading can judge the launch at
 * all. On Linux the GPU process can report a healthy Vulkan session (feature status
 * `vulkan: enabled_on`, WebGL on ANGLE Vulkan) while glRenderer is EMPTY, so an absent
 * string is "no evidence", never "it failed": the judgement then waits for the renderer
 * string the game reports itself (desktop-report-gpu-renderer). Chromium's own
 * softwareRendering flag is evidence on its own, as is any non-empty renderer string.
 */
function hasGetGpuInfoEvidence(aux) {
  if (aux?.softwareRendering === true) return true;
  return typeof aux?.glRenderer === 'string' && aux.glRenderer !== '';
}

/**
 * Whether a launch should be rescued because its backend never came up at all.
 *
 * The rescue's two other triggers both need the GPU process to have LIVED: one watches it
 * die, the other reads the renderer the page reports. A Vulkan rung on a machine with no
 * usable Vulkan driver produces neither, because the GPU process never starts: it cannot
 * die, and with no GPU at all nothing can report a renderer. Chromium then disables GPU
 * access for the profile and the player is left on a page that cannot make a context, with
 * the ladder still sitting on the rung that failed.
 *
 * The evidence is already in hand at that moment: `app.getGPUFeatureStatus()`, which the
 * shell reads and logs anyway. A launch that ASKED for a Vulkan rung and has no hardware
 * WebGL is a launch whose backend did not take, so it steps down like any other.
 *
 * Only from a Vulkan rung: below OpenGL there is nothing to step to, and no switch of ours
 * to blame, so a machine with no GPU at all stops there rather than looping. The caller
 * adds the timing guard the other triggers use (before the session is healthy).
 */
function shouldRescueMissingGpu({ rung, hardwareWebgl }) {
  if (hardwareWebgl !== false) return false;
  return rungIndex(rung) >= 0 && rung.startsWith('vulkan');
}

/**
 * Whether to tell the player their own choice did not take: they picked Vulkan and the
 * session is not running Vulkan.
 *
 * This reads the SETTING, never the rung this launch asked for, and the difference is the
 * whole point. A rescue chain ends on a process whose own launch SUCCEEDED (it asked for
 * OpenGL and got it), so comparing against the launch would go quiet on exactly the
 * machine the message exists for: the player asked for Vulkan, three processes tried, and
 * the one they are looking at says nothing.
 *
 * Vulkan at all, not the exact rung: the picker offers Auto, Vulkan and OpenGL, so a
 * session on `vulkan-plain` IS the Vulkan the player asked for (only the ANGLE
 * parallel-compile feature is missing, which they never picked and cannot pick). Saying
 * "unable to enable Vulkan" there would be false.
 *
 * Auto says nothing: the player chose nothing to fall short of, and the memory climbing
 * back is the mechanism working rather than a failure to report.
 */
function requestedBackendUnavailable({ setting, judged, boundRung }) {
  if (judged !== true || setting !== 'vulkan') return false;
  return rungIndex(boundRung) >= 0 && !boundRung.startsWith('vulkan');
}

/**
 * The memory after a launch-time GPU-process death on `rung`: one more consecutive
 * crash, and a step down only once they reach MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES. The
 * PROOF is never touched here: a crash does not un-prove a session that ran healthy, and
 * keeping it is what lets the climb aim straight back instead of feeling its way up.
 * Returns the fields to merge into the prefs, or null when nothing changed.
 */
function demoteAfterRepeatedCrashes({ prefs, rung }) {
  if (rungIndex(rung) < 0) return null;
  const stored = prefs?.gpuBackendToAttempt;
  const attempt = rungIndex(stored) >= 0 ? stored : TOP_GPU_BACKEND_RUNG;
  // A death on a rung the memory is not attempting (an explicit choice, a re-probe of a
  // rung above the remembered one) says nothing about the remembered rung.
  if (rung !== attempt) return null;
  const crashes =
    (Number.isInteger(prefs?.consecutiveGpuLaunchCrashes) ? prefs.consecutiveGpuLaunchCrashes : 0) +
    1;
  if (crashes < MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES) {
    return { consecutiveGpuLaunchCrashes: crashes };
  }
  const lower = rungBelow(attempt);
  // Nothing below the bottom rung: the streak holds at the threshold rather than
  // counting every death for the life of the profile.
  if (!lower) {
    const held = Math.min(crashes, MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES);
    return held === prefs?.consecutiveGpuLaunchCrashes
      ? null
      : { consecutiveGpuLaunchCrashes: held };
  }
  return { gpuBackendToAttempt: lower, consecutiveGpuLaunchCrashes: 0 };
}

/**
 * The memory after a session ran HEALTHY on `rung` (the launch was judged and the
 * session then survived SESSION_HEALTHY_AFTER_MS without a GPU-process death).
 * Three things can happen: the crash streak clears, Auto remembers this rung, and the
 * proof is written when it improves on what is stored or when the stored one describes
 * a machine that is no longer this one (another adapter, another app version). That
 * last arm is what keeps a stale high proof from aiming a new GPU at a rung it cannot
 * run.
 *
 * A RESCUED child gets the proof arm only. Its parent's death already counted against
 * the attempt, and the child runs a rung the parent chose for it, not one the memory
 * chose: letting it write the attempt would demote Auto on the very first death and
 * clear the streak the parent just started, so the threshold could never be reached.
 * Returns the fields to merge into the prefs, or null when nothing changed.
 */
function gpuBackendMemoryAfterHealthySession({ prefs, rung, appVersion, gpuAdapter, rescued }) {
  if (rungIndex(rung) < 0) return null;
  const next =
    rescued === true ? {} : { gpuBackendToAttempt: rung, consecutiveGpuLaunchCrashes: 0 };
  const adapter = typeof gpuAdapter === 'string' ? gpuAdapter : '';
  const proof = prefs?.gpuBackendProof;
  const known = proof && rungIndex(proof.backend) >= 0;
  const storedAdapter = typeof proof?.gpuAdapter === 'string' ? proof.gpuAdapter : '';
  const sameAdapter = adapter === '' || storedAdapter === '' || adapter === storedAdapter;
  const describesThisMachine = known && proof.appVersion === appVersion && sameAdapter;
  if (!known || !describesThisMachine || isHigherRung(rung, proof.backend)) {
    next.gpuBackendProof = { backend: rung, appVersion, gpuAdapter: adapter };
  }
  return Object.keys(next).length === 0 ? null : next;
}

/**
 * The launch counter after a launch: back to zero when this launch WAS the climb, one
 * more otherwise. Only an Auto launch counts, and never a rescued child: an explicit
 * choice and an env override are not the memory's business, and a rescue chain is one
 * launch to the player, so its children must not move the cadence by two or three (and
 * a re-probe's zero must not be followed at once by its rescued child's one). Returns
 * the field to merge, or null when nothing changed.
 */
function launchCounterAfterAutoLaunch({ prefs, launch }) {
  if (launch?.auto !== true || launch.rescued === true) return null;
  const since = Number.isInteger(prefs?.launchesSinceBackendReprobe)
    ? prefs.launchesSinceBackendReprobe
    : 0;
  const next = launch.reprobed === true ? 0 : since + 1;
  return next === since ? null : { launchesSinceBackendReprobe: next };
}

/**
 * Rescue: re-exec this process on the rung below `rung`, so a player whose GPU process
 * died at launch gets a running game inside the same launch instead of a dead screen.
 * Same binary (the outer AppImage when running from one), same argv, detached, with the
 * rescue marker naming the child's rung.
 *
 * Returns true when spawn() returned a handle (whether the child then starts is reported
 * later, through the callbacks below). False when there is no lower rung, when the
 * chain has already spent its budget (the marker on this process names a rung at or
 * below the target, so the child would repeat a rung this chain has already run), or
 * when spawn() itself throws, in which case this process keeps running on whatever
 * Chromium recovered rather than leaving the player with nothing.
 *
 * `deps.onSpawned` runs on the child's 'spawn' event, the only proof the child exists:
 * the shell hands over the single-instance lock there and exits, so the child cannot
 * reach its own requestSingleInstanceLock while this process still holds it, see itself
 * as a second instance and quit, which is the one outcome the rescue exists to prevent.
 * On the event and not on spawn() returning, because a target that cannot start (an
 * AppImage swapped under a running session) is reported later, as an 'error' event; a
 * process that had already released its lock and exited on the return would have left
 * the player with nothing, and one that only released it would let the next launch open
 * a second game beside it. `deps.onSpawnFailed` runs instead on that event, this process
 * still running, with its lock. The child needs far longer to boot to its own lock
 * request than this process needs to release and exit.
 */
function relaunchOnLowerBackend(deps = {}, rung) {
  const env = deps.env ?? process.env;
  const log = deps.log;
  const target = rungBelow(rung);
  if (!target) return false;
  // A chain only ever walks DOWN. If this process was itself rescued, the child may
  // only go below where we already are; anything else would re-run a rung this chain
  // has watched die. That is also what caps the chain: the ladder is three rungs, so at
  // most two rescues can ever spawn, without a counter to keep in step.
  const already = env[GPU_BACKEND_RESCUE_ENV];
  if (rungIndex(already) >= 0 && !isHigherRung(already, target)) return false;
  const argv = deps.argv ?? process.argv.slice(1);
  try {
    const spawnTarget = spawnDetachedSelf({
      env: { ...env, [GPU_BACKEND_RESCUE_ENV]: target },
      argv,
      execPath: deps.execPath ?? process.execPath,
      spawn: deps.spawn,
      onSpawned: () => deps.onSpawned?.(),
      onSpawnFailed: (err) => {
        log?.warn?.(`[gpu] the relaunch on ${target} never started; staying on ${rung}`, err);
        deps.onSpawnFailed?.(err);
      },
    });
    log?.info?.(`[gpu] the GPU process died on ${rung}; starting a relaunch on ${target}`, {
      spawnTarget,
    });
    return true;
  } catch (err) {
    log?.warn?.(`[gpu] could not relaunch on ${rungBelow(rung)} after a GPU-process death`, err);
    return false;
  }
}

module.exports = {
  GPU_BACKEND_ENV,
  GPU_BACKEND_RESCUE_ENV,
  GPU_BACKEND_RUNGS,
  GPU_BACKEND_SETTINGS,
  MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES,
  REPROBE_HIGHER_BACKEND_EVERY_LAUNCHES,
  REPROBE_WITHOUT_PROOF_EVERY_LAUNCHES,
  SESSION_HEALTHY_AFTER_MS,
  TOP_GPU_BACKEND_RUNG,
  VULKAN_BACKEND_SWITCHES,
  VULKAN_PARALLEL_COMPILE_SWITCH,
  activeGpuAdapterKey,
  applyGpuBackendSwitches,
  backendDidNotBind,
  decideGpuBackendLaunch,
  demoteAfterRepeatedCrashes,
  gpuBackendMemoryAfterHealthySession,
  hasGetGpuInfoEvidence,
  isHigherRung,
  judgeGpuBackendLaunch,
  launchCounterAfterAutoLaunch,
  relaunchOnLowerBackend,
  requestedBackendUnavailable,
  rungAbove,
  shouldRescueMissingGpu,
  rungBelow,
};
