// Tab target cycling order.
//
// Classic-style Tab targeting should cycle the enemies a player can actually
// see and fight, not the nearest blip anywhere in radius. The sim has no
// camera (the same code runs on the authoritative server and headless), so
// "on screen" is modelled deterministically from the player's facing: the
// forward vector is (sin(facing), cos(facing)) (see player movement in
// sim.ts), and a target counts as on screen when it falls inside a front cone
// around that vector: 45 degrees each side, a 90 degree field, at every
// distance (tabConeHalfAt). "In combat with you" is supplied by the caller from
// sim aggro state. Candidates are ranked into priority tiers so engaged,
// on-screen enemies cycle first, while off-screen ones stay reachable as a last
// resort instead of stealing the selection. Within a tier the player's Tab
// priority setting (TabPriority) picks the order: nearest first (the default)
// or most in front first. Remaining ties break by distance then id, so the
// order is stable and replay-deterministic.
//
// Idle mobs beyond the idle radius are excluded from Tab entirely. That radius
// follows the player's longest enemy-targeted ability (tabIdleRadiusFor), so a
// caster can Tab any idle mob a 30 yard spell reaches, never less than
// TAB_NEAR_RADIUS and never past TAB_QUERY_RADIUS. Engaged mobs and hostile
// players remain eligible within TAB_QUERY_RADIUS. Eligible enemies are split
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

// The "on screen" cone: 45 deg each side (a 90 deg field) at every distance.
// It used to flare to 60 deg each side by 30 yd, which let a mob far off to the
// side at range count as "in front" and cut into the cycle ahead of the one
// the player faced. The lerp below is kept so the shape can be flared again by
// editing the two endpoints: the half-angle grows linearly from
// TAB_CONE_HALF_NEAR at the player to TAB_CONE_HALF_FAR at TAB_CONE_FLARE_RADIUS,
// then clamps.
export const TAB_CONE_HALF_NEAR = (45 * Math.PI) / 180;
export const TAB_CONE_HALF_FAR = (45 * Math.PI) / 180;
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

// The FLOOR (yards) of the idle-mob Tab radius: a player whose attacks are all
// melee (or shorter than this) still cycles idle mobs out to here. The actual
// radius follows the player's longest enemy-targeted ability
// (tabIdleRadiusFor). Engaged mobs and hostile players remain eligible anywhere
// in the wider query range. Off-screen eligible enemies stay in the fallback
// band. This is separate from the cone flare span so distance tuning does not
// silently change facing behavior.
export const TAB_NEAR_RADIUS = 20;

// Radius (yards) of the enemy query that feeds Tab targeting: enemies beyond it
// are not candidates at all (not even fallback). Engaged enemies join the
// cluster anywhere inside this range (within the cone); idle mobs are further
// limited by TAB_NEAR_RADIUS. Used by Sim.enemyCandidates and the debug overlay.
export const TAB_QUERY_RADIUS = 40;

export const TAB_ENGAGED_MELEE_RADIUS = MELEE_RANGE;

/** Idle-mob Tab radius for a player whose longest enemy-targeted ability
 *  reaches `longestAttackRange` yards: "if you can hit it, Tab finds it".
 *  Clamped to [TAB_NEAR_RADIUS, TAB_QUERY_RADIUS], so a melee kit keeps the
 *  20 yd floor and nothing reaches past the enemy query. */
export function tabIdleRadiusFor(longestAttackRange: number): number {
  const r = Number.isFinite(longestAttackRange) ? longestAttackRange : 0;
  return Math.min(TAB_QUERY_RADIUS, Math.max(TAB_NEAR_RADIUS, r));
}

/** Order inside a priority tier (the player's Tab priority setting):
 *  'nearest' cycles the closest enemy first (the default); 'facing' cycles the
 *  enemy closest to straight ahead first, distance breaking angle ties. */
export type TabPriority = 'nearest' | 'facing';

export function isTabPriority(value: unknown): value is TabPriority {
  return value === 'nearest' || value === 'facing';
}

// Angle (radians, 0..PI) between the facing vector and the direction to the
// target. A target on top of the player has no direction and reads as dead
// ahead.
function angleOffFacing(c: TabCandidate, facing: number): number {
  if (c.d <= 1e-6) return 0;
  const cos = (Math.sin(facing) * c.dx + Math.cos(facing) * c.dz) / c.d;
  return Math.acos(Math.min(1, Math.max(-1, cos)));
}

function onScreen(c: TabCandidate, facing: number): boolean {
  // A target on top of the player has no meaningful direction; treat as visible.
  if (c.d <= 1e-6) return true;
  const fx = Math.sin(facing);
  const fz = Math.cos(facing);
  // Cosine of the angle between facing and the direction to the target, tested
  // against the cone's half-angle at this distance.
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
// cluster (the wrapped prefix) and the off-screen fallback band. `nearRadius`
// is the idle-mob radius (tabIdleRadiusFor); `priority` orders each tier.
export function orderTabTargets(
  candidates: TabCandidate[],
  facing: number,
  nearRadius: number = TAB_NEAR_RADIUS,
  priority: TabPriority = 'nearest',
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
        a: priority === 'facing' ? angleOffFacing(c, facing) : 0,
        // Visibility gates the cluster: an enemy must be on screen, and then
        // either engaged, a player (distance relaxed), or within the near radius. Tab never
        // grabs an unseen mob off to the side or behind the player, even one in
        // combat with them.
        near: (vis && (c.engaged || c.isPlayer || c.d <= nearRadius)) || meleeEngaged,
      };
    })
    .sort((a, b) => a.t - b.t || a.a - b.a || a.d - b.d || a.id - b.id);
  const primary = ranked.filter((c) => c.near);
  const fallback = ranked.filter((c) => !c.near);
  return {
    ids: [...primary, ...fallback].map((c) => c.id),
    primaryCount: primary.length,
  };
}
