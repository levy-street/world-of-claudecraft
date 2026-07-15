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

  it('runs the opt-in Chromium browser regressions in their own CI job', () => {
    const browserGate = jobSource('browser-gate');
    expect(browserGate).toContain('run: npx playwright install --with-deps chromium');
    expect(browserGate).toContain('run: npm run test:browser');
    expect(gate).toContain("['browser regressions', 'npm', ['run', 'test:browser']]");
  });

  it('posts the i18n coverage summary and diffs only the committed slices in both jobs', () => {
    // The job-summary step is the out-of-band audit trail that replaced the
    // committed src/ui/i18n.status.summary.json; deleting it would silently
    // drop the trail, and re-adding the summary to a freshness diff or to
    // gate.mjs would resurrect the aggregate merge conflicts the degit removed.
    const prGate = jobSource('pr-gate');
    const releaseGate = jobSource('release-gate');
    for (const job of [prGate, releaseGate]) {
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
    const releaseGate = jobSource('release-gate');
    expect(prGate).toContain(
      "github.event_name == 'pull_request' && (github.base_ref != 'main' || !startsWith(github.head_ref, 'release/'))",
    );
    expect(prGate).toContain(
      "github.event_name == 'push' && !startsWith(github.ref, 'refs/heads/release/')",
    );
    expect(prGate).toContain("github.event_name == 'workflow_dispatch'");
    expect(prGate).not.toContain('I18N_RELEASE_TIER');
    expect(releaseGate).toContain("I18N_RELEASE_TIER: '1'");
    expect(releaseGate).toContain(
      "github.event_name == 'pull_request' && github.base_ref == 'main'",
    );
    expect(releaseGate).toContain("startsWith(github.head_ref, 'release/')");
    expect(releaseGate).toContain(
      "github.event_name == 'push' && startsWith(github.ref, 'refs/heads/release/')",
    );
  });
});
