// THE ONE-TIME MASTERY RESET REHEARSAL: a blob-diff sweep proving that
// load-then-serialize applies EXACTLY the documented deltas to a character
// blob and nothing else. Default mode runs a deterministic synthetic corpus
// (the modern gather-cast shape, the legacy professions-key-only shape,
// over-cap values, minimal
// fresh shape, and one with masteryResetApplied already true). Env-gated
// mode: RESET_REHEARSAL_INPUT names a JSON file (an array of {id, state}
// rows exported from a database copy) and the same sweep runs over every row
// with a summary tally; this is the maintainer's pre-deploy staging
// rehearsal, exact-once semantics identical.
//
// The diff discipline: for each blob we round-trip it twice with the SAME
// seed, once as-is (the actual deploy load) and once with masteryResetApplied
// forced true (the no-reset baseline). Baseline vs actual isolates EXACTLY
// the reset's effect; input vs actual is then classified row by row against
// the documented allowlist (two maps zeroed, legacy professions mirror
// zeroed, flag added true, load-time cap clamps on the two maps) plus the
// default fills the no-reset baseline also produces. Anything else fails
// with a printed per-key diff.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CRAFT_RING, GATHERING_PROFESSIONS } from '../src/sim/content/professions';
import { type CharacterState, Sim } from '../src/sim/sim';

type Blob = Record<string, unknown>;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// Load a blob into a fresh deterministic world and serialize it straight back
// (no ticks, so nothing but the load path itself can move a field).
function roundTrip(state: CharacterState, seed: number, playerClass = 'warrior'): Blob {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  // biome-ignore lint/suspicious/noExplicitAny: rehearsal rows may carry any class
  const pid = sim.addPlayer(playerClass as any, 'Rehearsal', { state: clone(state) });
  const blob = sim.serializeCharacter(pid);
  if (!blob) throw new Error('serializeCharacter returned null');
  return clone(blob) as unknown as Blob;
}

