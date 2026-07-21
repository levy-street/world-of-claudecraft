import { describe, it, expect } from 'vitest';
import { resolveAssist, type AssistCandidate } from '../src/sim/assist';

// resolveAssist is the pure core behind the "/assist <name>" chat command: given the
// roster of online players (each with the entity they are currently targeting) it works
// out which entity the caster should switch their target to, or the error to show. The
// Sim is a thin consumer that builds the candidate list and applies the result via
// targetEntity(); all the branching logic lives here so it can be tested without a Sim.

const roster = (...rows: AssistCandidate[]): AssistCandidate[] => rows;

describe('resolveAssist', () => {
  // caster=1 (Aki), leader=2 (Bret) is beating mob 99. /assist Bret -> target 99.
  it('targets whatever mob the named player is targeting', () => {
    const r = resolveAssist(
      roster({ entityId: 1, name: 'Aki', targetId: null }, { entityId: 2, name: 'Bret', targetId: 99 }),
      1,
      'Bret',
    );
    expect(r).toEqual({ kind: 'target', targetId: 99, leaderName: 'Bret' });
  });

  it('matches the player name case-insensitively when unambiguous', () => {
    const r = resolveAssist(
      roster({ entityId: 1, name: 'Aki', targetId: null }, { entityId: 2, name: 'Bret', targetId: 99 }),
      1,
      'bret',
    );
    expect(r).toEqual({ kind: 'target', targetId: 99, leaderName: 'Bret' });
  });

  it('prefers an exact-case match over a case-insensitive one', () => {
    const r = resolveAssist(
      roster(
        { entityId: 1, name: 'Aki', targetId: null },
        { entityId: 2, name: 'bret', targetId: 50 },
        { entityId: 3, name: 'Bret', targetId: 99 },
      ),
      1,
      'Bret',
    );
    expect(r).toEqual({ kind: 'target', targetId: 99, leaderName: 'Bret' });
  });

  it('errors when several players match only case-insensitively', () => {
    const r = resolveAssist(
      roster(
        { entityId: 1, name: 'Aki', targetId: null },
        { entityId: 2, name: 'Bret', targetId: 50 },
        { entityId: 3, name: 'BRET', targetId: 99 },
      ),
      1,
      'bret',
    );
    expect(r).toEqual({ kind: 'error', message: "Several players match 'bret'. Use exact capitalization." });
  });

  it('errors when no player by that name is online', () => {
    const r = resolveAssist(roster({ entityId: 1, name: 'Aki', targetId: null }), 1, 'Ghost');
    expect(r).toEqual({ kind: 'error', message: "There is no player named 'Ghost' online." });
  });

  it('refuses to assist yourself by name', () => {
    const r = resolveAssist(roster({ entityId: 1, name: 'Aki', targetId: 99 }), 1, 'Aki');
    expect(r).toEqual({ kind: 'error', message: "You can't assist yourself." });
  });

  it('reports when the named player has no target', () => {
    const r = resolveAssist(
      roster({ entityId: 1, name: 'Aki', targetId: null }, { entityId: 2, name: 'Bret', targetId: null }),
      1,
      'Bret',
    );
    expect(r).toEqual({ kind: 'error', message: 'Bret has no target.' });
  });

  describe('no name argument (assist current target)', () => {
    it('assists the player the caster is currently targeting', () => {
      const r = resolveAssist(
        roster(
          { entityId: 1, name: 'Aki', targetId: 2 },
          { entityId: 2, name: 'Bret', targetId: 99 },
        ),
        1,
        '',
      );
      expect(r).toEqual({ kind: 'target', targetId: 99, leaderName: 'Bret' });
    });

    it('errors when the caster has no player targeted', () => {
      const r = resolveAssist(
        roster(
          { entityId: 1, name: 'Aki', targetId: 99 }, // a mob, not a player in the roster
          { entityId: 2, name: 'Bret', targetId: 99 },
        ),
        1,
        '   ',
      );
      expect(r).toEqual({ kind: 'error', message: 'Assist whom? Target a player or use /assist <name>.' });
    });

    it('refuses to assist yourself when you target yourself', () => {
      const r = resolveAssist(roster({ entityId: 1, name: 'Aki', targetId: 1 }), 1, '');
      expect(r).toEqual({ kind: 'error', message: "You can't assist yourself." });
    });
  });

  it('is a pure function: same inputs give the same result', () => {
    const rows = roster({ entityId: 1, name: 'Aki', targetId: null }, { entityId: 2, name: 'Bret', targetId: 99 });
    expect(resolveAssist(rows, 1, 'Bret')).toEqual(resolveAssist(rows, 1, 'Bret'));
  });
});
