import { describe, expect, it } from 'vitest';
import {
  changedMemberMeta,
  claimDailyActive,
  clearedMemberMeta,
  type DailyActiveState,
  isSelfNickEcho,
  type MemberMetaRecord,
  memberMetaChanged,
  nicknameNeedsWrite,
} from '../bot/logic';

// Ids are built by string concatenation, never by adding to a snowflake-sized
// number: 1000000000000000000 + i is past Number.MAX_SAFE_INTEGER, so a loop
// would collapse several members onto one id and the fixtures would lie.
const memberId = (n: number): string => `10000000000000000${String(10 + n)}`;

const record = (over: Partial<MemberMetaRecord> = {}): MemberMetaRecord => ({
  discord_user_id: memberId(0),
  name: 'Aldric',
  joinedAtMs: 1700000000000,
  role: 'moderator',
  ...over,
});

describe('nicknameNeedsWrite (skip the redundant nickname PATCH)', () => {
  it('writes when the nick has never been observed (undefined cache)', () => {
    // Never observed is not "already matches": we cannot prove the PATCH is a
    // no-op, so it must be sent.
    expect(nicknameNeedsWrite('Aldric 20', undefined)).toBe(true);
  });

  it('writes when the member has no nickname set (null cache)', () => {
    expect(nicknameNeedsWrite('Aldric 20', null)).toBe(true);
  });

  it('skips the write when the computed nick already matches exactly', () => {
    expect(nicknameNeedsWrite('Aldric 20', 'Aldric 20')).toBe(false);
  });

  it('writes when the computed nick differs', () => {
    expect(nicknameNeedsWrite('Aldric 21', 'Aldric 20')).toBe(true);
  });

  it('compares verbatim: whitespace and case are real differences', () => {
    // A trim here would re-PATCH forever on a name with a trailing space, since
    // Discord stores the nick exactly as sent.
    expect(nicknameNeedsWrite('Aldric 20', 'Aldric 20 ')).toBe(true);
    expect(nicknameNeedsWrite(' Aldric 20', 'Aldric 20')).toBe(true);
    expect(nicknameNeedsWrite('aldric 20', 'Aldric 20')).toBe(true);
  });

  it('treats an empty computed nick as a value, not as "no opinion"', () => {
    expect(nicknameNeedsWrite('', 'Aldric 20')).toBe(true);
    expect(nicknameNeedsWrite('', '')).toBe(false);
    expect(nicknameNeedsWrite('', null)).toBe(true);
    expect(nicknameNeedsWrite('', undefined)).toBe(true);
  });
});

describe('memberMetaChanged (skip the redundant members-meta push)', () => {
  it('pushes when the member was never pushed before', () => {
    expect(memberMetaChanged(record(), undefined)).toBe(true);
  });

  it('skips the push when every field is identical', () => {
    expect(memberMetaChanged(record(), record())).toBe(false);
  });

  // One case PER FIELD: a single "something changed" test stays green with three
  // of the four comparisons deleted.
  it('pushes when discord_user_id alone differs', () => {
    expect(memberMetaChanged(record({ discord_user_id: memberId(1) }), record())).toBe(true);
  });

  it('pushes when name alone differs', () => {
    expect(memberMetaChanged(record({ name: 'Aldrica' }), record())).toBe(true);
  });

  it('pushes when joinedAtMs alone differs', () => {
    expect(memberMetaChanged(record({ joinedAtMs: 1700000000001 }), record())).toBe(true);
  });

  it('pushes when role alone differs', () => {
    expect(memberMetaChanged(record({ role: 'core_dev' }), record())).toBe(true);
  });

  it('never conflates null with a value, in either direction', () => {
    expect(memberMetaChanged(record({ name: null }), record({ name: 'Aldric' }))).toBe(true);
    expect(memberMetaChanged(record({ name: 'Aldric' }), record({ name: null }))).toBe(true);
    expect(memberMetaChanged(record({ role: null }), record({ role: 'moderator' }))).toBe(true);
    expect(memberMetaChanged(record({ role: 'moderator' }), record({ role: null }))).toBe(true);
    expect(memberMetaChanged(record({ joinedAtMs: null }), record({ joinedAtMs: 0 }))).toBe(true);
    expect(memberMetaChanged(record({ name: null }), record({ name: null }))).toBe(false);
  });

  it('pushes a cleared record against a populated one, so leaving clears flair', () => {
    const cleared = clearedMemberMeta(memberId(0));
    expect(cleared).toEqual({
      discord_user_id: memberId(0),
      name: null,
      joinedAtMs: null,
      role: null,
    });
    expect(memberMetaChanged(cleared, record())).toBe(true);
    expect(memberMetaChanged(cleared, cleared)).toBe(false);
  });
});

