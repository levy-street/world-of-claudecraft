// Capture hygiene, the sibling of gpu_notice_suppress.mjs. The client's
// perf-doctor nudge (src/ui/perf_nudge_toast.ts) fires mid-session whenever the
// machine is slow, and every headless capture box is one (swiftshader software
// rendering), so it lands in the corner of captured frames on top of whatever
// the shot is evidence for. It is a real, gameplay-neutral player notice and
// must never be removed from game code; this only clears it for the capture
// SESSION.
//
// Unlike the GPU notice it cannot be pre-seeded: the stored dismissal must
// EQUAL the triggering id set (perfNudgeDismissalValue in
// src/ui/perf_nudge_view.ts, packet 0 ruling R16), and which ids fire is not
// known until the analyzer has watched real frames. So do exactly what a player
// does and press its Dismiss button, which writes the right value for whatever
// fired. Cheap enough to call before every shot: one querySelector when the
// toast is absent, which is the case after the first press.
//
// The element and class names are pinned by tests/perf_nudge_view.test.ts.
const ROOT_ID = 'perf-nudge';
const DISMISS_CLASS = 'perf-nudge-dismiss';

/**
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<boolean>} true when a visible nudge was pressed away
 */
export async function dismissPerfNudge(page) {
  try {
    return await page.evaluate(
      (rootId, dismissClass) => {
        const root = document.getElementById(rootId);
        if (!root || root.hidden) return false;
        const button = root.querySelector(`button.${dismissClass}`);
        if (!button) return false;
        button.click();
        return true;
      },
      ROOT_ID,
      DISMISS_CLASS,
    );
  } catch {
    // A navigation or a closed page mid-call: the capture proceeds either way.
    return false;
  }
}
