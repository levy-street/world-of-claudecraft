import { describe, expect, it } from 'vitest';
import { CombatAnnouncer } from '../src/ui/combat_announcer';
import { COMBAT_ANNOUNCE_INTERVAL_MS } from '../src/ui/live_region_politeness';

// The combat live-region announcer: one polite off-screen summary, throttled
// so a damage burst never floods the screen reader. DOM-free (injected text sink +
// clock), so this drives it directly with a recording sink and controlled time.
function recorder() {
  const calls: string[] = [];
  return { sink: (s: string) => calls.push(s), calls };
}

describe('CombatAnnouncer single-announce', () => {
  it('a single combat event updates the combat region exactly once', () => {
    const { sink, calls } = recorder();
    const announcer = new CombatAnnouncer(sink);
    announcer.push('You hit the Kobold for 42.', 0);
    expect(calls).toEqual(['You hit the Kobold for 42.']);
  });

  it('ignores blank lines (no announcement)', () => {
    const { sink, calls } = recorder();
    const announcer = new CombatAnnouncer(sink);
    announcer.push('   ', 0);
    expect(calls).toEqual([]);
  });

  it('relays the localized line verbatim (no new player-visible text introduced)', () => {
    const { sink, calls } = recorder();
    const announcer = new CombatAnnouncer(sink);
    announcer.push('Le Kobold vous frappe pour 7.', 0);
    expect(calls).toEqual(['Le Kobold vous frappe pour 7.']);
  });
});

describe('CombatAnnouncer burst throttle', () => {
  it('collapses a routine-damage burst to at most one announcement per interval', () => {
    const { sink, calls } = recorder();
    const announcer = new CombatAnnouncer(sink);
    // A burst at t=0: the first announces immediately, the rest buffer (latest wins).
    announcer.push('hit 1', 0);
    announcer.push('hit 2', 0);
    announcer.push('hit 3', 0);
    announcer.push('hit 4', 0);
    expect(calls).toEqual(['hit 1']);

    // Before the interval elapses, still no second announcement.
    announcer.flush(COMBAT_ANNOUNCE_INTERVAL_MS - 1);
    expect(calls).toEqual(['hit 1']);

    // At/after the interval, the latest buffered line flushes (one more announcement).
    announcer.flush(COMBAT_ANNOUNCE_INTERVAL_MS);
    expect(calls).toEqual(['hit 1', 'hit 4']);
  });

  it('does not flush when nothing is pending', () => {
    const { sink, calls } = recorder();
    const announcer = new CombatAnnouncer(sink);
    announcer.flush(0);
    announcer.flush(COMBAT_ANNOUNCE_INTERVAL_MS * 3);
    expect(calls).toEqual([]);
  });

  it('respects an injected interval override', () => {
    const { sink, calls } = recorder();
    const announcer = new CombatAnnouncer(sink, 1000);
    announcer.push('a', 0); // immediate
    announcer.push('b', 500); // within 1000ms -> buffered
    expect(calls).toEqual(['a']);
    announcer.push('c', 1000); // interval elapsed -> flush latest
    expect(calls).toEqual(['a', 'c']);
  });
});

describe('CombatAnnouncer identical-summary re-announce', () => {
  it('forces a byte-different sink write when the same summary repeats, so AT re-reads it', () => {
    const { sink, calls } = recorder();
    const announcer = new CombatAnnouncer(sink);
    // The exact same routine line three intervals apart: a screen reader that suppresses
    // unchanged live text would stay silent on lines 2 and 3 without a forced mutation.
    announcer.push('The Kobold resists your Frostbolt.', 0);
    announcer.push('The Kobold resists your Frostbolt.', COMBAT_ANNOUNCE_INTERVAL_MS);
    announcer.push('The Kobold resists your Frostbolt.', COMBAT_ANNOUNCE_INTERVAL_MS * 2);
    expect(calls.length).toBe(3);
    // First is the clean summary; each consecutive identical one is byte-different from its
    // immediate predecessor so the live region re-announces.
    expect(calls[0]).toBe('The Kobold resists your Frostbolt.');
    expect(calls[1]).not.toBe(calls[0]);
    expect(calls[2]).not.toBe(calls[1]);
    // The marker never changes how the line reads aloud: trimming it returns the original.
    expect(calls[1].trim()).toBe('The Kobold resists your Frostbolt.');
    expect(calls[2].trim()).toBe('The Kobold resists your Frostbolt.');
  });

  it('leaves a changed summary byte-faithful (no marker on non-identical text)', () => {
    const { sink, calls } = recorder();
    const announcer = new CombatAnnouncer(sink);
    announcer.push('You hit the Kobold for 42.', 0);
    announcer.push('You hit the Kobold for 7.', COMBAT_ANNOUNCE_INTERVAL_MS);
    expect(calls).toEqual(['You hit the Kobold for 42.', 'You hit the Kobold for 7.']);
  });

  it('stays deterministic: the same sequence yields the same sink writes (no clock/random)', () => {
    const run = (): string[] => {
      const { sink, calls } = recorder();
      const a = new CombatAnnouncer(sink);
      a.push('x', 0);
      a.push('x', COMBAT_ANNOUNCE_INTERVAL_MS);
      a.push('x', COMBAT_ANNOUNCE_INTERVAL_MS * 2);
      a.push('y', COMBAT_ANNOUNCE_INTERVAL_MS * 3);
      a.push('x', COMBAT_ANNOUNCE_INTERVAL_MS * 4);
      return calls;
    };
    expect(run()).toEqual(run());
  });
});
