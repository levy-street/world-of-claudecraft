// Arms the one-time performance nudge toast (packet 0 rulings R14-R16, the
// player-facing half of brainstorm finding 16): once real gameplay frames
// exist, periodically run the client perf-doctor over the live PerfMonitor
// snapshot, and the FIRST time a machine-local cause shows up (software
// rendering, or a hybrid laptop stuck on its integrated GPU), hand the id set
// to the UI toast exactly once for the session. Modeled on
// software_render_notice.ts: lives in src/game so main.ts stays a firewall
// (one composition call) and neither ui nor render imports the other.
//
// The polling gate exists because the non-software analyzer arms need a BAD
// last10s frame window, which cannot be judged during the loading screen or
// before a 10 s window fills; the frames floor mirrors the perf reporter's
// MIN_REPORT_FRAMES so the first check never reads warm-up garbage. Whatever
// the toast decides (shown, suppressed by the boot notice, or dismissed
// before), one nudge-worthy detection ENDS the polling: the causes it watches
// are machine-level and do not change within a session, so re-evaluating after
// the decision could only double-nudge.

import { initPerfNudgeToast } from '../ui/perf_nudge_toast';
import { isPerfNudgeArmId } from '../ui/perf_nudge_view';
import type { PerfSnapshot } from './perf';
import { analyzePerfSuggestions } from './perf_doctor';
import { softwareNoticeShown } from './software_render_notice';

const PERF_NUDGE_CHECK_INTERVAL_MS = 30_000;
const PERF_NUDGE_MIN_FRAMES = 30;

export interface PerfNudgeOptions {
  perf: { report(): PerfSnapshot };
  desktopShell: boolean;
}

/** Call once from main.ts when gameplay input goes live; returns a stop hook. */
export function initPerfNudge(options: PerfNudgeOptions): () => void {
  let timer: number | null = null;

  const stop = (): void => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };

  const check = (): void => {
    const snapshot = options.perf.report();
    if (snapshot.frames < PERF_NUDGE_MIN_FRAMES) return;
    const suggestionIds = analyzePerfSuggestions(snapshot, undefined, {
      desktopShell: options.desktopShell,
    }).map((suggestion) => suggestion.id);
    if (!suggestionIds.some(isPerfNudgeArmId)) return;
    // One decisive toast resolution per session, shown or not (see header).
    stop();
    initPerfNudgeToast({
      suggestionIds,
      softwareNoticeAlreadyShown: softwareNoticeShown(),
      desktopShell: options.desktopShell,
    });
  };

  timer = window.setInterval(check, PERF_NUDGE_CHECK_INTERVAL_MS);
  return stop;
}
