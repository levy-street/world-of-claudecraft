import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Node major every deploy and CI carrier must agree on, and the exact runtime
// base tag. A coordinated bump moves this ONE constant plus every carrier read
// below; a bump that forgets any single carrier fails that carrier's extraction
// assertion here. This is deliberately a cross-carrier pin, unlike the
// deploy_watchdog literal (which freezes DEPLOY.md's gate line against its own text
// only, never against the Dockerfile), so a later bump that moves the Dockerfile and
// both CI files but forgets DEPLOY.md's `docker run ... node:<tag>` gate image still
// reds, and vice versa.
const TARGET_MAJOR = 26;
const TARGET_TAG = 'node:26-slim';

const dockerfile = readFileSync('Dockerfile', 'utf8');
const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const auditWorkflow = readFileSync('.github/workflows/audit.yml', 'utf8');
const desktopWorkflow = readFileSync('.github/workflows/desktop-publish.yml', 'utf8');
const nightlyWorkflow = readFileSync('.github/workflows/nightly.yml', 'utf8');
const deployDoc = readFileSync('DEPLOY.md', 'utf8');
const compose = readFileSync('docker-compose.yml', 'utf8');

/** Every major in a `FROM node:<major>...` stage line across a Dockerfile. */
function dockerfileFromMajors(text: string): number[] {
  return [...text.matchAll(/^FROM node:(\d+)[-.\w]*/gm)].map((m) => Number(m[1]));
}

/**
 * Every `node-version: <major>` value in a GitHub Actions workflow file. Anchored to the
 * start of a line (`^\s*`, multiline) so a commented-out `# node-version: 22` reminder
 * cannot inject a phantom value; the optional quote tolerates `node-version: '26'`; without
 * it a future edit that both quotes AND wrong-values one line would slip past the extraction
 * while the literal pins passed on the surviving unquoted lines.
 */
