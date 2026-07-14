import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default function setup(): () => void {
  if (process.env.WOC_SFX_STUDIO_TEST_ROOT) return () => {};
  const root = mkdtempSync(join(tmpdir(), 'woc-sfx-studio-vitest-'));
  process.env.WOC_SFX_STUDIO_TEST_ROOT = root;
  return () => {
    delete process.env.WOC_SFX_STUDIO_TEST_ROOT;
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  };
}
