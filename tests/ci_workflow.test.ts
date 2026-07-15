import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const gate = readFileSync(new URL('../scripts/gate.mjs', import.meta.url), 'utf8');

function jobSource(name: string): string {
  const match = workflow.match(new RegExp(`\\n  ${name}:[\\s\\S]*?(?=\\n  [a-z][a-z-]+:|$)`));
  if (!match) throw new Error(`missing CI job: ${name}`);
  return match[0];
}

describe('CI workflow parity', () => {
  it('runs the canonical game and admin typecheck in CI and the local gate', () => {
    expect(workflow.match(/run: npm run check:types/g)).toHaveLength(2);
    expect(workflow).not.toContain('run: npx tsc --noEmit');
    expect(gate).toContain("['typecheck', 'npm', ['run', 'check:types']]");
  });

  it('provisions FFmpeg from the static npm packages instead of apt', () => {
    // The gate preflight and the Studio playback/encode spawns resolve
    // ffmpeg/ffprobe via scripts/sfx/ffmpeg_paths.mjs (ffmpeg-static/
    // ffprobe-static with a PATH fallback); the conformance-measuring call sites
    // (sfx_conform.mjs, export_bundle.mjs) bind to the static packages directly.
    // Either way no CI job apt-installs system FFmpeg; reintroducing the install
    // step would put its cost back on every job it touches.
    expect(workflow).not.toContain('apt-get');
    expect(gate).toContain("from './sfx/ffmpeg_paths.mjs'");
  });

  it('runs the opt-in Chromium browser regressions in their own CI job', () => {
    const browserGate = jobSource('browser-gate');
    expect(browserGate).toContain('run: npx playwright install --with-deps chromium');
    expect(browserGate).toContain('run: npm run test:browser');
    expect(gate).toContain("['browser regressions', 'npm', ['run', 'test:browser']]");
  });

  it('posts the i18n coverage summary and diffs the committed artifacts in both jobs', () => {
    // The job-summary step is the out-of-band audit trail that replaced the
    // committed src/ui/i18n.status.summary.json; deleting it would silently
    // drop the trail, and re-adding the summary to a freshness diff or to
    // gate.mjs would resurrect the aggregate merge conflicts the degit removed.
    // The PR-tier copies of both steps live in pr-checks, not pr-gate.
    const prChecks = jobSource('pr-checks');
    const releaseGate = jobSource('release-gate');
    for (const job of [prChecks, releaseGate]) {
      expect(job).toContain('run: node scripts/i18n_coverage_summary.mjs');
      expect(job).toContain(
        'run: git diff --exit-code -- src/ui/i18n.resolved.generated src/admin/i18n.resolved.generated src/ui/i18n.catalog/translation_keys.generated.ts',
      );
      expect(job).not.toContain('src/ui/i18n.status.summary.json');
    }
    expect(gate).not.toContain('src/ui/i18n.status.summary.json');
  });

  it('runs the release tier against a release-to-main pull request merge result', () => {
    const prGate = jobSource('pr-gate');
    const prChecks = jobSource('pr-checks');
    const releaseGate = jobSource('release-gate');
    for (const job of [prGate, prChecks]) {
      expect(job).toContain(
        "github.event_name == 'pull_request' && (github.base_ref != 'main' || !startsWith(github.head_ref, 'release/'))",
      );
      expect(job).toContain(
        "github.event_name == 'push' && !startsWith(github.ref, 'refs/heads/release/')",
      );
      expect(job).toContain("github.event_name == 'workflow_dispatch'");
      expect(job).not.toContain('I18N_RELEASE_TIER');
    }
    expect(releaseGate).toContain("I18N_RELEASE_TIER: '1'");
    expect(releaseGate).toContain(
      "github.event_name == 'pull_request' && github.base_ref == 'main'",
    );
    expect(releaseGate).toContain("startsWith(github.head_ref, 'release/')");
    expect(releaseGate).toContain(
      "github.event_name == 'push' && startsWith(github.ref, 'refs/heads/release/')",
    );
  });

  it('splits the PR tier into parallel test and checks jobs that cover every step', () => {
    const prGate = jobSource('pr-gate');
    const prChecks = jobSource('pr-checks');
    // Parallel means no needs edge in either direction, and splitting must not
    // DROP a check: the checks job carries every serialized step the single
    // pr-gate job used to run, while pr-gate keeps the test suite.
    expect(prGate).not.toContain('needs:');
    expect(prChecks).not.toContain('needs:');
    expect(prGate).toContain('run: npm test');
    expect(prChecks).not.toContain('run: npm test');
    for (const step of [
      'run: npm run i18n:gen',
      'run: node scripts/i18n_coverage_summary.mjs',
      'run: git diff --exit-code -- src/ui/i18n.resolved.generated',
      'run: npm run security:gate',
      'run: npm run check:types',
      'run: npm run build:env',
      'run: npm run build:server',
      'run: npm run build\n',
    ]) {
      expect(prChecks).toContain(step);
      expect(prGate).not.toContain(step);
    }
  });
});
