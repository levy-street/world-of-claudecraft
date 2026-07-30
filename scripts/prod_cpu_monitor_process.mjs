import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { buildSshArgs, errorMessage } from './prod_cpu_monitor_core.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export async function runProcess(
  command,
  args,
  {
    input,
    stdoutFile,
    timeoutMs = 30_000,
    maxStdoutBytes = 8 * 1024 * 1024,
    onStderrLine,
    signal,
  } = {},
) {
  if (signal?.aborted) {
    throw new Error(`${command} aborted: ${errorMessage(signal.reason)}`);
  }
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const stderrChunks = [];
  let stderrBytes = 0;
  let stderrLineBuffer = '';
  const stdoutChunks = [];
  let stdoutBytes = 0;
  let outputStream = null;
  let outputFinished = null;
  let outputError = null;
  let outputExceeded = false;
  let aborted = false;
  let forceKill = null;

  const terminate = () => {
    child.kill('SIGTERM');
    if (!forceKill) {
      forceKill = setTimeout(() => child.kill('SIGKILL'), 2_000);
      forceKill.unref();
    }
  };
  const onAbort = () => {
    aborted = true;
    terminate();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  if (stdoutFile) {
    outputStream = createWriteStream(stdoutFile, { flags: 'w', mode: 0o600 });
    outputFinished = finished(outputStream).catch((error) => {
      outputError = error;
      terminate();
    });
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= maxStdoutBytes) outputStream.write(chunk);
      else {
        outputExceeded = true;
        terminate();
      }
    });
    child.stdout.once('end', () => outputStream.end());
  } else {
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= maxStdoutBytes) stdoutChunks.push(chunk);
      else {
        outputExceeded = true;
        terminate();
      }
    });
  }
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes <= 2 * 1024 * 1024) stderrChunks.push(chunk);
    if (onStderrLine) {
      stderrLineBuffer += chunk.toString('utf8');
      const lines = stderrLineBuffer.split('\n');
      stderrLineBuffer = lines.pop() ?? '';
      for (const line of lines) onStderrLine(line.replace(/\r$/, ''));
    }
  });
  child.stdin.on('error', () => {
    // An early SSH failure can close stdin while the profile source is being sent.
  });

  if (input !== undefined) child.stdin.end(input);
  else child.stdin.end();

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    terminate();
  }, timeoutMs);

  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, closeSignal) => resolve({ code, signal: closeSignal }));
  }).finally(() => {
    clearTimeout(timeout);
    if (forceKill) clearTimeout(forceKill);
    signal?.removeEventListener('abort', onAbort);
  });
  if (outputFinished) await outputFinished;
  if (outputError) throw outputError;

  const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
  if (onStderrLine && stderrLineBuffer) onStderrLine(stderrLineBuffer.replace(/\r$/, ''));
  if (aborted) {
    throw new Error(
      `${command} aborted: ${errorMessage(signal?.reason)}${stderr ? `: ${stderr}` : ''}`,
    );
  }
  if (timedOut)
    throw new Error(`${command} timed out after ${timeoutMs}ms${stderr ? `: ${stderr}` : ''}`);
  if (result.code !== 0) {
    throw new Error(
      `${command} exited ${result.code ?? `on ${result.signal}`}${stderr ? `: ${stderr}` : ''}`,
    );
  }
  if (outputExceeded) {
    throw new Error(`${command} exceeded the ${maxStdoutBytes}-byte output limit`);
  }
  return { stdout: Buffer.concat(stdoutChunks).toString('utf8'), stderr };
}

export function remoteLockCommand() {
  const holder = "printf 'LOCKED\\n'; cat >/dev/null";
  return `sudo -n flock --nonblock /run/lock/woc-prod-cpu-monitor.lock sh -c ${shellQuote(holder)}`;
}

export async function acquireRemoteCaptureLock(options) {
  const child = spawn('ssh', buildSshArgs(options, remoteLockCommand()), {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let acquired = false;
  let released = false;
  child.stdin.on('error', () => {});
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk) => {
    if (stderr.length < 64 * 1024) stderr += chunk.toString('utf8');
  });

  let rejectLost;
  const lost = new Promise((_, reject) => {
    rejectLost = reject;
  });
  const closed = new Promise((resolve) => {
    child.once('close', (code) => {
      resolve(code);
      if (acquired && !released) {
        rejectLost(
          new Error(
            `production capture lock connection was lost (exit ${code})${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
          ),
        );
      }
    });
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('remote capture lock timed out'));
    }, 20_000);
    const check = setInterval(() => {
      if (!stdout.includes('LOCKED\n')) return;
      acquired = true;
      clearInterval(check);
      clearTimeout(timeout);
      resolve();
    }, 10);
    child.once('error', (error) => {
      clearInterval(check);
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      if (acquired) return;
      clearInterval(check);
      clearTimeout(timeout);
      reject(
        new Error(
          `production capture lock is already held or unavailable (exit ${code})${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
        ),
      );
    });
  });

  return {
    lost,
    release: async () => {
      if (released) return;
      released = true;
      child.stdin.end();
      await Promise.race([
        closed,
        delay(10_000).then(() => {
          child.kill('SIGTERM');
        }),
      ]);
    },
  };
}
