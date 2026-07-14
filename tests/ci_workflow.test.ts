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
