// Shared "skip a rebuild while a native drag it would destroy is in flight"
// latch.
//
// A native HTML5 drag never fires `dragend` on a source element that has
// already left the document (removed, or replaced wholesale by an innerHTML
// rebuild), so a window that tears down its own draggable rows on every
// live-data refresh leaves the shared drag state it feeds (ItemDragState,
// Hud.dragAction, or a window's own local drag flag) stuck for the rest of
// the session: every later drop reads that stale drag instead of the live
// one and silently refuses to land. bags_window.ts hit this first
// (tests/bags_window_drag_render_defer.test.ts, "action bar and items stop
// being draggable, only a full reload fixes it"); this is the shared shape
// every OTHER window that innerHTML-rebuilds itself AND hosts a native
// `draggable` row needs too, so a drag started there survives long enough to
// fire its own dragend normally.
//
// The caller decides what "a drag it could destroy" means (its own
// dragState / dragAction / a local flag, possibly OR'd together) and owns
// the actual rebuild; this class owns only the pending/flush bookkeeping,
// which is identical everywhere it is needed.

export class DeferredDragRender {
  private pending = false;

  /**
   * Call at the top of a rebuild. `active` is the caller's own "a drag this
   * rebuild could destroy is in flight" predicate. Returns true when the
   * caller must skip its rebuild this call; a flush is now owed. Returns
   * false when the caller's normal rebuild should run.
   */
  shouldDefer(active: boolean): boolean {
    if (active) this.pending = true;
    return active;
  }

  /**
   * Mark a rebuild as owed directly, for a caller that knows one is coming
   * (a state mutation it just committed) before any render() call has run to
   * observe the still-in-flight drag and defer itself through shouldDefer().
   * Without this, flush() would see nothing pending and skip the rebuild
   * that would otherwise be the only one to pick up the mutation.
   */
  arm(): void {
    this.pending = true;
  }

  /**
   * Call from the dragged row's own end-of-drag handler (native `dragend`,
   * or a touch drag's `onEnd`). Runs `rebuild` once if a rebuild was
   * actually owed; a no-op otherwise.
   */
  flush(rebuild: () => void): void {
    if (!this.pending) return;
    this.pending = false;
    rebuild();
  }
}
