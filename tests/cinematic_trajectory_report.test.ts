import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const reportScript = fileURLToPath(
  new URL('../scripts/cinematic_trajectory_report.mjs', import.meta.url),
);

describe('cinematic trajectory report CLI', () => {
  it('bundles the registered campaign scenes without a content import cycle', () => {
    const stdout = execFileSync(process.execPath, [reportScript, '--all'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      timeout: 30_000,
    });

    expect(stdout).toContain('scn_lb_ferry_depart_back');
    expect(stdout).toContain('scn_lb_ferry_depart_out');
    expect(stdout).toContain('scn_lb_q0_voyage');
  });
});
