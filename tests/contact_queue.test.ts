// src/render/contact_queue.ts: a melee swing's target-side presentation waits for its blade
// contact (the delay the swing's one-shot reported), frame-driven, in due order.
import { describe, expect, it, vi } from 'vitest';
import { CONTACT_HOLD_MAX_SEC, ContactQueue } from '../src/render/contact_queue';

describe('ContactQueue', () => {
  it('records a contact per event and holds that event until it arrives', () => {
    const q = new ContactQueue();
    const ev = { type: 'damage' };
    q.note(ev, 0.45);
    expect(q.delayFor(ev)).toBe(0.45);
    const ran: string[] = [];
    q.atContact(ev, 1000, () => ran.push('hit'));
    q.tick(1440);
    expect(ran).toEqual([]);
    q.tick(1450);
    expect(ran).toEqual(['hit']);
    expect(q.size).toBe(0);
  });

  it('runs at once for an event with no contact (or a non-positive one)', () => {
    const q = new ContactQueue();
    const a = {};
    const b = {};
    q.note(b, 0);
    const ran: string[] = [];
    q.atContact(a, 0, () => ran.push('a'));
    q.atContact(b, 0, () => ran.push('b'));
    q.after(-1, 0, () => ran.push('c'));
    expect(ran).toEqual(['a', 'b', 'c']);
    expect(q.delayFor(b)).toBe(0);
  });

  it('releases in due order when a later swing lands sooner', () => {
    const q = new ContactQueue();
    const ran: string[] = [];
    q.after(0.47, 0, () => ran.push('chop'));
    q.after(0.125, 100, () => ran.push('dagger'));
    q.tick(300);
    expect(ran).toEqual(['dagger']);
    q.tick(470);
    expect(ran).toEqual(['dagger', 'chop']);
  });

  it("holds a struck target's collapse until the blade lands, then lets it go", () => {
    const q = new ContactQueue();
    q.note({}, 0.47, 12, 1000);
    q.note({}, 0.125, 12, 1100); // an earlier-landing swing never shortens the hold
    expect(q.holdsDeath(12, 1200)).toBe(true);
    expect(q.holdsDeath(12, 1469)).toBe(true);
    expect(q.holdsDeath(12, 1470)).toBe(false);
    expect(q.holdsDeath(12, 1200)).toBe(false); // released once, gone
    expect(q.holdsDeath(99, 0)).toBe(false);
    q.note({}, 0, 13, 0); // no contact: no hold
    expect(q.holdsDeath(13, 0)).toBe(false);
  });

  it('clamps a hold to CONTACT_HOLD_MAX_SEC and clears on teardown', () => {
    const q = new ContactQueue();
    const ev = {};
    q.note(ev, 5);
    expect(q.delayFor(ev)).toBe(CONTACT_HOLD_MAX_SEC);
    let ran = false;
    q.after(5, 0, () => {
      ran = true;
    });
    q.tick(CONTACT_HOLD_MAX_SEC * 1000);
    expect(ran).toBe(true);
    q.after(0.2, 0, () => {
      ran = false;
    });
    q.clear();
    q.tick(1e9);
    expect(ran).toBe(true);
  });

  it('keeps running the batch when one held effect throws, and forgets passed death holds', () => {
    const q = new ContactQueue();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ran: string[] = [];
    q.after(0.1, 0, () => {
      throw new Error('boom');
    });
    q.after(0.1, 0, () => ran.push('second'));
    q.note({}, 0.2, 7, 0);
    expect(q.heldDeaths).toBe(1);
    expect(() => q.tick(150)).not.toThrow();
    expect(ran).toEqual(['second']);
    expect(warn).toHaveBeenCalledOnce();
    // a target that never died (holdsDeath is never asked) still drops its hold on time
    q.tick(199);
    expect(q.heldDeaths).toBe(1);
    q.tick(200);
    expect(q.heldDeaths).toBe(0);
    warn.mockRestore();
  });
});
