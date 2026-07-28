# Render runtime

This directory owns host-agnostic, allocation-bounded render indexing.

- Keep modules free of Three.js, DOM APIs, wall-clock reads, and randomness.
- Accept narrow structural entity inputs instead of importing a concrete world host.
- Store hot numeric state in typed arrays and retain object references only for
  presentation features that need cold entity fields.
- A slot stays stable while an entity is present. Reused slots increment their
  generation so delayed work can reject stale ownership.
- Per-frame candidate buffers are owned and reused by the runtime. Callers must
  consume them before the next update.
- Capacity growth may allocate. Steady-state updates must not allocate arrays,
  sets, or temporary objects.
- Pair each core behavior change with a focused Vitest suite and register pure
  cores in `tests/architecture.test.ts`.
