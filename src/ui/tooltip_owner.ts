// The HUD shows a SINGLE shared #tooltip box, and every attachTooltip() caller
// paints into it on hover. Because the box is shared, a pointer move over one
// element cannot, on its own, tell whether the currently visible content
// belongs to a DIFFERENT element. Two drag paths leave the wrong element owning
// the visible box:
//   - a drag-drop that ends with the cursor already inside a slot fires no
//     mouseenter, so the box keeps its pre-drop content (#1485); and
//   - Firefox, after a native drag, fires a spurious mouseenter on the drag
//     SOURCE, repainting the source's tooltip while the cursor actually sits
//     over another slot (#1626). The hovered slot's mousemove then only
//     REPOSITIONS that stale box, so the wrong tooltip trails the cursor.
//
// SharedTooltipOwner tracks which element last painted the box so a pointer move
// over element E can detect foreign content (needsReshow) and re-resolve E's
// live tooltip instead of dragging the stale one around. It is DOM-free and
// generic so a Vitest can drive it with plain tokens.
export class SharedTooltipOwner<T> {
  private owner: T | null = null;

  /** Record that `el` just painted the shared box (its show path ran). */
  claim(el: T): void {
    this.owner = el;
  }

  /** The box was hidden: no element owns it until the next claim. */
  release(): void {
    this.owner = null;
  }

  /** The element that last painted the visible box, or null when hidden. */
  current(): T | null {
    return this.owner;
  }

  /**
   * True when a pointer move over `el` finds the box showing foreign content (a
   * different element, or none): `el` must repaint its own tooltip rather than
   * merely reposition the shared box. False only while `el` already owns the
   * box, the common case, so the caller keeps the cheap reposition-only path and
   * pays a re-render only on an anomalous no-mouseenter transition.
   */
  needsReshow(el: T): boolean {
    return this.owner !== el;
  }
}
