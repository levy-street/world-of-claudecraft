// First-reveal compile gating: the pure state machine behind holding a
// world-content subtree through its FIRST hidden-to-visible flip until its
// shader programs are linked off-thread (hitch-hunt P3a). The post-entry
// compile-debt lane pays boot debt over tens of seconds, and a camera reveal
// that wins the race against it links programs synchronously inside a live
// frame (the measured 300 to 680 ms submit-stall class). A consulted cull
// keeps its subtree in the pre-reveal representation for the few frames a
// background compile needs, which for distant scenery is invisible.
//
// Pure core contract: no three import, no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/reveal_gate_core.test.ts. The promise/watchdog orchestration lives in
// the host adapter (reveal_gate.ts), which owns the compile requests.

export type RevealGateState = 'cold' | 'compiling' | 'warm';

export interface RevealGateCore {
  /**
   * Consult on a reveal edge. Warm keys reveal immediately. A cold key fires
   * ONE compile request and holds; further consultations hold without
   * re-requesting until the host settles the key.
   */
  allow(key: string): boolean;
  /** Mark a key revealable. Idempotent; an unknown key becomes warm (the
   *  fail-soft arm: a settle must always end the hold, whatever came first). */
  settle(key: string): void;
  state(key: string): RevealGateState;
}

export function createRevealGateCore(request: (key: string) => void): RevealGateCore {
  const states = new Map<string, RevealGateState>();
  return {
    allow(key: string): boolean {
      const state = states.get(key) ?? 'cold';
      if (state === 'warm') return true;
      if (state === 'cold') {
        states.set(key, 'compiling');
        request(key);
      }
      return false;
    },
    settle(key: string): void {
      states.set(key, 'warm');
    },
    state(key: string): RevealGateState {
      return states.get(key) ?? 'cold';
    },
  };
}
