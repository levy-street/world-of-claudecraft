import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { shouldDisableVitestFsModuleCache } from '../scripts/lib/vitest_fs_module_cache.mjs';

describe('Vitest fsModuleCache safety', () => {
  it('disables the experimental cache for linked OSS Brain worktrees', () => {
    expect(
      shouldDisableVitestFsModuleCache('/repo/.wt/dev-base-health', {
        ORCH: undefined,
        GAME_REPO: undefined,
        RUN_DIR: undefined,
        WORKTREE: undefined,
      }),
    ).toBe(true);
  });

  it('disables the experimental cache for the main OSS Brain checkout', () => {
    expect(
      shouldDisableVitestFsModuleCache('/opt/ossbrain/work/world-of-claudecraft', {
        ORCH: '/opt/ossbrain',
      }),
    ).toBe(true);
  });

  it('keeps the cache enabled for an ordinary checkout outside automation', () => {
    expect(
      shouldDisableVitestFsModuleCache(path.join(path.sep, 'home', 'dev', 'world-of-claudecraft'), {
        ORCH: undefined,
        GAME_REPO: undefined,
        RUN_DIR: undefined,
        WORKTREE: undefined,
      }),
    ).toBe(false);
  });
});
