// The store's fit memory, driven directly. Every rule here is reachable through
// the window too, but only across a whole repaint whose innerHTML write can be
// elided, so the arm that matters most (a count that moves DOWN drops the
// server's refusals) is pinned where it cannot pass for the wrong reason.
import { describe, expect, it } from 'vitest';
import { CharterFitMemory } from '../src/ui/charter_fit_memory';

describe('CharterFitMemory', () => {
  it('reports a changed signature against the count last observed, null included', () => {
    const m = new CharterFitMemory();
    // Nothing observed yet is NOT the same as a count of null: the store has not
    // painted, so even a null count is a change and the first paint must run.
    expect(m.changedFrom(null)).toBe(true);
    m.observe(null);
    expect(m.changedFrom(null)).toBe(false);
    expect(m.changedFrom(0)).toBe(true);
    m.observe(12);
    expect(m.changedFrom(12)).toBe(false);
    expect(m.changedFrom(18)).toBe(true);
    expect(m.changedFrom(null)).toBe(true);
  });

  it('keeps the refusals while the count holds or grows', () => {
    const m = new CharterFitMemory();
    m.observe(12);
    m.noteRefused(48);
    m.noteRefused(72);
    m.observe(12);
    expect([...m.refusedGrants].sort((a, b) => a - b)).toEqual([48, 72]);
    m.observe(18);
    expect([...m.refusedGrants].sort((a, b) => a - b)).toEqual([48, 72]);
  });

  it('DROPS the refusals when the count moves down', () => {
    // The reachable case is narrow but real: the count is monotone only while one
    // character stays resident on one realm process, and a fresh join that
    // reloads a durable row written before the last rung (an unclean restart
    // inside the autosave window, or the escrow quarantine's deliberate resume
    // refusal) brings a LOWER count back into the same open window. Every refusal
    // was derived from the higher count, so keeping them would hide a charter
    // that now FITS.
    const m = new CharterFitMemory();
    m.observe(24);
    m.noteRefused(48);
    expect(m.refusedGrants.size).toBe(1);
    m.observe(12);
    expect(m.refusedGrants.size).toBe(0);
    // And the signature followed the count down, so the next equal read is not a
    // change: a memory that dropped the refusals but kept the old signature would
    // repaint on every slow tick forever.
    expect(m.changedFrom(12)).toBe(false);
  });

  it('does not drop on the first observation, or on a null count', () => {
    // `undefined` (never painted) is not a number, so there is nothing to be
    // lower than; and null means no answer has arrived, which is not evidence the
    // count went down. Both would clear the refusals if the comparison were
    // written with a loose `<`.
    const first = new CharterFitMemory();
    first.noteRefused(72);
    first.observe(0);
    expect(first.refusedGrants.size).toBe(1);

    const nulled = new CharterFitMemory();
    nulled.observe(24);
    nulled.noteRefused(72);
    nulled.observe(null);
    expect(nulled.refusedGrants.size).toBe(1);
    // A null observation still moves the signature, so a later real count paints.
    expect(nulled.changedFrom(null)).toBe(false);
    expect(nulled.changedFrom(24)).toBe(true);
  });

  it('forgetRefusals drops the refusals and KEEPS the painted signature', () => {
    // close() bounds the belief to one store visit. It must not also reset the
    // signature: doing so would make the first slow tick after a reopen repaint
    // a body that is already correct.
    const m = new CharterFitMemory();
    m.observe(24);
    m.noteRefused(48);
    m.forgetRefusals();
    expect(m.refusedGrants.size).toBe(0);
    expect(m.changedFrom(24)).toBe(false);
  });
});
