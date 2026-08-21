// Fixture pins for the golden COMPOSITION checker
// (scripts/merge_audit/golden_composition.mjs), the unit 2 evidence tool of
// the farming absorb (masterwrought Phase 11d). Inline fixtures only: no git,
// no repo walk, so the selective gate sees it through the import graph. The
// 11d gate review flagged the tool as the one merge_audit script without a
// pin; these arms prove the two properties the phase leaned on: numeric
// leaves must COMPOSE (merged - base == oursDelta + theirsDelta) and a moved
// rng digest in a scenario neither side touched is a FINDING, not a delta.
import { describe, expect, it } from 'vitest';
import {
  checkAdd,
  checkShared,
  composeLeaf,
  GOLDEN_FLOOR,
  isIdPath,
  missingFromMerged,
  newCtx,
} from '../scripts/merge_audit/golden_composition.mjs';

const frame = (tick: number, over: Record<string, unknown> = {}) => ({
  tick,
  time: tick / 20,
  nextId: 968,
  state: 's0',
  events: 'e0',
  rng: { draws: 10, digest: 'aaaa' },
  label: 'init',
  players: [],
  entities: [{ id: 963, hp: 100 }],
  ...over,
});
const golden = (over: Record<string, unknown> = {}, frames = [frame(0)]) => ({
  scenario: 'fixture',
  seed: 1,
  sampleEvery: 20,
  ticks: 1,
  coverage: ['c'],
  draws: 10,
  drawDigest: 'aaaa',
  frames,
  ...over,
});

describe('composeLeaf', () => {
  it('accepts a numeric leaf that composes and rejects one that does not', () => {
    const ok = newCtx();
    composeLeaf(100, 110, 96, 106, 'hp', ok); // 100 + 10 - 4 = 106
    expect(ok.findings).toEqual([]);
    const bad = newCtx();
    composeLeaf(100, 110, 96, 110, 'hp', bad); // took ours, dropped theirs' delta
    expect(bad.findings).toHaveLength(1);
    expect(bad.findings[0]).toContain('does not compose');
  });

  it('applies the three-way rule to strings and flags a both-moved CONFLICT', () => {
    const ok = newCtx();
    composeLeaf('a', 'a', 'b', 'b', 'name', ok); // ours kept base, theirs moved
    expect(ok.findings).toEqual([]);
    const conflict = newCtx();
    composeLeaf('a', 'b', 'c', 'b', 'name', conflict);
    expect(conflict.findings[0]).toContain('CONFLICT');
  });

  it('composes key PRESENCE: a key one side added must be in merged', () => {
    const dropped = newCtx();
    composeLeaf(undefined, undefined, 5, undefined, 'craftDaily', dropped);
    expect(dropped.findings[0]).toContain('presence does not compose');
  });
});

describe('checkShared', () => {
  it('reports a moved rng digest as a finding when theirs kept base', () => {
    const b = golden();
    const o = golden();
    const t = golden();
    const m = golden({ drawDigest: 'ffff' }, [frame(0, { rng: { draws: 10, digest: 'ffff' } })]);
    const { ctx } = checkShared('fx', b, o, t, m);
    expect(ctx.findings.some((f: string) => f.includes('RNG MOVED'))).toBe(true);
  });

  it('passes a clean composition where BOTH parents moved a leaf, and counts the shift', () => {
    // Merged is built INDEPENDENTLY of theirs, not by the same call: the earlier
    // shape (`const t = shift(g,4); const m = shift(g,4)`) made merged a copy of
    // theirs, so no arm exercised a leaf both parents moved and a take-theirs
    // mutant of the additive rule went unkilled (Phase 11d QA audit, N9).
    // ours moves hp 100 -> 110; theirs shifts the ids by +4; merged carries both.
    const b = golden(undefined, [frame(0, { nextId: 968, entities: [{ id: 963, hp: 100 }] })]);
    const o = golden(undefined, [frame(0, { nextId: 968, entities: [{ id: 963, hp: 110 }] })]);
    const t = golden(undefined, [frame(0, { nextId: 972, entities: [{ id: 967, hp: 100 }] })]);
    const m = golden(undefined, [frame(0, { nextId: 972, entities: [{ id: 967, hp: 110 }] })]);
    const { ctx } = checkShared('fx', b, o, t, m);
    expect(ctx.findings).toEqual([]);
    expect(ctx.idShifts.get(4)).toBeGreaterThan(0);
  });

  it('FAILS when merged takes theirs on a leaf ours moved (the additive rule doing work)', () => {
    // The mutant the old self-comparing arm could not kill: merged keeps base's
    // hp instead of composing ours' move.
    const b = golden(undefined, [frame(0, { nextId: 968, entities: [{ id: 963, hp: 100 }] })]);
    const o = golden(undefined, [frame(0, { nextId: 968, entities: [{ id: 963, hp: 110 }] })]);
    const t = golden(undefined, [frame(0, { nextId: 972, entities: [{ id: 967, hp: 100 }] })]);
    const m = golden(undefined, [frame(0, { nextId: 972, entities: [{ id: 967, hp: 100 }] })]);
    const { ctx } = checkShared('fx', b, o, t, m);
    expect(ctx.findings.length).toBeGreaterThan(0);
  });
});

