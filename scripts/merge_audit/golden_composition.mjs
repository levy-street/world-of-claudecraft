#!/usr/bin/env node
// Masterwrought Phase 11d, unit 2: the golden COMPOSITION check for a merge
// re-record of tests/parity/golden/*.json. A re-recorded golden agrees with
// whatever the merged sim produces, so it cannot by itself tell a correct
// resolution from a dropped hunk. This script supplies the missing proof: for
// every golden present on BOTH merge parents it reads base, ours, theirs (via
// `git show`, nothing is checked out) and the MERGED file from disk, aligns
// frames by their (tick, label) key, and asserts that every readable,
// non-digest field COMPOSES:
//   numeric leaf:  merged - base == (ours - base) + (theirs - base); when BOTH
//                  parents moved the leaf, merged equal to ours or to theirs is
//                  an accepted SIDE-PICK (counted and printed, never silent),
//                  and merged matching none of the three is the finding
//   other leaf:    the three-way rule (if one side kept base, merged equals the
//                  other side; if both agree, merged equals them; else CONFLICT)
// over the top-level ticks / draws / coverage, every frame's tick / label /
// time / nextId / rng.draws, and every leaf under players[] and entities[]
// (ids, entityId, sourceId, hp, auras, ...). rng.digest and drawDigest follow
// the three-way rule too, which is the determinism anchor. Stated precisely,
// because the looser phrasing this header used to carry ("in a scenario neither
// packet touched") is UNFALSIFIABLE for the 11b absorb and the Phase 11d QA
// corrected it in the phase file: there is no such scenario, since all 67 shared
// goldens were touched by BOTH parents. What actually holds, and what this tool
// asserts, is that merged draws, drawDigest and every frame's rng equal OURS byte
// for byte, because farming shifted entity ids without perturbing the shared rng
// stream. A draw digest that moves during a re-record is a regression the
// re-record would bless. A frame only one parent carries (a scenario that parent lengthened)
// is checked against that parent with the other parent's contribution
// limited to the uniform id-family shift. The state and events digests are
// derived from the composed fields and are reported, never asserted.
//
// Goldens present on only one parent (clean adds) are compared against that
// parent: rng.draws / rng.digest / draws / drawDigest must be byte-equal; for
// an ours-only add every other numeric leaf may move only by the uniform
// id-family shift (the other parent's world-init allocations) and no string
// leaf may move (except the derived digests); for a theirs-only add the
// non-rng differences are LISTED for the reader to check against the ledger's
// written prediction (the farming_session composition block in state.md).
//
// THE RELEASE PARENTS (Phase 18, closing the tool gap the 11e ledger recorded).
// The branch keeps syncing release/** after the absorb merge, and a synced
// release is a PARENT of the merged tree exactly as it is for the census: a
// merged golden that follows the release on a leaf where both modelled parents
// agree on the other value used to read "base 2, ours 2, theirs 2, merged 1",
// a correct verdict from an incomplete model (the milepost_boots loot.items
// rows: 16 findings, exit 1 for the rest of the branch's life). The parent set
// is the one symbol_census builds, REUSED by import: RELEASE_REF (override
// --release <ref>) plus the second parent of every later first-parent merge
// (deriveSyncRefs; --sync <ref> adds one by hand, --no-auto-sync turns the
// derivation off). The rule: where a finding WOULD be raised (a numeric leaf
// that does not compose, a three-way violation or CONFLICT, a presence move,
// a type mismatch, an unaligned whole-value array), a merged value that is
// byte-equal (canonical JSON) to some release parent's value at the same path
// composes BY RELEASE instead: counted per golden, sampled in a NOTE line,
// never silent. Absence never matches (a key merged dropped takes no escape),
// and the determinism anchors never take it: `draws`, `drawDigest` and every
// `rng` leaf red exactly as before, because an rng digest that moves during a
// re-record is the regression the re-record would bless, whichever parent it
// happens to agree with. A golden on NO modelled parent that a release parent
// carries is a release-only add (compared against that parent like a
// theirs-only add), not an ORPHAN; the newest release tip joins the MISSING
// parent set. With no release parents the tool behaves as it did before.
//
// Usage (from the repo root, after the UPDATE_PARITY re-record):
//   node scripts/merge_audit/golden_composition.mjs [--base <ref>] [--ours <ref>]
//        [--theirs <ref>] [--release <ref>] [--sync <ref>]... [--no-auto-sync]
//        [--golden-dir tests/parity/golden] [--verbose]
// Exit code 1 on any composition failure, rng movement, unaligned frame set,
// or a golden with no parent. Defaults are the 11b farming-absorb refs.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveSyncRefs, RELEASE_REF } from './symbol_census.mjs';

