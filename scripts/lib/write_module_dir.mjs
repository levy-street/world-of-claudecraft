import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Write a { filename -> contents } map into `dir` ATOMICALLY and prune orphans:
//   - mkdir -p the dir
//   - if `<name>` already holds these exact bytes, skip it entirely (no tmp write, no
//     rename, mtime untouched): a no-op regen (the common case once the tree is
//     already fresh) then leaves the directory completely quiet instead of touching
//     every slice's mtime, which is friendlier to file watchers and incremental
//     tooling that key off mtime. Otherwise write `<name>.tmp` then renameSync it
//     over `<name>` (an atomic same-dir replace: the destination path is never
//     momentarily absent and never half-written). A bare rmSync(dir)+recreate would
//     make every slice vanish for a window, and a concurrent reader resolving
//     './en_XA' through the barrel during that gap fails with "Cannot find module"
//     (the reproducibility tests regenerate this directory while other Vitest
//     workers import it). It is also crash-safer: every expected path always holds
//     valid (old or new) content.
//   - the "does this already hold these bytes" check is a single readFileSync inside
//     a try/catch rather than existsSync-then-readFileSync: two syscalls collapse to
//     one, and there is no window between the existence check and the read where a
//     concurrent writer could remove the file out from under us. ENOENT (file does
//     not exist yet) falls through to the write like any other mismatch; any other
//     read error also falls through, since a byte-identical skip can only be proven
//     by a successful read that matches.
//   - delete any pre-existing *.ts not in the map (so a removed locale leaves no
//     orphan) AND any stale *.ts.tmp left by a run that crashed between writeFileSync
//     and renameSync (it never ends in plain ".ts", so it would otherwise survive and
//     could be committed by accident). By emit time every live tmp has been renamed
//     away, so this only sweeps leftovers, never an in-flight write.
// Returns the total bytes across every module (written or skipped as already
// identical) plus how many modules were actually rewritten, so a no-op regen and a
// full rewrite are distinguishable in the caller's log line.
export function writeModuleDir(dir, modules) {
  mkdirSync(dir, { recursive: true });
  let totalBytes = 0;
  let rewritten = 0;
  for (const [name, text] of Object.entries(modules)) {
    const dest = path.join(dir, name);
    totalBytes += Buffer.byteLength(text, 'utf8');
    let existing;
    try {
      existing = readFileSync(dest, 'utf8');
    } catch {
      existing = undefined;
    }
    if (existing === text) continue;
    const tmp = `${dest}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, dest);
    rewritten++;
  }
  const keep = new Set(Object.keys(modules));
  for (const entry of readdirSync(dir)) {
    if ((entry.endsWith('.ts') || entry.endsWith('.ts.tmp')) && !keep.has(entry)) {
      rmSync(path.join(dir, entry), { force: true });
    }
  }
  return { totalBytes, rewritten, total: Object.keys(modules).length };
}
