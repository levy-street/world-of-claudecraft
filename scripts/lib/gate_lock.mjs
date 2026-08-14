// Cross-process advisory lock serializing the "vitest (full suite)" step across
// concurrent local gates (issue #2808).
//
// Ownership is an exclusive loopback TCP listener, not a stale file. Binding one
// host/port is an atomic kernel operation on every Node platform: one process owns
// it, every contender gets EADDRINUSE, and the kernel drops ownership when that
// process exits. That removes three failure modes a pid-bearing JSON file cannot
// solve safely: a read-then-unlink reclaim race, a half-written owner file, and a
// dead owner's pid being reused by an unrelated process.
//
// The listener speaks a tiny identity protocol so a contender can distinguish a
// real gate holder from an unrelated service that happens to own the port. A real
// holder is waited on and named in the log. An unrecognised listener makes the lock
// unavailable and the gate runs unserialized, matching the existing rule that this
// wall-clock optimization must never prevent the test suite from running.
import { randomUUID } from 'node:crypto';
import net from 'node:net';

export const DEFAULT_LOCK_HOST = '127.0.0.1';
// Stable across worktrees and clones on one host. The protocol check below makes a
// coincidental collision visible and fall-open instead of treating it as a gate.
export const DEFAULT_LOCK_PORT = 22_281;
export const DEFAULT_POLL_MS = 5000;
export const DEFAULT_MAX_WAIT_MS = 60 * 60 * 1000;
export const DEFAULT_REANNOUNCE_MS = 2 * 60 * 1000;
export const DEFAULT_IDENTIFY_TIMEOUT_MS = 1000;

const PROTOCOL = 'woc-gate-full-suite/v1';
const MAX_FOREIGN_RESPONSES = 3;
const MAX_RELEASE_RACE_RETRIES = 3;

function sleepDefault(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listen(host, port, holder) {
  return new Promise((resolve, reject) => {
    const sockets = new Set();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      socket.end(`${JSON.stringify({ protocol: PROTOCOL, ...holder })}\n`);
    });
    const onError = (error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      // Runtime errors are not expected for a loopback listener. Keep one handler
      // so an exceptional socket error is visible rather than becoming an uncaught
      // exception while the full suite is running.
      server.on('error', (error) => {
        console.warn(`[gate] WARN: full-suite lock listener error (${error.message})`);
      });
      resolve({ server, sockets });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host, port, exclusive: true });
  });
}

function identifyHolder(host, port, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let data = '';
    const socket = net.createConnection({ host, port });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ kind: 'foreign' }), timeoutMs);
    timer.unref?.();
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      data += chunk;
      if (data.length > 4096) finish({ kind: 'foreign' });
    });
    socket.on('end', () => {
      try {
        const holder = JSON.parse(data.trim());
        if (
          holder.protocol === PROTOCOL &&
          typeof holder.ownerId === 'string' &&
          typeof holder.pid === 'number' &&
          typeof holder.startedAt === 'number'
        ) {
          finish({ kind: 'holder', holder });
          return;
        }
      } catch {
        // An unrelated service can return arbitrary bytes. It is not a gate holder.
      }
      finish({ kind: 'foreign' });
    });
    socket.on('error', (error) => {
      // The holder commonly releases between our failed bind and this probe. That
      // is a retry, not an unavailable lock.
      if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
        finish({ kind: 'retry' });
      } else {
        finish({ kind: 'foreign' });
      }
    });
  });
}

function closeServer({ server, sockets }) {
  return new Promise((resolve) => {
    // A local client must not be able to extend the critical section by opening
    // an identity connection and refusing to finish its half of the close.
    for (const socket of sockets) socket.destroy();
    try {
      server.close((error) => {
        if (error) {
          console.warn(`[gate] WARN: could not release the full-suite lock (${error.message})`);
        }
        resolve();
      });
    } catch (error) {
      if (error?.code !== 'ERR_SERVER_NOT_RUNNING') {
        console.warn(`[gate] WARN: could not release the full-suite lock (${error.message})`);
      }
      resolve();
    }
  });
}

