// The Paladin kit's live detail source (pure rule: paladin_vfx_detail_core.ts).
// Read it once at SPAWN and keep the answer on the effect instance: a running
// effect never changes shape mid-flight when the governor moves.
//
// The painter brackets every Paladin cue it dispatches with enterPaladinCast /
// exitPaladinCast, so a spawn inside that bracket sees the caster's spam-budget
// tier; a spawn outside one (an aura, a held presence, a per-frame driver) sees
// the ambient detail of the preset and the live quality. The cast tier is
// resolved LAZILY, only when a Paladin spawn asks: the painter brackets every
// class's events, and nothing here allocates or reads the budget for an event
// no Paladin effect claims.

import { GFX } from '../gfx';
import { type PaladinVfxDetail, paladinVfxDetail } from './paladin_vfx_detail_core';

type CastTierResolver = (casterId: number) => 0 | 1 | 2;

let quality = 1;
let testDetail: PaladinVfxDetail | null = null;
let resolver: CastTierResolver | null = null;

/** Open cast brackets, innermost last. Fixed size: a dispatch nests at most a
 *  cue inside a cue, and a deeper bracket falls back to the ambient detail. */
const MAX_DEPTH = 8;
const castCasters = new Float64Array(MAX_DEPTH);
const castResolved: (PaladinVfxDetail | null)[] = new Array(MAX_DEPTH).fill(null);
let depth = 0;

/** The render budget's vfx level, pushed by AbilityVfxFx.setQuality. A new
 *  renderer's engine pushes its own on construction, so a rebuilt renderer
 *  never inherits the old one's governed value. */
export function setPaladinVfxQuality(q: number): void {
  quality = Math.min(1, Math.max(0, Number.isFinite(q) ? q : 1));
}

/** The painter's spam-budget probe for a caster (peeked, never charged). */
export function setPaladinCastTierResolver(next: CastTierResolver | null): void {
  resolver = next;
}

function ambient(): PaladinVfxDetail {
  return paladinVfxDetail({ effectsTier: GFX.effectsTier, quality });
}

/** The detail a Paladin effect spawning now draws at. */
export function paladinVfxDetailNow(): PaladinVfxDetail {
  if (testDetail) return testDetail;
  if (depth === 0 || depth > MAX_DEPTH) return ambient();
  const at = depth - 1;
  const known = castResolved[at];
  if (known) return known;
  const caster = castCasters[at];
  const castTier = resolver && Number.isFinite(caster) ? resolver(caster) : 0;
  const detail = paladinVfxDetail({ effectsTier: GFX.effectsTier, quality, castTier });
  castResolved[at] = detail;
  return detail;
}

/** Open a cast bracket for `casterId` (undefined: no caster, budget tier 0).
 *  Always pair with exitPaladinCast in a finally. */
export function enterPaladinCast(casterId: number | undefined): void {
  if (depth < MAX_DEPTH) {
    castCasters[depth] = casterId ?? Number.NaN;
    castResolved[depth] = null;
  }
  depth++;
}

export function exitPaladinCast(): void {
  if (depth > 0) depth--;
}

/** Run `dispatch` with every Paladin spawn inside it at `castTier` (tests and
 *  callers that already know the tier). */
export function withPaladinCastDetail<T>(castTier: 0 | 1 | 2, dispatch: () => T): T {
  enterPaladinCast(undefined);
  if (depth <= MAX_DEPTH)
    castResolved[depth - 1] = paladinVfxDetail({
      effectsTier: GFX.effectsTier,
      quality,
      castTier,
    });
  try {
    return dispatch();
  } finally {
    exitPaladinCast();
  }
}

/** Tests: pin the detail every spawn sees (null restores the live rule). */
export function setPaladinVfxDetailForTest(detail: PaladinVfxDetail | null): void {
  testDetail = detail;
}
