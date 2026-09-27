// Pins the host diagnostic bundle (electron/host_diag/) four ways: the committed
// dist really is what the committed sources build, the sources stay pure ASCII
// and LF-only, the bundle is the SHIPPING form (no dev loader, every registered
// collector present), and the pure bundler's own contract holds on synthetic
// inputs.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bundleHostDiag,
  INCLUDES_HEADER,
  parseHostDiagMeta,
  sha256Hex,
  toShippedBytes,
} from '../scripts/lib/host_diag_bundle.mjs';

// import.meta.url, not process.cwd(): the suite must find the sources whatever
// directory vitest was started from (tests/ci_changed_base.test.ts does the same).
const at = (rel: string) => new URL(`../electron/host_diag/${rel}`, import.meta.url);
const readText = (rel: string) => readFileSync(at(rel), 'utf8');
const readBytes = (rel: string) => readFileSync(at(rel));
const listDir = (rel: string, suffix: string) =>
  readdirSync(at(rel))
    .filter((name) => name.endsWith(suffix))
    .map((name) => ({ name, text: readText(`${rel}/${name}`) }));

const ORCHESTRATOR = readText('win/Invoke-HostDiag.ps1');
const FRESH_BYTES = toShippedBytes(
  bundleHostDiag({
    orchestrator: ORCHESTRATOR,
    csFiles: listDir('win/lib', '.cs'),
    libPsFiles: listDir('win/lib', '.ps1'),
    collectorPsFiles: listDir('win/collectors', '.ps1'),
  }),
);
const FRESH_TEXT = FRESH_BYTES.toString('utf8');

/** Every file under win/, recursively: the ASCII rule covers the whole tree, and
 *  a single-level read would stop seeing a future win/<platform>/ subfolder. */
function winFiles(rel = 'win'): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(at(rel), { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...winFiles(`${rel}/${entry.name}`));
    else out.push(`${rel}/${entry.name}`);
  }
  return out.sort();
}