describe('the id-family shift must be UNIFORM (Phase 11d QA)', () => {
  // isIdPath routes an id leaf away from the hard `numeric` finding into a
  // counted shift, so in the TWO-WAY arms it decides finding versus silence.
  // Before this, an id leaf could move by ANY amount and the run still exited 0
  // with a PASS verdict: the audit moved one nextId by +37 and got "+4x28 +41x1"
  // printed in a cell.
  it('accepts one shift and reports nothing', () => {
    const p = golden(undefined, [frame(0, { nextId: 968, entities: [{ id: 963, hp: 100 }] })]);
    const m = golden(undefined, [frame(0, { nextId: 972, entities: [{ id: 967, hp: 100 }] })]);
    const { ctx } = checkAdd('fx', p, m, 'ours');
    expect(ctx.findings).toEqual([]);
  });

  it('FAILS a second, different shift in the same golden', () => {
    const p = golden(undefined, [frame(0, { nextId: 968, entities: [{ id: 963, hp: 100 }] })]);
    // nextId moves +41 while the entity id moves +4: the exact shape the audit
    // reproduced on rift_clear_rewards.
    const m = golden(undefined, [frame(0, { nextId: 1009, entities: [{ id: 967, hp: 100 }] })]);
    const { ctx } = checkAdd('fx', p, m, 'ours');
    expect(ctx.findings.some((f: string) => f.includes('NOT uniform'))).toBe(true);
  });

  it('applies to a THEIRS-only add too, whose other rows are only listed', () => {
    const p = golden(undefined, [frame(0, { nextId: 968, entities: [{ id: 963, hp: 100 }] })]);
    const m = golden(undefined, [frame(0, { nextId: 1009, entities: [{ id: 967, hp: 100 }] })]);
    const { ctx } = checkAdd('fx', p, m, 'theirs');
    expect(ctx.findings.some((f: string) => f.includes('NOT uniform'))).toBe(true);
  });
});

describe('checkAdd', () => {
  it('flags rng movement against the carrying parent of a clean add', () => {
    const p = golden();
    const m = golden({ draws: 11, drawDigest: 'bbbb' });
    const { ctx } = checkAdd('fx', p, m, 'theirs');
    expect(ctx.findings.some((f: string) => f.includes('RNG MOVED'))).toBe(true);
  });

  it('rejects non-id movement in an ours-only add and allows the id shift', () => {
    const p = golden();
    const idOnly = golden(undefined, [frame(0, { nextId: 972, entities: [{ id: 967, hp: 100 }] })]);
    expect(checkAdd('fx', p, idOnly, 'ours').ctx.findings).toEqual([]);
    const hpMoved = golden(undefined, [frame(0, { entities: [{ id: 963, hp: 90 }] })]);
    const { ctx } = checkAdd('fx', p, hpMoved, 'ours');
    expect(ctx.findings.some((f: string) => f.includes('non-id numeric'))).toBe(true);
  });
});

describe('the dropped-golden class (Phase 11d QA)', () => {
  // The composition walk is driven by the MERGED directory, so it is blind in one
  // direction by construction: a golden a parent carries and the merge DROPPED is
  // never visited, and the report still printed PASS over one fewer row. The 11d
  // QA gate review proved that live (hiding farming_session.json left 68 goldens,
  // 0 findings, exit 0). These arms pin the other side of the walk.
  const parents = (ours: string[], theirs: string[]) =>
    new Map([
      ['ours', new Set(ours)],
      ['theirs', new Set(theirs)],
    ]);

  it('reports nothing when merged carries every parent golden', () => {
    const merged = ['a.json', 'b.json', 'c.json'];
    expect(missingFromMerged(merged, parents(['a.json', 'b.json'], ['b.json', 'c.json']))).toEqual(
      [],
    );
  });

  it('names a golden the merge dropped, and which parent carried it', () => {
    const missing = missingFromMerged(['a.json'], parents(['a.json'], ['a.json', 'farming.json']));
    expect(missing).toEqual([{ file: 'farming.json', sides: ['theirs'] }]);
  });

  it('collapses a golden BOTH parents carried into one row naming both', () => {
    const missing = missingFromMerged([], parents(['shared.json'], ['shared.json']));
    expect(missing).toEqual([{ file: 'shared.json', sides: ['ours', 'theirs'] }]);
  });

  it('is not fooled by an empty merged set: every parent golden is missing', () => {
    // The empty-input case the review found: with no lower bound the tool printed
    // "every shared golden composes" over nothing at all.
    const missing = missingFromMerged([], parents(['a.json', 'b.json'], ['b.json']));
    expect(missing.map((m) => m.file)).toEqual(['a.json', 'b.json']);
  });

  it('keeps the vacuity floor under the real set but far above empty', () => {
    // A floor at or above the live count would red on any legitimate deletion;
    // a floor of 0 would not catch the truncation it exists for.
    expect(GOLDEN_FLOOR).toBeGreaterThan(0);
    expect(GOLDEN_FLOOR).toBeLessThan(69);
    expect(GOLDEN_FLOOR).toBeGreaterThan(50);
  });
});

describe('isIdPath', () => {
  it('classifies the id family and only the id family', () => {
    expect(isIdPath('frames[0:init#0].nextId')).toBe(true);
    expect(isIdPath('frames[0].entities[0].sourceId')).toBe(true);
    expect(isIdPath('frames[0].entities[1].threat[2][0]')).toBe(true);
    expect(isIdPath('frames[0].entities[1].lootRecipientIds[0]')).toBe(true);
    // The threat AMOUNT column and plain gameplay numbers are NOT ids.
    expect(isIdPath('frames[0].entities[1].threat[2][1]')).toBe(false);
    expect(isIdPath('frames[0].entities[0].hp')).toBe(false);
  });
});
