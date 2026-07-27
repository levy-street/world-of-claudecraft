# Procedural item generation

This directory owns deterministic item generation and nothing else.

- Use only the supplied child seed and `Rng`.
- Keep draw order fixed and documented in `generate.ts`.
- Never read presentation state or localized output.
- Never call `Math.random`, `Date.now`, browser APIs, server APIs, or UI code.
- Return the complete persisted instance. Transfer code must carry that object
  and must never call the generator again for a winner or recipient.
- Changes to draw order require deterministic fingerprint and distribution
  review.
- Keep the barrel in `index.ts` narrow.