describe('host-diag: the committed dist is what the sources build', () => {
  it('dist/HostDiag.ps1 holds the exact bytes of a fresh build', () => {
    const committed = readBytes('dist/HostDiag.ps1');
    // Compare the digests: a byte-array diff of a 100 KB script is unreadable.
    expect(sha256Hex(committed)).toBe(sha256Hex(FRESH_BYTES));
    expect(committed.length).toBe(FRESH_BYTES.length);
  });

  it('dist/manifest.json pins that build, and takes its versions from the orchestrator', () => {
    const manifestText = readText('dist/manifest.json');
    expect(manifestText).toBe(`${JSON.stringify(JSON.parse(manifestText), null, 2)}\n`);
    const manifest = JSON.parse(manifestText);
    const meta = parseHostDiagMeta(ORCHESTRATOR);
    expect(manifest).toEqual({
      file: 'HostDiag.ps1',
      sha256: sha256Hex(FRESH_BYTES),
      toolVersion: meta.toolVersion,
      schemaVersion: meta.schemaVersion,
    });
    // Not a self-comparison: these are the literal values the sources carry today,
    // so a silent version bump without a rebuild cannot slip through.
    expect(meta).toEqual({ toolVersion: '0.3.1', schemaVersion: 2 });
  });

  it('ships UTF-8 with a BOM and CRLF only (Windows PowerShell 5.1 reads BOM-less as ANSI)', () => {
    const committed = readBytes('dist/HostDiag.ps1');
    expect([...committed.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = committed.toString('utf8').slice(1);
    expect(body).not.toMatch(/(^|[^\r])\n/);
    expect(body).toMatch(/\r\n/);
  });
});

describe('host-diag: the sources stay pure ASCII and LF-only', () => {
  it('finds every file under win/, including nested folders', () => {
    const files = winFiles();
    expect(files).toContain('win/Invoke-HostDiag.ps1');
    expect(files).toContain('win/lib/NvDrs.cs');
    expect(files).toContain('win/collectors/Sampling.ps1');
    // Vacuity floor: the real tree is one orchestrator, three lib files and nine
    // collectors. A moved file must not quietly leave the ASCII scan.
    expect(files.length).toBeGreaterThanOrEqual(13);
  });

  it.each(winFiles())('%s is pure ASCII', (rel) => {
    const bytes = readBytes(rel);
    const offset = bytes.findIndex((b) => b > 0x7f);
    const context =
      offset < 0 ? '' : JSON.stringify(bytes.subarray(offset, offset + 24).toString());
    expect(offset, `${rel}: non-ASCII byte at offset ${offset}, near ${context}`).toBe(-1);
  });

  // The sources arrived from their sandbox with mixed line endings and are marked
  // `-text` in .gitattributes, so git will never normalize them for us: the only
  // thing keeping the tree uniform is this pin. The BUNDLE is still CRLF (the
  // bundler normalizes its output), which the dist tests above check separately.
  it.each(winFiles())('%s is LF-only (no CR byte)', (rel) => {
    const bytes = readBytes(rel);
    const offset = bytes.indexOf(0x0d);
    expect(offset, `${rel}: CR byte at offset ${offset}; convert the file to LF`).toBe(-1);
  });
});

describe('host-diag: the bundle is the shipping form, not the dev tree', () => {
  it('drops the BUILD:INCLUDES dev loader and keeps the inlined region', () => {
    expect(FRESH_TEXT).not.toContain('BUILD:INCLUDES');
    expect(FRESH_TEXT).not.toContain("Get-Content (Join-Path $PSScriptRoot 'lib\\");
    expect(FRESH_TEXT).not.toContain("Get-ChildItem (Join-Path $PSScriptRoot 'collectors\\");
    expect(FRESH_TEXT).toContain(INCLUDES_HEADER);
    // The literal header, not just the exported constant: the region must point a
    // reader at this repo's builder, never at the sandbox's build.ps1.
    expect(INCLUDES_HEADER).toBe(
      '#region INLINED BY scripts/host_diag_build.mjs - do not edit, edit the sources instead',
    );
    expect(FRESH_TEXT).not.toContain('build.ps1 - do not edit');
    // The dev loader IS still what the committed orchestrator carries, so the
    // absences above are a real substitution, not a coincidence.
    expect(ORCHESTRATOR).toContain('#region BUILD:INCLUDES');
    expect(ORCHESTRATOR).toContain("Get-Content (Join-Path $PSScriptRoot 'lib\\");
  });

  it('strips the dev-only fault-injection hooks from the shipped script', () => {
    expect(FRESH_TEXT).not.toContain('HOSTDIAG_TEST_');
    expect(FRESH_TEXT).not.toContain('BUILD:TESTHOOKS');
    // The hooks ARE still in the dev orchestrator, so the absence is a real strip.
    expect(ORCHESTRATOR).toContain('#region BUILD:TESTHOOKS');
    expect(ORCHESTRATOR).toContain('$env:HOSTDIAG_TEST_HANG');
  });

  it('defines every collector function the orchestrator registry dispatches to', () => {
    const fns = [...ORCHESTRATOR.matchAll(/Fn\s*=\s*'(Get-Diag\w+)'/g)].map((m) => m[1]);
    expect(fns.length).toBeGreaterThanOrEqual(9);
    expect(new Set(fns).size).toBe(fns.length);
    for (const fn of fns) expect(FRESH_TEXT).toMatch(new RegExp(`^function ${fn}\\b`, 'm'));
    // Same for the summary formatter, which -Summary calls from the orchestrator.
    expect(FRESH_TEXT).toMatch(/^function Format-DiagSummary\b/m);
  });

  it('embeds each native C# source once, inside a single-quoted here-string array', () => {
    const cs = listDir('win/lib', '.cs');
    expect(cs.map((f) => f.name)).toEqual(['NvDrs.cs', 'SysNative.cs']);
    expect(FRESH_TEXT).toContain('$script:NativeSources = @(');
    for (const file of cs) {
      const firstLine = file.text.split(/\r?\n/)[0];
      expect(FRESH_TEXT.split(firstLine).length - 1).toBe(1);
    }
  });
});

// The privacy rules the orchestrator enforces are PowerShell, so vitest cannot run
// them; what it can do is pin the two structural properties whose loss is exactly
// how the earlier bugs happened. Both are asserted on FRESH_TEXT, the shipped
// bundle, not just the source, so a bundler that dropped the region fails too.
describe('host-diag: the privacy structure the scrubber depends on', () => {
  it('runs the bare-word redaction on EVERY string, not only path-shaped ones', () => {
    // The bug: Protect-DiagObject's string arm tested `-match '\\|%'` and returned
    // an unmatched string UNTOUCHED, so the user-name / machine-name redaction
    // never reached plain prose ("access denied for <user>"), a device name, or a
    // profile name. The fast path is legitimate for the PATH rewrites alone.
    const objectFn = /function Protect-DiagObject[\s\S]*?\n(?=function |\$|# -)/.exec(FRESH_TEXT);
    expect(objectFn, 'Protect-DiagObject not found in the bundle').not.toBeNull();
    const stringArm = /if \(\$Value -is \[string\]\) \{(.*)\}/.exec(String(objectFn?.[0]));
    expect(stringArm, 'the string arm of Protect-DiagObject changed shape').not.toBeNull();
    const arm = String(stringArm?.[1]);
    // Both branches scrub: the matched one fully, the other at least the words.
    expect(arm).toContain('Protect-DiagText');
    expect(arm).toContain('Protect-DiagWords');
    // The regression itself: no branch may hand back the raw value.
    expect(arm).not.toMatch(/else\s*\{\s*return \$Value\s*\}/);
  });

  it('keeps the word patterns and the path rewrites in separate functions', () => {
    // Protect-DiagWords must not do path work and must not be the fast-path gate;
    // Protect-DiagText stays the full scrub the error messages go through.
    expect(FRESH_TEXT).toMatch(/^function Protect-DiagWords\b/m);
    expect(FRESH_TEXT).toMatch(/^function Protect-DiagPaths\b/m);
    expect(FRESH_TEXT).toMatch(/^function Protect-DiagText\b/m);
    expect(FRESH_TEXT).toContain('$script:ScrubWords');
    // Operators only: a .NET method call here would throw under Constrained
    // Language Mode, where this scrubber still has to run.
    const words = /function Protect-DiagWords[\s\S]*?\n\}/.exec(FRESH_TEXT);
    expect(String(words?.[0])).toContain("-replace $re, '%REDACTED%'");
    expect(String(words?.[0])).not.toMatch(/\[[A-Za-z.]+\]::/);
  });

  it('mints `computer` as a random per-report code, never from the machine name', () => {
    // A truncated hash of COMPUTERNAME is a pseudonym a dictionary reverses, and
    // this file is mailed to a stranger (SCHEMA.md, "Privacy").
    const block = /\$computer = 'pc-unknown'[\s\S]*?\n\} catch \{ \}/.exec(FRESH_TEXT);
    expect(block, 'the computer-code block changed shape').not.toBeNull();
    const text = String(block?.[0]);
    expect(text).toContain('New-Guid');
    expect(text).not.toContain('SHA256');
    expect(text).not.toContain('ComputeHash');
    // -NoAnonymize is the ONLY arm that may still read the machine name.
    expect(text).toMatch(/if \(\$NoAnonymize\) \{ \$env:COMPUTERNAME \}/);
    expect(text.split('$env:COMPUTERNAME').length - 1).toBe(1);
  });

  it('sweeps stale worker fragments at startup, bounded and best-effort', () => {
    // A run the caller killed leaves %TEMP%\hostdiag-<guid>-<name>.json behind.
    const sweep = /\$staleBefore = [\s\S]*?\n\} catch \{ \}/.exec(FRESH_TEXT);
    expect(sweep, 'the stale-residue sweep is missing').not.toBeNull();
    const text = String(sweep?.[0]);
    expect(text).toContain("-Filter 'hostdiag-*.json'");
    // Strictly older than the cutoff, or a concurrent run's live fragments go too.
    expect(text).toContain('New-TimeSpan -Minutes 10');
    expect(text).toContain('$old.LastWriteTime -lt $staleBefore');
    // It must never be able to fail the run.
    expect(text).toContain('Remove-Item');
    expect(text).toContain('-ErrorAction SilentlyContinue');
    // Orchestrator only: the sweep sits AFTER the worker-mode block's exit.
    expect(FRESH_TEXT.indexOf('if ($Worker) {')).toBeLessThan(FRESH_TEXT.indexOf('$staleBefore'));
  });
});

