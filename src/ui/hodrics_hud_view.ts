// Pure, host-agnostic view model for the in-race Gauntlet HUD strip: the
// countdown, the live position board (rank, section, progress, falls), and
// the aftermath banner state. Snapshot-driven from HcInfo so it self-heals on
// reconnect; one-shot juice (knock cues, the finish banner) rides events in
// hud.ts. DOM/i18n live in hodrics_hud.ts.

import type { HcInfo } from '../world_api';

export interface HcHudRacerRow {
  name: string;
  you: boolean;
  bot: boolean;
  progress: number; // 0..1
  finished: boolean;
  place: number | null;
  left: boolean;
}

export type HcHudView =
  | { kind: 'hidden' }
  | { kind: 'countdown'; seconds: number; sig: string }
  | {
      kind: 'race';
      rank: number; // my live rank, 1-based
      fieldSize: number;
      section: string; // course section id (localized by the painter)
      progress: number; // my progress 0..1
      falls: number;
      timeLeft: number; // whole seconds until the course cap
      finished: boolean;
      place: number | null;
      rows: HcHudRacerRow[];
      sig: string;
    }
  | { kind: 'over'; place: number | null; won: boolean; sig: string };

/** Build the race HUD view from the mirrored snapshot. */
export function buildHcHudView(info: HcInfo | null): HcHudView {
  const m = info?.match;
  if (!m) return { kind: 'hidden' };
  if (m.state === 'countdown') {
    return { kind: 'countdown', seconds: m.countdown, sig: `c${m.countdown}` };
  }
  if (m.state === 'over') {
    return {
      kind: 'over',
      place: m.place,
      won: m.place === 1,
      sig: `o${m.place ?? 'x'}`,
    };
  }
  const rows: HcHudRacerRow[] = m.racers.map((r) => ({
    name: r.name,
    you: r.you,
    bot: r.bot,
    progress: r.progress,
    finished: r.finished,
    place: r.place,
    left: r.left,
  }));
  const rank = Math.max(1, rows.findIndex((r) => r.you) + 1);
  const me = rows.find((r) => r.you);
  const timeLeft = Math.max(0, Math.ceil(m.timeLeft));
  const sig = JSON.stringify([
    rank,
    m.section,
    m.checkpoint,
    m.falls,
    timeLeft,
    m.finished,
    m.place,
    rows.map((r) => [r.progress.toFixed(3), r.finished, r.place]),
  ]);
  return {
    kind: 'race',
    rank,
    fieldSize: rows.length,
    section: m.section,
    progress: me?.progress ?? 0,
    falls: m.falls,
    timeLeft,
    finished: m.finished,
    place: m.place,
    rows,
    sig,
  };
}
