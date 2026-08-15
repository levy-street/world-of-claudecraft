// Refresh signature for the character sheet's PROGRESSION block: the worn Book
// of Deeds cosmetics (active title line, border badge row's worn word), the
// earned border badges themselves, and the Reliquary completion pair plus
// Curator rank.
//
// Why this exists at all: the character sheet is a COLD window. It repaints on
// open and on the handful of edges that call renderIfOpen, and it is absent from
// the HUD's 2 Hz slow band, so changing the worn title or border from the Book of
// Deeds picker (which deliberately repaints only itself, taking no optimistic
// write) left an already-open sheet showing the previous wearer state until the
// player closed and reopened it. This signature is what the HUD latches on to
// notice the change and call charWindow.renderIfOpen(), the same shape
// professionSurfaceRefreshSig (src/ui/profession_identity_view.ts) gives the
// profession surfaces.
//
// It covers the DEEDS and RELIQUARY rows of the progression block, not only the
// worn cosmetics, because those rows paint three things from three different
// sources: the worn title and border ids, the earned border-badge row
// (deedsEarned), and the Reliquary pair plus rank (buildReliquarySheetModel).
// Signing only the first left the other two stale in exactly the same way:
// earning a border deed, or filling a relic, with the sheet already open changed
// nothing on screen until it was reopened.
//
// Deliberately NOT the whole block. The same progression HTML also paints Total
// XP, Virtual Level, Prestige rank, and the milestone badges, and none of those
// is signed here: they move on paths this latch was not built for, and the Total
// XP row's own staleness is a recorded pre-existing follow-up rather than
// something this signature closes. Widening to them is a separate decision, not
// an oversight to patch by adding fields.
//
// The Reliquary half is signed by its OWNERSHIP SIZES, not by re-running
// catalogCharacterCompletion every slow tick. The sizes are the same proxy the
// Reliquary tracker uses on this same band (reliquaryTrackerOwnershipSig in
// src/ui/reliquary_tracker_view.ts), and they move whenever the pair or the rank
// can have moved. Cheap with one caveat worth stating: three of the four are
// O(1) `.size` reads, but the mount count comes from Sim.ownedMounts(), which
// spreads bags AND bank into a fresh array per call. The tracker defers its
// gather behind a THUNK for exactly that reason, so a player with pinned pages
// never pays it; the latch that feeds this signature reads it unconditionally,
// at a measured cost of microseconds, because keeping the signature warm across
// a closed sheet is what avoids a redundant repaint on reopen. Accepted, not
// free, and a third consumer of these reads on this band earns one shared
// once-per-tick computation instead of a third walk.
//
// Two consequences, both accepted and neither a staleness bug: a discovery that
// is not a catalogued relic moves the signature without moving the pair, which
// costs one repaint of identical HTML; and a mount add plus a mount remove
// inside ONE 500 ms band cancel out, the same documented blind spot the
// tracker's signature carries (nothing else here can shrink: deeds, discoveries,
// and marks never come back off). Both are pinned in
// tests/char_sheet_sig_core.test.ts.
//
// Weapon skins are deliberately NOT signed. They are account cosmetics, and
// catalogCharacterCompletion excludes them from the character-scoped pair by
// design, so signing them would repaint the sheet for a number it does not show.
//
// It converges in BOTH hosts without an optimistic write: offline the sim setters
// are synchronous, so the next slow tick already reads the new values; online the
// mirror updates from the server's atitle / aborder echo and the snapshot's own
// ownership fields, which land well inside the 500 ms band.
//
// Deliberately DEED IDS, not resolved display text: the ids are what the sim and
// the mirror hold, and comparing them means a language change (which repaints
// every window through its own path) does not masquerade as a cosmetic change.
//
// Pure and host-agnostic: no DOM, no i18n, no world reference, so a Vitest drives
// it directly.

/**
 * Compact signature of everything the character sheet's progression block reads
 * that can move while the sheet is open: the active title deed id and the active
 * border deed id (both null for "nothing worn"), the earned-deed count behind the
 * border badge row, and the three character-scoped Reliquary ownership sizes
 * behind the completion pair and Curator rank. Byte-stable for equal input (a
 * fixed six-element array through JSON.stringify), so a latch comparing two
 * signatures moves exactly when one of the six moves.
 */
export function charSheetRefreshSig(parts: {
  activeTitle: string | null;
  activeBorder: string | null;
  /** deedsEarned.size: the earned border-badge row is built from that set. */
  deedsEarned: number;
  /** deedStats.itemsDiscovered.size: item relics behind the completion pair. */
  itemsDiscovered: number;
  /** reliquaryMarks.size: authored non-item marks behind the pair. */
  marks: number;
  /** ownedMounts().length: Horizons mount relics behind the pair. */
  mounts: number;
}): string {
  return JSON.stringify([
    parts.activeTitle,
    parts.activeBorder,
    parts.deedsEarned,
    parts.itemsDiscovered,
    parts.marks,
    parts.mounts,
  ]);
}
