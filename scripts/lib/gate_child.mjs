// Runs the one lock-protected gate step with an explicit child lifecycle.
// spawnSync cannot service signal handlers while it waits: killing the gate wrapper
// can orphan npm/Vitest, while the wrapper-owned lock disappears and lets another
// suite overlap it. This async runner keeps the event loop live, owns a process group
// on POSIX, and tears down the whole child tree before returning to gate.mjs, whose
// finally block then releases the full-suite lock.
import { spawn, spawnSync } from 'node:child_process';

const POSIX_SIGNAL_EXIT = Object.freeze({
  SIGINT: 130,
  SIGHUP: 129,
  SIGQUIT: 131,
  SIGTERM: 143,
});
const WINDOWS_SIGNAL_EXIT = Object.freeze({
  SIGINT: 130,
  SIGHUP: 129,
  SIGTERM: 143,
  SIGBREAK: 149,
});
const DEFAULT_QUIESCENCE_POLL_MS = 25;
const DEFAULT_QUIESCENCE_ESCALATION_MS = 5000;

function handledSignals(platform) {
  return Object.keys(platform === 'win32' ? WINDOWS_SIGNAL_EXIT : POSIX_SIGNAL_EXIT);
}

function signalExitCode(signal, platform) {
  const table = platform === 'win32' ? WINDOWS_SIGNAL_EXIT : POSIX_SIGNAL_EXIT;
  return table[signal] ?? 1;
}

function terminateChildTree(child, signal, platform) {
  if (child.pid == null) return false;
  if (platform === 'win32') {
    const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    if (result.status === 0) return true;
    child.kill();
    return false;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
  return false;
}

function isPosixProcessGroupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/**
 * Run one command and keep handled termination tied to its complete process tree.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {{
 *   stdio?: import('node:child_process').StdioOptions,
 *   env?: NodeJS.ProcessEnv,
 *   shell?: boolean,
 *   cwd?: string,
 *   platform?: NodeJS.Platform,
 *   forceKillAfterMs?: number,
 *   quiescencePollMs?: number,
 *   quiescenceEscalationMs?: number,
 * }} [opts]
 * @returns {Promise<{ status: number | null, signal: NodeJS.Signals | null }>}
 */
export function runGateChild(cmd, args, opts = {}) {
  const platform = opts.platform ?? process.platform;
  const forceKillAfterMs = opts.forceKillAfterMs ?? 5000;
  const quiescencePollMs = opts.quiescencePollMs ?? DEFAULT_QUIESCENCE_POLL_MS;
  const quiescenceEscalationMs = opts.quiescenceEscalationMs ?? DEFAULT_QUIESCENCE_ESCALATION_MS;
  const child = spawn(cmd, args, {
    stdio: opts.stdio ?? 'inherit',
    env: opts.env,
    shell: opts.shell,
    cwd: opts.cwd,
    // A distinct process group lets POSIX termination reach npm, Vitest, and
    // every worker rather than only the immediate shell or npm process.
    detached: platform !== 'win32',
  });

  return new Promise((resolve) => {
    let handledSignal = null;
    let forceKillTimer = null;
    let quiescenceTimer = null;
    let nextEscalationAt = null;
    let directResult = null;
    let windowsTreeTerminated = false;
    let settled = false;
    const handlers = new Map();

    const cleanup = () => {
      for (const [signal, handler] of handlers) process.removeListener(signal, handler);
      if (forceKillTimer !== null) clearTimeout(forceKillTimer);
      if (quiescenceTimer !== null) clearTimeout(quiescenceTimer);
    };
    const finish = (status, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        status: handledSignal === null ? status : signalExitCode(handledSignal, platform),
        signal,
      });
    };
    const checkQuiescence = () => {
      if (quiescenceTimer !== null) {
        clearTimeout(quiescenceTimer);
        quiescenceTimer = null;
      }
      if (settled || handledSignal === null) return;
      if (platform === 'win32') {
        if (directResult !== null && windowsTreeTerminated) {
          finish(directResult.status, directResult.signal);
          return;
        }
      } else if (
        directResult !== null &&
        (child.pid == null || !isPosixProcessGroupAlive(child.pid))
      ) {
        finish(directResult.status, directResult.signal);
        return;
      }

      if (nextEscalationAt !== null && Date.now() >= nextEscalationAt) {
        windowsTreeTerminated =
          terminateChildTree(child, 'SIGKILL', platform) || windowsTreeTerminated;
        nextEscalationAt = Date.now() + quiescenceEscalationMs;
      }
      quiescenceTimer = setTimeout(checkQuiescence, quiescencePollMs);
    };

    for (const signal of handledSignals(platform)) {
      const handler = () => {
        if (handledSignal !== null) return;
        handledSignal = signal;
        windowsTreeTerminated = terminateChildTree(child, signal, platform);
        nextEscalationAt = Date.now() + forceKillAfterMs + quiescenceEscalationMs;
        forceKillTimer = setTimeout(() => {
          windowsTreeTerminated =
            terminateChildTree(child, 'SIGKILL', platform) || windowsTreeTerminated;
          nextEscalationAt = Date.now() + quiescenceEscalationMs;
        }, forceKillAfterMs);
        forceKillTimer.unref?.();
        checkQuiescence();
      };
      handlers.set(signal, handler);
      process.on(signal, handler);
    }

    child.once('error', () => {
      if (handledSignal === null) finish(null, null);
      else {
        directResult = { status: null, signal: null };
        checkQuiescence();
      }
    });
    child.once('close', (code, signal) => {
      if (handledSignal === null) finish(code, signal);
      else {
        directResult = { status: code, signal };
        checkQuiescence();
      }
    });
  });
}
