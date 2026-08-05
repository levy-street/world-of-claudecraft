// The bot's own liveness signal: a file whose modification time says the run
// loop is still turning (D15).
//
// A Discord bot has no port to probe, so the bot writes a file on a cadence and
// the container healthcheck compares its mtime against now. What that proves is
// exactly what a healthcheck should prove and no more: the scheduler is still
// driving tasks, because the write is one of them. The wedges it catches are
// whole-process ones, an event loop starved by a hot spin, a scheduler whose
// driver died, an exit that never fired. It does NOT catch a single OTHER task
// claimed by a run that never settled (task chains are independent, so this one
// keeps stamping), and it says nothing about gateway state (the gateway is not
// on the scheduler): per-task wedges are covered structurally instead, by the
// L10/L17 deadlines both IO shells now carry.
//
// This is an IO shell, thin on purpose: the freshness DECISION is the pure
// helper below, unit-tested on its own, and the writer is the only part that
// touches the filesystem.
import { writeFile } from 'node:fs/promises';

/**
 * Where the heartbeat file lives by default.
 *
 * /tmp and not somewhere under /app: the runtime image runs as USER node, and
 * the only path chowned to that user is /app/dist/media. /tmp is 1777 from the
 * Debian base, so it is the one directory the non-root user can write without a
 * Dockerfile change. The path is env-overridable (DISCORD_HEARTBEAT_FILE) for a
 * deployment that mounts something else.
 *
 * A world-writable directory is safe here only because the container's /tmp is
 * PRIVATE: the compose service declares no volumes, no tmpfs, and no shared
 * namespaces, so the bot is the sole process in it. writeFile follows symlinks;
 * if a future change ever mounts a shared /tmp into this container, this path
 * becomes a write primitive and must move to a dedicated mount.
 */
export const DEFAULT_HEARTBEAT_FILE = '/tmp/discord-bot-heartbeat';

/**
 * Whether a heartbeat written at `mtimeMs` still counts as alive at `nowMs`.
 *
 * Strictly under the bound, so `staleMs` itself is already stale: the healthcheck
 * runs on its own interval and a boundary that admitted exactly `staleMs` would
 * make the verdict depend on which side of a millisecond the probe landed.
 * A mtime in the FUTURE reads as fresh rather than stale, which is the safe
 * direction for a clock that jumped: a healthcheck must not kill a working bot
 * over a time sync.
 */
export function isHeartbeatFresh(mtimeMs: number, nowMs: number, staleMs: number): boolean {
  return nowMs - mtimeMs < staleMs;
}

/** The IO one heartbeat write performs. Injected so a test needs no filesystem. */
export interface HeartbeatIo {
  writeFile: (path: string, contents: string) => Promise<void>;
  now: () => number;
}

/**
 * Write the heartbeat file. Resolves TRUE when the write landed, false when it
 * did not, and never rejects.
 *
 * Never rejecting is the contract that matters: this runs as a scheduler task,
 * and the scheduler arms the next delay only after a run settles, so a run that
 * rejected would still be fine (the task catches) but a run that HUNG would stop
 * its own loop for the life of the process. Reporting a failed write as `false`
 * rather than a throw also keeps the log to one line per failure, which is what
 * an unwritable path (a read-only mount, a full disk) would otherwise produce at
 * the task's cadence forever.
 *
 * The contents are a timestamp for a human reading the file by hand; the
 * healthcheck itself only ever reads the mtime.
 */
export async function writeHeartbeatFile(
  path: string,
  // Trailing seam with a production default that FORWARDS to the import rather
  // than capturing it, the one convention the bot's shells share (bot/CLAUDE.md,
  // "One injection convention in the three shells").
  io: HeartbeatIo = {
    writeFile: (p, contents) => writeFile(p, contents),
    now: () => Date.now(),
  },
): Promise<boolean> {
  try {
    await io.writeFile(path, `${io.now()}\n`);
    return true;
  } catch (err) {
    console.error(`[bot] heartbeat write to ${path} failed`, err);
    return false;
  }
}
