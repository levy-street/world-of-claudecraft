import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeModuleDir } from '../scripts/lib/write_module_dir.mjs';

// Direct-import unit test for the shared writeModuleDir helper (scripts/lib/write_module_dir.mjs,
// typed via its sibling .d.mts per scripts/CLAUDE.md's guidance: script logic worth a unit test
// gets a .d.mts specifically so Vitest can import it directly). Additive to the subprocess-based
// coverage in tests/i18n_emit_shape.test.ts (which drives the same module through 4 full
// scripts/i18n_build.mjs / scripts/i18n_admin_build.mjs runs per leg): this file pins the
// rewritten/total return fields, the ENOENT fall-through arm, and the *.ts.tmp leftover sweep
// directly, in milliseconds, without paying for a full build.
describe('writeModuleDir (direct import)', () => {
  function scratchDir() {
    return mkdtempSync(path.join(os.tmpdir(), 'write-module-dir-'));
  }

  it('rewritten counts only the modules that actually changed on a mixed skip/rewrite run', () => {
    const dir = scratchDir();
    try {
      const first = writeModuleDir(dir, { 'a.ts': 'const a = 1;\n', 'b.ts': 'const b = 1;\n' });
      expect(first, 'first write: both modules are new, both rewritten').toEqual({
        totalBytes: Buffer.byteLength('const a = 1;\n') + Buffer.byteLength('const b = 1;\n'),
        rewritten: 2,
        total: 2,
      });

      // a.ts unchanged, b.ts content changes: exactly one of the two should be rewritten.
      const second = writeModuleDir(dir, { 'a.ts': 'const a = 1;\n', 'b.ts': 'const b = 2;\n' });
      expect(second.rewritten, 'only the diverged module is rewritten').toBe(1);
      expect(second.total, 'total counts every module in the map, skipped or not').toBe(2);
      expect(readFileSync(path.join(dir, 'a.ts'), 'utf8')).toBe('const a = 1;\n');
      expect(readFileSync(path.join(dir, 'b.ts'), 'utf8')).toBe('const b = 2;\n');

      // A fully no-op regen over an already-fresh directory rewrites nothing.
      const third = writeModuleDir(dir, { 'a.ts': 'const a = 1;\n', 'b.ts': 'const b = 2;\n' });
      expect(third.rewritten, 'a no-op regen rewrites nothing').toBe(0);
      expect(third.total).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls through to a write when the destination does not exist yet (ENOENT)', () => {
    const dir = scratchDir();
    try {
      expect(existsSync(path.join(dir, 'new.ts')), 'file does not exist before the call').toBe(
        false,
      );
      const result = writeModuleDir(dir, { 'new.ts': 'export const x = 1;\n' });
      expect(result.rewritten, 'ENOENT falls through to a write, counted as rewritten').toBe(1);
      expect(readFileSync(path.join(dir, 'new.ts'), 'utf8')).toBe('export const x = 1;\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a no-op regen leaves an unchanged module mtime untouched', () => {
    const dir = scratchDir();
    try {
      writeModuleDir(dir, { 'a.ts': 'const a = 1;\n' });
      const before = statSync(path.join(dir, 'a.ts')).mtimeMs;
      const result = writeModuleDir(dir, { 'a.ts': 'const a = 1;\n' });
      const after = statSync(path.join(dir, 'a.ts')).mtimeMs;
      expect(result.rewritten, 'byte-identical content is skipped').toBe(0);
      expect(after, 'skip means no write, so mtime is untouched').toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sweeps a *.ts.tmp leftover from a prior interrupted run', () => {
    const dir = scratchDir();
    try {
      writeModuleDir(dir, { 'a.ts': 'const a = 1;\n' });
      // Simulate a crash between the tmp writeFileSync and its renameSync: a stray
      // "<name>.ts.tmp" that never ends in plain ".ts" and would otherwise survive forever.
      const leftover = path.join(dir, 'a.ts.tmp');
      writeFileSync(leftover, 'const a = STALE;\n');
      expect(existsSync(leftover), 'leftover tmp is planted before the call').toBe(true);

      writeModuleDir(dir, { 'a.ts': 'const a = 1;\n' });

      expect(existsSync(leftover), 'the stale *.ts.tmp leftover is swept on the next run').toBe(
        false,
      );
      expect(readFileSync(path.join(dir, 'a.ts'), 'utf8')).toBe('const a = 1;\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
