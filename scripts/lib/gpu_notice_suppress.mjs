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

// The dismissal is a COMPONENT SIGNATURE, not a boolean: the toast re-arms when
// the live verdict carries a component the stored value does not cover
// (src/ui/gpu_notice_view.ts parseGpuNoticeSignature, formatGpuNoticeSignature).
// The legacy '1' this helper used to write parses as a SOFTWARE-only dismissal,
// so on a headless swiftshader box, whose verdict also carries
// 'discrete-inactive', the notice kept mounting and kept landing in captured
// frames. Seed the FULL component set instead: sorted and comma-joined, exactly
// what the toast writes when a player dismisses every component at once.
// Kept in sync with GPU_NOTICE_COMPONENTS by tests/gpu_notice_view.test.ts.
const DISMISSED_ALL_COMPONENTS = 'discrete-inactive,hybrid,software';

/** @param {import('puppeteer-core').Page} page */
export async function suppressGpuNotice(page) {
  await page.evaluateOnNewDocument(
    (key, value) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Storage unavailable (rare in a headless capture context): nothing to do,
        // the toast still renders but capture proceeds.
      }
    },
    DISMISSED_KEY,
    DISMISSED_ALL_COMPONENTS,
  );
}
