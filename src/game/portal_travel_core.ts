// Pure core for Baldemar's portal travel: the cast-then-open state machine,
// the walk-in test, and the handoff codec that survives the page swap.
//
// The world change itself is a PAGE SWAP (the Deepglass is its own world, see
// deepglass/steward.ts), so "teleporting" decomposes into three honest parts:
//   1. presentation in the departing world (cast pose, portal prop, VFX),
//      driven by this state machine from main.ts;
//   2. a one-shot localStorage handoff (encoded here, stored by
//      portal_travel.ts) carrying who was travelling and where they left from,
//      the same one-shot-transfer shape as game/editor_playtest.ts;
//   3. the ordinary world boot on the far side, which reads the handoff to
//      keep the character's name and class, and to aim the return trip at the
//      town the player originally left.
//
// No DOM, no Three, no sim imports: main.ts owns the side effects.

export type PortalDest = 'deepglass' | 'overworld';

/** How long the wizard holds the cast before the gate opens. Matches the
 *  Spellcast_Raise arm-up plus a beat of showmanship. */
export const PORTAL_CAST_SECONDS = 1.7;

/** An unused gate closes on its own: long enough to finish reading the
 *  dialog and walk over, short enough that a wandering player does not find
 *  a forgotten portal humming in the square an hour later. */
export const PORTAL_OPEN_SECONDS = 60;

/** Walk-in radius (yards, horizontal). The disc is ~1.5 yd; requiring the
 *  player's centre inside 1.25 reads as "stepped through", not "walked past". */
export const PORTAL_ENTER_RADIUS = 1.25;

/** The gate opens this far from the wizard, off his LEFT SHOULDER rather
 *  than dead ahead: the player asking for passage is standing in front of
 *  him, and a gate conjured onto the conversation spot would swallow them
 *  the instant it opened. Beside him, stepping through stays a deliberate
 *  walk of a few yards. */
export const PORTAL_FORWARD_YARDS = 3.4;
export const PORTAL_SIDE_ANGLE = Math.PI / 2;

export interface PortalSpot {
  x: number;
  z: number;
  /** The way the portal disc faces: back at the wizard (and the player
   *  standing beside him), so the swirl is seen face-on. */
  facing: number;
}

/** Facing f points along (sin f, cos f), the sim's convention. */
export function portalSpotBeside(x: number, z: number, facing: number): PortalSpot {
  const ray = facing + PORTAL_SIDE_ANGLE;
  return {
    x: x + Math.sin(ray) * PORTAL_FORWARD_YARDS,
    z: z + Math.cos(ray) * PORTAL_FORWARD_YARDS,
    facing: ray + Math.PI,
  };
}

export interface PortalState {
  phase: 'casting' | 'open';
  /** Seconds remaining in the current phase. */
  remaining: number;
  spot: PortalSpot;
  dest: PortalDest;
  /** The town stop this round trip belongs to (portal_wizard.ts stop npcId),
   *  null when the trip started from a URL boot rather than a town. */
  originStopId: string | null;
}

export function beginPortalCast(
  spot: PortalSpot,
  dest: PortalDest,
  originStopId: string | null,
): PortalState {
  return { phase: 'casting', remaining: PORTAL_CAST_SECONDS, spot, dest, originStopId };
}

export interface PortalTickResult {
  state: PortalState | null;
  /** The cast just finished: the caller spawns the portal prop and sound. */
  justOpened: boolean;
  /** The open gate timed out: the caller removes the prop and sound. */
  expired: boolean;
}

export function tickPortal(state: PortalState, dt: number): PortalTickResult {
  const remaining = state.remaining - dt;
  if (remaining > 0) {
    return { state: { ...state, remaining }, justOpened: false, expired: false };
  }
  if (state.phase === 'casting') {
    return {
      state: { ...state, phase: 'open', remaining: PORTAL_OPEN_SECONDS },
      justOpened: true,
      expired: false,
    };
  }
  return { state: null, justOpened: false, expired: true };
}

/** True when the player's feet are inside an OPEN gate. */
export function shouldEnterPortal(state: PortalState, px: number, pz: number): boolean {
  if (state.phase !== 'open') return false;
  const dx = px - state.spot.x;
  const dz = pz - state.spot.z;
  return dx * dx + dz * dz <= PORTAL_ENTER_RADIUS * PORTAL_ENTER_RADIUS;
}

// --- the handoff ------------------------------------------------------------

export interface PortalHandoff {
  v: 1;
  /** Which world this handoff boots into. */
  dest: PortalDest;
  /** Carried so the far side boots the same character: offline characters are
   *  not persisted (a fresh name is typed each session), so without these the
   *  round trip would eat the player's identity. */
  cls: string;
  name: string;
  /** The town stop the OUTBOUND trip left from. The Deepglass self reads it to
   *  aim the way home; the overworld boot reads it to land the player back at
   *  that wizard's side. */
  originStopId: string | null;
}

export function encodePortalHandoff(handoff: PortalHandoff): string {
  return JSON.stringify(handoff);
}

/** Strict decode: anything malformed (older shape, hand-edited storage) is
 *  null, and the caller falls back to a normal boot. */
export function decodePortalHandoff(raw: string | null): PortalHandoff | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const h = parsed as Record<string, unknown>;
    if (h.v !== 1) return null;
    if (h.dest !== 'deepglass' && h.dest !== 'overworld') return null;
    if (typeof h.cls !== 'string' || h.cls === '') return null;
    if (typeof h.name !== 'string') return null;
    if (h.originStopId !== null && typeof h.originStopId !== 'string') return null;
    return {
      v: 1,
      dest: h.dest,
      cls: h.cls,
      name: h.name,
      originStopId: h.originStopId as string | null,
    };
  } catch {
    return null;
  }
}
