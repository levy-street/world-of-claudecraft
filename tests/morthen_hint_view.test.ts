import { describe, expect, it } from 'vitest';
import {
  createMorthenHints,
  MORTHEN_CORPSE_CHECK_MS,
  MORTHEN_HINT_MS,
  type MorthenCorpseCandidate,
  morthenCorpseInReach,
  morthenHintText,
} from '../src/ui/hud/vehicle/morthen_hint_view';
import { setLanguage } from '../src/ui/i18n';

const never = () => false;

describe('Morthen hint line', () => {
  it("opens with Sexton's Chain and holds it for the hint duration", () => {
    const hints = createMorthenHints();
    expect(hints.tick(0, 0, never, never)).toBe('chain');
    expect(hints.tick(MORTHEN_HINT_MS - 1, 0, never, never)).toBe('chain');
    expect(hints.tick(MORTHEN_HINT_MS, 0, never, never)).toBeNull();
  });

  it('offers Shadow Pulse the first time the Dread pays for it, never below', () => {
    const hints = createMorthenHints();
    hints.tick(0, 0, never, never);
    expect(hints.tick(MORTHEN_HINT_MS, 24, never, never)).toBeNull();
    expect(hints.tick(MORTHEN_HINT_MS + 1, 25, never, never)).toBe('pulse');
    // Spent and earned again: the line never comes back in the same shift.
    expect(hints.tick(3 * MORTHEN_HINT_MS, 0, never, never)).toBeNull();
    expect(hints.tick(4 * MORTHEN_HINT_MS, 30, never, never)).toBeNull();
  });

  it('queues a line behind the one on screen instead of replacing it', () => {
    const hints = createMorthenHints();
    expect(hints.tick(0, 40, never, never)).toBe('chain');
    expect(hints.tick(1000, 40, never, never)).toBe('chain');
    expect(hints.tick(MORTHEN_HINT_MS, 40, never, never)).toBe('pulse');
  });

  it('offers Raise the Fallen once a corpse is in reach, scanning at most every check interval', () => {
    const hints = createMorthenHints();
    let scans = 0;
    let corpse = false;
    const scan = () => {
      scans++;
      return corpse;
    };
    hints.tick(0, 0, scan, never);
    hints.tick(10, 0, scan, never);
    hints.tick(MORTHEN_CORPSE_CHECK_MS - 1, 0, scan, never);
    expect(scans).toBe(1);
    corpse = true;
    hints.tick(MORTHEN_CORPSE_CHECK_MS, 0, scan, never);
    expect(scans).toBe(2);
    expect(hints.tick(MORTHEN_HINT_MS, 0, scan, never)).toBe('raise');
    // Queued: the scan stops for the rest of the shift.
    hints.tick(MORTHEN_HINT_MS + 10 * MORTHEN_CORPSE_CHECK_MS, 0, scan, never);
    expect(scans).toBe(2);
  });

  it('the Staff Exit line jumps the queue and replaces the line on screen', () => {
    const hints = createMorthenHints();
    expect(hints.tick(0, 40, never, never)).toBe('chain');
    expect(hints.tick(MORTHEN_CORPSE_CHECK_MS, 40, never, () => true)).toBe('exit');
    // Offered once: the queued Pulse line follows after its hold.
    expect(hints.tick(MORTHEN_CORPSE_CHECK_MS + MORTHEN_HINT_MS, 40, never, () => true)).toBe(
      'pulse',
    );
    expect(
      hints.tick(MORTHEN_CORPSE_CHECK_MS + 3 * MORTHEN_HINT_MS, 40, never, () => true),
    ).toBeNull();
  });

  it('a new shift shows every line again', () => {
    const hints = createMorthenHints();
    hints.tick(0, 40, never, never);
    hints.tick(MORTHEN_HINT_MS, 40, never, never);
    hints.reset();
    expect(hints.tick(100_000, 0, never, never)).toBe('chain');
  });
});

describe('Morthen corpse reach', () => {
  const self = { id: 1, pos: { x: 0, y: 0, z: 0 } };
  const body = (over: Partial<MorthenCorpseCandidate>): MorthenCorpseCandidate => ({
    id: 2,
    dead: true,
    kind: 'player',
    ownerId: null,
    pos: { x: 5, y: 0, z: 0 },
    ...over,
  });

  it('finds a fallen adventurer or ownerless creature within Raise the Fallen reach', () => {
    expect(morthenCorpseInReach([body({})], self)).toBe(true);
    expect(morthenCorpseInReach([body({ kind: 'mob' })], self)).toBe(true);
    expect(morthenCorpseInReach([body({ pos: { x: 20, y: 0, z: 0 } })], self)).toBe(true);
  });

  it('ignores the living, the far, owned corpses, objects and Morthen himself', () => {
    expect(morthenCorpseInReach([body({ dead: false })], self)).toBe(false);
    expect(morthenCorpseInReach([body({ pos: { x: 20.5, y: 0, z: 0 } })], self)).toBe(false);
    expect(morthenCorpseInReach([body({ ownerId: 1 })], self)).toBe(false);
    expect(morthenCorpseInReach([body({ kind: 'object' as never })], self)).toBe(false);
    expect(morthenCorpseInReach([body({ id: 1 })], self)).toBe(false);
  });
});

describe('Morthen hint text', () => {
  it('reads each line from the catalog, localized, never a raw key', () => {
    setLanguage('en');
    expect(morthenHintText('chain')).toBe(
      "Sexton's Chain: pick one of them and drag them to you. The healer is a fine start.",
    );
    expect(morthenHintText('pulse')).toMatch(/^Shadow Pulse is ready/);
    expect(morthenHintText('raise')).toMatch(/^Raise the Fallen/);
    expect(morthenHintText('exit')).toMatch(/Staff Exit/);
    for (const id of ['chain', 'pulse', 'raise', 'exit'] as const) {
      expect(morthenHintText(id)).not.toMatch(/devCommand|\{/);
    }
  });
});
