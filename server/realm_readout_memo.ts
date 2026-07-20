// Per-broadcast-pass memo for a realm-wide readout. GameServer holds one
// instance per shared fragment (like its wireCache / partyFrameGlobalsCache
// fields), keyed on sim.tickCount: the shared object and its JSON string are
// built at most once per tick and reused by every session in that broadcast
// pass, instead of once per online viewer. Server-host state only; draws no
// rng, so it cannot perturb sim determinism. Payload-agnostic: the Vale Cup
// readout (vcupb) and the dungeon-finder board (dfb) are the two tenants, each
// on its own GameServer memo field.
export interface RealmReadoutMemo<T> {
  tick: number; // the sim tick the cached object/string were built for (-1 = never)
  shared: T | null;
  json: string | null; // JSON.stringify(shared) for the same tick, lazily built
  objectBuilds: number; // increments once per real object build (once-per-pass proof)
  stringifies: number; // increments once per real JSON.stringify (once-per-pass proof)
}

export function createRealmReadoutMemo<T>(): RealmReadoutMemo<T> {
  return { tick: -1, shared: null, json: null, objectBuilds: 0, stringifies: 0 };
}

// The shared readout object for `tick`, built via `build` only on a tick miss.
// A rebuild invalidates the cached JSON so realmReadoutJson restringifies.
export function realmReadoutObject<T>(memo: RealmReadoutMemo<T>, tick: number, build: () => T): T {
  if (memo.tick !== tick || memo.shared === null) {
    memo.shared = build();
    memo.json = null;
    memo.tick = tick;
    memo.objectBuilds++;
  }
  return memo.shared;
}

// The JSON string of the shared readout for `tick`, stringified only once per
// tick. Ensures the object is current first (so a stale-tick string is never
// returned), then stringifies on a miss.
export function realmReadoutJson<T>(
  memo: RealmReadoutMemo<T>,
  tick: number,
  build: () => T,
): string {
  const obj = realmReadoutObject(memo, tick, build);
  if (memo.json === null) {
    memo.json = JSON.stringify(obj);
    memo.stringifies++;
  }
  return memo.json;
}
