import { createHash } from 'node:crypto';
import fs, { type Stats } from 'node:fs';

export const MAX_STATIC_SFX_BYTES = 4 * 1024 * 1024;

export interface StaticSfxSnapshot {
  bytes: Buffer;
  hash: string;
  stats: Stats;
}

function sameFile(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

/**
 * Open, bound, and snapshot one versioned SFX asset. The caller hashes and sends
 * this one Buffer, so a later pathname replacement cannot change the response.
 */
export function readStaticSfxSnapshot(file: string): StaticSfxSnapshot {
  const fd = fs.openSync(file, 'r');
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size < 1 || before.size > MAX_STATIC_SFX_BYTES) {
      throw new Error('versioned SFX asset is not a bounded regular file');
    }

    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error('versioned SFX asset ended during snapshot');
      offset += count;
    }

    // Catch growth after the bounded allocation instead of letting readFileSync
    // consume an attacker-controlled or partially activated file without limit.
    const overflow = Buffer.allocUnsafe(1);
    if (fs.readSync(fd, overflow, 0, 1, bytes.length) !== 0) {
      throw new Error('versioned SFX asset grew during snapshot');
    }

    const after = fs.fstatSync(fd);
    const pathname = fs.statSync(file);
    if (!sameFile(before, after) || !sameFile(after, pathname)) {
      throw new Error('versioned SFX asset changed during snapshot');
    }

    return {
      bytes,
      hash: createHash('sha256').update(bytes).digest('hex'),
      stats: after,
    };
  } finally {
    fs.closeSync(fd);
  }
}
