// src/render/contact_queue.ts: a melee swing's target-side presentation waits for its blade
// contact (the delay the swing's one-shot reported), frame-driven, in due order.
import { describe, expect, it, vi } from 'vitest';
import {
  CONTACT_HOLD_MAX_SEC,
  ContactQueue,
  collapsed,
  heldUntilCollapse,
} from '../src/render/contact_queue';

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

  it('runs a receiver method in place for an event with no contact, and holds it for one with', () => {
    const q = new ContactQueue();
    const calls: Array<{ self: unknown; ev: unknown }> = [];
    const host = {
      play(this: unknown, ev: object): void {
        calls.push({ self: this, ev });
      },
    };
    // every event but a held melee hit: the method runs at once, on its receiver, with the
    // event, and nothing is queued. It is called in place, never handed to `after` wrapped
    // in a closure built to carry the receiver and the event (the per-event garbage this
    // arm exists to avoid).
    const after = vi.spyOn(q, 'after');
    const heal = { type: 'heal2' };
    q.atContact(heal, 0, host.play, host);
    expect(calls).toEqual([{ self: host, ev: heal }]);
    expect(calls[0].self).toBe(host);
    expect(calls[0].ev).toBe(heal);
    expect(q.size).toBe(0);
    expect(after).not.toHaveBeenCalled();
    // a held melee hit: the same call waits for the blade, then lands on the same receiver
    const hit = { type: 'damage' };
    q.note(hit, 0.3);
    q.atContact(hit, 1000, host.play, host);
    expect(after).toHaveBeenCalledOnce();
    expect(after.mock.calls[0].slice(0, 2)).toEqual([0.3, 1000]);
    expect(calls).toHaveLength(1);
    expect(q.size).toBe(1);
    q.tick(1299);
    expect(calls).toHaveLength(1);
    q.tick(1300);
    expect(calls).toHaveLength(2);
    expect(calls[1].self).toBe(host);
    expect(calls[1].ev).toBe(hit);
    expect(q.size).toBe(0);
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

  it('reads a hold against its own frame clock (the last tick) when no time is given', () => {
    const q = new ContactQueue();
    q.tick(1000);
    q.note({}, 0.4, 5, 1000);
    // asked any number of times inside one frame: the same answer, nothing consumed
    expect(q.holdsDeath(5)).toBe(true);
    expect(q.holdsDeath(5)).toBe(true);
    q.tick(1399);
    expect(q.holdsDeath(5)).toBe(true);
    // the frame the blade lands
    q.tick(1400);
    expect(q.holdsDeath(5)).toBe(false);
    // the FRAME's clock, kept by the queue itself: a hold whose blade had already landed
    // when the frame began holds nothing, with no sweep of it in between
    const late = new ContactQueue();
    late.tick(2000);
    late.note({}, 0.4, 5, 1000);
    expect(late.heldDeaths).toBe(1);
    expect(late.holdsDeath(5)).toBe(false);
    expect(late.heldDeaths).toBe(0);
    // ...and one still in the air at that clock holds, to the tick that passes it
    late.note({}, 0.4, 6, 1700);
    expect(late.holdsDeath(6)).toBe(true);
    late.tick(2099);
    expect(late.holdsDeath(6)).toBe(true);
    late.tick(2100);
    expect(late.holdsDeath(6)).toBe(false);
    // a queue never ticked reads frame zero: a hold noted on a real clock still holds
    const fresh = new ContactQueue();
    fresh.note({}, 0.4, 5, 1000);
    expect(fresh.holdsDeath(5)).toBe(true);
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

// What leaves WITH a struck body waits with it: one hold, read by the death pose, the mount
// under a rider and the wings on a paladin. tests/mount_lifecycle.test.ts and
// tests/paladin_avenging_wrath_visual.test.ts drive the real mount and wing modules through
// a held kill; tests/melee_contact_wiring.test.ts pins the renderer's reads.
describe('one hold for everything a death ends', () => {
  it('collapsed: a body is presented dead once it is dead and no blade is still in the air', () => {
    expect(collapsed(false, false)).toBe(false); // alive
    expect(collapsed(true, true)).toBe(false); // killed, the blade not landed: still standing
    expect(collapsed(true, false)).toBe(true); // the blade landed (or the kill had no swing)
    // a hold says nothing about a living body: only a death is ever held
    expect(collapsed(false, true)).toBe(false);
  });

  it('heldUntilCollapse: a held body keeps what it showed the frame before, then the live value', () => {
    // The sim clears on the death tick, so the LIVE value is already empty on the first held
    // frame: the mount key of a rider (the mount bolts)...
    expect(heldUntilCollapse(true, '', 'grag_bear')).toBe('grag_bear');
    // ...and whether a paladin still wears its wings (the aura is stripped with every buff)
    expect(heldUntilCollapse(true, false, true)).toBe(true);
    // the blade landed: the live (empty) value, on the same frame the body collapses
    expect(heldUntilCollapse(false, '', 'grag_bear')).toBe('');
    expect(heldUntilCollapse(false, false, true)).toBe(false);
    // never held, the live value is all there is: a summon, a swap, wings spread
    expect(heldUntilCollapse(false, 'horse', '')).toBe('horse');
    expect(heldUntilCollapse(false, true, false)).toBe(true);
    // a hold invents nothing: a body that showed none keeps none
    expect(heldUntilCollapse(true, '', '')).toBe('');
    expect(heldUntilCollapse(true, false, false)).toBe(false);
  });

  it('reads one hold for the pose and for what leaves with the body, frame by frame', () => {
    const q = new ContactQueue();
    const RIDER = 7;
    // the last living frame: mounted, winged
    let lastMountKey = 'grag_bear';
    let wings = true;
    const frame = (now: number, live: { dead: boolean; mountKey: string; wingAura: boolean }) => {
      q.tick(now);
      const deathHeld = live.dead && q.holdsDeath(RIDER);
      const mountKey = heldUntilCollapse(deathHeld, live.mountKey, lastMountKey);
      wings = heldUntilCollapse(deathHeld, !live.dead && live.wingAura, wings);
      lastMountKey = mountKey;
      return { dead: collapsed(live.dead, deathHeld), mountKey, wings };
    };
    expect(frame(984, { dead: false, mountKey: 'grag_bear', wingAura: true })).toEqual({
      dead: false,
      mountKey: 'grag_bear',
      wings: true,
    });
    // the killing swing: its blade lands 0.4 s on. The sim has already cleared the rider's
    // mount key and stripped the wing aura by the frame that draws the event.
    q.note({}, 0.4, RIDER, 1000);
    const corpse = { dead: true, mountKey: '', wingAura: false };
    for (const now of [1000, 1016, 1200, 1399]) {
      expect(frame(now, corpse), `held at ${now}`).toEqual({
        dead: false,
        mountKey: 'grag_bear',
        wings: true,
      });
    }
    // the blade lands: the pose, the mount and the wings go on the same frame
    expect(frame(1400, corpse)).toEqual({ dead: true, mountKey: '', wings: false });
    expect(frame(1416, corpse)).toEqual({ dead: true, mountKey: '', wings: false });
  });

  it('a kill with no swing behind it holds nothing: everything goes on the event', () => {
    const q = new ContactQueue();
    q.note({}, 0, 7, 1000); // a spell, a mob's bite, a fall: no contact
    q.tick(1000);
    const deathHeld = q.holdsDeath(7);
    expect(deathHeld).toBe(false);
    expect(collapsed(true, deathHeld)).toBe(true);
    expect(heldUntilCollapse(deathHeld, '', 'grag_bear')).toBe('');
    expect(heldUntilCollapse(deathHeld, false, true)).toBe(false);
  });
});
