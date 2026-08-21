#!/usr/bin/env node
// Masterwrought Phase 11d, unit 2: the golden COMPOSITION check for a merge
// re-record of tests/parity/golden/*.json. A re-recorded golden agrees with
// whatever the merged sim produces, so it cannot by itself tell a correct
// resolution from a dropped hunk. This script supplies the missing proof: for
// every golden present on BOTH merge parents it reads base, ours, theirs (via
// `git show`, nothing is checked out) and the MERGED file from disk, aligns
// frames by their (tick, label) key, and asserts that every readable,
// non-digest field COMPOSES:
//   numeric leaf:  merged - base == (ours - base) + (theirs - base)
//   other leaf:    the three-way rule (if one side kept base, merged equals the
//                  other side; if both agree, merged equals them; else CONFLICT)
// over the top-level ticks / draws / coverage, every frame's tick / label /
// time / nextId / rng.draws, and every leaf under players[] and entities[]
// (ids, entityId, sourceId, hp, auras, ...). rng.digest and drawDigest follow
// the three-way rule too, which is the determinism anchor: in a scenario
// neither packet touched they must equal ours byte for byte, because farming
// shifted entity ids without perturbing the shared rng stream, and a draw
// digest that moves during a re-record is a regression the re-record would
// bless. A frame only one parent carries (a scenario that parent lengthened)
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
// Usage (from the repo root, after the UPDATE_PARITY re-record):
//   node scripts/merge_audit/golden_composition.mjs [--base <ref>] [--ours <ref>]
//        [--theirs <ref>] [--golden-dir tests/parity/golden] [--verbose]
// Exit code 1 on any composition failure, rng movement, unaligned frame set,
// or a golden with no parent. Defaults are the 11b farming-absorb refs.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
const REFS = {
  base: argValue('--base', DEFAULTS.base),
  ours: argValue('--ours', DEFAULTS.ours),
  theirs: argValue('--theirs', DEFAULTS.theirs),
};
const GOLDEN_DIR = argValue('--golden-dir', 'tests/parity/golden');
const VERBOSE = process.argv.includes('--verbose');

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
    const raw = execFileSync(
      'git',
      ['-C', ROOT, 'ls-tree', '--name-only', `${ref}:${GOLDEN_DIR}`],
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

/** The MISSING class as a pure set operation, so it is testable without git:
 *  every golden a parent carries that the merged tree does not, carrying WHICH
 *  parents had it. Sorted by name so the report is stable. */
export function missingFromMerged(mergedFiles, parentSets) {
  const onMerged = new Set(mergedFiles);
  const missing = [];
  for (const [side, set] of parentSets) {
    for (const f of set) {
      if (onMerged.has(f)) continue;
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
  };
}

// Four-way composition of one value (base, ours, theirs, merged) at path.
export function composeLeaf(b, o, t, m, path, ctx) {
  const kinds = new Set([typeOf(b), typeOf(o), typeOf(t), typeOf(m)]);
  if (kinds.has('undefined')) {
    const pb = b !== undefined;
    const po = o !== undefined;
    const pt = t !== undefined;
    const pm = m !== undefined;
    const expected = po === pb ? pt : pt === pb ? po : po === pt ? po : null;
    if (expected === null) {
      ctx.findings.push(
        `${path}: presence CONFLICT (ours and theirs changed presence differently)`,
      );
    } else if (pm !== expected) {
      ctx.findings.push(
        `${path}: presence does not compose (base ${pb} ours ${po} theirs ${pt} merged ${pm})`,
      );
    } else if (pm !== pb) {
      ctx.presenceMoves += 1;
    }
    if (!pm || expected === null) return;
    // Present in merged: compare it against the side(s) that carry it, using
    // the carrier's value where a side lacks the key.
    const carrier = pb ? b : po ? o : t;
    const present = [b, o, t, m].filter((v) => v !== undefined);
    if (new Set(present.map(typeOf)).size !== 1) return;
    composeLeaf(pb ? b : carrier, po ? o : carrier, pt ? t : carrier, m, path, ctx);
    return;
  }
  if (kinds.size !== 1) {
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
      composeLeaf(b[k], o[k], t[k], m[k], `${path}.${k}`, ctx);
    }
    return;
  }
  if (kind === 'array') {
    const lens = [b.length, o.length, t.length, m.length];
    if (new Set(lens).size === 1) {
      for (let i = 0; i < m.length; i++) composeLeaf(b[i], o[i], t[i], m[i], `${path}[${i}]`, ctx);
      return;
    }
    // Lengths differ: the length composes numerically; the elements cannot
    // be aligned by index, so the array is compared whole under the three-way
    // rule on its JSON (an id shift inside such an array surfaces as a
    // CONFLICT and must be read by hand).
    composeLeaf(b.length, o.length, t.length, m.length, `${path}.length`, ctx);
    threeWay(
      JSON.stringify(b),
      JSON.stringify(o),
      JSON.stringify(t),
      JSON.stringify(m),
      `${path} (unaligned array, whole-value)`,
      ctx,
    );
    ctx.unalignedArrays += 1;
    return;
  }
  if (kind === 'number') {
    if (!isNum(b) || !isNum(o) || !isNum(t) || !isNum(m)) {
      threeWay(String(b), String(o), String(t), String(m), path, ctx);
      return;
    }
    // THE ADDITIVE-COMPOSE HOLE (the other residual hole the 11d ledger records
    // for the next reader). When only ONE parent moved a leaf this is exactly
    // the three-way rule. When BOTH moved it, the rule demands a value NEITHER
    // parent holds, so in that case it would bless a synthetic sum and reject a
    // legitimate side-pick. Measured exposure at 11d: ZERO, because no numeric
    // leaf was moved by both parents in any shared golden. A future re-record
    // that changes that has to decide the rule deliberately rather than inherit
    // it; the honest signal is that this line is where it would be decided.
    const expected = b + (o - b) + (t - b);
    ctx.numericChecked += 1;
    if (Math.abs(m - expected) > 1e-9) {
      ctx.findings.push(
        `${path}: numeric does not compose (base ${b} ours ${o} theirs ${t} merged ${m}, expected ${expected})`,
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
  threeWay(b, o, t, m, path, ctx);
}

function threeWay(b, o, t, m, path, ctx) {
  ctx.otherChecked += 1;
  let expected;
  if (o === b) expected = t;
  else if (t === b) expected = o;
  else if (o === t) expected = o;
  else {
    ctx.findings.push(
      `${path}: CONFLICT (ours and theirs both moved differently: base ${show(b)} ours ${show(o)} theirs ${show(t)} merged ${show(m)})`,
    );
    return;
  }
  if (m !== expected) {
    ctx.findings.push(
      `${path}: does not follow the three-way rule (base ${show(b)} ours ${show(o)} theirs ${show(t)} merged ${show(m)})`,
    );
    return;
  }
  if (o !== b) ctx.oursMoved += 1;
  if (t !== b) ctx.theirsMoved += 1;
}

// Two-way walk: merged against one carrier parent. Collects the differences
// by class so a clean add (or a parent-only frame) can be judged.
export function diffAgainst(p, m, path, diffs, ctx) {
  const walk = (a, z, at) => {
    if (a === undefined || z === undefined) {
      diffs.presence.push(
        `${at}: ${a === undefined ? 'added' : 'removed'} (${show(a === undefined ? z : a)})`,
      );
      return;
    }
    const ka = typeOf(a);
    const kz = typeOf(z);
    if (ka !== kz) {
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
        walk(a[k], z[k], `${at}.${k}`);
      }
      return;
    }
    if (ka === 'array') {
      if (a.length !== z.length) diffs.other.push(`${at}.length ${a.length} -> ${z.length}`);
      // THE MIN-LENGTH-ARRAY HOLE (one of the two residual holes the 11d ledger
      // records for the next re-record's reader). The length mismatch above is
      // reported, but the walk then compares only the overlap, so an APPENDED
      // element's own fields are never visited: a bogus entity appended to a
      // frame shows up as one `.length` row and nothing else. Measured exposure
      // at 11d: ZERO (every length-mismatched array lives in a shared golden,
      // which takes the strict whole-value rule instead of this walk).
      const n = Math.min(a.length, z.length);
      for (let i = 0; i < n; i++) walk(a[i], z[i], `${at}[${i}]`);
      return;
    }
    if (ka === 'number' && isNum(a) && isNum(z)) {
      if (a !== z) {
        if (isIdPath(at)) diffs.idDeltas.set(z - a, (diffs.idDeltas.get(z - a) ?? 0) + 1);
        else diffs.numeric.push(`${at}: ${a} -> ${z}`);
      }
      return;
    }
    if (a !== z) diffs.other.push(`${at}: ${show(a)} -> ${show(z)}`);
  };
  walk(p, m, path);
}
function newDiffs() {
  return { rng: [], idDeltas: new Map(), numeric: [], other: [], presence: [] };
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

// Shared golden: four-way composition with frame alignment by key.
export function checkShared(name, b, o, t, m) {
  const ctx = newCtx();
  const fb = frameMap(b);
  const fo = frameMap(o);
  const ft = frameMap(t);
  const fm = frameMap(m);
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
    const expected = inO === inB ? inT : inT === inB ? inO : inO === inT ? inO : null;
    if (expected === null) {
      ctx.findings.push(`frame ${key}: presence CONFLICT across parents`);
      continue;
    }
    if (inM !== expected) {
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
      composeLeaf(pb, po, pt, pm, `frames[${key}]`, ctx);
    } else if (inO && !inT) {
      // ours lengthened the scenario: theirs contributes only the id shift.
      oursOnlyFrames += 1;
      const diffs = newDiffs();
      diffAgainst(fo.get(key), fm.get(key), `frames[${key}]`, diffs, ctx);
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
      diffAgainst(ft.get(key), fm.get(key), `frames[${key}]`, diffs, ctx);
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
    composeLeaf(b[k], o[k], t[k], m[k], k, ctx);
  }
  composeLeaf(b.coverage, o.coverage, t.coverage, m.coverage, 'coverage', ctx);
  return { ctx, frames: m.frames.length, fourWay, oursOnlyFrames, theirsOnlyFrames };
}

// Clean add: merged vs the single parent that carries the golden.
export function checkAdd(name, p, m, side) {
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
    diffAgainst(p[k], m[k], k, diffs, ctx);
  diffAgainst(p.coverage, m.coverage, 'coverage', diffs, ctx);
  for (let i = 0; i < m.frames.length; i++) {
    diffAgainst(p.frames[i], m.frames[i], `frames[${i}]`, diffs, ctx);
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
  const classes = { shared: 0, oursOnly: 0, theirsOnly: 0, orphan: 0 };

  // MISSING: on a parent, absent from merged. The per-file walk below cannot see
  // these (it visits merged files only), so a resolution that DROPPED a golden
  // would otherwise report one fewer row and still print PASS.
  const parentGoldens = new Map([
    ['ours', gitLsGoldens(REFS.ours)],
    ['theirs', gitLsGoldens(REFS.theirs)],
  ]);
  const missing = missingFromMerged(files, parentGoldens);
  failures += missing.length;
  for (const f of files) {
    const rel = `${GOLDEN_DIR}/${f}`;
    const name = f.replace(/\.json$/, '');
    const m = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const b = gitShowJson(REFS.base, rel);
    const o = gitShowJson(REFS.ours, rel);
    const t = gitShowJson(REFS.theirs, rel);
    if (b && o && t) {
      classes.shared += 1;
      const r = checkShared(name, b, o, t, m);
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
        ctx: r.ctx,
        findings: r.ctx.findings,
      });
      failures += r.ctx.findings.length;
    } else if (o && !t && !b) {
      classes.oursOnly += 1;
      const r = checkAdd(name, o, m, 'ours');
      rows.push({
        name,
        kind: 'ours-only add',
        frames: `${m.frames.length}`,
        draws: `-/${o.draws}/-/${m.draws}`,
        digest: `${o.drawDigest}${m.drawDigest === o.drawDigest ? '=' : '!='}${m.drawDigest}`,
        nextId0: `-/${o.frames[0]?.nextId}/-/${m.frames[0]?.nextId}`,
        numeric: r.diffs.numeric.length,
        other: r.diffs.other.length,
        oursMoved: '-',
        theirsMoved: '-',
        idShifts: shiftsText(r.diffs.idDeltas),
        digests: `${r.ctx.stateMoves}/${r.ctx.eventsMoves}`,
        unaligned: 0,
        ctx: r.ctx,
        findings: r.ctx.findings,
        diffs: r.diffs,
      });
      failures += r.ctx.findings.length;
    } else if (t && !o && !b) {
      classes.theirsOnly += 1;
      const r = checkAdd(name, t, m, 'theirs');
      rows.push({
        name,
        kind: 'theirs-only add',
        frames: `${m.frames.length}`,
        draws: `-/-/${t.draws}/${m.draws}`,
        digest: `${t.drawDigest}${m.drawDigest === t.drawDigest ? '=' : '!='}${m.drawDigest}`,
        nextId0: `-/-/${t.frames[0]?.nextId}/${m.frames[0]?.nextId}`,
        numeric: r.diffs.numeric.length,
        other: r.diffs.other.length,
        oursMoved: '-',
        theirsMoved: '-',
        idShifts: shiftsText(r.diffs.idDeltas),
        digests: `${r.ctx.stateMoves}/${r.ctx.eventsMoves}`,
        unaligned: 0,
        ctx: r.ctx,
        findings: r.ctx.findings,
        diffs: r.diffs,
      });
      failures += r.ctx.findings.length;
    } else {
      classes.orphan += 1;
      rows.push({
        name,
        kind: `ORPHAN (base ${!!b} ours ${!!o} theirs ${!!t})`,
        findings: ['golden has no single-parent or three-way lineage'],
      });
      failures += 1;
    }
  }

  console.log(
    `refs: base ${REFS.base} ours ${REFS.ours} theirs ${REFS.theirs}; merged = ${GOLDEN_DIR} on disk`,
  );
  console.log(
    `goldens: ${files.length} (shared ${classes.shared}, ours-only ${classes.oursOnly}, theirs-only ${classes.theirsOnly}, orphan ${classes.orphan})`,
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
  const shiftAgreement = [...tableShifts.keys()].filter((d) => d !== 0);
  if (shiftAgreement.length > 1) failures += 1;

  const floorFail = files.length < GOLDEN_FLOOR;
  if (floorFail) failures += 1;
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
    'name | kind | frames | draws b/o/t/m | drawDigest o?m | nextId0 b/o/t/m | numeric | other | oursMoved | theirsMoved | idShifts | state/events moved | unaligned | findings',
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
        r.findings.length,
      ].join(' | '),
    );
  }
  console.log('');
  for (const r of rows) {
    if (r.findings.length) {
      console.log(`FINDINGS ${r.name}:`);
      for (const x of r.findings.slice(0, VERBOSE ? r.findings.length : 25)) console.log(`  ${x}`);
      if (!VERBOSE && r.findings.length > 25)
        console.log(`  ... ${r.findings.length - 25} more (use --verbose)`);
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
    if (r.diffs && r.kind === 'theirs-only add') {
      console.log(
        `DIFFS ${r.name} vs theirs (for the reader; check against the ledger's prediction):`,
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
  console.log(
    failures === 0
      ? `COMPOSITION: PASS (${files.length} goldens over the floor; none missing from a parent; every shared golden composes; rng unmoved; adds follow their parent)`
      : `COMPOSITION: FAIL (${failures} findings${missing.length ? `, ${missing.length} golden(s) missing from merged` : ''}${floorFail ? ', under the golden floor' : ''})`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

if (process.argv[1]?.endsWith('golden_composition.mjs')) main();
