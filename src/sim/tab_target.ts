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
// Idle mobs beyond TAB_NEAR_RADIUS are excluded from Tab entirely; engaged
// mobs and hostile players remain eligible within TAB_QUERY_RADIUS. Eligible enemies are split
// into a visible "fight cluster" and an off-screen fallback. Being engaged
// relaxes the distance (a mob fighting you in front at 35 yd still cycles) but
// never the facing, so an enemy off screen to the side or behind the player is
// fallback even while it is attacking you. Tab cycles and WRAPS within the
// cluster, so a DoT class can dot the nearest few mobs it can see, Tab through
// them, then Tab once more to land back on the priority target, instead of
// stepping out to an idle mob outside reach or one off to the side
// (#tab-near-cluster). An enemy actively engaged in melee with the player also
// joins the cluster, even outside the facing cone, so an immediate attacker
// cannot lose target priority to a distant idle mob. Keeping the wider off-screen
// engaged band out of the cluster still means a warrior fleeing a fight can turn
// toward a fresh mob, Tab it, and Charge away, rather than Tab snapping back to
// the enemy chasing from behind. The fallback band is reached only when the
// cluster is empty (e.g. the player has turned away from every eligible enemy).

import { MELEE_RANGE } from './types';

export interface TabCandidate {
  id: number;
  // Target position relative to the player (target.pos - player.pos), in yards.
  dx: number;
  dz: number;
  // Planar distance to the player, in yards.
  d: number;
  // True when this enemy is in combat with the player (aggroed onto / targeting them).
  engaged: boolean;
  // PvP opponents keep the full query range, including during arena countdowns.
  isPlayer?: boolean;
}

// The "on screen" cone is FLARED: its half-angle grows linearly with distance,
// from TAB_CONE_HALF_NEAR at the player to TAB_CONE_HALF_FAR at TAB_CONE_FLARE_RADIUS,
// then clamped. Up close the cone is tight (45 deg each side, a 90 deg field) so
// a mob right beside you is not treated as in front; by the flare radius it opens
// to 60 deg each side (a 120 deg field), where the same screen offset reads as
// ahead. Edit the two endpoints to retune the shape.
export const TAB_CONE_HALF_NEAR = (45 * Math.PI) / 180;
export const TAB_CONE_HALF_FAR = (60 * Math.PI) / 180;
// Keep the facing profile unchanged when tuning the idle-enemy cycle radius.
export const TAB_CONE_FLARE_RADIUS = 30;

// Half-angle (radians) of the on-screen cone at planar distance d. Lerps from
// TAB_CONE_HALF_NEAR to TAB_CONE_HALF_FAR across [0, TAB_CONE_FLARE_RADIUS], clamped
// beyond. Single source of truth: the debug overlay is fed this same function.
export function tabConeHalfAt(d: number): number {
  const span = TAB_CONE_FLARE_RADIUS;
  const t = span > 0 ? Math.min(1, Math.max(0, d / span)) : 1;
  return TAB_CONE_HALF_NEAR + (TAB_CONE_HALF_FAR - TAB_CONE_HALF_NEAR) * t;
}

// Radius (yards) for idle mobs to be eligible for Tab. Engaged mobs and hostile
// players remain eligible anywhere in the wider query range. Off-screen eligible
// enemies stay in the fallback band. This is separate from the cone flare span
// so distance tuning does not silently change facing behavior.
export const TAB_NEAR_RADIUS = 20;

// Radius (yards) of the enemy query that feeds Tab targeting: enemies beyond it
// are not candidates at all (not even fallback). Engaged enemies join the
// cluster anywhere inside this range (within the cone); idle mobs are further
// limited by TAB_NEAR_RADIUS. Used by Sim.enemyCandidates and the debug overlay.
export const TAB_QUERY_RADIUS = 40;

export const TAB_ENGAGED_MELEE_RADIUS = MELEE_RANGE;

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
function tier(engaged: boolean, vis: boolean, meleeEngaged: boolean): number {
  if (engaged && (vis || meleeEngaged)) return 0;
  if (vis) return 1;
  if (engaged) return 2;
  return 3;
}

export interface TabOrder {
  // Candidate ids in cycle order: the visible fight cluster first, then the
  // off-screen fallback band, each ordered by tier, distance, then id.
  ids: number[];
  // Count of leading ids that form the near cluster. Tab wraps within this
  // prefix; ids at or past it are the fallback, reached only when the cluster is
  // empty (see the cycle logic in Targeting.cycleEnemyTarget).
  primaryCount: number;
}

// Direction of one cycle step: +1 is Tab (next target), -1 is Shift+Tab
// (previous target).
export type TabStep = 1 | -1;

// The index step a Tab press takes over an ordered candidate list. Both binds
// share it, so backward mirrors forward WITHIN the near cluster: there, stepping
// forward and then back lands on the enemy you started from, which is where
// every ordinary cycle happens. It is deliberately NOT an inverse at the
// cluster/fallback boundary: forward out of the cluster head wraps to ids[0] and
// backward out of it wraps to the cluster TAIL, so neither direction can leave
// the cluster once inside it. That forward wrap is load-bearing (it is what
// keeps Tab off an off-screen enemy) and must not be "repaired" into a symmetric
// step: doing so changes tabTarget's result and forks the parity draw order.
// `curIdx` is the current target's index in `order.ids`, or -1 when the player
// has no (or no longer valid) target; the caller guarantees a non-empty list.
export function stepTabTarget(order: TabOrder, curIdx: number, step: TabStep): number {
  const { ids, primaryCount } = order;
  // No (or no longer valid) target: grab the priority enemy, cluster first, in
  // either direction.
  if (curIdx === -1) return ids[0];
  // Cycling the visible fight cluster: wrap back inside it instead of stepping
  // out to an off-screen enemy still in range.
  if (curIdx < primaryCount) return ids[(curIdx + step + primaryCount) % primaryCount];
  // Sitting on an off-screen fallback target: walk the rest of the fallback, then
  // wrap back into the near cluster (at its first id going forward, its last
  // going backward).
  const next = curIdx + step;
  if (next >= ids.length) return ids[0];
  if (next < 0) return ids[ids.length - 1];
  return ids[next];
}

// Return eligible candidate ids in cycle order, split into the visible fight
// cluster (the wrapped prefix) and the off-screen fallback band.
export function orderTabTargets(
  candidates: TabCandidate[],
  facing: number,
  nearRadius: number = TAB_NEAR_RADIUS,
): TabOrder {
  const ranked = candidates
    .filter((c) => c.engaged || c.isPlayer || c.d <= nearRadius)
    .map((c) => {
      const vis = onScreen(c, facing);
      const meleeEngaged = c.engaged && c.d <= TAB_ENGAGED_MELEE_RADIUS;
      return {
        id: c.id,
        t: tier(c.engaged, vis, meleeEngaged),
        d: c.d,
        // Visibility gates the cluster: an enemy must be on screen, and then
        // either engaged, a player (distance relaxed), or within the near radius. Tab never
        // grabs an unseen mob off to the side or behind the player, even one in
        // combat with them.
        near: (vis && (c.engaged || c.isPlayer || c.d <= nearRadius)) || meleeEngaged,
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
