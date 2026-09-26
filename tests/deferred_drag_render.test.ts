// Pure unit test for the shared defer/flush latch (see the module header for the
// hazard it exists to close: a native drag's source row destroyed mid-drag by an
// unrelated rebuild never fires dragend, so the shared drag state it feeds gets
// stuck). Behavioral coverage for each real consumer lives beside it:
// tests/bags_window_drag_render_defer.test.ts,
// tests/spellbook_window_drag_render_defer.test.ts,
// tests/char_window_drag_render_defer.test.ts.

import { describe, expect, it } from 'vitest';
import { DeferredDragRender } from '../src/ui/deferred_drag_render';

describe('DeferredDragRender', () => {
  it('runs the caller rebuild directly when nothing is active', () => {
    const gate = new DeferredDragRender();
    let ran = 0;
    const rebuild = () => ran++;
    expect(gate.shouldDefer(false)).toBe(false);
    if (!gate.shouldDefer(false)) rebuild();
    expect(ran).toBe(1);
  });

  it('defers when active, and flush() runs the rebuild exactly once', () => {
    const gate = new DeferredDragRender();
    let ran = 0;
    expect(gate.shouldDefer(true)).toBe(true);
    // A caller that observes true must skip its own rebuild.
    expect(gate.shouldDefer(true)).toBe(true); // still active on a second call

    gate.flush(() => ran++);
    expect(ran).toBe(1);

    // flush() is idempotent once nothing is pending.
    gate.flush(() => ran++);
    expect(ran).toBe(1);
  });

  it('arm() marks a rebuild owed even when no shouldDefer() call observed the drag', () => {
    const gate = new DeferredDragRender();
    let ran = 0;
    gate.arm();
    gate.flush(() => ran++);
    expect(ran).toBe(1);
  });

  it('flush() is a no-op when nothing was ever deferred or armed', () => {
    const gate = new DeferredDragRender();
    let ran = 0;
    gate.flush(() => ran++);
    expect(ran).toBe(0);
  });
});
