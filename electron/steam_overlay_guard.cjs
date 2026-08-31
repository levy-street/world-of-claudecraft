const nodePath = require('node:path');

// Steam preloads gameoverlayrenderer.so into every native Linux game it launches, and with it
// mapped this app never starts: Chromium's GPU process fails to come up, retries, and the
// browser process gives up with
//
//   FATAL:content/browser/gpu/gpu_data_manager_impl_private.cc] GPU process isn't usable. Goodbye.
//
// which is a CHECK, so the process dies on SIGTRAP with no window and no main.log. To the
// player that is Steam's launching spinner, forever. This is the normal way to install on a
// Steam Deck (download the AppImage, add it as a non-Steam game), and Steam injects the same
// library into depot builds, so it breaks the Steam channel too.
//
// Relaxing the GPU sandbox is enough, and is the narrowest thing that is: the RENDERER stays
// sandboxed, which is the boundary that matters, since the renderer is what runs page content.
// Measured on a Steam Deck (SteamOS 3, Game Mode, gamescope), overlay preloaded throughout:
//
//   no flags                  SIGTRAP, the fatal above
//   --disable-gpu-sandbox     boots
//   --no-sandbox              boots (a much larger relaxation, so not this one)
//   --in-process-gpu          boots (drops GPU process isolation entirely, so not this one)
//
// And it boots on real hardware rather than quietly falling back to software, which is the
// thing worth checking for a WebGL game: 3 runs out of 3 reported the Deck's own AMD adapter
// (0x1002:0x1435) active with webgl, gpu_compositing and rasterization all enabled. A "fix"
// that silently swapped in SwiftShader would have been worse than the crash.
//
// Deliberately NOT unconditional: a normal desktop launch keeps the full sandbox, and only a
// session Steam actually injected into relaxes it. The cost is scoped to the launches that
// would otherwise not start at all.
//
// Rejected alternatives, both measured rather than assumed:
//   - Stripping the overlay from LD_PRELOAD. It cannot be done from inside the app: the
//     variable is read by ld.so at exec time, so it needs a re-exec, and every shape of that
//     fails. A detached parent exits immediately, which Steam reads as the game closing. A
//     parent blocked in spawnSync cannot run a signal handler, and the child lands in its own
//     app-world-of-claudecraft-<pid>.scope while the parent stays in app-steam@autostart.service,
//     so Steam's stop kills the parent and strands the game. A supervising parent can forward
//     signals but is itself an Electron process with the overlay still mapped, so it dies of
//     the very crash it exists to avoid.
//   - Turning the overlay off in Steam. It does not stop the injection: with AllowOverlay=0 on
//     the shortcut, Steam still handed the launch both gameoverlayrenderer.so paths. Valve has
//     said the same for Windows, that disabling stops the overlay UI but not the library, which
//     carries other Steamworks plumbing.

const STEAM_OVERLAY_LIB = 'gameoverlayrenderer.so';
// Relaxes the GPU process sandbox only. The renderer sandbox, which is the one containing page
// content, is untouched.
const GPU_SANDBOX_SWITCH = 'disable-gpu-sandbox';
// docs/desktop-release.md tells an operator to grep main.log for this, which makes it a support
// procedure rather than prose: pinned by the test so a reword cannot break it silently.
const OVERLAY_DETECTED_LOG = '[steam] Steam overlay detected';

/**
 * True when Steam launched this process with its overlay preloaded.
 *
 * glibc separates LD_PRELOAD entries on spaces AND colons, with no escaping, so both are split
 * on; a path containing either is unrepresentable to the loader anyway. Matched on the
 * BASENAME because Steam injects both its ubuntu12_32 and ubuntu12_64 copies and the absolute
 * prefix moves with the Steam install (~/.local/share/Steam, ~/.steam/steam, flatpak, Deck).
 */
function steamOverlayPreloaded(env = process.env) {
  const preload = env.LD_PRELOAD;
  if (typeof preload !== 'string' || preload === '') return false;
  return preload
    .split(/[:\s]+/)
    .some((entry) => entry !== '' && nodePath.basename(entry) === STEAM_OVERLAY_LIB);
}

/**
 * Append the GPU-sandbox relaxation when, and only when, Steam's overlay is preloaded.
 *
 * MUST be called before app 'ready': Chromium reads its command line when the GPU process is
 * created, and a switch appended after that is simply ignored. Returns true when the switch was
 * added, so the caller can record it; a launch that did not need it is left completely alone.
 */
function allowGpuUnderSteamOverlay(deps = {}) {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const app = deps.app;
  if (platform !== 'linux') return false;
  if (!steamOverlayPreloaded(env)) return false;

  // Checked rather than optional-chained away: a missing app or commandLine would otherwise
  // append nothing, log success and return true, and the log line is the operator's grep handle
  // for "did this launch relax the sandbox". It has to be false exactly when nothing happened.
  const appendSwitch = app?.commandLine?.appendSwitch;
  if (typeof appendSwitch !== 'function') {
    // Deliberately does NOT contain OVERLAY_DETECTED_LOG: the docs make that string the
    // operator's grep for "the guard fired", so a failure line carrying it would match on the
    // one path where it did not.
    deps.log?.warn?.('[steam] overlay present but the GPU sandbox could not be relaxed', {
      reason: 'no app.commandLine.appendSwitch',
    });
    return false;
  }
  try {
    appendSwitch.call(app.commandLine, GPU_SANDBOX_SWITCH);
  } catch (err) {
    deps.log?.warn?.('[steam] could not relax the GPU sandbox', err);
    return false;
  }
  deps.log?.info?.(
    `${OVERLAY_DETECTED_LOG}; relaxing the GPU sandbox so the GPU process can start`,
    {
      switch: GPU_SANDBOX_SWITCH,
    },
  );
  return true;
}

module.exports = {
  GPU_SANDBOX_SWITCH,
  OVERLAY_DETECTED_LOG,
  STEAM_OVERLAY_LIB,
  allowGpuUnderSteamOverlay,
  steamOverlayPreloaded,
};
