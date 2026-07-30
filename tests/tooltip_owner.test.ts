// Regression for a reported bug (#1626): in the bag, dragging one item on top of
// another left the shared #tooltip box showing the DRAGGED item's text instead of
// the item under the cursor, and moving the cursor within that item's bounds did
// not correct it. The HUD shows a single shared tooltip box; on a native drag,
// Firefox re-enters the drag SOURCE and repaints its tooltip while the cursor sits
// over a different slot, and the hovered slot's mousemove then only REPOSITIONS
// the stale box. SharedTooltipOwner lets a hovered slot detect that the visible
// content belongs to a different (or no) element and re-resolve its own tooltip.

import { describe, expect, it } from 'vitest';
import { SharedTooltipOwner } from '../src/ui/tooltip_owner';

describe('SharedTooltipOwner (#1626 shared-tooltip staleness)', () => {
  it('starts unowned: any hovered element must re-resolve its own tooltip', () => {
    const owner = new SharedTooltipOwner<string>();
    expect(owner.current()).toBeNull();
    expect(owner.needsReshow('A')).toBe(true);
  });

  it('the claiming element keeps the cheap reposition-only path; others re-resolve', () => {
    const owner = new SharedTooltipOwner<string>();
    owner.claim('A');
    expect(owner.current()).toBe('A');
    // A owns the box: A's own mousemove stays on the reposition-only path.
    expect(owner.needsReshow('A')).toBe(false);
    // A different slot finds foreign content and must repaint.
    expect(owner.needsReshow('B')).toBe(true);
  });

  it('re-claiming transfers ownership so the previous owner now re-resolves', () => {
    const owner = new SharedTooltipOwner<string>();
    owner.claim('A');
    owner.claim('B');
    expect(owner.current()).toBe('B');
    expect(owner.needsReshow('B')).toBe(false);
    expect(owner.needsReshow('A')).toBe(true);
  });

  it('release (box hidden) drops ownership so the next move over any slot re-resolves', () => {
    const owner = new SharedTooltipOwner<string>();
    owner.claim('A');
    owner.release();
    expect(owner.current()).toBeNull();
    expect(owner.needsReshow('A')).toBe(true);
    expect(owner.needsReshow('B')).toBe(true);
  });

  it('reproduces the drag path: source re-enter over slot B corrects on the next move', () => {
    const owner = new SharedTooltipOwner<string>();
    // Hover source item A: its tooltip owns the shared box.
    owner.claim('A');
    // dragstart hides the box (bags path) -> ownership released.
    owner.release();
    // Firefox fires a spurious mouseenter on the drag SOURCE after the native
    // drag, repainting A's tooltip while the cursor actually sits over B.
    owner.claim('A');
    // The box wrongly shows A while the cursor is over B: B must re-resolve.
    expect(owner.needsReshow('B')).toBe(true);
    // B repaints its own tooltip (claims the box); further B moves stay cheap.
    owner.claim('B');
    expect(owner.needsReshow('B')).toBe(false);
    expect(owner.current()).toBe('B');
  });
});