/**
 * Wait until this process owns the host-wide full-suite listener. Every outcome
 * returns an awaitable release function; lock infrastructure failures fall open.
 *
 * @param {{
 *   optOut?: boolean,
 *   host?: string,
 *   port?: number,
 *   pid?: number,
 *   ownerId?: string,
 *   now?: () => number,
 *   pollMs?: number,
 *   maxWaitMs?: number,
 *   reannounceMs?: number,
 *   identifyTimeoutMs?: number,
 *   sleep?: (ms: number) => Promise<void>,
 *   log?: (msg: string) => void,
 * }} [opts]
 * @returns {Promise<{ release: () => Promise<void> }>}
 */
export async function acquireFullSuiteLock(opts = {}) {
  if (opts.optOut) return { release: async () => {} };

  const host = opts.host ?? DEFAULT_LOCK_HOST;
  const port = opts.port ?? DEFAULT_LOCK_PORT;
  const pid = opts.pid ?? process.pid;
  const ownerId = opts.ownerId ?? randomUUID();
  const now = opts.now ?? Date.now;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const reannounceMs = opts.reannounceMs ?? DEFAULT_REANNOUNCE_MS;
  const identifyTimeoutMs = opts.identifyTimeoutMs ?? DEFAULT_IDENTIFY_TIMEOUT_MS;
  const sleep = opts.sleep ?? sleepDefault;
  const log = opts.log ?? ((message) => console.log(message));
  const waitStartedAt = now();
  let lastAnnouncedAt = waitStartedAt;
  let announcedOwnerId = null;
  let foreignResponses = 0;
  let releaseRaceRetries = 0;

  const waitExpired = () => now() - waitStartedAt >= maxWaitMs;
  const fallOpenAfterWait = () => {
    log(
      `[gate] WARN: waited over ${Math.round(maxWaitMs / 60000)}m for the full-suite ` +
        'lock, running unserialized',
    );
    return { release: async () => {} };
  };

  for (;;) {
    try {
      const ownership = await listen(host, port, { ownerId, pid, startedAt: now() });
      let released = false;
      return {
        release: async () => {
          if (released) return;
          released = true;
          await closeServer(ownership);
        },
      };
    } catch (error) {
      if (error?.code !== 'EADDRINUSE') {
        const detail = error?.code ?? error?.message ?? String(error);
        log(`[gate] WARN: full-suite lock unavailable (${detail}), running unserialized`);
        return { release: async () => {} };
      }
    }
    if (waitExpired()) return fallOpenAfterWait();

    const identity = await identifyHolder(host, port, identifyTimeoutMs);
    if (waitExpired()) return fallOpenAfterWait();
    if (identity.kind === 'retry') {
      releaseRaceRetries++;
      if (releaseRaceRetries > MAX_RELEASE_RACE_RETRIES) {
        log(
          `[gate] WARN: ${host}:${port} repeatedly reset the gate lock probe, ` +
            'running unserialized',
        );
        return { release: async () => {} };
      }
      // A holder can disappear between EADDRINUSE and the identity connection.
      // Yield before the bounded re-bind attempt so a reset-only foreign service
      // cannot turn that legitimate race allowance into hot connection churn.
      await sleep(Math.min(pollMs, 100));
      if (waitExpired()) return fallOpenAfterWait();
      continue;
    }
    releaseRaceRetries = 0;
    if (identity.kind === 'foreign') {
      foreignResponses++;
      if (foreignResponses >= MAX_FOREIGN_RESPONSES) {
        log(
          `[gate] WARN: ${host}:${port} is not a World of Claudecraft gate lock, ` +
            'running unserialized',
        );
        return { release: async () => {} };
      }
      await sleep(pollMs);
      if (waitExpired()) return fallOpenAfterWait();
      continue;
    }

    foreignResponses = 0;
    const { holder } = identity;
    if (holder.ownerId !== announcedOwnerId || now() - lastAnnouncedAt > reannounceMs) {
      const ageMs = Math.max(0, now() - holder.startedAt);
      log(
        `[gate] waiting for the full-suite lock held by pid ${holder.pid} ` +
          `(running ${Math.round(ageMs / 1000)}s)...`,
      );
      announcedOwnerId = holder.ownerId;
      lastAnnouncedAt = now();
    }
    await sleep(pollMs);
    if (waitExpired()) return fallOpenAfterWait();
  }
}
