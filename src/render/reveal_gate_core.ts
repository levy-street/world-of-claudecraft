// First-reveal compile gating: the pure state machine behind holding a
// world-content subtree through its FIRST hidden-to-visible flip until its
// shader programs are linked off-thread (hitch-hunt P3a). The post-entry
// compile-debt lane pays boot debt over tens of seconds, and a camera reveal
// that wins the race against it links programs synchronously inside a live
// frame (the measured 300 to 680 ms submit-stall class). A consulted cull
// keeps its subtree in the pre-reveal representation for the few frames a
// background compile needs, which for distant scenery is invisible.
//
// The hold is tracked twice, per KEY and per ROOT. The key answers `allow`
// and warms only once every root behind it is ready, so nothing about the
// whole-key contract moved. The per-root half exists because a key can cover
// dozens of independent subtrees (a town is every static batch plus every
// building group): holding all of them until the slowest link settles turns
// the settle frame into the very first-draw burst the gate exists to prevent.
// A consumer that can reveal its roots independently asks `rootReady` and
// shows each one as its own compile lands.
//
// One consult shape is IMMINENT. A cull that reveals because the camera is
// already among its objects (a teleport arrival: a band inside half the fog on
// its first consult, a town whose cull radius the camera is inside) is content
// the player needs NOW, so its consult says so and the host submits that key's
// compiles at a higher queue priority than ordinary reveal work. That is the
// only thing imminence changes: it reorders the queue, it never reveals
// anything early. There is NO wall-clock bound anywhere in this core, which is
// why the core takes no clock: a held root shows when its own compile lands,
// and the only ends of a hold are the host's watchdog and the consumers' own
// reach floors (PROP_CULL_REVEAL_REACH, TOWN_REVEAL_REACH_YD).
//
// Pure core contract: no three import, no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/reveal_gate_core.test.ts. The promise/watchdog orchestration lives in
// the host adapter (reveal_gate.ts), which owns the compile requests.

export type RevealGateState = 'cold' | 'compiling' | 'warm';

/** Ready and total root counts for one key, filled into a caller-owned
 *  object so a per-frame or per-escape read allocates nothing. */
export interface RevealGateReadiness {
  ready: number;
  total: number;
}

export interface RevealGateCore {
  /**
   * Consult on a reveal edge. Warm keys reveal immediately. A cold key fires
   * ONE compile request and holds; further consultations hold without
   * re-requesting until the host settles the key.
   *
   * `imminent` says the camera is already among this key's objects. It marks
   * the key before the request fires, so the host submits its compiles at the
   * imminent priority, and it is what the arrival cover counts as still held.
   * It never reveals anything: an imminent hold is still a hold.
   */
  allow(key: string, imminent?: boolean): boolean;
  /** Mark a key revealable. Idempotent; an unknown key becomes warm (the
   *  fail-soft arm: a settle must always end the hold, whatever came first),
   *  and every root behind it counts as ready, so a late per-root settle
   *  cannot push the ready count past the total. */
  settle(key: string): void;
  state(key: string): RevealGateState;
  /** Host: declare the roots behind a key, once, right after its request
   *  fires. Duplicates collapse; a key with no roots is warm at once. */
  noteRoots(key: string, roots: readonly object[]): void;
  /** Host: one root's compile settled. A REJECTED link settles the root too:
   *  the hold ends on the driver's answer, not on its success. */
  settleRoot(key: string, root: object): void;
  /** Consumer: may this one root reveal now? True once its own compile
   *  settled, or once the whole key is warm. An unknown root waits for the
   *  key, which is the safe direction: it can only reveal late, never cold. */
  rootReady(key: string, root: object): boolean;
  /** Ready/total roots behind a key, for the host's telemetry. */
  readiness(key: string, out: RevealGateReadiness): RevealGateReadiness;
  /** Keys an imminent consult marked that have not warmed yet. The arrival
   *  cover polls it to know whether anything the camera landed among is still
   *  held. */
  heldImminentKeys(): number;
}

interface KeyEntry {
  state: RevealGateState;
  /** Root -> its compile has settled. */
  roots: Map<object, boolean>;
  ready: number;
  total: number;
  /** An imminent consult has touched this key. */
  imminent: boolean;
}

export interface RevealGateCoreOptions {
  /** The first imminent consult on a key that is not warm. Telemetry only. */
  onImminentHold?: (key: string) => void;
}

export function createRevealGateCore(
  request: (key: string, imminent: boolean) => void,
  options: RevealGateCoreOptions = {},
): RevealGateCore {
  const keys = new Map<string, KeyEntry>();
  const entryFor = (key: string): KeyEntry => {
    let entry = keys.get(key);
    if (!entry) {
      entry = { state: 'cold', roots: new Map(), ready: 0, total: 0, imminent: false };
      keys.set(key, entry);
    }
    return entry;
  };
  return {
    allow(key: string, imminent?: boolean): boolean {
      const entry = entryFor(key);
      if (entry.state === 'warm') return true;
      // Marked BEFORE the request: the priority the host submits at is decided
      // by the consult that fires the request, not by a later frame.
      if (imminent === true && !entry.imminent) {
        entry.imminent = true;
        options.onImminentHold?.(key);
      }
      if (entry.state === 'cold') {
        entry.state = 'compiling';
        request(key, entry.imminent);
      }
      return false;
    },
    settle(key: string): void {
      const entry = entryFor(key);
      entry.state = 'warm';
      // Every root is marked ready, not just the count: a root left false here
      // would settle again later and carry `ready` past `total` into the
      // telemetry (a 41-root key reporting 71 of 41).
      for (const root of entry.roots.keys()) entry.roots.set(root, true);
      entry.ready = entry.total;
    },
    state(key: string): RevealGateState {
      return keys.get(key)?.state ?? 'cold';
    },
    noteRoots(key: string, roots: readonly object[]): void {
      const entry = entryFor(key);
      for (let i = 0; i < roots.length; i++) {
        const root = roots[i];
        if (entry.roots.has(root)) continue;
        entry.roots.set(root, false);
        entry.total++;
      }
      if (entry.total === 0) entry.state = 'warm';
    },
    settleRoot(key: string, root: object): void {
      const entry = keys.get(key);
      if (!entry) return;
      if (entry.roots.get(root) !== false) return;
      entry.roots.set(root, true);
      entry.ready++;
      if (entry.ready >= entry.total) entry.state = 'warm';
    },
    rootReady(key: string, root: object): boolean {
      const entry = keys.get(key);
      if (!entry) return false;
      if (entry.state === 'warm') return true;
      return entry.roots.get(root) === true;
    },
    heldImminentKeys(): number {
      let held = 0;
      for (const entry of keys.values()) {
        if (entry.state === 'warm' || !entry.imminent) continue;
        held++;
      }
      return held;
    },
    readiness(key: string, out: RevealGateReadiness): RevealGateReadiness {
      const entry = keys.get(key);
      out.ready = entry ? entry.ready : 0;
      out.total = entry ? entry.total : 0;
      return out;
    },
  };
}