function nodeVersionValues(text: string): number[] {
  return [...text.matchAll(/^\s*node-version:\s*['"]?(\d+)/gm)].map((m) => Number(m[1]));
}

/**
 * Every Node major from a DEPLOY.md containerized tsc-gate `docker run ... -w /app node:<tag>`.
 * Anchored on the `-w /app node:` fragment (the same fragment the literal pin below uses), so
 * a future unrelated `docker run node:` example prepended above the gate cannot shift it; and
 * matchAll (not a single match) so a SECOND gate example carrying a different major is pinned
 * too, not silently ignored.
 */
function deployGateMajors(text: string): number[] {
  return [...text.matchAll(/-w \/app node:(\d+)[-.\w]*/g)].map((m) => Number(m[1]));
}

describe('deploy and CI Node version pin', () => {
  // Both Dockerfile stages (build and runtime) must sit on TARGET_MAJOR. The
  // extraction catches a bump that moves only one stage; the length check guards
  // against a stage being deleted, which would otherwise let `every` pass vacuously
  // on the surviving line. The literal count is the belt-and-suspenders pin: a
  // reformat that slips past the regex still has to keep two `FROM node:26-slim`.
  it('pins both Dockerfile FROM stages to the target Node major', () => {
    const majors = dockerfileFromMajors(dockerfile);
    expect(majors).toHaveLength(2);
    for (const major of majors) expect(major).toBe(TARGET_MAJOR);
    // split() length is occurrences + 1, so two `FROM node:26-slim` gives 3.
    expect(dockerfile.split(`FROM ${TARGET_TAG}`)).toHaveLength(3);
  });

  // Full pnpm migration: the game-server image must not reintroduce package-lock.json
  // or npm ci. Pin packageManager version + frozen install so a copy-paste npm
  // Dockerfile cannot ship while CI and local stay on pnpm-lock.yaml.
  it('installs build deps with pnpm frozen-lockfile matching packageManager', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      packageManager?: string;
    };
    const field = pkg.packageManager ?? '';
    const match = field.match(/^pnpm@(\d+\.\d+\.\d+)$/);
    expect(match).not.toBeNull();
    const pnpmVer = match?.[1] ?? '';
    expect(pnpmVer).toMatch(/^\d+\.\d+\.\d+$/);
    expect(dockerfile).toContain(`pnpm@${pnpmVer}`);
    expect(dockerfile).toContain('pnpm-lock.yaml');
    expect(dockerfile).toContain('.npmrc');
    expect(dockerfile).toContain('pnpm install --frozen-lockfile');
    expect(dockerfile).not.toContain('package-lock.json');
    expect(dockerfile).not.toContain('npm ci');
  });

  // Every actions/setup-node step in the main CI workflow must be on TARGET_MAJOR.
  // desktop-publish.yml is deliberately NOT read here: the Steam/Electron publish
  // path is intentionally held on Node 22, so folding it in would wrongly red this
  // pin. The non-empty guard stops a workflow that lost all its node-version lines
  // from passing vacuously through `every`.
  it('pins every ci.yml node-version to the target Node major', () => {
    const values = nodeVersionValues(ciWorkflow);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toBe(TARGET_MAJOR);
    expect(ciWorkflow).toContain(`node-version: ${TARGET_MAJOR}`);
  });

  // audit.yml carries its own setup-node step and lives outside ci.yml on purpose (its
  // `schedule` trigger would otherwise fire ci.yml's changes/lint/browser-gate jobs), so
  // the cross-carrier pin has to read it separately or a Node bump would leave the audit
  // job behind on a version nothing else builds against.
  it('pins every audit.yml node-version to the target Node major', () => {
    const values = nodeVersionValues(auditWorkflow);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toBe(TARGET_MAJOR);
    expect(auditWorkflow).toContain(`node-version: ${TARGET_MAJOR}`);
  });

  // nightly.yml re-proves the tips on a schedule with its own setup-node steps, so it
  // is a bump carrier like audit.yml: fold it into the coordinated move or the nightly
  // would silently prove the tree against a Node nothing else ships on.
  it('pins every nightly.yml node-version to the target Node major', () => {
    const values = nodeVersionValues(nightlyWorkflow);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toBe(TARGET_MAJOR);
    expect(nightlyWorkflow).toContain(`node-version: ${TARGET_MAJOR}`);
  });

  // DEPLOY.md's containerized tsc-gate builds the type check inside
  // `docker run ... node:<tag>`. This is the carrier the deploy_watchdog literal
  // cannot catch drifting against the rest, so extract its major and equate it to
  // TARGET_MAJOR explicitly, plus an anchored literal so a matching reformat still
  // has to carry the exact base tag on the gate line.
  it('pins the DEPLOY.md containerized tsc-gate image to the target Node major', () => {
    const majors = deployGateMajors(deployDoc);
    expect(majors.length).toBeGreaterThan(0);
    for (const major of majors) expect(major).toBe(TARGET_MAJOR);
    expect(deployDoc).toContain(`-w /app ${TARGET_TAG}`);
  });

  // desktop-publish.yml is DELIBERATELY held on Node 22: the Steam/Electron publish
  // path stays on 22 by an intentional decision until it is separately revisited. This
  // positive pin locks that intentional divergence: it reds if desktop-publish.yml is
  // accidentally swept to the target major with the rest, forcing a conscious decision
  // (and an update here) rather than a silent bump. If the publish path is later moved
  // to the target too, fold it into nodeVersionValues above, delete this, and drop its
  // NODE_MAJOR_EXEMPTIONS entry below.
  it('keeps desktop-publish.yml on Node 22, not the target major', () => {
    const values = nodeVersionValues(desktopWorkflow);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toBe(22);
    expect(desktopWorkflow).not.toContain(`node-version: ${TARGET_MAJOR}`);
  });

  // The game healthcheck comment names the runtime base explicitly (node:26-slim, a Debian
  // slim base with no curl/wget) to justify the exec-form node probe. That tag is a
  // hand-maintained echo of the Dockerfile runtime stage on a comment line no other pin
  // reads, so pin it to the target base tag: a coordinated bump that moves the Dockerfile
  // but leaves the comment naming the old base reds here rather than shipping a comment that
  // lies about the image the healthcheck runs in.
  it('keeps the docker-compose healthcheck comment on the target base tag', () => {
    expect(compose).toContain(`(${TARGET_TAG})`);
  });

  // The whole-directory closer: the per-file arms above each pin a KNOWN carrier, so a
  // NEW workflow carrying its own Node toolchain would land unpinned and drift silently.
  // ota-publish.yml did exactly that (Node 22 with no recorded decision, inherited from
  // desktop-publish, until the 2026-08-07 bump). Enumerate .github/workflows and hold
  // every declared node-version to the target major unless the file is in the named
  // exemption list below. The read is single-level by GitHub's own contract: Actions
  // registers only top-level workflow files, so a YAML parked in a subdirectory is inert
  // to CI and a flat read matches the real registration surface rather than narrowing it.
  // The read still checks that premise (tests/CLAUDE.md, scan-guard rules): the day this
  // directory grows a subdirectory, refuse loudly instead of quietly skipping whatever
  // sits inside it, because a workflow parked there would also silently never run in CI.
  const WORKFLOW_DIR = '.github/workflows';
  const workflowEntries = readdirSync(WORKFLOW_DIR, { withFileTypes: true });
  const workflowSubdirs = workflowEntries.filter((e) => e.isDirectory()).map((e) => e.name);
  if (workflowSubdirs.length > 0) {
    throw new Error(
      `${WORKFLOW_DIR} grew subdirectories (${workflowSubdirs.join(', ')}): a workflow file ` +
        'in there is inert to Actions and invisible to this scan; move it to the top level ' +
        'or extend this scan consciously.',
    );
  }
  const workflowFiles = workflowEntries
    .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
    .map((e) => e.name)
    .sort();

  // Workflows allowed off the target major, each with its recorded reason. An entry must
  // BOTH exist and still diverge (second test below), so an exemption cannot rot into a
  // blanket waiver after the divergence it covered is gone.
  const NODE_MAJOR_EXEMPTIONS: Record<string, string> = {
    'desktop-publish.yml':
      'Steam/Electron publish path deliberately held on Node 22 until separately revisited',
  };

  it('holds every workflow node-version to the target major or a named exemption', () => {
    // Vacuity floor: the enumeration must see the known carriers before "every" means much.
    expect(workflowFiles).toContain('ci.yml');
    expect(workflowFiles).toContain('desktop-publish.yml');
    expect(workflowFiles).toContain('ota-publish.yml');
    const filesWithValues = new Set<string>();
    for (const file of workflowFiles) {
      if (file in NODE_MAJOR_EXEMPTIONS) continue;
      const text = readFileSync(join(WORKFLOW_DIR, file), 'utf8');
      // Only a literal numeric node-version is pinnable by extraction, so the
      // non-literal carriers must be banned here or a new workflow could ride
      // node-version-file, an expression, or lts/latest straight past the pin.
      expect(
        text.includes('node-version-file:'),
        `${file} uses node-version-file; pin a literal node-version or exempt it with a reason`,
      ).toBe(false);
      for (const m of text.matchAll(/^\s*node-version:\s*(.*)$/gm)) {
        expect(
          /^['"]?\d+['"]?$/.test(m[1].trim()),
          `${file} carries a non-literal node-version "${m[1].trim()}"; only a plain major ` +
            'is pinnable here. Use a literal or exempt the file with a reason.',
        ).toBe(true);
      }
      const values = nodeVersionValues(text);
      if (values.length > 0) filesWithValues.add(file);
      for (const value of values) {
        expect(
          value,
          `${file} declares node-version ${value}; the target major is ${TARGET_MAJOR}. ` +
            'Bump it or add a reasoned NODE_MAJOR_EXEMPTIONS entry.',
        ).toBe(TARGET_MAJOR);
      }
    }
    // Per-file vacuity floor for the carrier this arm exists to hold: dropping the
    // explicit version to ride the runner default is exactly the silent-drift shape,
    // so a known carrier losing all its node-version lines must red, not pass empty.
    // (ci.yml, audit.yml, and nightly.yml have their own non-empty guards above.)
    expect(
      filesWithValues,
      'ota-publish.yml no longer declares any node-version; the runner default is unpinned',
    ).toContain('ota-publish.yml');
  });

  it('keeps every exemption naming a real, still-divergent workflow', () => {
    for (const [file, reason] of Object.entries(NODE_MAJOR_EXEMPTIONS)) {
      expect(reason.trim().length, `${file} exemption needs a recorded reason`).toBeGreaterThan(0);
      expect(workflowFiles, `stale exemption: ${file} is not in ${WORKFLOW_DIR}`).toContain(file);
      const values = nodeVersionValues(readFileSync(join(WORKFLOW_DIR, file), 'utf8'));
      expect(values.length, `${file} declares no node-version; drop the exemption`).toBeGreaterThan(
        0,
      );
      expect(
        values.some((value) => value !== TARGET_MAJOR),
        `${file} sits on the target major now; drop the exemption`,
      ).toBe(true);
    }
  });

  // DEPLOY.md's tsc-gate carries a prose aside for the host that already has Node on PATH
  // ("On a host that does have Node <major> on PATH ..."). It states the same major as the
  // gate image but on a different line the `-w /app node:` extraction never sees, so pin the
  // phrase to the target major: a bump that moves the gate image but forgets this aside would
  // otherwise leave the doc telling operators to use the wrong Node major off-box.
  it('pins the DEPLOY.md Node-on-PATH aside to the target major', () => {
    expect(deployDoc).toContain(`Node ${TARGET_MAJOR} on PATH`);
  });
});
