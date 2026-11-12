// The skill event heart bar: the PURE view (no DOM). While the viewer fights a
// heart event (src/sim/pvp/skill_events.ts SKILL_EVENT_HEART_KINDS) their
// health bar gives way to a row of hearts: every hit from another participant
// takes exactly one, so the bar shows whole hearts, full or spent. It reads the
// viewer's own entity (`eventHearts`, on the entity wire every tick), so the row
// never lags a hit; the field is present exactly while a heart fight runs.

export interface HeartBarView {
  /** Hearts replace the health bar right now. */
  show: boolean;
  /** Hearts left, clamped to [0, max]. */
  filled: number;
  max: number;
}

export const HIDDEN_HEART_BAR: HeartBarView = Object.freeze({ show: false, filled: 0, max: 0 });

export function buildHeartBarView(hearts: number | undefined, maxHearts: number): HeartBarView {
  if (hearts === undefined || !Number.isFinite(hearts) || maxHearts <= 0) return HIDDEN_HEART_BAR;
  const max = Math.floor(maxHearts);
  return { show: true, filled: Math.max(0, Math.min(max, Math.floor(hearts))), max };
}
