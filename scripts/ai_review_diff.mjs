// Pure helpers for the AI reviewer's diff handling, split out so they unit-test without
// the CLI, the network, or the top-level side effects of ai_review.mjs.
//
// A raw PR diff is mostly noise for a reviewer: regenerated i18n tables, parity golden
// snapshots, lockfiles, and binary assets can dwarf the actual code change and burn the
// character budget (which then truncates the real code). filterReviewDiff drops those
// per-file sections so the model sees the hand-written change, and reports what it dropped
// so the prompt can say so.

// Path fragments whose per-file diff is generated, vendored, or binary: reviewing the diff
// text of these adds nothing (they are derived from the real change, gated elsewhere).
const NOISE = [
  'i18n.resolved.generated/',
  'i18n.status.json',
  'i18n.status.summary.json',
  'i18n.resolved.sha256',
  '.generated.ts',
  'tests/parity/golden/',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
];

// Extensions that are binary/asset blobs (a diff shows them as "Binary files differ" or a
// huge base64-ish blob); never useful to a code reviewer.
const BINARY_EXT = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.glb',
  '.gltf',
  '.hdr',
  '.mp3',
  '.wav',
  '.ogg',
  '.woff',
  '.woff2',
  '.pdf',
];

// The b-side path of a "diff --git a/<x> b/<y>" section header.
function sectionPath(section) {
  const header = section.match(/^diff --git a\/(?:.+?) b\/(.+)$/m);
  if (header) return header[1].trim();
  const plus = section.match(/^\+\+\+ b\/(.+)$/m);
  return plus ? plus[1].trim() : '';
}

function isNoise(path) {
  if (!path) return false;
  if (NOISE.some((n) => path.includes(n))) return true;
  return BINARY_EXT.some((ext) => path.toLowerCase().endsWith(ext));
}

// Split a unified diff into per-file sections. Each section starts at a "diff --git" line.
function splitSections(diff) {
  const parts = diff.split(/(?=^diff --git )/m);
  // A leading chunk before the first "diff --git" (rare) is kept as-is if non-empty.
  return parts.filter((p) => p.length > 0);
}

// Drop the generated/vendored/binary file sections from a unified diff. Returns the kept
// diff plus the list of dropped paths (for a one-line note in the prompt).
export function filterReviewDiff(diff) {
  if (!diff) return { diff: '', dropped: [] };
  const kept = [];
  const dropped = [];
  for (const section of splitSections(diff)) {
    if (!section.startsWith('diff --git ')) {
      kept.push(section);
      continue;
    }
    const path = sectionPath(section);
    if (isNoise(path)) dropped.push(path);
    else kept.push(section);
  }
  return { diff: kept.join(''), dropped };
}

// Apply the character cap after filtering, cutting on a section boundary when possible so
// the model never sees a half-truncated hunk. Returns { diff, truncated }.
export function capDiff(diff, maxChars) {
  if (!maxChars || diff.length <= maxChars) return { diff, truncated: false };
  const head = diff.slice(0, maxChars);
  // Prefer to end at the last complete file section within the cap.
  const lastBoundary = head.lastIndexOf('\ndiff --git ');
  const cut = lastBoundary > 0 ? head.slice(0, lastBoundary + 1) : head;
  return { diff: cut, truncated: true };
}
