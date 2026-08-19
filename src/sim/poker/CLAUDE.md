# Poker simulation

This directory owns the host-neutral Texas Hold'em rules core. Keep UI, sockets,
database calls, clocks, authentication, and game-currency mutation outside this
module.

## Determinism

- `PokerTable.create()` consumes exactly one seed from the shared simulation `Rng`.
- A table then owns a persisted deterministic substream: each hand derives its shuffle
  from `tableSeed` and `handNumber`. This follows the existing per-match RNG precedent
  and lets an active table serialize and resume without depending on unrelated world
  RNG draws.
- Never use `Math.random`, Web Crypto, Node `crypto`, or wall-clock time here.
- Changing the seed mixer, shuffle order, dealing order, burn order, or RNG draw count
  is a replay-breaking change and requires decisive deterministic tests.

## Security boundary

- `serialize()` is private authoritative state and includes the seed and full deck.
  It must never be sent to a client. Persisted bytes must be stored behind the
  authoritative server's access controls and protected from modification; structural
  validation is not a substitute for an authenticated action history.
- Client-facing code must use `snapshotFor(viewerId)`. The authoritative server must
  derive `viewerId` from the authenticated session, never from an untrusted request.
- Restores accept untrusted-shaped data defensively, but storage and economy adapters
  must still use atomic, idempotent debit/credit operations.
