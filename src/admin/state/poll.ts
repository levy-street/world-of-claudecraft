// Small polling helper for live admin data. Call inside a Svelte $effect: it runs fn
// once immediately, then every ms, and returns a cleanup the effect uses to clear the
// interval on unmount or dependency change. Replaces the old main.ts setInterval pair
// (live 5s overview+online, activity 60s) with per-component, auto-torn-down timers.
export const LIVE_REFRESH_MS = 5_000;
export const ACTIVITY_REFRESH_MS = 60_000;
export const SEARCH_DEBOUNCE_MS = 300;

export function poll(fn: () => void, ms: number): () => void {
  fn();
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
}