const ROOT = process.cwd();
const DEFAULTS = {
  base: 'e56707a675013fc1a86bb19d31a0a8d79a02a197',
  ours: 'd5304a78c4a1add6b1ed5a0b66ddb9f8246a4d73',
  theirs: '8cd964d599ebbb6800fc20741690a0b9b6f17b40',
};
function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
/** Every value of a repeatable flag (`--sync <ref> --sync <ref>`), in order. */
function argValues(flag) {
  const out = [];
  process.argv.forEach((a, i) => {
    if (a === flag && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
}
const REFS = {
  base: argValue('--base', DEFAULTS.base),
  ours: argValue('--ours', DEFAULTS.ours),
  theirs: argValue('--theirs', DEFAULTS.theirs),
};
const GOLDEN_DIR = argValue('--golden-dir', 'tests/parity/golden');
const VERBOSE = process.argv.includes('--verbose');

/**
 * The release-parent list in census order: the pinned (or --release) tip first,
 * then the second parent of every later first-parent merge (deriveSyncRefs,
 * newest first), then the --sync extras; resolved BEFORE dedupe so two spellings
 * of one commit collapse. Pure: the resolver is injected (git rev-parse in main).
 * @param {{releaseRef?: string, derived?: Array<{ref: string, via: string}>,
 *          extra?: string[], resolve?: (ref: string) => string}} args
 * @returns {Array<{ref: string, via: string | null}>}
 */
export function releaseParentRefs({
  releaseRef = RELEASE_REF,
  derived = [],
  extra = [],
  resolve = (ref) => ref,
} = {}) {
  const out = [];
  const seen = new Set();
  for (const cand of [
    { ref: releaseRef, via: null },
    ...derived,
    ...extra.map((ref) => ({ ref, via: null })),
  ]) {
    const full = resolve(cand.ref);
    if (seen.has(full)) continue;
    seen.add(full);
    out.push({ ref: full, via: cand.via ?? null });
  }
  return out;
}

/** The newest synced release tip: the first derived sync (git log order is
 *  newest first), else the pinned release ref. Only this one joins the MISSING
 *  parent set, because a golden an EARLIER sync carried and a later release
 *  retired is legitimately absent from merged. */
export function newestReleaseRef({ releaseRef = RELEASE_REF, derived = [] } = {}) {
  return derived[0]?.ref ?? releaseRef;
}

function resolveRef(ref) {
  try {
    return execFileSync('git', ['-C', ROOT, 'rev-parse', `${ref}^{commit}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return ref;
  }
}

/**
 * Which comparison path a golden takes, from which refs carry it. A golden on no
 * modelled parent that some release parent carries is a release-only add (the
 * release recorded it and the merge kept it), never an ORPHAN.
 * @param {{b: unknown, o: unknown, t: unknown, releases?: unknown[]}} args
 */
export function classifyLineage({ b, o, t, releases = [] }) {
  if (b && o && t) return 'shared';
  if (o && !t && !b) return 'ours-only add';
  if (t && !o && !b) return 'theirs-only add';
  if (!b && !o && !t && releases.some(Boolean)) return 'release-only add';
  return 'orphan';
}

// The id FAMILY, for reporting which numeric moves are the uniform entity-id
// shift: `id`, `nextId`, any `...Id` key, the id LISTS (`...Ids[i]`,
// bossDamagers[i], personalFor[i]), the threat table's entity column
// (threat[i][0]) and the masterwork crafter. In the four-way path this is
// classification only, and the composition assertion is the same for every
// numeric leaf. In the TWO-WAY path (a clean add, or a frame only one parent
// carries) it is LOAD-BEARING: it routes a leaf away from the hard `numeric`
// finding into a counted shift, so it decides finding versus silence. That is
// why both two-way arms now assert the shift is uniform, and why main() checks
// the whole table agrees on ONE shift; before those, an id leaf the classifier
// accepted could move by any amount and still exit 0 (Phase 11d QA audit).
export function isIdPath(path) {
  const key = lastKey(path);
  if (/(^id$|^nextId$|Id$|^crafter$)/.test(key)) return true;
  if (/(Ids|bossDamagers|personalFor)\[\d+\]$/.test(path)) return true;
  return /\.threat\[\d+\]\[0\]$/.test(path);
}
const DIGEST_KEYS = new Set(['state', 'events']);
const FRAME_PATH = /^frames\[[^\]]+\]$/;

function gitShowJson(ref, relPath) {
  try {
    const raw = execFileSync('git', ['-C', ROOT, 'show', `${ref}:${relPath}`], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Every `<name>.json` the golden directory holds at `ref`, read with plumbing
 *  (no checkout). The composition walk itself is driven by the MERGED directory,
 *  which is blind in one direction by construction: a golden a parent carries and
 *  the merge DROPPED is simply never visited. This is the other side of that walk
 *  (the census's MISSING class, which exists for exactly this reason). */
function gitLsGoldens(ref) {
  try {
    // --full-tree: without it ls-tree lists relative to the cwd, so a run from a
    // subdirectory (a scratch merged tree) saw an empty parent set and MISSING
    // was vacuously zero; the flag makes the class cwd-independent.
    const raw = execFileSync(
      'git',
      ['-C', ROOT, 'ls-tree', '--full-tree', '--name-only', `${ref}:${GOLDEN_DIR}`],
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return new Set(
      raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.endsWith('.json')),
    );
  } catch {
    // The directory does not exist at that ref (a parent from before the goldens
    // moved, or a --golden-dir pointed somewhere else): an empty set, not a throw.
    return new Set();
  }
}

/** Vacuity floor, the sibling of the census's FLOORS. The composition report is a
 *  PASS-shaped output with no lower bound of its own, so an empty or truncated
 *  input set would print "every shared golden composes" over nothing at all.
 *  Set ~10 percent under the 69 goldens observed when this was written. */
export const GOLDEN_FLOOR = 62;

/** Goldens a parent carries that the merged tree DELIBERATELY does not, with the
 *  reason. The MISSING class has to have an escape hatch or a legitimately retired
 *  scenario is an undischargeable FAIL (Phase 11d QA fix-round review: the class
 *  shipped without one). Empty today, which is the honest state: the absorb
 *  dropped nothing. Add a row here, never a filter at the call site, so the
 *  deletion stays written down. Override with --allow-missing <file> for a
 *  one-off. */
export const EXPLAINED_MISSING_GOLDENS = Object.freeze({
  // 'some_scenario.json': 'phase 11f, ruling ...: retired with its scenario row',
});

/**
 * The run's VERDICT as a pure function, so the wiring is observable. The helpers
 * below were each pinned while main() was not exported and nothing asserted that
 * their results reached the exit code: the Phase 11d QA pin audit showed the
 * dropped-golden class could be computed and then discarded with a PASS verdict
 * and exit 0. Everything that can fail a run is counted here, in one place.
 *
 * @param {{goldenCount: number, missingCount: number, rowFindingCount: number,
 *          shifts: Map<number, number>, floor?: number}} args
 */
export function compositionVerdict({
  goldenCount,
  missingCount,
  rowFindingCount,
  shifts,
  floor = GOLDEN_FLOOR,
}) {
  // The merge contributed ONE world-init id shift, so more than one distinct
  // non-zero shift across the whole table is a disagreement, not a tally.
  const distinctShifts = [...shifts.keys()].filter((d) => d !== 0);
  const shiftDisagreement = distinctShifts.length > 1;
  const floorFail = goldenCount < floor;
  const failures =
    rowFindingCount + missingCount + (shiftDisagreement ? 1 : 0) + (floorFail ? 1 : 0);
  return { failures, floorFail, shiftDisagreement, distinctShifts, failed: failures > 0 };
}

/** The MISSING class as a pure set operation, so it is testable without git:
 *  every golden a parent carries that the merged tree does not, carrying WHICH
 *  parents had it. Sorted by name so the report is stable. */
export function missingFromMerged(mergedFiles, parentSets, explained = EXPLAINED_MISSING_GOLDENS) {
  const onMerged = new Set(mergedFiles);
  const missing = [];
  for (const [side, set] of parentSets) {
    for (const f of set) {
      if (onMerged.has(f)) continue;
      // A recorded deliberate deletion is not a finding; it is still REPORTED by
      // the caller, so a stale row cannot hide behind silence.
      if (Object.hasOwn(explained, f)) continue;
      const already = missing.find((m) => m.file === f);
      if (already) already.sides.push(side);
      else missing.push({ file: f, sides: [side] });
    }
  }
  return missing.sort((a, b) => a.file.localeCompare(b.file));
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
function lastKey(path) {
  return (
    path
      .split(/[.[\]]+/)
      .filter(Boolean)
      .pop() ?? ''
  );
}
function show(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

export function newCtx() {
  return {
    findings: [],
    numericChecked: 0,
    otherChecked: 0,
    oursMoved: 0,
    theirsMoved: 0,
    theirsNonIdPaths: [],
    oursNonIdPaths: [],
    presenceMoves: 0,
    stateMoves: 0,
    eventsMoves: 0,
    unalignedArrays: 0,
    idShifts: new Map(),
    releaseComposed: 0,
    releaseComposedPaths: [],
    sidePicks: 0,
    sidePickPaths: [],
  };
}

/** The determinism anchors: the top-level draw count and digest, and every rng
 *  leaf of every frame. These never compose by release, whichever parent they
 *  happen to agree with. The whole-value arm suffixes its path with a
 *  parenthesised note, stripped before the key is read. */
export function isAnchorPath(path) {
  const bare = path.replace(/ \([^)]*\)$/, '');
  const key = lastKey(bare);
  return key === 'draws' || key === 'drawDigest' || /(^|\.)rng(\.|\[|$)/.test(bare);
}

/**
 * The release escape. True, and counted into `sink` (a ctx or a diffs record),
 * when the merged value is byte-equal (canonical JSON) to SOME release parent's
 * value at this path. Absence never matches: a merged value must EXIST to take
 * the escape, so a key merged dropped stays a finding even when a release
 * parent lacks it too (a release parent that lacks the whole golden reads as
 * undefined at every path, indistinguishable from a dropped key).
 */
function releaseMatch(m, rs, path, sink) {
  if (m === undefined || rs.length === 0 || isAnchorPath(path)) return false;
  const mj = JSON.stringify(m);
  if (!rs.some((r) => r !== undefined && JSON.stringify(r) === mj)) return false;
  sink.releaseComposed += 1;
  if (sink.releaseComposedPaths.length < 8) sink.releaseComposedPaths.push(path);
  return true;
}

/** The release values one level down: `rs.map(r => r[k])`, undefined where a
 *  release parent lacks the golden, the key, or holds a non-container there. */
function sub(rs, k) {
  return rs.map((r) => (r !== null && typeof r === 'object' ? r[k] : undefined));
}

// Four-way composition of one value (base, ours, theirs, merged) at path. `rs`
// carries the release parents' values at the same path (undefined where absent).
export function composeLeaf(b, o, t, m, path, ctx, rs = []) {
  const kinds = new Set([typeOf(b), typeOf(o), typeOf(t), typeOf(m)]);
  if (kinds.has('undefined')) {
    const pb = b !== undefined;
    const po = o !== undefined;
    const pt = t !== undefined;
    const pm = m !== undefined;
    const expected = po === pb ? pt : pt === pb ? po : po === pt ? po : null;
    if (expected === null) {
      if (releaseMatch(m, rs, path, ctx)) return;
      ctx.findings.push(
        `${path}: presence CONFLICT (ours and theirs changed presence differently)`,
      );
    } else if (pm !== expected) {
      if (releaseMatch(m, rs, path, ctx)) return;
      ctx.findings.push(
        `${path}: presence does not compose (base ${pb} ours ${po} theirs ${pt} merged ${pm})`,
      );
    } else if (pm !== pb) {
      ctx.presenceMoves += 1;
    }
    if (!pm || expected === null) return;
    // A key NO modelled parent carries has nothing to compare the merged value
    // against; the finding (or the release escape) above is the whole verdict.
    // Before this return the recursion below re-entered this arm with the same
    // four undefineds and never terminated: the live tool died with a
    // RangeError on the first release-added key (Phase 18).
    if (!pb && !po && !pt) return;
    // Present in merged: compare it against the side(s) that carry it, using
    // the carrier's value where a side lacks the key.
    const carrier = pb ? b : po ? o : t;
    const present = [b, o, t, m].filter((v) => v !== undefined);
    if (new Set(present.map(typeOf)).size !== 1) return;
    composeLeaf(pb ? b : carrier, po ? o : carrier, pt ? t : carrier, m, path, ctx, rs);
    return;
  }
  if (kinds.size !== 1) {
    if (releaseMatch(m, rs, path, ctx)) return;
    ctx.findings.push(`${path}: type mismatch across refs (${[...kinds].join(',')})`);
    return;
  }
  const kind = [...kinds][0];
  if (kind === 'object') {
    const keys = new Set([
      ...Object.keys(b),
      ...Object.keys(o),
      ...Object.keys(t),
      ...Object.keys(m),
    ]);
    for (const k of [...keys].sort()) {
      if (DIGEST_KEYS.has(k) && FRAME_PATH.test(path)) {
        if (m[k] !== o[k]) {
          if (k === 'state') ctx.stateMoves += 1;
          else ctx.eventsMoves += 1;
        }
        continue;
      }
      composeLeaf(b[k], o[k], t[k], m[k], `${path}.${k}`, ctx, sub(rs, k));
    }
    return;
  }
  if (kind === 'array') {
    const lens = [b.length, o.length, t.length, m.length];
    if (new Set(lens).size === 1) {
      for (let i = 0; i < m.length; i++) {
        composeLeaf(b[i], o[i], t[i], m[i], `${path}[${i}]`, ctx, sub(rs, i));
      }
      return;
    }
    // Lengths differ: the length composes numerically; the elements cannot
    // be aligned by index, so the array is compared whole under the three-way
    // rule on its JSON (an id shift inside such an array surfaces as a
    // CONFLICT and must be read by hand). The release escape is ATOMIC here:
    // the whole merged array byte-equal to a release parent's is one release
    // row covering both checks; otherwise neither the length row nor the
    // whole-value row may take it, so a coincidental length match against a
    // release array with different contents cannot read as composition.
    ctx.unalignedArrays += 1;
    if (releaseMatch(m, rs, path, ctx)) return;
    composeLeaf(b.length, o.length, t.length, m.length, `${path}.length`, ctx);
    threeWay(
      JSON.stringify(b),
      JSON.stringify(o),
      JSON.stringify(t),
      JSON.stringify(m),
      `${path} (unaligned array, whole-value)`,
      ctx,
    );
    return;
  }
  if (kind === 'number') {
    if (!isNum(b) || !isNum(o) || !isNum(t) || !isNum(m)) {
      threeWay(
        String(b),
        String(o),
        String(t),
        String(m),
        path,
        ctx,
        rs.map((r) => (r === undefined ? undefined : String(r))),
      );
      return;
    }
    // THE ADDITIVE RULE, and the side-pick the 11d ledger recorded as its hole
    // (ADDITIVE-COMPOSE), patched at Phase 18. When only ONE parent moved a
    // leaf the additive value IS the three-way value, and merged must equal it.
    // When BOTH moved it, the additive value is one neither parent holds, so
    // demanding it alone would bless a synthetic sum and reject a legitimate
    // side-pick; merged equal to ours or to theirs is therefore ACCEPTED as a
    // side-pick, counted and sampled so the report shows every one, and the
    // finding is reserved for a merged value matching none of the three.
    const additive = b + (o - b) + (t - b);
    ctx.numericChecked += 1;
    const bothMoved = o !== b && t !== b;
    const composes = Math.abs(m - additive) <= 1e-9;
    if (!composes && bothMoved && (m === o || m === t)) {
      ctx.sidePicks += 1;
      if (ctx.sidePickPaths.length < 8) {
        const side = m === o ? 'ours' : 'theirs';
        const other = m === o ? `theirs ${t}` : `ours ${o}`;
        ctx.sidePickPaths.push(`${path} ${b}->${m} (${side}; ${other}, additive ${additive})`);
      }
    } else if (!composes) {
      if (releaseMatch(m, rs, path, ctx)) return;
      const accepted = bothMoved ? `${additive}, ours ${o}, or theirs ${t}` : `${additive}`;
      ctx.findings.push(
        `${path}: numeric does not compose (base ${b} ours ${o} theirs ${t} merged ${m}, expected ${accepted})`,
      );
      return;
    }
    const isId = isIdPath(path);
    if (o !== b) {
      ctx.oursMoved += 1;
      if (!isId && ctx.oursNonIdPaths.length < 8) ctx.oursNonIdPaths.push(`${path} ${b}->${o}`);
    }
    if (t !== b) {
      ctx.theirsMoved += 1;
      if (isId) ctx.idShifts.set(t - b, (ctx.idShifts.get(t - b) ?? 0) + 1);
      else if (ctx.theirsNonIdPaths.length < 8) ctx.theirsNonIdPaths.push(`${path} ${b}->${t}`);
    }
    return;
  }
  threeWay(b, o, t, m, path, ctx, rs);
}

function threeWay(b, o, t, m, path, ctx, rs = []) {
  ctx.otherChecked += 1;
  let expected;
  if (o === b) expected = t;
  else if (t === b) expected = o;
  else if (o === t) expected = o;
  else {
    if (releaseMatch(m, rs, path, ctx)) return;
    ctx.findings.push(
      `${path}: CONFLICT (ours and theirs both moved differently: base ${show(b)} ours ${show(o)} theirs ${show(t)} merged ${show(m)})`,
    );
    return;
  }
  if (m !== expected) {
    if (releaseMatch(m, rs, path, ctx)) return;
    ctx.findings.push(
      `${path}: does not follow the three-way rule (base ${show(b)} ours ${show(o)} theirs ${show(t)} merged ${show(m)})`,
    );
    return;
  }
  if (o !== b) ctx.oursMoved += 1;
  if (t !== b) ctx.theirsMoved += 1;
}

// Two-way walk: merged against one carrier parent. Collects the differences
// by class so a clean add (or a parent-only frame) can be judged. `rs` carries
// the release parents' values at the same path; a merged leaf byte-equal to one
// of them is counted into diffs.releaseComposed instead of a difference row
// (same rule and same anchor exclusion as the four-way path). The id family is
// never escaped: its deltas feed the uniform-shift check, which must see them.
export function diffAgainst(p, m, path, diffs, ctx, rs = []) {
  const walk = (a, z, at, rz) => {
    if (a === undefined || z === undefined) {
      if (releaseMatch(z, rz, at, diffs)) return;
      diffs.presence.push(
        `${at}: ${a === undefined ? 'added' : 'removed'} (${show(a === undefined ? z : a)})`,
      );
      return;
    }
    const ka = typeOf(a);
    const kz = typeOf(z);
    if (ka !== kz) {
      if (releaseMatch(z, rz, at, diffs)) return;
      diffs.other.push(`${at}: ${show(a)} -> ${show(z)}`);
      return;
    }
    if (ka === 'object') {
      const keys = new Set([...Object.keys(a), ...Object.keys(z)]);
      for (const k of [...keys].sort()) {
        if (DIGEST_KEYS.has(k) && FRAME_PATH.test(at)) {
          if (a[k] !== z[k]) {
            if (k === 'state') ctx.stateMoves += 1;
            else ctx.eventsMoves += 1;
          }
          continue;
        }
        if (k === 'rng' && FRAME_PATH.test(at)) {
          if (a.rng.draws !== z.rng.draws || a.rng.digest !== z.rng.digest) {
            diffs.rng.push(
              `${at}.rng ${a.rng.draws}/${a.rng.digest} -> ${z.rng.draws}/${z.rng.digest}`,
            );
          }
          continue;
        }
        walk(a[k], z[k], `${at}.${k}`, sub(rz, k));
      }
      return;
    }
    if (ka === 'array') {
      if (a.length !== z.length) {
        // A merged array byte-equal to a release parent's composes whole, as
        // the four-way unaligned arm does; otherwise the length row stands.
        if (releaseMatch(z, rz, at, diffs)) return;
        diffs.other.push(`${at}.length ${a.length} -> ${z.length}`);
      }
      // Walk to the LONGER length (the MIN-LENGTH-ARRAY hole the 11d ledger
      // recorded, patched at Phase 18): the overlap compares element by
      // element, and every element past it lands in `presence` through the
      // undefined arm above, so an appended (or dropped) entity is a row of
      // its own, not just a `.length` delta.
      const n = Math.max(a.length, z.length);
      for (let i = 0; i < n; i++) walk(a[i], z[i], `${at}[${i}]`, sub(rz, i));
      return;
    }
    if (ka === 'number' && isNum(a) && isNum(z)) {
      if (a !== z) {
        if (isIdPath(at)) diffs.idDeltas.set(z - a, (diffs.idDeltas.get(z - a) ?? 0) + 1);
        else if (!releaseMatch(z, rz, at, diffs)) diffs.numeric.push(`${at}: ${a} -> ${z}`);
      }
      return;
    }
    if (a !== z && !releaseMatch(z, rz, at, diffs)) {
      diffs.other.push(`${at}: ${show(a)} -> ${show(z)}`);
    }
  };
  walk(p, m, path, rs);
}
function newDiffs() {
  return {
    rng: [],
    idDeltas: new Map(),
    numeric: [],
    other: [],
    presence: [],
    releaseComposed: 0,
    releaseComposedPaths: [],
  };
}
/** Fold a two-way arm's release escapes into the golden's ctx (the frame arms
 *  of a shared golden report through ctx, the clean adds through diffs). */
function foldRelease(ctx, diffs) {
  ctx.releaseComposed += diffs.releaseComposed;
  for (const p of diffs.releaseComposedPaths) {
    if (ctx.releaseComposedPaths.length < 8) ctx.releaseComposedPaths.push(p);
  }
}

/** The id-family shift must be UNIFORM within a comparison. `isIdPath` routes an
 *  id leaf away from the hard `numeric` finding and into a counted classification,
 *  which meant a leaf the classifier accepted could move by ANY amount and still
 *  exit 0: the Phase 11d QA audit moved a single `nextId` by +37 and got PASS with
 *  a cell reading "+4x28 +41x1". The whole point of the two-way arms is that the
 *  other parent's contribution is limited to the uniform world-init shift, so more
 *  than one distinct delta is a finding, not a cell. */
export function checkUniformIdShift(diffs, ctx, label) {
  if (diffs.idDeltas.size <= 1) return;
  const shown = [...diffs.idDeltas.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([d, n]) => `${d > 0 ? '+' : ''}${d}x${n}`)
    .join(' ');
  ctx.findings.push(
    `${label}: id-family shift is NOT uniform (${shown}); the other parent's contribution ` +
      'must be one world-init shift, so a second delta is a moved id, not a classification',
  );
}
function frameKey(f, i) {
  return `${f.tick}:${f.label ?? ''}#${i}`;
}
// Frames align by (tick, label) in order; the index suffix disambiguates a
// repeated key and keeps the alignment stable when one parent appended frames.
function frameMap(g) {
  const map = new Map();
  const counts = new Map();
  g.frames.forEach((f) => {
    const base = `${f.tick}:${f.label ?? ''}`;
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    map.set(`${base}#${n}`, f);
  });
  return map;
}

// Shared golden: four-way composition with frame alignment by key. `releases`
// carries the release parents' copies of the golden (undefined where a parent
// lacks it); their frames align by the same (tick, label) key.
export function checkShared(name, b, o, t, m, releases = []) {
  const ctx = newCtx();
  const fb = frameMap(b);
  const fo = frameMap(o);
  const ft = frameMap(t);
  const fm = frameMap(m);
  const frs = releases.map((r) => (r ? frameMap(r) : new Map()));
  // The frame SET composes by the three-way rule on keys.
  const allKeys = new Set([...fb.keys(), ...fo.keys(), ...ft.keys(), ...fm.keys()]);
  let fourWay = 0;
  let oursOnlyFrames = 0;
  let theirsOnlyFrames = 0;
  for (const key of allKeys) {
    const inB = fb.has(key);
    const inO = fo.has(key);
    const inT = ft.has(key);
    const inM = fm.has(key);
    const prs = frs.map((fr) => fr.get(key));
    const expected = inO === inB ? inT : inT === inB ? inO : inO === inT ? inO : null;
    if (expected === null) {
      // A merged frame byte-equal to a release parent's frame composes by
      // release (there is no modelled frame to anchor its rng to); a frame
      // merged lacks takes no escape.
      if (inM && releaseMatch(fm.get(key), prs, `frames[${key}]`, ctx)) continue;
      ctx.findings.push(`frame ${key}: presence CONFLICT across parents`);
      continue;
    }
    if (inM !== expected) {
      if (inM && releaseMatch(fm.get(key), prs, `frames[${key}]`, ctx)) continue;
      ctx.findings.push(
        `frame ${key}: frame presence does not compose (base ${inB} ours ${inO} theirs ${inT} merged ${inM})`,
      );
      continue;
    }
    if (!inM) continue;
    if (inB && inO && inT) {
      fourWay += 1;
      const pb = fb.get(key);
      const po = fo.get(key);
      const pt = ft.get(key);
      const pm = fm.get(key);
      if (
        (pm.rng.draws !== po.rng.draws || pm.rng.digest !== po.rng.digest) &&
        pt.rng.draws === pb.rng.draws &&
        pt.rng.digest === pb.rng.digest
      ) {
        ctx.findings.push(
          `frame ${key}: RNG MOVED vs ours while theirs kept base (ours ${po.rng.draws}/${po.rng.digest} merged ${pm.rng.draws}/${pm.rng.digest})`,
        );
      }
      composeLeaf(pb, po, pt, pm, `frames[${key}]`, ctx, prs);
    } else if (inO && !inT) {
      // ours lengthened the scenario: theirs contributes only the id shift.
      oursOnlyFrames += 1;
      const diffs = newDiffs();
      diffAgainst(fo.get(key), fm.get(key), `frames[${key}]`, diffs, ctx, prs);
      foldRelease(ctx, diffs);
      if (diffs.rng.length)
        ctx.findings.push(`frame ${key}: RNG MOVED vs ours (${diffs.rng.join('; ')})`);
      if (diffs.numeric.length)
        ctx.findings.push(
          `frame ${key}: non-id numeric leaves moved vs ours: ${diffs.numeric.slice(0, 5).join('; ')}`,
        );
      if (diffs.other.length)
        ctx.findings.push(
          `frame ${key}: string leaves moved vs ours: ${diffs.other.slice(0, 5).join('; ')}`,
        );
      if (diffs.presence.length)
        ctx.findings.push(
          `frame ${key}: keys appeared or vanished vs ours: ${diffs.presence.slice(0, 5).join('; ')}`,
        );
      checkUniformIdShift(diffs, ctx, `frame ${key} (ours-only)`);
      for (const [d, n] of diffs.idDeltas) ctx.idShifts.set(d, (ctx.idShifts.get(d) ?? 0) + n);
    } else if (inT && !inO) {
      // theirs lengthened the scenario: ours' contribution is listed.
      theirsOnlyFrames += 1;
      const diffs = newDiffs();
      diffAgainst(ft.get(key), fm.get(key), `frames[${key}]`, diffs, ctx, prs);
      foldRelease(ctx, diffs);
      if (diffs.rng.length)
        ctx.findings.push(`frame ${key}: RNG MOVED vs theirs (${diffs.rng.join('; ')})`);
      checkUniformIdShift(diffs, ctx, `frame ${key} (theirs-only)`);
      for (const [d, n] of diffs.idDeltas) ctx.idShifts.set(d, (ctx.idShifts.get(d) ?? 0) + n);
      ctx.theirsOnlyFrameDiffs = (ctx.theirsOnlyFrameDiffs ?? []).concat(
        diffs.numeric.map((x) => `numeric ${x}`),
        diffs.other.map((x) => `other ${x}`),
        diffs.presence.map((x) => `presence ${x}`),
      );
    }
  }
  for (const k of ['scenario', 'seed', 'sampleEvery', 'ticks', 'draws', 'drawDigest']) {
    composeLeaf(b[k], o[k], t[k], m[k], k, ctx, sub(releases, k));
  }
  composeLeaf(
    b.coverage,
    o.coverage,
    t.coverage,
    m.coverage,
    'coverage',
    ctx,
    sub(releases, 'coverage'),
  );
  return { ctx, frames: m.frames.length, fourWay, oursOnlyFrames, theirsOnlyFrames };
}

// Clean add: merged vs the single parent that carries the golden. `side` names
// that parent ('ours', 'theirs', or 'release' for a golden only a release parent
// recorded); `releases` carries the OTHER release parents' copies for the escape.
export function checkAdd(name, p, m, side, releases = []) {
  const ctx = newCtx();
  const diffs = newDiffs();
  if (p.frames.length !== m.frames.length) {
    ctx.findings.push(
      `${name}: frame count differs (${side} ${p.frames.length} merged ${m.frames.length})`,
    );
    return { ctx, diffs, frames: m.frames.length };
  }
  if (p.draws !== m.draws || p.drawDigest !== m.drawDigest) {
    diffs.rng.push(
      `top-level draws/drawDigest ${p.draws}/${p.drawDigest} -> ${m.draws}/${m.drawDigest}`,
    );
  }
  for (const k of ['scenario', 'seed', 'sampleEvery', 'ticks'])
    diffAgainst(p[k], m[k], k, diffs, ctx, sub(releases, k));
  diffAgainst(p.coverage, m.coverage, 'coverage', diffs, ctx, sub(releases, 'coverage'));
  const releaseFrames = releases.map((r) => (r ? r.frames : undefined));
  for (let i = 0; i < m.frames.length; i++) {
    diffAgainst(p.frames[i], m.frames[i], `frames[${i}]`, diffs, ctx, sub(releaseFrames, i));
  }
  if (diffs.rng.length)
    ctx.findings.push(`${name}: RNG MOVED vs ${side} (${diffs.rng.length} rows)`);
  // Both sides: the only id movement a clean add may show is the ONE world-init
  // shift the other parent contributed. Applied to theirs-only adds too, whose
  // non-rng rows are otherwise only listed for a reader.
  checkUniformIdShift(diffs, ctx, name);
  if (side === 'ours') {
    // The other parent (farming) only shifts ids at world init: nothing else
    // may move in an ours-only golden.
    if (diffs.numeric.length)
      ctx.findings.push(`${name}: non-id numeric leaves moved vs ours (${diffs.numeric.length})`);
    if (diffs.other.length)
      ctx.findings.push(`${name}: string leaves moved vs ours (${diffs.other.length})`);
    if (diffs.presence.length)
      ctx.findings.push(`${name}: keys appeared or vanished vs ours (${diffs.presence.length})`);
  }
  return { ctx, diffs, frames: m.frames.length };
}

function shiftsText(map) {
  return [...map.entries()].map(([d, n]) => `${d > 0 ? '+' : ''}${d}x${n}`).join(' ') || '-';
}

function main() {
  const dir = join(ROOT, GOLDEN_DIR);
  if (!existsSync(dir)) throw new Error(`no golden dir at ${dir}`);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const rows = [];
  let failures = 0;
  const classes = { shared: 0, oursOnly: 0, theirsOnly: 0, releaseOnly: 0, orphan: 0 };

  // The release parents, the census's own set (reused, never re-derived):
  // RELEASE_REF or --release, every later sync's second parent, the --sync
  // extras; the newest synced tip alone joins the MISSING parent set.
  const releaseRef = argValue('--release', RELEASE_REF);
  const derived = process.argv.includes('--no-auto-sync') ? [] : deriveSyncRefs(ROOT);
  const releaseRefs = releaseParentRefs({
    releaseRef,
    derived,
    extra: argValues('--sync'),
    resolve: resolveRef,
  });
  const newestRelease = resolveRef(newestReleaseRef({ releaseRef, derived }));

  // MISSING: on a parent, absent from merged. The per-file walk below cannot see
  // these (it visits merged files only), so a resolution that DROPPED a golden
  // would otherwise report one fewer row and still print PASS.
  const parentGoldens = new Map([
    ['ours', gitLsGoldens(REFS.ours)],
    ['theirs', gitLsGoldens(REFS.theirs)],
    ['release', gitLsGoldens(newestRelease)],
  ]);
  const missing = missingFromMerged(files, parentGoldens);
  const addRow = (name, kind, p, m, r, drawsCell, nextIdCell) => ({
    name,
    kind,
    frames: `${m.frames.length}`,
    draws: drawsCell,
    digest: `${p.drawDigest}${m.drawDigest === p.drawDigest ? '=' : '!='}${m.drawDigest}`,
    nextId0: nextIdCell,
    numeric: r.diffs.numeric.length,
    other: r.diffs.other.length,
    oursMoved: '-',
    theirsMoved: '-',
    idShifts: shiftsText(r.diffs.idDeltas),
    digests: `${r.ctx.stateMoves}/${r.ctx.eventsMoves}`,
    unaligned: 0,
    releaseComposed: r.diffs.releaseComposed,
    sidePicks: '-',
    ctx: r.ctx,
    findings: r.ctx.findings,
    diffs: r.diffs,
  });
  for (const f of files) {
    const rel = `${GOLDEN_DIR}/${f}`;
    const name = f.replace(/\.json$/, '');
    const m = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const b = gitShowJson(REFS.base, rel);
    const o = gitShowJson(REFS.ours, rel);
    const t = gitShowJson(REFS.theirs, rel);
    const releases = releaseRefs.map((re) => gitShowJson(re.ref, rel) ?? undefined);
    const lineage = classifyLineage({ b, o, t, releases });
    if (lineage === 'shared') {
      classes.shared += 1;
      const r = checkShared(name, b, o, t, m, releases);
      rows.push({
        name,
        kind: 'shared',
        frames: `${m.frames.length} (${r.fourWay} four-way${r.oursOnlyFrames ? `, ${r.oursOnlyFrames} ours-only` : ''}${r.theirsOnlyFrames ? `, ${r.theirsOnlyFrames} theirs-only` : ''})`,
        draws: `${b.draws}/${o.draws}/${t.draws}/${m.draws}`,
        digest: `${o.drawDigest}${m.drawDigest === o.drawDigest ? '=' : '!='}${m.drawDigest}`,
        nextId0: `${b.frames[0]?.nextId}/${o.frames[0]?.nextId}/${t.frames[0]?.nextId}/${m.frames[0]?.nextId}`,
        numeric: r.ctx.numericChecked,
        other: r.ctx.otherChecked,
        oursMoved: r.ctx.oursMoved,
        theirsMoved: r.ctx.theirsMoved,
        idShifts: shiftsText(r.ctx.idShifts),
        digests: `${r.ctx.stateMoves}/${r.ctx.eventsMoves}`,
        unaligned: r.ctx.unalignedArrays,
        releaseComposed: r.ctx.releaseComposed,
        sidePicks: r.ctx.sidePicks,
        ctx: r.ctx,
        findings: r.ctx.findings,
      });
      failures += r.ctx.findings.length;
    } else if (lineage === 'ours-only add') {
      classes.oursOnly += 1;
      const r = checkAdd(name, o, m, 'ours', releases);
      rows.push(
        addRow(
          name,
          'ours-only add',
          o,
          m,
          r,
          `-/${o.draws}/-/${m.draws}`,
          `-/${o.frames[0]?.nextId}/-/${m.frames[0]?.nextId}`,
        ),
      );
      failures += r.ctx.findings.length;
    } else if (lineage === 'theirs-only add') {
      classes.theirsOnly += 1;
      const r = checkAdd(name, t, m, 'theirs', releases);
      rows.push(
        addRow(
          name,
          'theirs-only add',
          t,
          m,
          r,
          `-/-/${t.draws}/${m.draws}`,
          `-/-/${t.frames[0]?.nextId}/${m.frames[0]?.nextId}`,
        ),
      );
      failures += r.ctx.findings.length;
    } else if (lineage === 'release-only add') {
      // A golden the release recorded and the merge kept: compared against the
      // first release parent that carries it (the others feed the escape), with
      // the theirs-only listing discipline (rng and the uniform shift are
      // findings; everything else is listed for the reader).
      classes.releaseOnly += 1;
      const carrierIndex = releases.findIndex(Boolean);
      const p = releases[carrierIndex];
      const others = releases.filter((_, i) => i !== carrierIndex);
      const r = checkAdd(name, p, m, 'release', others);
      rows.push(
        addRow(
          name,
          `release-only add (${releaseRefs[carrierIndex].ref.slice(0, 10)})`,
          p,
          m,
          r,
          `rel ${p.draws}/${m.draws}`,
          `rel ${p.frames[0]?.nextId}/${m.frames[0]?.nextId}`,
        ),
      );
      failures += r.ctx.findings.length;
    } else {
      classes.orphan += 1;
      rows.push({
        name,
        kind: `ORPHAN (base ${!!b} ours ${!!o} theirs ${!!t} release ${releases.some(Boolean)})`,
        findings: ['golden has no single-parent, release-parent, or three-way lineage'],
      });
      failures += 1;
    }
  }

  console.log(
    `refs: base ${REFS.base} ours ${REFS.ours} theirs ${REFS.theirs}; merged = ${GOLDEN_DIR} on disk`,
  );
  console.log(
    `release parents (${releaseRefs.length}): ${
      releaseRefs
        .map((re) => `${re.ref.slice(0, 10)}${re.via ? ` (via ${re.via.slice(0, 10)})` : ''}`)
        .join(', ') || 'none'
    }; newest ${newestRelease.slice(0, 10)} joins the MISSING parent set`,
  );
  console.log(
    `goldens: ${files.length} (shared ${classes.shared}, ours-only ${classes.oursOnly}, theirs-only ${classes.theirsOnly}, release-only ${classes.releaseOnly}, orphan ${classes.orphan})`,
  );
  // WHOLE-TABLE agreement: the merge contributed ONE world-init id shift, so every
  // golden that shifts ids at all must shift them by the SAME amount. A per-golden
  // uniformity check cannot see a golden whose every id moved by +1 while the rest
  // moved by +4; this can. (Phase 11d QA audit: both shapes exited 0 before.)
  // Both maps: shared goldens accumulate into ctx.idShifts, clean adds into
  // diffs.idDeltas. Reading only the first would leave every add outside the
  // table-wide agreement check, which is where a wrong-but-uniform shift hides.
  const tableShifts = new Map();
  for (const r of rows) {
    for (const [d, n] of r.ctx?.idShifts ?? []) tableShifts.set(d, (tableShifts.get(d) ?? 0) + n);
    for (const [d, n] of r.diffs?.idDeltas ?? []) tableShifts.set(d, (tableShifts.get(d) ?? 0) + n);
  }
  // ONE place decides the verdict, and it is a pure function so the wiring is
  // observable: `failures` above is only the per-row finding count.
  const verdict = compositionVerdict({
    goldenCount: files.length,
    missingCount: missing.length,
    rowFindingCount: failures,
    shifts: tableShifts,
  });
  const shiftAgreement = verdict.distinctShifts;
  const floorFail = verdict.floorFail;
  failures = verdict.failures;
  console.log(
    `floor: ${files.length} >= ${GOLDEN_FLOOR} ${floorFail ? 'FAIL (an empty or truncated set cannot pass by composing nothing)' : 'ok'}`,
  );
  console.log(
    `id shift across the whole table: ${shiftsText(tableShifts)} ${
      shiftAgreement.length > 1
        ? `FAIL (${shiftAgreement.length} distinct shifts; the merge contributed one)`
        : 'ok'
    }`,
  );
  console.log(
    `parent goldens: ours ${parentGoldens.get('ours').size}, theirs ${parentGoldens.get('theirs').size}; MISSING from merged ${missing.length}`,
  );
  for (const m of missing) {
    console.log(`  MISSING ${m.file} (on ${m.sides.join(' and ')}, absent from merged)`);
  }
  console.log('');
  console.log(
    'name | kind | frames | draws b/o/t/m | drawDigest o?m | nextId0 b/o/t/m | numeric | other | oursMoved | theirsMoved | idShifts | state/events moved | unaligned | byRelease | sidePicks | findings',
  );
  for (const r of rows) {
    console.log(
      [
        r.name,
        r.kind,
        r.frames ?? '-',
        r.draws ?? '-',
        r.digest ?? '-',
        r.nextId0 ?? '-',
        r.numeric ?? '-',
        r.other ?? '-',
        r.oursMoved ?? '-',
        r.theirsMoved ?? '-',
        r.idShifts ?? '-',
        r.digests ?? '-',
        r.unaligned ?? '-',
        r.releaseComposed ?? '-',
        r.sidePicks ?? '-',
        r.findings.length,
      ].join(' | '),
    );
  }
  console.log('');
  let releaseComposedTotal = 0;
  let sidePicksTotal = 0;
  for (const r of rows) {
    if (r.findings.length) {
      console.log(`FINDINGS ${r.name}:`);
      for (const x of r.findings.slice(0, VERBOSE ? r.findings.length : 25)) console.log(`  ${x}`);
      if (!VERBOSE && r.findings.length > 25)
        console.log(`  ... ${r.findings.length - 25} more (use --verbose)`);
    }
    // The two acceptances that are weaker than the additive rule are never
    // silent: every golden that took one prints its count and a path sample.
    const byRelease = r.ctx?.releaseComposedPaths?.length
      ? r.ctx
      : r.diffs?.releaseComposedPaths?.length
        ? r.diffs
        : null;
    if (byRelease) {
      releaseComposedTotal += byRelease.releaseComposed;
      console.log(
        `NOTE ${r.name}: ${byRelease.releaseComposed} leaves composed BY RELEASE (merged byte-equal to a release parent; sample): ${byRelease.releaseComposedPaths.join('; ')}`,
      );
    }
    if (r.ctx?.sidePickPaths?.length) {
      sidePicksTotal += r.ctx.sidePicks;
      console.log(
        `NOTE ${r.name}: ${r.ctx.sidePicks} both-moved numeric leaves took a SIDE-PICK (sample): ${r.ctx.sidePickPaths.join('; ')}`,
      );
    }
    if (r.ctx?.theirsNonIdPaths?.length) {
      console.log(
        `NOTE ${r.name}: theirs moved non-id numeric leaves (sample): ${r.ctx.theirsNonIdPaths.join('; ')}`,
      );
    }
    if (r.ctx?.oursNonIdPaths?.length && VERBOSE) {
      console.log(
        `NOTE ${r.name}: ours moved non-id numeric leaves (sample): ${r.ctx.oursNonIdPaths.join('; ')}`,
      );
    }
    if (r.ctx?.theirsOnlyFrameDiffs?.length) {
      console.log(`DIFFS ${r.name} in theirs-only frames (ours' contribution, for the reader):`);
      for (const x of r.ctx.theirsOnlyFrameDiffs) console.log(`  ${x}`);
    }
    if (r.diffs && (r.kind === 'theirs-only add' || r.kind.startsWith('release-only add'))) {
      console.log(
        `DIFFS ${r.name} vs ${r.kind.startsWith('release') ? 'its release parent' : 'theirs'} (for the reader; check against the ledger's prediction):`,
      );
      console.log(`  id-family deltas: ${shiftsText(r.diffs.idDeltas)}`);
      console.log(
        `  rng moves: ${r.diffs.rng.length}; state digest moved in ${r.ctx.stateMoves} frames, events digest in ${r.ctx.eventsMoves}`,
      );
      for (const x of r.diffs.presence) console.log(`  presence ${x}`);
      for (const x of r.diffs.numeric) console.log(`  numeric ${x}`);
      for (const x of r.diffs.other) console.log(`  other ${x}`);
    }
    if (r.diffs && r.kind === 'ours-only add' && VERBOSE) {
      console.log(`DIFFS ${r.name} vs ours:`);
      for (const x of r.diffs.numeric) console.log(`  numeric ${x}`);
      for (const x of r.diffs.other) console.log(`  other ${x}`);
      for (const x of r.diffs.presence) console.log(`  presence ${x}`);
    }
  }
  console.log('');
  const acceptances = `${releaseComposedTotal} leaves composed by release, ${sidePicksTotal} side-picks`;
  console.log(
    failures === 0
      ? `COMPOSITION: PASS (${files.length} goldens over the floor; none missing from a parent; every shared golden composes; rng unmoved; adds follow their parent; ${acceptances})`
      : `COMPOSITION: FAIL (${failures} findings${missing.length ? `, ${missing.length} golden(s) missing from merged` : ''}${floorFail ? ', under the golden floor' : ''}; ${acceptances})`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

if (process.argv[1]?.endsWith('golden_composition.mjs')) main();
