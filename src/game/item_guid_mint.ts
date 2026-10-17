// The offline client's guid mint for tracked (epic and legendary) item copies
// (src/sim/item_tracking.ts, SimConfig.mintItemGuid): the browser's own
// crypto.randomUUID where it exists. Read at CALL time, never at module load,
// so importing this file is safe under a bare Node test env, and a host with
// no usable crypto simply returns undefined, which leaves the sim on its
// deterministic fallback (src/sim/item_provenance.ts deterministicItemGuid).

export function offlineItemGuidMint(): (() => string) | undefined {
  try {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return () => c.randomUUID();
  } catch {
    // Some locked-down embedders throw on the property access itself.
  }
  return undefined;
}