interface DiffRow {
  path: string;
  before: unknown;
  after: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function deepDiff(a: unknown, b: unknown, path: string, out: DiffRow[]): void {
  // Recurse when either side is a plain object (treating an absent side as
  // {}), so an added or removed subtree reports LEAF rows the allowlist and
  // the baseline default-fill rule can classify one key at a time.
  if (
    (isPlainObject(a) || isPlainObject(b)) &&
    (a === undefined || isPlainObject(a)) &&
    (b === undefined || isPlainObject(b))
  ) {
    const ao = (a ?? {}) as Record<string, unknown>;
    const bo = (b ?? {}) as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort();
    for (const k of keys) deepDiff(ao[k], bo[k], path ? `${path}.${k}` : k, out);
    return;
  }
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  out.push({ path, before: a, after: b });
}

const SKILL_MAP_ROOTS = ['craftSkills', 'gatheringProficiency', 'professions'];

function skillMapRoot(path: string): string | null {
  const root = path.split('.')[0];
  return SKILL_MAP_ROOTS.includes(root) ? root : null;
}

// The load-time cap for a skill-map leaf (the Stage 2 clamp arms): gathering
// paths clamp to GATHERING_PROFESSIONS maxSkill, craft paths to the ring
// craft's maxSkill (read via the sim content the same way the clamps do).
function capFor(path: string): number | null {
  const [root, id] = path.split('.');
  if (root === 'craftSkills') return CRAFT_RING.find((c) => c.id === id)?.maxSkill ?? null;
  if (root === 'gatheringProficiency' || root === 'professions') {
    // biome-ignore lint/suspicious/noExplicitAny: id-keyed content lookup
    return (GATHERING_PROFESSIONS as any)[id]?.maxSkill ?? null;
  }
  return null;
}

interface RehearsalResult {
  applied: boolean;
  violations: string[];
}

// The sweep core: classify every input-vs-output delta against the
// documented allowlist. `seed` must stay fixed per row so the baseline and
// actual arms share one world construction.
function rehearse(state: CharacterState, seed: number, playerClass = 'warrior'): RehearsalResult {
  const input = clone(state) as unknown as Blob;
  const wasApplied = input.masteryResetApplied === true;
  const baseline = roundTrip({ ...clone(state), masteryResetApplied: true }, seed, playerClass);
  const actual = roundTrip(clone(state), seed, playerClass);
  const violations: string[] = [];

  // Arm 1: baseline vs actual isolates EXACTLY the reset effect. Every delta
  // must be a skill-map leaf zeroed by the reset (an already-applied row must
  // show zero deltas here).
  const resetEffect: DiffRow[] = [];
  deepDiff(baseline, actual, '', resetEffect);
  for (const row of resetEffect) {
    const ok = skillMapRoot(row.path) !== null && row.after === 0 && !wasApplied;
    if (!ok) {
      violations.push(
        `reset effect outside the two maps: ${row.path}: ${JSON.stringify(row.before)} -> ${JSON.stringify(row.after)}`,
      );
    }
  }

  // Arm 2: input vs actual, the full deploy delta. Allowed rows: the two
  // maps zeroed (or, when the flag was already true, clamped down to the
  // documented content cap), the flag added as true, and default fills the
  // no-reset baseline produces identically (before absent, after equal to
  // the baseline's value at that path).
  const deployDelta: DiffRow[] = [];
  deepDiff(input, actual, '', deployDelta);
  const baselinePaths = new Map<string, unknown>();
  const flatten = (v: unknown, path: string): void => {
    if (isPlainObject(v)) {
      for (const k of Object.keys(v)) flatten(v[k], path ? `${path}.${k}` : k);
      return;
    }
    baselinePaths.set(path, v);
  };
  flatten(baseline, '');
  for (const row of deployDelta) {
    if (row.path === 'masteryResetApplied' && row.before === undefined && row.after === true) {
      continue; // the flag lands true
    }
    const root = skillMapRoot(row.path);
    if (root !== null && !wasApplied && row.after === 0) continue; // zeroed by the reset
    if (root !== null && typeof row.before === 'number' && row.after === capFor(row.path)) {
      continue; // the documented load-time cap clamp
    }
    if (
      row.before === undefined &&
      baselinePaths.has(row.path) &&
      JSON.stringify(baselinePaths.get(row.path)) === JSON.stringify(row.after)
    ) {
      continue; // a default fill any curve-era load produces, reset or not
    }
    violations.push(
      `undocumented delta: ${row.path}: ${JSON.stringify(row.before)} -> ${JSON.stringify(row.after)}`,
    );
  }

  if (actual.masteryResetApplied !== true) {
    violations.push('output blob is missing masteryResetApplied: true');
  }

  // Arm 3 (completeness): the two allowlist arms above only
  // classify deltas that HAPPENED, so a partial reset (one map missed) sails
  // through them: the untouched map produces no delta at all. For a row the
  // reset should have applied to, require every craft-skill and gathering
  // leaf of the OUTPUT blob (the legacy professions mirror included, when
  // present) to be exactly 0. This is the arm that makes the env-gated
  // production-copy run fail loudly on an incomplete reset instead of
  // tallying it as applied.
  if (!wasApplied) {
    const craftOut = (actual.craftSkills ?? {}) as Record<string, unknown>;
    for (const craft of CRAFT_RING) {
      if (craftOut[craft.id] !== 0) {
        violations.push(
          `reset incompleteness: craftSkills.${craft.id} is ${JSON.stringify(craftOut[craft.id])}, expected 0`,
        );
      }
    }
    for (const root of ['gatheringProficiency', 'professions'] as const) {
      const map = actual[root] as Record<string, unknown> | undefined;
      if (root === 'professions' && map === undefined) continue; // mirror is optional
      for (const id of Object.keys(GATHERING_PROFESSIONS)) {
        if ((map ?? {})[id] !== 0) {
          violations.push(
            `reset incompleteness: ${root}.${id} is ${JSON.stringify((map ?? {})[id])}, expected 0`,
          );
        }
      }
    }
  }
  return { applied: !wasApplied, violations };
}

// ----- the committed synthetic corpus -----------------------------------------
// Built deterministically from serializeCharacter itself (fixed seed), so the
// modern rows carry the full curve-era blob shape, then hand-derived into the
// five documented variants.

function buildModernBlob(): CharacterState {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('warrior', 'Corpus');
  // biome-ignore lint/suspicious/noExplicitAny: corpus construction reaches meta
  const meta = (sim as any).players.get(pid);
  meta.copper = 4321;
  meta.craftSkills.armorcrafting = 60;
  meta.craftSkills.enchanting = 15;
  meta.gatheringProficiency.mining = 40;
  meta.inventory.push({ itemId: 'roasted_boar', count: 3 });
  const blob = sim.serializeCharacter(pid);
  if (!blob) throw new Error('serializeCharacter returned null');
  return clone(blob);
}

// Bake the join-time machinery (deed retro grants inferred from the skill
// values, item-discovery seeding, the renown recompute) into a row with the
// flag forced true, so the corpus models a REAL exported character whose
// deeds are already consistent with its skills. Without this, a synthetic
// row with nonzero skills but no deeds would show join-time deed deltas that
// are the deed system's own doing, not the reset's.
function stabilize(blob: CharacterState, seed: number): Blob {
  return roundTrip({ ...clone(blob), masteryResetApplied: true }, seed);
}

function buildCorpus(): { id: string; state: CharacterState }[] {
  const modernApplied = stabilize(buildModernBlob(), 50);
  const modern = clone(modernApplied);
  delete modern.masteryResetApplied;

  const legacy = clone(modern) as Blob;
  legacy.professions = { mining: 55 };
  delete legacy.gatheringProficiency;

  // Over-cap values re-bumped AFTER stabilization, so the row keeps deeds
  // consistent with having once stood past the thresholds while the input
  // skill values still exceed the caps.
  const overCapBase = stabilize(
    (() => {
      const b = clone(modern) as Blob;
      (b.craftSkills as Record<string, number>).armorcrafting = 99999;
      (b.gatheringProficiency as Record<string, number>).mining = 99999;
      (b.professions as Record<string, number>).mining = 99999;
      return b as unknown as CharacterState;
    })(),
    51,
  );
  const overCap = clone(overCapBase) as Blob;
  delete overCap.masteryResetApplied;
  (overCap.craftSkills as Record<string, number>).armorcrafting = 99999;
  (overCap.gatheringProficiency as Record<string, number>).mining = 99999;
  (overCap.professions as Record<string, number>).mining = 99999;

  // Already-applied AND over-cap: the only row where a nonzero clamp delta
  // (down to the documented content cap) is the expected outcome.
  const overCapApplied = clone(overCap) as Blob;
  overCapApplied.masteryResetApplied = true;

  // A sparse pre-12b row. Its deeds carry the grants a real character with
  // these skills already received the first time it logged in after the Book
  // of Deeds shipped (the skill-proof retro inferences), so the reset cannot
  // be blamed for their absence.
  const minimal = {
    level: 3,
    xp: 10,
    copper: 250,
    hp: 80,
    resource: 0,
    pos: { x: 0, z: 150 },
    facing: 0,
    equipment: {},
    inventory: [],
    questLog: [],
    questsDone: [],
    craftSkills: { cooking: 12 },
    professions: { herbalism: 8 },
    deeds: { prog_first_craft: '', prog_first_harvest: '', exp_first_herb: '' },
  } as unknown as CharacterState;

  return [
    { id: 'modern-12b-shape', state: modern as unknown as CharacterState },
    { id: 'legacy-professions-key-only', state: legacy as unknown as CharacterState },
    { id: 'over-cap-values', state: overCap as unknown as CharacterState },
    { id: 'over-cap-already-applied', state: overCapApplied as unknown as CharacterState },
    { id: 'minimal-fresh-shape', state: minimal },
    { id: 'already-applied', state: modernApplied as unknown as CharacterState },
  ];
}

describe('mastery reset rehearsal (the committed synthetic corpus)', () => {
  const corpus = buildCorpus();
  corpus.forEach((row, i) => {
    it(`${row.id}: only the documented deltas`, () => {
      const result = rehearse(row.state, 100 + i);
      expect(result.violations, result.violations.join('\n')).toHaveLength(0);
    });
  });

  it('flags the reset as applied exactly for the flag-absent rows', () => {
    const byId = new Map(corpus.map((row, i) => [row.id, rehearse(row.state, 100 + i)]));
    expect(byId.get('modern-12b-shape')?.applied).toBe(true);
    expect(byId.get('minimal-fresh-shape')?.applied).toBe(true);
    expect(byId.get('over-cap-already-applied')?.applied).toBe(false);
    expect(byId.get('already-applied')?.applied).toBe(false);
  });
});

// ----- the env-gated staging rehearsal ----------------------------------------
const rehearsalInput = process.env.RESET_REHEARSAL_INPUT;

describe.runIf(!!rehearsalInput)('mastery reset rehearsal (RESET_REHEARSAL_INPUT)', () => {
  it('applies exactly the documented deltas to every exported row', () => {
    const rows = JSON.parse(fs.readFileSync(rehearsalInput as string, 'utf8')) as {
      id: string;
      state: CharacterState;
      playerClass?: string;
    }[];
    let applied = 0;
    let alreadyApplied = 0;
    const failures: string[] = [];
    rows.forEach((row, i) => {
      const result = rehearse(row.state, 1000 + i, row.playerClass ?? 'warrior');
      if (result.applied) applied++;
      else alreadyApplied++;
      for (const v of result.violations) failures.push(`${row.id}: ${v}`);
    });
    // Dev-channel summary for the staging operator (English by design).
    console.log(
      `mastery reset rehearsal: ${rows.length} rows, ${applied} reset, ${alreadyApplied} already applied, ${failures.length} violations`,
    );
    expect(failures, failures.join('\n')).toHaveLength(0);
  });
});
