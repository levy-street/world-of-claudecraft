// Entry-wait resolution for scripts/pr_screenshots.mjs, extracted so the
// raise-only escape-hatch rule is unit-testable (scripts/CLAUDE.md
// module-first): NAV_TIMEOUT_MS lifts the page-load ceiling AND every entry
// wait together on a contended host, while ENTRY_SELECTOR_TIMEOUT_MS can
// raise the class-card selector wait past even that. Raise-only: an override
// BELOW the 60s CI budget is ignored, so the selector wait never sinks
// under the page-load budget it must outlast. Defaults leave CI behavior
// untouched (both waits at 60000).
export function resolveEntryTimeouts(env) {
  const navTimeoutMs = Number(env.NAV_TIMEOUT_MS ?? 60000);
  const entrySelectorTimeoutMs = Number(env.ENTRY_SELECTOR_TIMEOUT_MS ?? 15000);
  return {
    navTimeoutMs,
    // The literal 60000 term is an explicit floor, not a restatement of the
    // nav default: with NAV_TIMEOUT_MS set LOW (say 20000) the max of the
    // other two terms alone would sink the selector wait to 20000, under the
    // 60s budget the class cards need, silently reintroducing the flake the
    // raise-only rule exists to prevent. Lowering NAV_TIMEOUT_MS may shorten
    // page-load waits, never the selector wait.
    selectorTimeoutMs: Math.max(entrySelectorTimeoutMs, navTimeoutMs, 60000),
  };
}
