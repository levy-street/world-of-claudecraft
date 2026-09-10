// The server-owned "movement mode" mirror bits (see src/net/CLAUDE.md, Wire
// protocol): the client never re-simulates these, it only needs to know one
// is active so the local self-extrapolator stops predicting ordinary
// grounded input over it (src/game/self_motion_gate.ts). One decode site for
// the whole family, following the account_cosmetics_wire.ts /
// combat_scalar_wire.ts convention so online.ts stays a consumer.

import type { Entity } from '../sim/types';

// biome-ignore lint/suspicious/noExplicitAny: mirrors online.ts's own LooseJson wire-record idiom
export function applyMovementModeWire(e: Entity, w: any): void {
  e.riftSliding = !!w.sld; // ice-slide: render a frozen gliding pose
  e.climbing = !!w.cl;
  // Quantized 1..99 progress through the pull (see server snapshot);
  // undefined when not climbing so the visual falls back to its own clock.
  e.climbProgress = typeof w.cl === 'number' && w.cl > 0 ? w.cl / 100 : undefined;
  e.leaping = !!w.lp; // Vaulting Charge (heroic_leap): bare presence bit, same family as climbing
}
