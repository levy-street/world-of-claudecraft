// Shared helper for screenshot/E2E capture: every headless puppeteer session runs on
// swiftshader (software rendering), so the legitimate GPU-acceleration toast
// (src/ui/gpu_notice_toast.ts) always fires and shows up in captured frames. It is a
// real, gameplay-neutral player notice and must never be removed from game code; this
// helper only suppresses it for the capture SESSION by pre-seeding the same
// per-install dismissal key the toast itself writes when a player clicks dismiss.
//
// Call before `page.goto` (evaluateOnNewDocument runs before any page script, so the
// toast never mounts in the first place, unlike setting localStorage after load).
const DISMISSED_KEY = 'woc_gpu_notice_dismissed';

/** @param {import('puppeteer-core').Page} page */
export async function suppressGpuNotice(page) {
  await page.evaluateOnNewDocument((key) => {
    try {
      localStorage.setItem(key, '1');
    } catch {
      // Storage unavailable (rare in a headless capture context): nothing to do,
      // the toast still renders but capture proceeds.
    }
  }, DISMISSED_KEY);
}
