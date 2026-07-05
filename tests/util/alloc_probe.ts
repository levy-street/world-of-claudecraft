// Allocation-budget probe for the per-frame pure cores (action bar, auras pool,
// FCT pool, standing budget). It is the CANONICAL,
// machine-independent allocation assertion for these per-frame cores.
//
// Why this exists: a correct per-frame core returns a
// REUSED, preallocated container (an array of slot-state objects, or a pool
// object) and MUTATES it in place every frame, so it allocates ZERO new
// per-frame arrays/objects. That property is directly observable in Node without
// a GC or wall-clock timer: drive the core N times and check that the returned
// container reference AND every directly-contained reference-typed slot is === to
// the first call's. A reallocating core fails on the very first comparison.
//
// This is the deterministic floor. It does NOT (and cannot) measure transient
// garbage that lives strictly INSIDE an already-allocated slot (e.g. a fresh
// string built per frame and stored on a slot field): primitive fields are
// EXPECTED to be mutated in place every frame, so they carry no identity and are
// deliberately skipped. The full-HUD garbage signal (where no single core can be
// isolated) is the perf_tour fallback: frameP95 + longTasks.
//
// Dependency-free on purpose (no vitest import): callable from any test, which
// can either read the returned result or call the throwing variant.

/** Result of one allocation-stability probe over many core calls. */
export interface AllocProbeResult {
  /** True when the container and all of its reference-typed slots stayed identical. */
  stable: boolean;
  /** How many times the thunk was driven. */
  calls: number;
  /**
   * The array index of the first slot whose reference changed, or -1 when the
   * top-level container reference itself changed (or when stable). The human
   * readable `detail` always names exactly what moved (and, for object
   * containers, the key).
   */
  firstUnstableIndex: number;
  /** Human-readable explanation of the verdict, suitable for a thrown message. */
  detail: string;
}

/** A heap value carries identity only when it is a (non-null) object or a function. */
function isReference(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

/**
 * Drive `produce` (a zero-arg thunk returning a per-frame core's reused state
 * container) `calls` times and report whether it allocated nothing new: the
 * returned container reference and every directly-contained reference-typed slot
 * must be === to the first call's. Primitive slots are skipped (they are meant to
 * be mutated in place). Returns a verdict instead of throwing so a test can
 * assert on the structured result; use `assertAllocationStable` to throw.
 */
export function probeAllocationStability(produce: () => unknown, calls = 64): AllocProbeResult {
  if (calls < 2) {
    return {
      stable: true,
      calls,
      firstUnstableIndex: -1,
      detail: `calls=${calls}: nothing to compare (need at least 2 calls)`,
    };
  }

  const first = produce();
  if (!isReference(first)) {
    const kind = first === null ? 'null' : typeof first;
    return {
      stable: false,
      calls,
      firstUnstableIndex: -1,
      detail: `thunk returned a ${kind}; a per-frame core must return a reused object or array, which a primitive value cannot be`,
    };
  }

  const isArray = Array.isArray(first);
  const container = first as Record<PropertyKey, unknown>;
  // Anchor on the first frame's directly-contained reference-typed slots, keyed
  // by index (arrays) or own enumerable key (objects). Capturing the references
  // is safe even though the core mutates the slots in place: a reused slot keeps
  // its identity regardless of its field values.
  const keys: Array<number | string> = isArray
    ? (first as unknown[]).map((_, index) => index)
    : Object.keys(container);
  const firstRefs = new Map<number | string, object>();
  for (const key of keys) {
    const value = container[key];
    if (isReference(value)) firstRefs.set(key, value);
  }

  for (let call = 1; call < calls; call++) {
    const current = produce();
    if (current !== first) {
      return {
        stable: false,
        calls,
        firstUnstableIndex: -1,
        detail: `top-level ${isArray ? 'array' : 'object'} reference changed on call ${call + 1}/${calls}: the core reallocated its returned container instead of mutating it in place`,
      };
    }
    const currentContainer = current as Record<PropertyKey, unknown>;
    for (const [key, ref] of firstRefs) {
      if (currentContainer[key] !== ref) {
        const where = typeof key === 'number' ? `[${key}]` : `.${String(key)}`;
        return {
          stable: false,
          calls,
          firstUnstableIndex: typeof key === 'number' ? key : -1,
          detail: `slot ${where} reference changed on call ${call + 1}/${calls}: the core reallocated this slot instead of mutating it in place`,
        };
      }
    }
  }

  return {
    stable: true,
    calls,
    firstUnstableIndex: -1,
    detail: `stable across ${calls} calls: container + ${firstRefs.size} reference-typed slot(s) identical`,
  };
}

/**
 * Throwing wrapper around `probeAllocationStability`: throws with a clear,
 * `label`-prefixed message when the core allocates a new container or slot.
 * Use this directly in a test (`expect(() => assertAllocationStable(...)).not.toThrow()`).
 */
export function assertAllocationStable(
  produce: () => unknown,
  calls = 64,
  label = 'per-frame core',
): void {
  const result = probeAllocationStability(produce, calls);
  if (!result.stable) {
    throw new Error(`${label}: allocation budget violated: ${result.detail}`);
  }
}
