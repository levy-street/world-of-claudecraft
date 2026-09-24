// Pure bundler for the host diagnostic, Windows layer (electron/host_diag/win/**).
//
// It replaces the PowerShell build.ps1 that shipped with the tool's original
// sandbox: same output, but deterministic and runnable on any platform. No fs
// access lives here on purpose, so tests/host_diag_bundle.test.ts can drive the
// whole transform from synthetic inputs. The CLI (scripts/host_diag_build.mjs)
// owns reading and writing.
//
// Faithfulness contract (each step below mirrors one step of the original
// build.ps1, and the committed dist is pinned to the exact bytes):
//   - the orchestrator's `#region BUILD:INCLUDES ... #endregion` dev loader is
//     replaced wholesale by an inlined region;
//   - the C# sources become a `$script:NativeSources` array of single-quoted
//     here-strings, in name order;
//   - the lib .ps1 files then the collector .ps1 files are concatenated, each
//     under a `# ---- <dir>\<name> ----` marker, in name order;
//   - every embedded body is right-trimmed.
// One deliberate departure: every line ending in the output is CRLF. The
// sources are LF (pinned by tests/host_diag_bundle.test.ts) and the original
// build.ps1 carried whatever mix it was handed into the bundle, which makes the
// shipped bytes depend on how the sources were checked out. Windows PowerShell
// 5.1 reads either, so the bundle is normalized instead.

import { createHash } from 'node:crypto';

/** The marker comment the inlined region opens with. It names the builder that
 *  actually produces the bundle, so a reader of dist/HostDiag.ps1 is pointed at
 *  this repo's build step rather than at the original sandbox's build.ps1. */
export const INCLUDES_HEADER =
  '#region INLINED BY scripts/host_diag_build.mjs - do not edit, edit the sources instead';

/** The dev-time loader in the orchestrator, replaced at build time. Non-greedy,
 *  exactly like the `(?s)#region BUILD:INCLUDES.*?#endregion` pattern it ports. */
const INCLUDES_REGION = /#region BUILD:INCLUDES[\s\S]*?#endregion/;

/** Dev-only fault-injection hooks (`HOSTDIAG_TEST_*` environment variables).
 *  Whole lines, stripped from the shipped script: a player's session
 *  environment must not be able to hang or crash a collector. */
const TESTHOOKS_REGION = /^[ \t]*#region BUILD:TESTHOOKS[\s\S]*?#endregion[ \t]*\r?\n/gm;

const CRLF = '\r\n';

/** Normalizes every line ending (LF or CRLF) to CRLF. */
export function toCrlf(text) {
  return String(text).replace(/\r\n|\n|\r/g, CRLF);
}

/** Right-trims trailing whitespace, including trailing newlines (String.TrimEnd). */
function trimEnd(text) {
  return String(text).replace(/\s+$/, '');
}

/** Ordinal (code-unit) sort by `name`, so the order never depends on the
 *  caller's directory-listing order or on a host locale. */
export function sortByName(files) {
  return [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Parses `$ToolVersion` and `$SchemaVersion` out of the orchestrator source.
 *  They are the two values the manifest publishes, and the orchestrator is
 *  their single source of truth. */
export function parseHostDiagMeta(orchestrator) {
  const version = /^\$ToolVersion\s*=\s*'([^']+)'/m.exec(orchestrator);
  const schema = /^\$SchemaVersion\s*=\s*(\d+)/m.exec(orchestrator);
  if (!version) throw new Error('host-diag: $ToolVersion not found in the orchestrator');
  if (!schema) throw new Error('host-diag: $SchemaVersion not found in the orchestrator');
  return { toolVersion: version[1], schemaVersion: Number(schema[1]) };
}

/** Builds the inlined replacement for the BUILD:INCLUDES region. */
export function buildIncludesRegion({ csFiles = [], libPsFiles = [], collectorPsFiles = [] } = {}) {
  const cs = sortByName(csFiles);
  const out = [INCLUDES_HEADER, '$script:NativeSources = @('];
  cs.forEach((file, i) => {
    const code = trimEnd(toCrlf(file.text));
    // A line starting with '@ would close the here-string early and produce a
    // bundle that does not parse. The original build.ps1 refuses the same way.
    if (/^'@/m.test(code)) {
      throw new Error(
        `host-diag: ${file.name} has a line starting with '@ : it breaks the here-string`,
      );
    }
    out.push("@'", code, i < cs.length - 1 ? "'@," : "'@");
  });
  out.push(')');
  for (const file of sortByName(libPsFiles)) {
    out.push(`# ---- lib\\${file.name} ----`, trimEnd(toCrlf(file.text)), '');
  }
  for (const file of sortByName(collectorPsFiles)) {
    out.push(`# ---- collectors\\${file.name} ----`, trimEnd(toCrlf(file.text)), '');
  }
  // Every entry above is a full line; `#endregion` closes the region with no
  // trailing newline, because the orchestrator text resumes right after it.
  return `${out.map((line) => line + CRLF).join('')}#endregion`;
}

/** Returns the single-file bundle text (CRLF, no BOM: the writer adds that). */
export function bundleHostDiag({
  orchestrator,
  csFiles = [],
  libPsFiles = [],
  collectorPsFiles = [],
} = {}) {
  const main = toCrlf(orchestrator ?? '');
  if (!INCLUDES_REGION.test(main)) {
    throw new Error('host-diag: BUILD:INCLUDES region not found in Invoke-HostDiag.ps1');
  }
  const region = buildIncludesRegion({ csFiles, libPsFiles, collectorPsFiles });
  // A function replacement, so `$&` and friends inside the region stay literal
  // (PowerShell variables are everywhere in these sources).
  const bundled = main.replace(INCLUDES_REGION, () => region);
  // After the inlining, so a hook region in any source file is stripped too.
  const shipped = bundled.replace(TESTHOOKS_REGION, '');
  if (/HOSTDIAG_TEST_/.test(shipped)) {
    throw new Error('host-diag: a HOSTDIAG_TEST_ hook sits outside a BUILD:TESTHOOKS region');
  }
  return shipped;
}

/** The exact bytes that ship: UTF-8 with a BOM, because Windows PowerShell 5.1
 *  reads a BOM-less file as ANSI. */
export function toShippedBytes(text) {
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
}

/** Lowercase hex SHA-256 of a Buffer or string. */
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}
