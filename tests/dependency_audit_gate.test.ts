import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The dependency-audit gate is a CI-only surface: nothing in the test suite runs
// `pnpm audit` (it needs the network, and a registry outage must never present as a
// red suite). That makes the workflow file itself the only artifact a test can hold,
// so these pins cover the three decisions that carry the gate's value, each of which
// is silently reversible by a one-line edit:
//
//   1. it runs at all, on the events where its signal is actionable
//   2. it installs frozen, so the audited tree is the tree the lockfile pins
//   3. its exceptions carry a written justification
//
// (2) matters more than it looks: a non-frozen install can resolve a fixed version
// the lockfile does not actually pin, reporting a clean tree nobody ships.
const workflow = readFileSync('.github/workflows/audit.yml', 'utf8');
const catalog = readFileSync('docs/security/dependency-audit-catalog.md', 'utf8');

// Every pin below matches an ANCHORED WHOLE LINE (`^...$` with the real
// indentation), never a substring, and the file is read raw with its comments
// intact. That combination is the whole defence, and it replaced a comment-strip
// helper that tried to get there the other way round.
//
// Why the strip is gone. Stripping comments and then substring-matching sounds
// equivalent, but the strip needs a carve-out for lines carrying quotes (the cron
// expression would be truncated mid-value otherwise), and that carve-out IS a
// bypass: a quoted branch entry with the pinned tokens trailing in its comment,
//
//     - 'dev-*' # paths:       - package.json       - pnpm-lock.yaml
//
// survives the strip and keeps the substring counts whole with the real `paths:`
// filter deleted. Anchoring removes the question instead of narrowing it, because
// a comment can never match a full-line pattern on either side of a strip, so no
// helper has to be trusted at all.
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  packageManager?: string;
  pnpm?: {
    overrides?: Record<string, string>;
    auditConfig?: { ignoreCves?: string[]; ignoreGhsas?: string[] };
  };
};

const PNPM_VERSION = (() => {
  const match = (packageJson.packageManager ?? '').match(/^pnpm@(\d+\.\d+\.\d+)$/);
  if (!match) throw new Error('package.json packageManager must be pnpm@X.Y.Z');
  return match[1];
})();

