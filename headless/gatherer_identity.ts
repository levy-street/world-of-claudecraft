// The HEADLESS host's allocator for material-gatherer identities.
//
// Same rule as the browser allocator and the same reason it lives outside
// `src/sim/`: minting needs randomness, the sim has none, so the sim only ever
// receives a finished value.
//
// The env keeps NO state across a reset (`reset()` builds a whole new `Sim`), so
// there is nothing to persist into and nothing to reload. What must still hold
// is that two agents are never confused for one, and the seed cannot supply
// that: two runs of one seed are the SAME world by design, which is exactly why
// deriving an identity from it would give two independent training runs one
// shared gatherer record.
//
// So: a per-PROCESS namespace minted once from node crypto, plus a monotonic
// EPISODE counter bumped on every allocation. Two resets differ even at an
// identical seed; two processes differ even at an identical episode number.
//
// This does not make a headless episode non-deterministic. The identity is
// resolved before the Sim is constructed and passed in as a plain value, so a
// given (seed, identity) pair always replays identically; only the identity
// itself varies between runs, and it feeds no gameplay decision, no rng draw and
// no reward.

import { randomUUID } from 'node:crypto';
import type { LocalGathererIdentity } from '../src/sim/material_gatherer';

/** Minted once per process. 32 hex characters, so `hl:<ns>:<n>` stays far
 *  inside the sim's 64-character bound. */
const PROCESS_NAMESPACE = randomUUID().replace(/-/g, '');

let episode = 0;

/**
 * Allocate ONE headless gatherer identity. Every call returns a distinct id for
 * the life of the process; callers hand it straight to the Sim config.
 */
export function allocateHeadlessGathererIdentity(): LocalGathererIdentity {
  episode += 1;
  return { kind: 'headless', id: `hl:${PROCESS_NAMESPACE}:${episode}` };
}
