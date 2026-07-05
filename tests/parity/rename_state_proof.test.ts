// RENAME STATE PROOF — the reverse-map re-digest proof (operator ruling addendum,
// 2026-07-02, recorded in ip-refactor/02-WORKING-MEMORY.md).
//
// Display names (and, for the sanctioned C1/C2 coined-id sweep, code ids) flow
// into the parity goldens' per-frame `state` digests (entity `name`/`templateId`
// samples) and per-window `events` digests (event text embeds display names). A
// pure rename therefore legitimately moves those hashes while every rng
// draw-order fingerprint, draw count, tick/time/nextId and frame shape stays
// byte-identical. The golden_token_inspector accepts such state-hash deltas ONLY
// under --allow-state-hashes, which in turn is sanctioned ONLY when THIS proof
// passes:
//
//   For every re-minted golden that differs from the baseline ref, re-record the
//   scenario live, capture the RAW canonical pre-hash payload of every frame's
//   state + events digest, reverse-map every string leaf new->old via the LOCKED
//   NAME-MAP (plus the sanctioned coined-id pairs), re-digest, and require the
//   result to equal the BASELINE golden's hashes exactly, frame by frame. That
//   machine-checks "nothing moved but the renamed tokens": any behavioral drift
//   (a number, an order, an extra event) cannot survive the reverse map.
//
// Deterministic: fixed scenario seeds, no wall clock, no network; the baseline is
// read from a pinned local git ref.
//
// Run:  RENAME_PROOF=1 npx vitest run tests/parity/rename_state_proof.test.ts
//       (default baseline ref HEAD — i.e. worktree goldens vs last commit;
//        after the rename slice is committed, re-run with
//        RENAME_PROOF_BASE=HEAD~1 to verify the committed slice.)
// Skipped entirely (env-gated) unless RENAME_PROOF=1.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { recordTrace } from './record';
import { SCENARIOS } from './scenarios';
import { canonical, fnv1a } from './trace';

// Hoisted capture buffers (vi.mock factories execute during import, before test
// body top-levels run — vi.hoisted makes these exist first).
const captures = vi.hoisted(() => ({
  state: [] as string[], // canonical JSON of {players, entities}, one per frame
  events: [] as string[], // canonical JSON of the event window, one per frame
}));

// Wrap the two digest entry points the Recorder uses so the proof can see the
// exact canonical payload each hash was computed over. Hash results are
// unchanged (fnv1a over the identical canonical JSON), so the recorded trace is
// byte-identical to what the parity gate records.
vi.mock('./trace', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./trace')>();
  return {
    ...orig,
    digest: (value: unknown): string => {
      const canonicalJson = JSON.stringify(orig.canonical(value, { omitDefaults: false }));
      captures.state.push(canonicalJson);
      return orig.fnv1a(canonicalJson);
    },
    eventDigest: (events: readonly unknown[]): string => {
      const canonicalJson = JSON.stringify(orig.canonical(events, { omitDefaults: false }));
      captures.events.push(canonicalJson);
      return orig.fnv1a(canonicalJson);
    },
  };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BASE_REF = process.env.RENAME_PROOF_BASE || 'HEAD';

// ---- the reverse map (new -> old), sourced from the LOCKED NAME-MAP ----------

// Sanctioned coined-id sweeps (C1 family ids + C2 warlock pet ids), exact-match
// only — mirrors ip-refactor/golden_token_inspector.mjs, reversed.
const REVERSE_ID_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['mudfin', 'murloc'],
  ['burrower', 'kobold'],
  ['emberkin', 'imp'],
  ['gloomshade', 'voidwalker'],
  ['duskborn', 'succubus'],
  ['spellhound', 'felhunter'],
  ['warfiend', 'felguard'],
  ['pyre_colossus', 'infernal'],
  ['wraithborn', 'doomguard'],
];

