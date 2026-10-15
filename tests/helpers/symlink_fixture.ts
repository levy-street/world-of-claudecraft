// Symlink fixtures that also build on Windows.
//
// Creating a symbolic link on Windows needs Developer Mode or an elevated
// shell, so a plain symlinkSync throws EPERM on a stock machine. A directory
// JUNCTION needs neither, and Node reports it exactly like a directory symlink
// (lstat and Dirent say isSymbolicLink, stat and readdir follow it, readlink
// returns the target), so directory fixtures use one. Node ignores the type
// argument everywhere but Windows, so Linux and macOS still get a real symlink
// and nothing changes on CI.
//
// A FILE link has no unprivileged Windows equivalent. Cases that need one gate
// on FILE_SYMLINKS, a probe of what this process may actually do, so a Windows
// machine with Developer Mode on still runs them. Off Windows it is always
// true without probing: those platforms never skip.
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Link `linkPath` to the directory `target` (a junction on Windows). */
export function symlinkDir(target: string, linkPath: string): void {
  symlinkSync(target, linkPath, 'junction');
}

function probeFileSymlinks(): boolean {
  if (process.platform !== 'win32') return true;
  const dir = mkdtempSync(join(tmpdir(), 'woc-symlink-probe-'));
  try {
    writeFileSync(join(dir, 'target'), '');
    symlinkSync(join(dir, 'target'), join(dir, 'link'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Whether this process may create a FILE symlink. */
export const FILE_SYMLINKS = probeFileSymlinks();

/** The skip reason a file-symlink case names when FILE_SYMLINKS is false. */
export const NO_FILE_SYMLINKS =
  'file symlinks need Windows Developer Mode or elevation (directory cases use a junction)';