describe('dependency audit gate', () => {
  // Both the pull_request and push arms must carry the dependency path filter. An
  // arm that loses its `paths:` block does not fail loudly, it just starts running
  // the audit on every push to that branch, which is the exact "red on unrelated
  // work" failure the separate workflow exists to avoid. Asserting the count (not
  // just presence) is what catches ONE arm losing it.
  it('scopes the diff-driven triggers to the dependency manifest and lockfile', () => {
    expect(workflow).toMatch(/^ {2}pull_request:$/m);
    expect(workflow).toMatch(/^ {2}push:$/m);
    expect(workflow.match(/^ {4}paths:$/gm) ?? []).toHaveLength(2);
    expect(workflow.match(/^ {6}- package\.json$/gm) ?? []).toHaveLength(2);
    expect(workflow.match(/^ {6}- pnpm-lock\.yaml$/gm) ?? []).toHaveLength(2);
  });

  // The cron is the only trigger that discovers a NEW advisory against an unchanged
  // tree, so losing it silently reduces the gate to "audits what the author already
  // touched". workflow_dispatch is what makes it runnable on demand during triage.
  it('keeps the scheduled sweep and manual dispatch', () => {
    expect(workflow).toMatch(/^ {4}- cron: '[\d\s*/,-]+'$/m);
    expect(workflow).toMatch(/^ {2}workflow_dispatch:$/m);
  });

  // Same pnpm as every other carrier, and a frozen install, or the audited tree is
  // not the shipped tree.
  it('installs the pinned pnpm version with a frozen lockfile', () => {
    const pinnedVersion = new RegExp(
      String.raw`^\s+version: ${PNPM_VERSION.replace(/\./g, '\\.')}$`,
      'm',
    );
    expect(workflow).toMatch(pinnedVersion);
    expect(workflow).toMatch(/^\s+run: pnpm install --frozen-lockfile$/m);
  });

  // The audit must fail the job on a finding. Every way this gate turns decorative
  // while still reporting a green run is a suffix or a sibling key, never a deletion:
  // `--audit-level` raises the bar above the default `low`, and `|| true`, `|| :`,
  // `; true`, or `continue-on-error` decouple the report from the job result. So the
  // run line is matched ANCHORED to end-of-line rather than by substring, which
  // rejects every trailing form at once instead of enumerating the ones I thought of.
  it('runs a blocking audit at the default severity floor', () => {
    expect(workflow).toMatch(/^\s+run: pnpm audit --ignore-registry-errors[ \t]*$/m);
    // Anchored to a real run line and a real YAML key rather than searched for as
    // bare text, so prose mentioning either (this workflow's own header explains
    // why the severity floor stays at the default) can never red the suite.
    expect(workflow).not.toMatch(/^\s+run:.*--audit-level/m);
    expect(workflow).not.toMatch(/^\s*continue-on-error:/m);
  });

  // A step or job that never runs reports success. Nothing above would notice an
  // `if: false` (or any narrowing condition) added to the job or the audit step, so
  // pin the absence directly: this workflow's triggers alone decide when it runs, and
  // it has no conditional arm to reason about.
  it('runs unconditionally, with no job or step condition', () => {
    expect(workflow).not.toMatch(/^\s+if:/m);
  });

  // Every ignored advisory needs its reasoning written down where a reviewer will
  // read it. Without this, `ignoreGhsas` is a one-line way to make any finding
  // disappear. The register lives in docs/security/ next to the malware-scan
  // catalog, not in CONTRIBUTING.md: it is a dated security record that grows and
  // gets retired entry by entry, read by someone auditing the posture, not by
  // someone learning how to open a PR. The shape check comes first so a malformed
  // id cannot pass by coincidentally appearing in the prose.
  it('documents every ignored advisory in the security catalog', () => {
    const ignored = packageJson.pnpm?.auditConfig?.ignoreGhsas ?? [];
    expect(ignored.length).toBeGreaterThan(0);
    for (const ghsa of ignored) {
      expect(ghsa).toMatch(/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
      expect(catalog, `${ghsa} is ignored but undocumented`).toContain(ghsa);
      // A bare mention in a list is not a justification. Each entry gets its own
      // section, which is what carries the reachability argument and the
      // condition for retiring it.
      expect(catalog, `${ghsa} has no catalog section`).toContain(`### ${ghsa}`);
    }
    // ignoreCves is the same escape hatch keyed by CVE rather than GHSA, so an
    // entry there would bypass the documentation rule above entirely.
    expect(packageJson.pnpm?.auditConfig?.ignoreCves ?? []).toEqual([]);
  });

  // Overrides are the primary fix, so they must stay version-scoped: a bare
  // `"undici": "^7.29.0"` selector rewrites EVERY undici range in the tree,
  // including majors the advisory never covered, which is how an override quietly
  // becomes an unreviewed dependency bump. Requiring a DIGIT after the `@` is what
  // makes that a real constraint: `undici@*` and `undici@>=0` are shaped like
  // scoped selectors and carry exactly the tree-wide reach this rejects. The
  // trailing anchor keeps a scoped package (`@scope/pkg@1`) legal, since only the
  // last `@` segment is the range.
  it('keeps every security override scoped to one version range', () => {
    const overrides = packageJson.pnpm?.overrides ?? {};
    expect(Object.keys(overrides).length).toBeGreaterThan(0);
    for (const [selector, range] of Object.entries(overrides)) {
      expect(selector, `${selector} must pin a numeric @<range> selector`).toMatch(/@\d[\w.-]*$/);
      expect(range).toMatch(/^\^?\d+\.\d+\.\d+$/);
    }
  });
});
