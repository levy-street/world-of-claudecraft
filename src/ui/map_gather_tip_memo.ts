// The zone-map gather tooltip's resolve memo (PR 2933 review): the map's
// pointermove hit-tests on every mouse move, and the tooltip resolve behind
// it (buildGatherNodeTooltip: a content find plus bag scans) is too heavy to
// re-run per event (the src/ui/CLAUDE.md resolve-elision rule). One entry
// deep, keyed by node id: a pointer sweeping across one icon resolves once,
// and the HUD drops the memo beside every marker rebuild so a respawn or
// lock flip is at most one repaint behind the painted icon.
//
// Pure and host-agnostic so tests/map_gather_tip_memo.test.ts drives it
// directly; the Hud owns only the stored entry.

export interface MapGatherTipMemo {
  nodeId: string;
  html: string;
}

/** Return a memo entry valid for `nodeId`: the given one when it already
 *  matches (`resolve` is NOT called), otherwise a fresh entry from `resolve`.
 *  An empty html result is cached too, so a content-less id stays cheap and
 *  the caller's fall-through (to the quest-area arm) keeps working. */
export function resolveGatherTipMemo(
  memo: MapGatherTipMemo | null,
  nodeId: string,
  resolve: (nodeId: string) => string,
): MapGatherTipMemo {
  if (memo && memo.nodeId === nodeId) return memo;
  return { nodeId, html: resolve(nodeId) };
}