// Display renames parsed from the locked map (same row filters as the
// inspector), reversed new->old and applied longest-new-first, word-bounded.
function loadReverseDisplayPairs(): Array<[string, string]> {
  const mapPath = join(ROOT, 'ip-refactor', 'NAME-MAP.md');
  const pairs: Array<[string, string]> = [];
  for (const line of readFileSync(mapPath, 'utf8').split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const c = line.split('|').map((x) => x.trim());
    if (c.length !== 7) continue;
    const oldName = c[2];
    const newName = c[3];
    const flag = c[5];
    if (!['rename', 'coined-id', 'pairing'].includes(flag)) continue;
    if (!oldName || oldName === 'old' || /^[-: ]+$/.test(oldName)) continue;
    if (oldName.includes('(') || oldName.includes('"')) continue;
    if (oldName === newName) continue;
    if (oldName.startsWith('`')) continue; // backticked = code-id row (family ids)
    pairs.push([newName, oldName]);
  }
  pairs.sort((a, b) => b[0].length - a[0].length); // longest NEW name first
  return pairs;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function makeReverseMapper(): (s: string) => string {
  const displayPairs = loadReverseDisplayPairs();
  return (s: string): string => {
    const idHit = REVERSE_ID_PAIRS.find(([n]) => s === n);
    if (idHit) return idHit[1];
    let out = s;
    for (const [n, o] of displayPairs) {
      out = out.replace(new RegExp(`\\b${esc(n)}\\b`, 'g'), o);
    }
    return out;
  };
}

// Walk a parsed canonical payload, reverse-mapping every string LEAF. Keys are
// never mapped (no renamed token is an object key in the sampled state; ability,
// item and talent ids are frozen).
function reverseMapValue(value: unknown, mapStr: (s: string) => string): unknown {
  if (typeof value === 'string') return mapStr(value);
  if (Array.isArray(value)) return value.map((v) => reverseMapValue(v, mapStr));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = reverseMapValue(v, mapStr);
    }
    return out;
  }
  return value;
}

// ---- baseline access ----------------------------------------------------------

interface GoldenFrame {
  tick: number;
  time: number;
  nextId: number;
  state: string;
  events: string;
  rng: { draws: number; digest: string };
  label?: string;
}
interface GoldenTrace {
  scenario: string;
  draws: number;
  drawDigest: string;
  frames: GoldenFrame[];
}

function gitShow(ref: string, rel: string): string | null {
  try {
    return execFileSync('git', ['-C', ROOT, 'show', `${ref}:${rel}`], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    });
  } catch {
    return null;
  }
}

// ---- the proof ------------------------------------------------------------------

const RUN = process.env.RENAME_PROOF === '1';
const d = RUN ? describe : describe.skip;

d(`rename state proof (reverse-map re-digest vs ${BASE_REF})`, () => {
  const mapStr = makeReverseMapper();

  // Scope to the goldens that actually differ from the baseline ref.
  const changed = SCENARIOS.filter((s) => {
    const rel = `tests/parity/golden/${s.name}.json`;
    const base = gitShow(BASE_REF, rel);
    if (base === null) return false; // new golden: not this proof's business
    const work = readFileSync(join(ROOT, rel), 'utf8');
    return base !== work;
  });

  it('finds at least one re-minted golden to prove (else nothing sanctioned the flag)', () => {
    expect(changed.length).toBeGreaterThan(0);
  });

  for (const scenario of changed) {
    it(`${scenario.name}: reverse-mapped re-digest reproduces the baseline hashes`, () => {
      const baseText = gitShow(BASE_REF, `tests/parity/golden/${scenario.name}.json`);
      expect(baseText).not.toBeNull();
      const base = JSON.parse(baseText as string) as GoldenTrace;

      captures.state.length = 0;
      captures.events.length = 0;
      const live = JSON.parse(JSON.stringify(recordTrace(scenario))) as GoldenTrace;

      // One state + one events capture per frame, in frame order.
      expect(captures.state.length).toBe(live.frames.length);
      expect(captures.events.length).toBe(live.frames.length);
      expect(live.frames.length).toBe(base.frames.length);

      // The rename moved NO randomness and NO trajectory: rng draw count +
      // draw-order digest byte-identical, per frame and in total.
      expect(live.draws).toBe(base.draws);
      expect(live.drawDigest).toBe(base.drawDigest);

      for (let i = 0; i < live.frames.length; i++) {
        const lf = live.frames[i];
        const bf = base.frames[i];
        expect(lf.tick, `frame ${i} tick`).toBe(bf.tick);
        expect(lf.time, `frame ${i} time`).toBe(bf.time);
        expect(lf.nextId, `frame ${i} nextId`).toBe(bf.nextId);
        expect(lf.rng, `frame ${i} rng`).toEqual(bf.rng);

        // Harness sanity: the captured canonical payload is exactly what the
        // live trace hashed.
        expect(fnv1a(captures.state[i]), `frame ${i} live state recompute`).toBe(lf.state);
        expect(fnv1a(captures.events[i]), `frame ${i} live events recompute`).toBe(lf.events);

        // THE PROOF: reverse-map every string leaf new->old and re-digest; the
        // result must equal the baseline hash exactly.
        const revState = canonical(reverseMapValue(JSON.parse(captures.state[i]), mapStr), {
          omitDefaults: false,
        });
        expect(fnv1a(JSON.stringify(revState)), `frame ${i} state proof`).toBe(bf.state);

        const revEvents = canonical(reverseMapValue(JSON.parse(captures.events[i]), mapStr), {
          omitDefaults: false,
        });
        expect(fnv1a(JSON.stringify(revEvents)), `frame ${i} events proof`).toBe(bf.events);
      }
    });
  }
});