describe('changedMemberMeta (the sweep filter)', () => {
  it('keeps only unseen or differing records, in input order', () => {
    const unseen = record({ discord_user_id: memberId(1), name: 'Bryn' });
    const same = record({ discord_user_id: memberId(2), name: 'Cass' });
    const differs = record({ discord_user_id: memberId(3), name: 'Dael' });
    const lastPushed = new Map<string, MemberMetaRecord>([
      [memberId(2), record({ discord_user_id: memberId(2), name: 'Cass' })],
      [memberId(3), record({ discord_user_id: memberId(3), name: 'Old Dael' })],
    ]);
    // Input order is unseen, same, differs; the survivors must come back in that
    // order (not grouped, not reversed) so a batch reads against the roster.
    expect(changedMemberMeta([unseen, same, differs], lastPushed)).toEqual([unseen, differs]);
  });

  it('returns an empty list when nothing changed', () => {
    const a = record({ discord_user_id: memberId(1) });
    const b = record({ discord_user_id: memberId(2) });
    const lastPushed = new Map<string, MemberMetaRecord>([
      [memberId(1), record({ discord_user_id: memberId(1) })],
      [memberId(2), record({ discord_user_id: memberId(2) })],
    ]);
    expect(changedMemberMeta([a, b], lastPushed)).toEqual([]);
  });

  it('does not mutate lastPushed (the caller updates it only after a push lands)', () => {
    const lastPushed = new Map<string, MemberMetaRecord>([
      [memberId(1), record({ discord_user_id: memberId(1), name: 'Old Bryn' })],
    ]);
    const next = record({ discord_user_id: memberId(1), name: 'Bryn' });
    changedMemberMeta([next, record({ discord_user_id: memberId(2) })], lastPushed);
    expect(lastPushed.size).toBe(1);
    expect(lastPushed.get(memberId(1))).toEqual(
      record({ discord_user_id: memberId(1), name: 'Old Bryn' }),
    );
    expect(lastPushed.has(memberId(2))).toBe(false);
  });
});

describe('isSelfNickEcho (drop the update our own PATCH caused)', () => {
  const roles = ['200000000000000001', '200000000000000002'];

  it('is not an echo when the bot never wrote this member a nick', () => {
    expect(isSelfNickEcho({ nick: 'Aldric 20', roleIds: roles }, undefined, roles)).toBe(false);
  });

  it('is not an echo when the incoming nick differs from what we wrote', () => {
    // A moderator renaming the member: a genuine third-party update, must push.
    expect(isSelfNickEcho({ nick: 'Banned User', roleIds: roles }, 'Aldric 20', roles)).toBe(false);
    expect(isSelfNickEcho({ nick: null, roleIds: roles }, 'Aldric 20', roles)).toBe(false);
    expect(isSelfNickEcho({ nick: undefined, roleIds: roles }, 'Aldric 20', roles)).toBe(false);
  });

  it('is not an echo when a role was granted (different set, different length)', () => {
    const granted = [...roles, '200000000000000003'];
    expect(isSelfNickEcho({ nick: 'Aldric 20', roleIds: granted }, 'Aldric 20', roles)).toBe(false);
  });

  it('is not an echo when a role was revoked (shorter set)', () => {
    expect(isSelfNickEcho({ nick: 'Aldric 20', roleIds: [roles[0]] }, 'Aldric 20', roles)).toBe(
      false,
    );
  });

  it('is not an echo when a role was swapped (same length, different membership)', () => {
    const swapped = [roles[0], '200000000000000009'];
    expect(isSelfNickEcho({ nick: 'Aldric 20', roleIds: swapped }, 'Aldric 20', roles)).toBe(false);
  });

  it('is an echo when the nick matches and the roles are the same set', () => {
    expect(isSelfNickEcho({ nick: 'Aldric 20', roleIds: roles }, 'Aldric 20', roles)).toBe(true);
  });

  it('compares roles as sets, so a reordered role list is still an echo', () => {
    // Discord does not promise role order; an ordered compare would call every
    // no-op update a change forever.
    const reordered = [roles[1], roles[0]];
    expect(isSelfNickEcho({ nick: 'Aldric 20', roleIds: reordered }, 'Aldric 20', roles)).toBe(
      true,
    );
  });

  it('treats a duplicate id on EITHER side as no change, because the Sets dedupe it', () => {
    // Retitled: this used to claim a both-directions membership scan, and the
    // reverse loop it named was deleted as unreachable (equal Set sizes plus
    // containment in one direction already proves equality). Building the Sets is
    // what neutralizes a duplicate, so both sides are exercised here.
    const duplicated = [roles[0], roles[1], roles[1]];
    expect(isSelfNickEcho({ nick: 'Aldric 20', roleIds: duplicated }, 'Aldric 20', roles)).toBe(
      true,
    );
    // And the mirror: the duplicate on the CACHED side instead.
    expect(isSelfNickEcho({ nick: 'Aldric 20', roleIds: roles }, 'Aldric 20', duplicated)).toBe(
      true,
    );
  });

  it('claims a member once per day and empties the bucket on the rollover', () => {
    // The bot-side half of the daily-engagement dedupe. The clear is what keeps the
    // set from accumulating an entry per member per day for the life of the
    // process, and it is safe because every key carries its own day.
    const state: DailyActiveState = { seen: new Set<string>(), day: '' };
    expect(claimDailyActive(state, '2026-07-31', 'u1')).toBe(true);
    expect(claimDailyActive(state, '2026-07-31', 'u1')).toBe(false);
    // A second member the same day is independent, and both keys are held.
    expect(claimDailyActive(state, '2026-07-31', 'u2')).toBe(true);
    expect(state.seen.size).toBe(2);

    // The rollover: the same member grants again, and the bucket did not grow.
    expect(claimDailyActive(state, '2026-08-01', 'u1')).toBe(true);
    expect(state.seen.size).toBe(1);
    expect(state.day).toBe('2026-08-01');
    expect(claimDailyActive(state, '2026-08-01', 'u1')).toBe(false);
  });

  it('is an echo for an empty role set on both sides, with the written nick', () => {
    expect(isSelfNickEcho({ nick: 'Aldric 20', roleIds: [] }, 'Aldric 20', [])).toBe(true);
    expect(isSelfNickEcho({ nick: 'Aldric 20', roleIds: [] }, 'Aldric 20', roles)).toBe(false);
  });
});