describe('host-diag: bundler contract on synthetic inputs', () => {
  const orchestrator = ['$ToolVersion = ', "'9.9.9'", '\n$SchemaVersion = 7\n'].join('');
  const shell = `head\n#region BUILD:INCLUDES\n. dev loader\n#endregion\ntail\n${orchestrator}`;
  const inputs = {
    orchestrator: shell,
    csFiles: [
      { name: 'Beta.cs', text: '// beta\n' },
      { name: 'Alpha.cs', text: '// alpha\n' },
    ],
    libPsFiles: [{ name: 'Summary.ps1', text: 'function Fmt {}\n' }],
    collectorPsFiles: [
      { name: 'Zed.ps1', text: 'function Get-DiagZed {}\n' },
      { name: 'Ant.ps1', text: 'function Get-DiagAnt {}\n' },
    ],
  };

  it('orders files ordinally, whatever order the caller passed them in', () => {
    const bundle = bundleHostDiag(inputs);
    expect(bundle.indexOf('// alpha')).toBeLessThan(bundle.indexOf('// beta'));
    expect(bundle.indexOf('# ---- collectors\\Ant.ps1 ----')).toBeLessThan(
      bundle.indexOf('# ---- collectors\\Zed.ps1 ----'),
    );
    // lib before collectors, and both after the native array.
    expect(bundle.indexOf('# ---- lib\\Summary.ps1 ----')).toBeLessThan(
      bundle.indexOf('# ---- collectors\\Ant.ps1 ----'),
    );
    expect(bundle.indexOf('$script:NativeSources = @(')).toBeLessThan(
      bundle.indexOf('# ---- lib\\Summary.ps1 ----'),
    );
    // Reversing every input list must not change a single byte.
    expect(
      bundleHostDiag({
        orchestrator: shell,
        csFiles: [...inputs.csFiles].reverse(),
        libPsFiles: [...inputs.libPsFiles].reverse(),
        collectorPsFiles: [...inputs.collectorPsFiles].reverse(),
      }),
    ).toBe(bundle);
  });

  it('commas every here-string but the last, and keeps the dev loader out', () => {
    const bundle = bundleHostDiag(inputs);
    expect(bundle).toContain("@'\r\n// alpha\r\n'@,\r\n@'\r\n// beta\r\n'@\r\n)");
    expect(bundle).not.toContain('. dev loader');
    expect(bundle).toContain('head\r\n#region INLINED BY');
    expect(bundle).toContain('#endregion\r\ntail');
  });

  it('normalizes mixed LF and CRLF input to CRLF throughout', () => {
    const bundle = bundleHostDiag({
      orchestrator: 'a\n#region BUILD:INCLUDES\nx\n#endregion\r\nb\n',
      csFiles: [{ name: 'A.cs', text: 'one\r\ntwo\nthree\n' }],
      collectorPsFiles: [{ name: 'B.ps1', text: 'p\nq\r\n' }],
    });
    expect(bundle).not.toMatch(/(^|[^\r])\n/);
    expect(bundle).toContain("@'\r\none\r\ntwo\r\nthree\r\n'@");
    expect(bundle).toContain('# ---- collectors\\B.ps1 ----\r\np\r\nq\r\n\r\n#endregion');
  });

  it('refuses inputs it cannot bundle correctly', () => {
    expect(() => bundleHostDiag({ orchestrator: 'no region here\n' })).toThrow(
      /BUILD:INCLUDES region not found/,
    );
    expect(() => bundleHostDiag({ orchestrator: '#region BUILD:INCLUDES\nx\n' })).toThrow(
      /BUILD:INCLUDES region not found/,
    );
    // A line starting with '@ would close the here-string early.
    expect(() =>
      bundleHostDiag({ ...inputs, csFiles: [{ name: 'Bad.cs', text: "ok\n'@ oops\nmore\n" }] }),
    ).toThrow(/Bad\.cs/);
  });

  it('strips a BUILD:TESTHOOKS region whole and keeps its neighbours', () => {
    const hooked = {
      ...inputs,
      orchestrator: `${shell}before\n  #region BUILD:TESTHOOKS dev\n  if ($env:HOSTDIAG_TEST_FAIL) { throw 'x' }\n  #endregion\nafter\n`,
    };
    const text = bundleHostDiag(hooked);
    expect(text).toContain('before\r\nafter\r\n');
    expect(text).not.toContain('HOSTDIAG_TEST_');
  });

  it('refuses a test hook that sits outside a BUILD:TESTHOOKS region', () => {
    const stray = {
      ...inputs,
      collectorPsFiles: [{ name: 'Ant.ps1', text: 'if ($env:HOSTDIAG_TEST_HANG) { }\n' }],
    };
    expect(() => bundleHostDiag(stray)).toThrow(/outside a BUILD:TESTHOOKS region/);
  });

  it('reads the tool and schema versions out of the orchestrator text', () => {
    expect(parseHostDiagMeta(shell)).toEqual({ toolVersion: '9.9.9', schemaVersion: 7 });
    expect(() => parseHostDiagMeta('$SchemaVersion = 7\n')).toThrow(/ToolVersion/);
    expect(() => parseHostDiagMeta("$ToolVersion = '1.0.0'\n")).toThrow(/SchemaVersion/);
  });

  it('prepends exactly one UTF-8 BOM and nothing else', () => {
    const bytes = toShippedBytes('abc');
    expect([...bytes]).toEqual([0xef, 0xbb, 0xbf, 0x61, 0x62, 0x63]);
    // Cross-check the literal byte triple against UTF-8 encoding U+FEFF itself.
    const bom = String.fromCharCode(0xfeff);
    expect(sha256Hex(bytes)).toBe(sha256Hex(Buffer.from(`${bom}abc`, 'utf8')));
  });
});
