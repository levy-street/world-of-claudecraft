// Pure change-detection for the Source Cave kill-progress banner: the WoW-style
// top-center flash quest_progress_banner.ts already renders for quest objectives,
// reused here with an integer percentage so the fixed combat budget never reads
// like a mismatch with the larger visible contributor roster.
//
// world.sourceCaveInfo() (killed/totalMobs/cleared) is server-authoritative,
// wire-mirrored state, not a per-event notification hud.ts can diff on arrival
// (the sim emits kill progress as a plain localized log line today, matched by
// sim_i18n.ts's sim.sourceCave.killProgress rule, not a questProgress SimEvent),
// so this core polls the numbers each cadence and decides whether a NEW banner
// line is due by diffing against the caller's own last-seen snapshot. DOM-free /
// i18n-free / allocation-light (no container object, a flat discriminated
// return), so tests/source_cave_progress_view.test.ts drives it directly and it
// is safe to call every HUD tick.

import type { SourceCaveInfo } from '../world_api/dungeons';

/** The caller's own last-seen snapshot, carried across calls (hud.ts fields). */
export interface SourceCaveProgressSeen {
  killed: number;
  cleared: boolean;
}

export type SourceCaveProgressEvent = { kind: 'killed'; percent: number } | { kind: 'cleared' };

/**
 * Diffs `info` against `seen` and returns the ONE event due this call (a fresh
 * clear wins over a same-call kill uptick, the more significant milestone), or
 * null when nothing new happened. `seen` is null on the very first call for a
 * given viewer (no announcement: avoids flashing a stale line for progress made
 * before the cave info was first observed this session).
 */
export function sourceCaveProgressEvent(
  seen: SourceCaveProgressSeen | null,
  info: SourceCaveInfo | null,
): SourceCaveProgressEvent | null {
  if (!info || !seen) return null;
  if (!seen.cleared && info.cleared) return { kind: 'cleared' };
  if (info.killed > seen.killed) {
    const percent =
      info.totalMobs > 0
        ? Math.min(100, Math.floor((Math.max(0, info.killed) * 100) / info.totalMobs))
        : 0;
    return { kind: 'killed', percent };
  }
  return null;
}
