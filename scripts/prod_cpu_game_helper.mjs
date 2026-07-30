// Immutable in-container helper for identifying and signaling the game Node process.

import { readdir, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';

async function findGamePid() {
  const matches = [];
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (pid === process.pid) continue;
    const proc = `/proc/${name}`;
    try {
      const [executable, cmdline] = await Promise.all([
        readlink(`${proc}/exe`),
        readFile(`${proc}/cmdline`, 'utf8'),
      ]);
      const args = cmdline.split('\0');
      if (
        path.basename(executable) === 'node' &&
        path.basename(args[0] ?? '') === 'node' &&
        args[1] === 'dist-server/server.cjs'
      ) {
        matches.push(pid);
      }
    } catch {
      // Processes can exit, or be unreadable, while /proc is being scanned.
    }
  }
  if (matches.length !== 1) {
    throw new Error(`expected one game Node process, found ${matches.length}`);
  }
  return matches[0];
}

async function main() {
  const action = process.argv[2];
  const pid = await findGamePid();
  if (action === 'pid' && process.argv.length === 3) {
    process.stdout.write(`${pid}\n`);
    return;
  }
  if (action === 'signal' && process.argv.length === 4) {
    const expectedPid = Number(process.argv[3]);
    if (!Number.isInteger(expectedPid) || expectedPid <= 0) {
      throw new Error('expected game PID must be a positive integer');
    }
    if (pid !== expectedPid) throw new Error('game Node PID changed before inspector signal');
    process.kill(pid, 'SIGUSR1');
    process.stdout.write(`${pid}\n`);
    return;
  }
  throw new Error('usage: prod_cpu_game_helper.mjs pid | signal EXPECTED_PID');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
