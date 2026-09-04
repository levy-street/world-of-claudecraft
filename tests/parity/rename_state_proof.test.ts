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
// The PROOF block is env-gated (RENAME_PROOF=1) and stays hand-run, by
// construction: it needs a base ref whose goldens differ from the working tree
// ONLY by a rename, and it reds on any other golden move. An unconditional CI
// copy would red every legitimate UPDATE_PARITY re-record (a behavior change
// moves rng digests, which this proof must reject), and its "at least one
// re-minted golden" arm reds on every PR that touched no golden. What CI CAN
// honestly run is the SELF-CHECK block at the bottom of this file, ungated: it
// pins the NAME-MAP row filter, the reverse mapper, the re-digest identity and
// the Recorder capture hooks against fixtures and one cheap live recording.
// tests/parity/ is a CI_GUARD_PREFIXES floor prefix (scripts/lib/ci_shard_plan.mjs),
// so that block runs on every selective shard plan and every full run, and a
// rot in the harness (a renamed trace.ts export, a NAME-MAP format drift) reds
// in CI instead of surfacing the next time someone runs the proof by hand.
//
// SLICE SCOPING (Masterwrought Phase 03): the default reverse map spans the
// WHOLE locked NAME-MAP plus the C1/C2 coined-id pairs, which is correct only
// for the original pivot wave (whose baseline predates every row). A LATER
// rename slice must reverse ONLY its own rows: the baseline already carries the
// earlier waves' new names, so reversing those too un-renames strings the
// baseline never had old (observed: Frostveil -> Ice Barrier, Cottage Loaf ->
// Freshly Baked Bread, pet id gloomshade -> voidwalker). Set
// RENAME_PROOF_SECTION=<heading substring> to restrict the display pairs to
// the map rows AFTER the first heading containing that substring, and to skip
// the coined-id pairs (they belong to the original wave). Any heading line
// closes the section again, so keep an amendment section free of subheadings.
//
// Worked example (the Masterwrought Phase 03 slice; its goldens were minted in
// commit 233bd5bed0, so after that slice is committed the base is that
// commit's parent, NOT HEAD~1):
//   RENAME_PROOF=1 RENAME_PROOF_SECTION="MASTERWROUGHT PHASE 03" \
//     RENAME_PROOF_BASE=233bd5bed0~1 \
//     npx vitest run tests/parity/rename_state_proof.test.ts

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
const PROOF_SECTION = process.env.RENAME_PROOF_SECTION || '';

