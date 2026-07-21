// Tab target cycling order.
//
// Classic-style Tab targeting should cycle the enemies a player can actually
// see and fight, not the nearest blip anywhere in radius. The sim has no
// camera (the same code runs on the authoritative server and headless), so
// "on screen" is modelled deterministically from the player's facing: the
// forward vector is (sin(facing), cos(facing)) (see player movement in
// sim.ts), and a target counts as on screen when it falls inside a FLARED front
// cone around that vector. The cone's half-angle grows with distance
// (tabConeHalfAt): tight up close so a mob right beside you is not "in front",
// widening farther out where a small screen offset still reads as ahead. "In
// combat with you" is supplied by the caller from sim aggro state. Candidates
// are ranked into priority tiers so engaged, on-screen
// enemies cycle first, while off-screen ones stay reachable as a last resort
// instead of stealing the selection. Ties break by distance then id, so the
// order is stable and replay-deterministic.
//
// On top of the tier order, candidates are split into two bands: a near "fight
// cluster" and a distant fallback. Visibility is the master gate: an enemy joins
// the cluster only when it is ON SCREEN and (engaged with the player OR within
// TAB_NEAR_RADIUS). Being engaged relaxes the distance (a mob fighting you in
// front at 35 yd still cycles) but never the facing, so an enemy off screen to
// the side or behind the player is always fallback even while it is attacking
// you. Everything not in the cluster (idle enemies past the radius, and any
// enemy off screen) is the fallback band. Tab cycles and WRAPS within the
// cluster, so a DoT class can dot the nearest few mobs it can see, Tab through
// them, then Tab once more to land back on the priority target, instead of
// stepping out to an idle mob two screens away or one off to the side
// (#tab-near-cluster). Keeping the gate on facing also means a warrior fleeing a
// fight can turn toward a fresh mob, Tab it, and Charge away, rather than Tab
// snapping back to the enemy chasing from behind. The fallback band is reached
// only when the cluster is empty (e.g. the player has turned away from every
// enemy), so Tab never leaves the player unable to target anything.

export interface TabCandidate {
  id: number;
  // Target position relative to the player (target.pos - player.pos), in yards.
  dx: number;
  dz: number;
  // Planar distance to the player, in yards.
  d: number;
  // True when this enemy is in combat with the player (aggroed onto / targeting them).
  engaged: boolean;
}

// The "on screen" cone is FLARED: its half-angle grows linearly with distance,
// from TAB_CONE_HALF_NEAR at the player to TAB_CONE_HALF_FAR at TAB_NEAR_RADIUS,
// then clamped. Up close the cone is tight (45 deg each side, a 90 deg field) so
// a mob right beside you is not treated as in front; by the near radius it opens
// to 60 deg each side (a 120 deg field), where the same screen offset reads as
// ahead. Edit the two endpoints to retune the shape.
export const TAB_CONE_HALF_NEAR = (45 * Math.PI) / 180;
export const TAB_CONE_HALF_FAR = (60 * Math.PI) / 180;

// Half-angle (radians) of the on-screen cone at planar distance d. Lerps from
// TAB_CONE_HALF_NEAR to TAB_CONE_HALF_FAR across [0, TAB_NEAR_RADIUS], clamped
// beyond. Single source of truth: the debug overlay is fed this same function.
export function tabConeHalfAt(d: number): number {
  const span = TAB_NEAR_RADIUS;
  const t = span > 0 ? Math.min(1, Math.max(0, d / span)) : 1;
  return TAB_CONE_HALF_NEAR + (TAB_CONE_HALF_FAR - TAB_CONE_HALF_NEAR) * t;
}

// Radius (yards) of the near "fight cluster" Tab cycles and wraps within. Among
// the on-screen enemies, an idle one joins the cluster only within this radius;
// an engaged one joins from anywhere in the caller's query range (distance is
// relaxed for the fight, facing is not). Off-screen enemies are never in the
// cluster regardless of distance. Sized below the caller's ~40 yd enemy query so
// genuinely far, uninvolved mobs drop out of the Tab cycle. Tuning knob: raise
// to cycle a wider area, lower to keep Tab tighter on the immediate melee.
export const TAB_NEAR_RADIUS = 30;

// Radius (yards) of the enemy query that feeds Tab targeting: enemies beyond it
// are not candidates at all (not even fallback). Engaged enemies join the
// cluster anywhere inside this range (within the cone); idle ones only within
// TAB_NEAR_RADIUS. Used by Sim.enemyCandidates and surfaced by the debug overlay.
export const TAB_QUERY_RADIUS = 40;

function onScreen(c: TabCandidate, facing: number): boolean {
  // A target on top of the player has no meaningful direction; treat as visible.
  if (c.d <= 1e-6) return true;
  const fx = Math.sin(facing);
  const fz = Math.cos(facing);
  // Cosine of the angle between facing and the direction to the target, tested
  // against the flared cone's half-angle at this distance.
  const cos = (fx * c.dx + fz * c.dz) / c.d;
  return cos >= Math.cos(tabConeHalfAt(c.d));
}

// Lower tier = cycles first. 0: engaged and on screen, 1: on screen,
// 2: engaged but off screen, 3: neither.
function tier(engaged: boolean, vis: boolean): number {
  if (engaged && vis) return 0;
  if (vis) return 1;
  if (engaged) return 2;
  return 3;
}

export interface TabOrder {
  // Candidate ids in cycle order: the near fight cluster first, then the distant
  // fallback band, each internally ordered by tier, then distance, then id.
  ids: number[];
  // Count of leading ids that form the near cluster. Tab wraps within this
  // prefix; ids at or past it are the fallback, reached only when the cluster is
  // empty (see the cycle logic in Sim.tabTarget).
  primaryCount: number;
}

// Return candidate ids in the order Tab should cycle them, split into the near
// fight cluster (the wrapped prefix) and the distant fallback band.
export function orderTabTargets(
  candidates: TabCandidate[],
  facing: number,
  nearRadius: number = TAB_NEAR_RADIUS,
): TabOrder {
  const ranked = candidates
    .map((c) => {
      const vis = onScreen(c, facing);
      return {
        id: c.id,
        t: tier(c.engaged, vis),
        d: c.d,
        // Visibility gates the cluster: an enemy must be on screen, and then
        // either engaged (distance relaxed) or within the near radius. Tab never
        // grabs an unseen mob off to the side or behind the player, even one in
        // combat with them.
        near: vis && (c.engaged || c.d <= nearRadius),
      };
    })
    .sort((a, b) => a.t - b.t || a.d - b.d || a.id - b.id);
  const primary = ranked.filter((c) => c.near);
  const fallback = ranked.filter((c) => !c.near);
  return {
    ids: [...primary, ...fallback].map((c) => c.id),
    primaryCount: primary.length,
  };
}
