// The compensation decider for a thrown escrow write: restore is allowed only
// on PROOF of rollback. The table below is the security boundary: a wrong
// true is a double-mint (a copy restored while the committed listing also
// holds it), a wrong false only parks a copy for the operator. Node socket
// errnos are the trap this suite exists for: EPIPE/EBADF/EBUSY are five
// uppercase characters and pg's client can surface them on err.code, and
// EPIPE is exactly the a-COMMIT-may-have-landed case.
import { describe, expect, it } from 'vitest';
import { throwProvedRollback } from '../../server/pg_rollback_proof';

describe('throwProvedRollback', () => {
  it.each([
    ['23505', 'unique violation'],
    ['23503', 'foreign key violation'],
    ['22P02', 'invalid text representation'],
    ['25P03', 'idle-in-transaction kill'],
    ['40P01', 'deadlock victim'],
    ['42703', 'undefined column'],
    ['53200', 'out of memory'],
    ['54000', 'program limit'],
    ['55P03', 'lock_timeout'],
    // Documented assumption: every row here arises mid-statement. 57014
    // during COMMIT's critical section would be misclassified as proof, but
    // Postgres holds off cancellation there (the cancel lands before the
    // critical section or not at all), so the mid-statement reading is the
    // only one reachable in practice.
    ['57014', 'query_canceled (statement_timeout)'],
  ])('proves rollback for %s (%s)', (code) => {
    expect(throwProvedRollback({ code })).toBe(true);
  });

  it.each([
    ['EPIPE', 'node socket errno, five uppercase chars, COMMIT may have landed'],
    ['EBADF', 'node socket errno'],
    ['EBUSY', 'node socket errno'],
    ['ECONNRESET', 'node socket errno (wrong length too)'],
    ['08006', 'connection failure'],
    ['08003', 'connection does not exist'],
    ['57P01', 'admin shutdown: in-flight COMMIT unknowable'],
    ['57P02', 'crash shutdown'],
    ['57P03', 'cannot connect now: not an allowlisted proof'],
    ['40003', 'statement_completion_unknown: class 40, but literally the ambiguity'],
    ['XX000', 'internal error'],
  ])('treats %s as ambiguous (%s)', (code) => {
    expect(throwProvedRollback({ code })).toBe(false);
  });

  it('treats a missing, non-string, lowercase, or misshapen code as ambiguous', () => {
    expect(throwProvedRollback({})).toBe(false);
    expect(throwProvedRollback(new Error('no code'))).toBe(false);
    expect(throwProvedRollback({ code: 23505 })).toBe(false);
    expect(throwProvedRollback({ code: 'epipe' })).toBe(false);
    expect(throwProvedRollback({ code: '2350' })).toBe(false);
    expect(throwProvedRollback({ code: '235055' })).toBe(false);
    expect(throwProvedRollback(null)).toBe(false);
    expect(throwProvedRollback(undefined)).toBe(false);
  });
});
