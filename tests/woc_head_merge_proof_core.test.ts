// Which merged WOC head may skip its compile gate (woc_head_merge_proof_core.ts): only one
// whose program a WITNESS still proves, by the gate's own readiness proof asked again at
// every use. Nothing is remembered as "linked": a proof that stops holding (the context
// was restored, the renderer rebuilt, the witness's material disposed and its program
// released with it) drops the witness, and the next head takes the gate.
import { describe, expect, it } from 'vitest';
import {
  dropWocMergedProof,
  recordWocMergedProof,
  wocMergedProgramProven,
} from '../src/render/characters/woc_head_merge_proof_core';

const ONE_SIDED = 1;
const TWO_SIDED = 2;

/** A proven reveal: a mesh wearing `material`, and a gate proof a case can turn off. */
function witness(material: object = {}) {
  const state = { ready: true, asked: 0 };
  const holder: { material: unknown } = { material };
  return {
    holder,
    material,
    state,
    ready: (): boolean => {
      state.asked++;
      return state.ready;
    },
  };
}

describe('wocMergedProgramProven', () => {
  it('nothing is proven until a gate proved it', () => {
    const source = {};
    expect(wocMergedProgramProven(source, ONE_SIDED)).toBe(false);
    expect(wocMergedProgramProven(source, TWO_SIDED)).toBe(false);
  });

  it('a recorded proof is ASKED at every use, never remembered as true', () => {
    const source = {};
    const w = witness();
    recordWocMergedProof(source, ONE_SIDED, w);
    // recording asks nothing: the gate just proved it
    expect(w.state.asked).toBe(0);
    expect(wocMergedProgramProven(source, ONE_SIDED)).toBe(true);
    expect(wocMergedProgramProven(source, ONE_SIDED)).toBe(true);
    expect(w.state.asked).toBe(2);
  });

  it('a proof is of ONE tier material and ONE sidedness variant', () => {
    const source = {};
    recordWocMergedProof(source, ONE_SIDED, witness());
    // the other variant is another program
    expect(wocMergedProgramProven(source, TWO_SIDED)).toBe(false);
    // ...and so is the same variant of another tier material (a rebuilt profile mints new ones)
    expect(wocMergedProgramProven({}, ONE_SIDED)).toBe(false);
    expect(wocMergedProgramProven(source, ONE_SIDED)).toBe(true);
  });

  it('a proof that no longer holds drops its witness: the next head takes the gate', () => {
    const source = {};
    const w = witness();
    recordWocMergedProof(source, ONE_SIDED, w);
    expect(wocMergedProgramProven(source, ONE_SIDED)).toBe(true);
    // the context was restored (or the witness's material disposed): its record is gone
    w.state.ready = false;
    expect(wocMergedProgramProven(source, ONE_SIDED)).toBe(false);
    // dropped for good: even a proof that would answer yes again is not asked
    w.state.ready = true;
    const asked = w.state.asked;
    expect(wocMergedProgramProven(source, ONE_SIDED)).toBe(false);
    expect(w.state.asked).toBe(asked);
    // the head that took the gate is the witness now
    recordWocMergedProof(source, ONE_SIDED, witness());
    expect(wocMergedProgramProven(source, ONE_SIDED)).toBe(true);
  });

  it('a proof that throws (its renderer is gone) is no proof, and never escapes', () => {
    const source = {};
    const material = {};
    recordWocMergedProof(source, TWO_SIDED, {
      holder: { material },
      material,
      ready: () => {
        throw new Error('renderer disposed');
      },
    });
    expect(wocMergedProgramProven(source, TWO_SIDED)).toBe(false);
    expect(wocMergedProgramProven(source, TWO_SIDED)).toBe(false);
  });

  it('a witness wearing another material proves nothing for now, and is kept', () => {
    const source = {};
    const w = witness();
    recordWocMergedProof(source, ONE_SIDED, w);
    // an effect is mounted over the witness: what the gate proved is not what it wears
    w.holder.material = { effect: true };
    expect(wocMergedProgramProven(source, ONE_SIDED)).toBe(false);
    // the proof was not even asked: it is about another material
    expect(w.state.asked).toBe(0);
    // the effect ends: the witness wears the proven material again
    w.holder.material = w.material;
    expect(wocMergedProgramProven(source, ONE_SIDED)).toBe(true);
    // a multi-material mesh is read by its first material, as three draws a single group
    w.holder.material = [w.material];
    expect(wocMergedProgramProven(source, ONE_SIDED)).toBe(true);
  });

  it('the newest proof replaces the one before it', () => {
    const source = {};
    const first = witness();
    const second = witness();
    recordWocMergedProof(source, ONE_SIDED, first);
    recordWocMergedProof(source, ONE_SIDED, second);
    first.state.ready = false;
    expect(wocMergedProgramProven(source, ONE_SIDED)).toBe(true);
    expect(first.state.asked).toBe(0);
    expect(second.state.asked).toBe(1);
  });
});

describe('dropWocMergedProof', () => {
  it('lets go of the witness wearing that material, without asking its proof', () => {
    const source = {};
    const w = witness();
    recordWocMergedProof(source, ONE_SIDED, w);
    dropWocMergedProof(source, ONE_SIDED, w.material);
    // guards: a body disposed while it was the witness kept its mesh, its buffers and the
    // renderer behind its proof alive until some later head happened to ask
    expect(wocMergedProgramProven(source, ONE_SIDED)).toBe(false);
    expect(w.state.asked).toBe(0);
  });

  it("leaves another body's witness, and another variant's, alone", () => {
    const source = {};
    const mine = witness();
    const theirs = witness();
    recordWocMergedProof(source, ONE_SIDED, theirs);
    recordWocMergedProof(source, TWO_SIDED, mine);
    // my wrap is not what the one sided witness wears: nothing of it is dropped
    dropWocMergedProof(source, ONE_SIDED, mine.material);
    expect(wocMergedProgramProven(source, ONE_SIDED)).toBe(true);
    expect(wocMergedProgramProven(source, TWO_SIDED)).toBe(true);
    // a source nobody witnessed is a no-op
    dropWocMergedProof({}, ONE_SIDED, mine.material);
    dropWocMergedProof(source, TWO_SIDED, mine.material);
    expect(wocMergedProgramProven(source, TWO_SIDED)).toBe(false);
    expect(wocMergedProgramProven(source, ONE_SIDED)).toBe(true);
  });
});
