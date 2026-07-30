// Self-contained V8 CPU-profile collector for the production game container.
// The production image installs this root-owned helper under /app/ops. The
// monitor invokes that immutable copy after starting the inspector on loopback.

const profileMs = Number(process.env.WOC_PROFILE_MS ?? 30_000);
if (!Number.isFinite(profileMs) || profileMs < 0 || profileMs > 300_000) {
  throw new Error('WOC_PROFILE_MS must be between 0 and 300000');
}
const sampleIntervalUs = Number(process.env.WOC_PROFILE_SAMPLE_INTERVAL_US ?? 4_000);
if (!Number.isInteger(sampleIntervalUs) || sampleIntervalUs < 100 || sampleIntervalUs > 100_000) {
  throw new Error('WOC_PROFILE_SAMPLE_INTERVAL_US must be an integer between 100 and 100000');
}
const expectedPid = Number(process.env.WOC_EXPECTED_PID);
if (!Number.isInteger(expectedPid) || expectedPid <= 0) {
  throw new Error('WOC_EXPECTED_PID must be a positive integer');
}
const closeInspector = process.env.WOC_CLOSE_INSPECTOR === '1';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function inspectorTarget() {
  const deadline = Date.now() + 20_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:9229/json/list', {
        signal: AbortSignal.timeout(1_500),
      });
      if (!response.ok) throw new Error(`inspector discovery returned ${response.status}`);
      const targets = await response.json();
      const target = targets.find(
        (entry) => entry?.type === 'node' && typeof entry.webSocketDebuggerUrl === 'string',
      );
      if (target) return target;
      lastError = new Error('inspector discovery returned no Node target');
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`inspector was unavailable: ${String(lastError)}`);
}

class CdpSession {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener('message', (event) => this.onMessage(event));
    socket.addEventListener('close', () => this.rejectPending(new Error('inspector closed')));
    socket.addEventListener('error', () =>
      this.rejectPending(new Error('inspector WebSocket failed')),
    );
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('inspector connection timed out')), 5_000);
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timeout);
          reject(new Error('inspector connection failed'));
        },
        { once: true },
      );
    });
  }

  onMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (typeof message.id !== 'number') return;
    const waiter = this.pending.get(message.id);
    if (!waiter) return;
    this.pending.delete(message.id);
    clearTimeout(waiter.timeout);
    if (message.error)
      waiter.reject(new Error(message.error.message ?? 'inspector command failed'));
    else waiter.resolve(message.result ?? {});
  }

  rejectPending(error) {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.pending.clear();
  }

  call(method, params = {}, timeoutMs = 10_000) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('inspector is not connected'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.rejectPending(new Error('inspector session closed'));
    try {
      this.socket?.close();
    } catch {
      // The process is exiting and the profile has already been emitted.
    }
  }
}

async function main() {
  const target = await inspectorTarget();
  const session = new CdpSession(target.webSocketDebuggerUrl);
  let started = false;
  let targetVerified = false;
  try {
    await session.connect();
    const evaluated = await session.call('Runtime.evaluate', {
      expression: 'process.pid',
      returnByValue: true,
    });
    const actualPid = Number(evaluated.result?.value);
    if (actualPid !== expectedPid) {
      throw new Error(`unexpected inspector PID ${actualPid}; expected ${expectedPid}`);
    }
    targetVerified = true;
    if (profileMs > 0) {
      await session.call('Profiler.enable');
      await session.call('Profiler.setSamplingInterval', { interval: sampleIntervalUs });
      await session.call('Profiler.start');
      started = true;
      console.error('WOC_PROFILE_STARTED');
      await delay(profileMs);
      const result = await session.call('Profiler.stop', {}, 20_000);
      started = false;
      console.error('WOC_PROFILE_STOPPED');
      if (!result.profile?.nodes || !result.profile?.samples) {
        throw new Error('inspector returned an invalid CPU profile');
      }
      process.stdout.write(JSON.stringify(result.profile));
    } else {
      process.stdout.write('{}');
    }
  } finally {
    if (started) {
      await session.call('Profiler.stop', {}, 5_000).catch(() => {});
    }
    if (closeInspector && targetVerified) {
      await session
        .call('Runtime.evaluate', {
          expression:
            "setTimeout(() => process.getBuiltinModule('node:inspector').close(), 100); true",
          returnByValue: true,
        })
        .catch(() => {});
    }
    session.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
