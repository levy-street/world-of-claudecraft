import { describe, expect, it } from 'vitest';
import {
  PREVIEW_TOUCH_HINT_LEAVE_MS,
  PREVIEW_TOUCH_HINT_SEEN,
  PREVIEW_TOUCH_HINT_STORAGE_KEY,
  type TouchHintPhase,
  touchHintFirstGesture,
  touchHintOnInteract,
  touchHintOnLeft,
  touchHintOnOffer,
  touchHintStartPhase,
} from '../src/ui/preview_touch_hint_core';

// The phone creator's one-time pinch hint, its pure half (src/ui/preview_touch_hint_core.ts):
// it shows while the stage offers it, until the player's first gesture made while it is up;
// that gesture plays the exit and retires it for good, and a stored flag keeps it retired on
// later visits. A visit that ends with no such gesture leaves it to show again.

const PHASES: readonly TouchHintPhase[] = ['idle', 'shown', 'leaving', 'done'];

describe('the stored flag', () => {
  it('pins the storage key and value (a rename would show the hint to everyone again)', () => {
    expect(PREVIEW_TOUCH_HINT_STORAGE_KEY).toBe('woc_preview_touch_hint_seen');
    expect(PREVIEW_TOUCH_HINT_SEEN).toBe('1');
  });

  it('starts retired only on the stored value', () => {
    expect(touchHintStartPhase('1')).toBe('done');
    expect(touchHintStartPhase(null)).toBe('idle');
    expect(touchHintStartPhase(undefined)).toBe('idle');
    expect(touchHintStartPhase('')).toBe('idle');
    expect(touchHintStartPhase('0')).toBe('idle');
    expect(touchHintStartPhase('true')).toBe('idle');
  });
});

describe('the stage offer', () => {
  it('shows while offered and comes off when not, as often as the stage changes its mind', () => {
    let phase: TouchHintPhase = 'idle';
    phase = touchHintOnOffer(phase, true);
    expect(phase).toBe('shown');
    phase = touchHintOnOffer(phase, true);
    expect(phase).toBe('shown');
    // the player leaves the creator without touching the model: off, and back next visit
    phase = touchHintOnOffer(phase, false);
    expect(phase).toBe('idle');
    expect(touchHintOnOffer(phase, true)).toBe('shown');
  });

  it('lets an exit finish while the stage holds, and ends it at once when the stage goes', () => {
    expect(touchHintOnOffer('leaving', true)).toBe('leaving');
    expect(touchHintOnOffer('leaving', false)).toBe('done');
  });

  it('never brings a retired hint back', () => {
    expect(touchHintOnOffer('done', true)).toBe('done');
    expect(touchHintOnOffer('done', false)).toBe('done');
  });
});

describe('the first gesture', () => {
  it('plays the exit for a hint on screen, then retires it', () => {
    const leaving = touchHintOnInteract('shown');
    expect(leaving).toBe('leaving');
    expect(touchHintOnLeft(leaving)).toBe('done');
  });

  it('leaves a hint that is not on screen alone (the player never saw it)', () => {
    // a turn on the character select's stage, or a pinch before the creator's model draws
    expect(touchHintOnInteract('idle')).toBe('idle');
    expect(touchHintOnOffer(touchHintOnInteract('idle'), true)).toBe('shown');
  });

  it('counts a gesture only while the hint is on screen', () => {
    expect(touchHintFirstGesture('shown')).toBe(true);
    expect(touchHintFirstGesture('idle')).toBe(false);
    expect(touchHintFirstGesture('leaving')).toBe(false);
    expect(touchHintFirstGesture('done')).toBe(false);
  });

  it('a later gesture changes nothing', () => {
    expect(touchHintOnInteract('leaving')).toBe('leaving');
    expect(touchHintOnInteract('done')).toBe('done');
  });

  it('a finished exit moves only a leaving hint', () => {
    for (const phase of PHASES) {
      expect(touchHintOnLeft(phase)).toBe(phase === 'leaving' ? 'done' : phase);
    }
  });

  it('times the exit long enough for the slide back into the stage edge', () => {
    // shell.css pth-dock-out runs 300 ms; the node must outlive it
    expect(PREVIEW_TOUCH_HINT_LEAVE_MS).toBeGreaterThanOrEqual(300);
    expect(PREVIEW_TOUCH_HINT_LEAVE_MS).toBeLessThan(1000);
  });
});
