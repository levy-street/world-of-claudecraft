'use strict';

// Settings that take effect at the NEXT launch, and the restart that gets there.
//
// Two of the shell's stored preferences are read before Electron's own startup and
// cannot change under a running process: the discrete-GPU force (`gpuForceOptOut`, a
// Chromium switch set plus a per-app OS preference) and the Linux graphics backend
// (`gpuBackend`, the ANGLE switches). A setter persists them for the next launch, so a
// player who changes one sits on a session that still runs the old value. Two things
// make that usable: the game must be able to tell "what this process started with" from
// "what is stored now" (the setters update the store live, so the getters cannot serve
// that), and it must be able to restart the shell from the options window rather than
// being told to quit and find the launcher.
//
// The snapshot is taken ONCE, right after the prefs load and before any setter can run,
// and frozen; the game compares its local settings against it (src/game/
// desktop_next_launch_settings.ts) and shows its restart strip on a difference.
//
// The restart re-execs this program the way the two rescue levers do (spawnDetachedSelf
// in electron/gpu_preference.cjs, the one shell module sanctioned for process
// execution), with the environment a relaunch must NOT inherit stripped: the rescue
// marker would pin the child to the rung a dead parent was rescued onto, over the very
// setting the player just changed; the PRIME offload variables the relaunch recorded
// planting (present only when this process is the PRIME-relaunched child) would keep the
// dedicated GPU forced on after the player turned the force off, and the child re-derives
// them itself when the force is still on. Pure functions with injected deps, exercised by
// tests/electron_launch_settings.test.ts; main.cjs wires the prefs, process and app.

const { GPU_BACKEND_RESCUE_ENV, GPU_BACKEND_SETTINGS } = require('./gpu_backend.cjs');
const {
  LINUX_OZONE_X11_ARG,
  LINUX_PRIME_ENV,
  PRIME_RELAUNCH_ADDED_ENV,
  PRIME_RELAUNCH_MARKER,
  spawnDetachedSelf,
} = require('./gpu_preference.cjs');

/**
 * What the PRIME relaunch planted in this process, per its own record
 * (PRIME_RELAUNCH_ADDED_ENV): the env names, and LINUX_OZONE_X11_ARG when it appended it.
 * Empty when this process is not the PRIME child. A child whose parent left no record
 * (the marker alone) reads as "everything the lever can plant": stripping a variable the
 * player set themselves costs them a restart with the offload off, keeping one the shell
 * set costs a player who turned the force OFF a restart with it still on.
 */
function primeRelaunchAdditions(env) {
  if (env?.[PRIME_RELAUNCH_MARKER] !== '1') return new Set();
  const record = env[PRIME_RELAUNCH_ADDED_ENV];
  if (typeof record === 'string') {
    return new Set(record.split(',').filter((name) => name !== ''));
  }
  return new Set([...Object.keys(LINUX_PRIME_ENV), LINUX_OZONE_X11_ARG]);
}

/**
 * The next-launch settings as THIS process read them at startup. Normalized to the
 * values the setters accept, so a hand-edited prefs file compares the same way the
 * launch read it (an unknown backend value launches as 'auto', so it is 'auto' here).
 */
function launchSettingsSnapshot(prefs) {
  const backend = prefs?.gpuBackend;
  return Object.freeze({
    gpuForceOptOut: prefs?.gpuForceOptOut === true,
    gpuBackend: GPU_BACKEND_SETTINGS.includes(backend) ? backend : 'auto',
  });
}

/**
 * The environment a restarted child starts from: this process's, minus what the shell's
 * own relaunch levers planted in it. The rescue marker always goes (a restart is a fresh
 * decision from the prefs, never a continuation of a rescue chain). The PRIME markers and
 * exactly the offload variables the PRIME relaunch recorded adding go with them: a
 * DRI_PRIME the player exported themselves is not in that record and stays.
 */
function restartEnv(env) {
  const next = { ...env };
  delete next[GPU_BACKEND_RESCUE_ENV];
  for (const name of primeRelaunchAdditions(env)) delete next[name];
  delete next[PRIME_RELAUNCH_MARKER];
  delete next[PRIME_RELAUNCH_ADDED_ENV];
  return next;
}

/**
 * The argv a restarted child starts with: this process's, minus the X11 ozone argument
 * when the PRIME relaunch recorded appending it. A player's own `--ozone-platform` choice
 * is not in that record and stays.
 */
function restartArgv(argv, env) {
  if (!primeRelaunchAdditions(env).has(LINUX_OZONE_X11_ARG)) return [...argv];
  return argv.filter((arg) => arg !== LINUX_OZONE_X11_ARG);
}

/**
 * Restart this program: spawn it again, detached, from a clean environment. Resolves
 * true on the child's 'spawn' event, the only proof the child exists, after running
 * `deps.onSpawned`, which is where the caller hands over the single-instance lock and
 * quits, exactly as the backend rescue does: a child requesting its own lock while the
 * parent still holds it would see itself as a second instance and quit, and a parent that
 * quit on spawn() returning would leave nothing running when the child never starts (an
 * async ENOENT, the 'error' event). Resolves false on that event, when spawn() itself
 * throws, when the handle it returned can report nothing at all, and under the dev
 * server's orchestrator, this process still running and still holding its lock, so the
 * options window can say the restart did not happen. Nothing here ever rejects.
 */
function restartApp(deps = {}) {
  const env = deps.env ?? process.env;
  const log = deps.log;
  // Under `npm run electron:dev` this program is one child of an orchestrator that owns the
  // Vite server (scripts/electron-dev.mjs) and stops it the moment this child exits, so a
  // restart would hand the player a detached shell loading a dead origin. Refused instead,
  // with the same false the strip already renders as "the restart did not happen"; a dev
  // run applies a next-launch setting by restarting the dev loop itself. The caller hands
  // the URL it honours (main.cjs reads it only when unpackaged), so a packaged build whose
  // environment happens to carry the variable restarts normally.
  if (typeof deps.devServerUrl === 'string' && deps.devServerUrl !== '') {
    log?.info?.('[shell] no restart under the dev server; restart npm run electron:dev instead');
    return Promise.resolve(false);
  }
  const argv = restartArgv(deps.argv ?? process.argv.slice(1), env);
  return new Promise((resolve) => {
    try {
      const spawnTarget = spawnDetachedSelf({
        env: restartEnv(env),
        argv,
        execPath: deps.execPath ?? process.execPath,
        spawn: deps.spawn,
        onSpawned: () => {
          deps.onSpawned?.();
          resolve(true);
        },
        onSpawnFailed: (err) => {
          log?.warn?.('[shell] the restart never started; this session keeps running', err);
          resolve(false);
        },
        // A handle with no event surface answers neither callback, so the answer is that
        // there is none: without this the promise would never settle and the strip would
        // sit on "Restarting" for the rest of the session.
        onUnobservable: () => {
          log?.warn?.('[shell] the restart child cannot be observed; this session keeps running');
          resolve(false);
        },
      });
      log?.info?.("[shell] restarting at the player's request", { spawnTarget });
    } catch (err) {
      log?.warn?.('[shell] could not restart', err);
      resolve(false);
    }
  });
}

module.exports = {
  launchSettingsSnapshot,
  restartApp,
  restartArgv,
  restartEnv,
};
