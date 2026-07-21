// Pure in-memory link cache for the local-document <-> server-map linkage.
// The optimistic-version check must use the version THIS TAB captured at
// load/save time, not whatever another tab last wrote to the shared
// localStorage links key: re-reading storage on every save let a stale tab
// silently win instead of getting the server 409 that triggers the
// save-as-copy flow. Storage stays a fallback for maps this tab has not
// resolved yet. DOM-free; Vitest drives it directly
// (tests/editor_link_memory.test.ts).

export class LinkMemory<T> {
  private readonly mem = new Map<string, T | null>();

  /**
   * The link this tab knows for `id`. First call seeds from `fallback`
   * (persistent storage); later calls return the seeded/updated value and
   * never re-read the fallback, so another tab's save cannot silently bump
   * this tab's optimistic version.
   */
  resolve(id: string, fallback: () => T | null): T | null {
    const held = this.mem.get(id);
    if (held !== undefined) return held;
    const seeded = fallback();
    this.mem.set(id, seeded);
    return seeded;
  }

  /** Record the link captured at load/save time (null = explicitly unlinked). */
  set(id: string, value: T | null): void {
    this.mem.set(id, value);
  }
}