// The parser takes the map TEXT and the section filter as parameters so the
// self-check block below can drive it over a synthetic map: the proof and the
// self-check share this one function, so a filter change cannot pass one and
// silently skip the other.
function parseReverseDisplayPairs(mapText: string, section: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  let inSection = section === '';
  for (const line of mapText.split('\n')) {
    if (section && line.startsWith('#')) {
      inSection = line.includes(section);
      continue;
    }
    if (!inSection) continue;
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

function loadReverseDisplayPairs(): Array<[string, string]> {
  const mapPath = join(ROOT, 'ip-refactor', 'NAME-MAP.md');
  return parseReverseDisplayPairs(readFileSync(mapPath, 'utf8'), PROOF_SECTION);
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface ReverseMapSource {
  displayPairs: ReadonlyArray<readonly [string, string]>;
  // Coined-id pairs are the original wave's; a scoped slice never maps ids.
  idPairs: ReadonlyArray<readonly [string, string]>;
}

function makeReverseMapper(
  source: ReverseMapSource = {
    displayPairs: loadReverseDisplayPairs(),
    idPairs: PROOF_SECTION ? [] : REVERSE_ID_PAIRS,
  },
): (s: string) => string {
  const { displayPairs, idPairs } = source;
  return (s: string): string => {
    const idHit = idPairs.find(([n]) => s === n);
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

  if (PROOF_SECTION) {
    it('section scoping matched at least one map row (a typo would otherwise surface as opaque hash mismatches)', () => {
      expect(loadReverseDisplayPairs().length).toBeGreaterThan(0);
    });
  }

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

// ---- the self-check floor arm (UNGATED: this is what CI runs) -------------------
//
// The proof above cannot run unconditionally in CI (header). These arms pin the
// machinery it stands on, against fixtures and one cheap live recording, so the
// harness cannot rot between two hand-run rename slices: the NAME-MAP row filter,
// the reverse mapper's word-bounded longest-first replacement, the re-digest
// identity, and the vi.mock capture of the Recorder's digest path.
describe('rename state proof: self-check floor arm', () => {
  it('parses the locked NAME-MAP into a non-empty, longest-new-first reverse map', () => {
    const pairs = loadReverseDisplayPairs();
    // Vacuity floor near the real row count (about 640 rename/pairing/coined-id
    // rows when written), so a parser that silently matches nothing fails here
    // instead of turning the proof into a no-op reverse map.
    expect(pairs.length).toBeGreaterThan(500);
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i - 1][0].length, `pair ${i} sorts longest-new-first`).toBeGreaterThanOrEqual(
        pairs[i][0].length,
      );
    }
    for (const [newName, oldName] of pairs) {
      expect(newName.length).toBeGreaterThan(0);
      expect(oldName.length).toBeGreaterThan(0);
      expect(newName, `no-op pair ${newName}`).not.toBe(oldName);
      expect(oldName.startsWith('`'), `code-id row leaked: ${oldName}`).toBe(false);
      expect(oldName.includes('('), `annotated row leaked: ${oldName}`).toBe(false);
    }
  });

  it('row filter positive control: a synthetic map admits exactly the display-rename rows', () => {
    const map = [
      '# NAME-MAP - the locked rename contract',
      '',
      '## Abilities (V1)',
      '### Warrior',
      '| id (frozen) | old | new (PROPOSED) | kind | flag |',
      '|---|---|---|---|---|',
      '| `heroic_strike` | Heroic Strike | Reaver Strike | ability | rename |',
      '| `murloc` | `murloc` | `mudfin` | family | coined-id |',
      '| `war_imp_heroic_strike` | Improved Heroic Strike | Improved Reaver Strike | talent | pairing |',
      '| `frost_nova` | Frost (Ice) Nova | Icebind | ability | rename |',
      '| `keep` | Same Name | Same Name | ability | rename |',
      '| `maybe` | Old Thing | New Thing | ability | rename? |',
      '| `generic` | Charge | Charge Kept | ability | generic-keep? |',
      '| `short` | Only Five | Cells |',
      '## MASTERWROUGHT PHASE 03 AMENDMENT (2026-08-07)',
      '| id (frozen) | old | new (PROPOSED) | kind | flag |',
      '|---|---|---|---|---|',
      '| `late` | Late Old | Late New | item | rename |',
    ].join('\n');
    // Whole map: the rename, the pairing, and the amendment row, longest NEW
    // name first; the backticked code-id row, the parenthesised old name, the
    // no-op row, the pending `rename?` and `generic-keep?` flags, and the
    // malformed short row are all filtered.
    expect(parseReverseDisplayPairs(map, '')).toEqual([
      ['Improved Reaver Strike', 'Improved Heroic Strike'],
      ['Reaver Strike', 'Heroic Strike'],
      ['Late New', 'Late Old'],
    ]);
    // Section scoping restricts to the rows after the matching heading.
    expect(parseReverseDisplayPairs(map, 'MASTERWROUGHT PHASE 03')).toEqual([
      ['Late New', 'Late Old'],
    ]);
    // A section typo matches nothing, which the gated block turns into its own
    // loud failure rather than opaque hash mismatches.
    expect(parseReverseDisplayPairs(map, 'NO SUCH SECTION')).toEqual([]);
  });

  it('the sanctioned coined-id pairs are unique on both sides', () => {
    expect(REVERSE_ID_PAIRS.length).toBeGreaterThan(0);
    expect(new Set(REVERSE_ID_PAIRS.map(([n]) => n)).size).toBe(REVERSE_ID_PAIRS.length);
    expect(new Set(REVERSE_ID_PAIRS.map(([, o]) => o)).size).toBe(REVERSE_ID_PAIRS.length);
    for (const [n, o] of REVERSE_ID_PAIRS) expect(n).not.toBe(o);
  });

  it('the reverse mapper round-trips a payload of NEW names to OLD and re-digests identically', () => {
    const mapStr = makeReverseMapper({
      displayPairs: [
        ['Reaver Strike', 'Heroic Strike'],
        ['Frostveil', 'Ice Barrier'],
      ],
      idPairs: REVERSE_ID_PAIRS,
    });
    const live = {
      entities: [
        {
          name: 'Reaver Strike',
          templateId: 'mudfin',
          // The third string is NOT a whole-word hit and must stay untouched.
          auras: ['Frostveil fades', 'Reaver Strike x2', 'Frostveiled'],
          hp: 12.5,
        },
      ],
      events: [{ text: 'You cast Reaver Strike.' }, { text: 'mudfin flees' }],
    };
    const expected = {
      entities: [
        {
          name: 'Heroic Strike',
          templateId: 'murloc',
          auras: ['Ice Barrier fades', 'Heroic Strike x2', 'Frostveiled'],
          hp: 12.5,
        },
      ],
      // The id pair is exact-match only: an id inside prose is not a coined id.
      events: [{ text: 'You cast Heroic Strike.' }, { text: 'mudfin flees' }],
    };
    const reversed = reverseMapValue(live, mapStr);
    expect(reversed).toEqual(expected);
    const digestOf = (v: unknown) => fnv1a(JSON.stringify(canonical(v, { omitDefaults: false })));
    expect(digestOf(reversed)).toBe(digestOf(expected));
    // And the digest MOVED, so the identity above is not vacuous.
    expect(digestOf(live)).not.toBe(digestOf(expected));
  });

  it('the capture harness still intercepts the Recorder digest path frame by frame', () => {
    // grix_respawn_window is the cheapest scenario in tests/parity/scenarios.ts:
    // no tick loop (0 ticks, 4 frames: init, two snapshots, final), one Sim.
    const scenario = SCENARIOS.find((s) => s.name === 'grix_respawn_window');
    if (!scenario) throw new Error('grix_respawn_window scenario missing from SCENARIOS');
    captures.state.length = 0;
    captures.events.length = 0;
    const live = JSON.parse(JSON.stringify(recordTrace(scenario))) as GoldenTrace;
    expect(live.frames.length).toBeGreaterThan(0);
    // One state + one events capture per frame, in frame order: the vi.mock
    // of ./trace is what the proof stands on, and a renamed digest export or a
    // Recorder that stops calling it would leave these buffers empty.
    expect(captures.state.length).toBe(live.frames.length);
    expect(captures.events.length).toBe(live.frames.length);
    for (let i = 0; i < live.frames.length; i++) {
      expect(fnv1a(captures.state[i]), `frame ${i} state recompute`).toBe(live.frames[i].state);
      expect(fnv1a(captures.events[i]), `frame ${i} events recompute`).toBe(live.frames[i].events);
    }
  });
});
