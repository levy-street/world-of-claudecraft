// Hourly skill events: the PURE rules (owner brief, 2026-11-12). Five small
// open-world PvP events that test the player more than the class, one per
// hour on the hour, in a fixed rotation, each on a fixed arena
// (content/skill_event_sites.ts). No ctx, no rng, no clock: the system
// (skill_events.ts) feeds in the time and the draws.

import type { SkillEventSite } from '../content/skill_event_sites';

/** Hit points in the heart events (owner brief 2026-11-12): every hit from
 *  another participant takes exactly one, heals and absorbs do nothing. */
export const SKILL_EVENT_HEARTS = 4;

/** The five events, in their fixed hourly rotation order. */
export const SKILL_EVENT_KINDS = [
  'riposte',
  'footprints',
  'tongues',
  'bankshot',
  'common_hand',
] as const;
export type SkillEventKind = (typeof SKILL_EVENT_KINDS)[number];

/** A fighter can lose at most one heart in this window, so a multi-hit
 *  attack or a damage-over-time tick never drains several hearts at once. */
export const SKILL_EVENT_HEART_GRACE_SECONDS = 0.5;

/** The events fought on hearts instead of health. Rite of Tongues deals no
 *  damage at all and The Common Hand keeps ordinary health bars. */
export const SKILL_EVENT_HEART_KINDS: ReadonlySet<SkillEventKind> = new Set([
  'riposte',
  'footprints',
  'bankshot',
]);

/** One event starts every hour, on the hour. */
export const SKILL_EVENT_PERIOD_SECONDS = 60 * 60;
/** The realm is warned, the map marks the arena and the join prompt opens this
 *  long before the start. */
export const SKILL_EVENT_WARNING_SECONDS = 5 * 60;
/** Hard cap on a running event: whatever the rule set says, it ends here. */
export const SKILL_EVENT_MAX_SECONDS = 12 * 60;
/** The arena circle: the highlighted area on the ground and the map. */
export const SKILL_EVENT_RADIUS = 25;
/** The join prompt reaches this far past the arena's edge. */
export const SKILL_EVENT_PROMPT_MARGIN = 25;
/** Without a host clock (tests, the RL env, a fresh offline session) the
 *  first event starts this long after boot, then every period after it. */
export const SKILL_EVENT_FIRST_START_SECONDS = 10 * 60;

/** Honor (owner brief): the winner, every other participant, and each player
 *  killing blow inside the event, the kill with no diminishing returns. */
export const SKILL_EVENT_WIN_HONOR = 300;
export const SKILL_EVENT_PARTICIPATION_HONOR = 100;
export const SKILL_EVENT_KILL_HONOR = 10;

/** Clear ground kept between an arena and a King of the Hill circle or a
 *  natural rift portal (owner brief 2026-11-12: they never share ground). */
export const SKILL_EVENT_HILL_GAP = 20;
/** The ground a natural rift portal is treated as occupying for that rule. */
export const SKILL_EVENT_PORTAL_RADIUS = 10;
/** A participant must spend this long inside the running arena to earn the
 *  participation award (the winner is always paid): joining and walking away
 *  earns nothing. */
export const SKILL_EVENT_MIN_PRESENCE_SECONDS = 60;

/** The kind that runs in hour `ordinal`. */
export function skillEventKindFor(ordinal: number): SkillEventKind {
  const n = SKILL_EVENT_KINDS.length;
  return SKILL_EVENT_KINDS[((ordinal % n) + n) % n];
}

/** The hour ordinal and its start (in sim seconds) of the next event that has
 *  not started yet at sim time `now`. With a host clock (`nowMs`, epoch
 *  milliseconds) the events sit on the real hour, so every realm runs the
 *  same kind at the same time; without one they count from boot. */
export function nextSkillEventStart(
  now: number,
  nowMs: number | null,
): { ordinal: number; startsAt: number } {
  if (nowMs === null) {
    const since = now - SKILL_EVENT_FIRST_START_SECONDS;
    const ordinal = since < 0 ? 0 : Math.floor(since / SKILL_EVENT_PERIOD_SECONDS) + 1;
    return {
      ordinal,
      startsAt: SKILL_EVENT_FIRST_START_SECONDS + ordinal * SKILL_EVENT_PERIOD_SECONDS,
    };
  }
  const periodMs = SKILL_EVENT_PERIOD_SECONDS * 1000;
  const ordinal = Math.floor(nowMs / periodMs) + 1;
  return { ordinal, startsAt: now + (ordinal * periodMs - nowMs) / 1000 };
}

/** Whole minutes from `now` to `at`, rounded up, never below zero. */
export function skillEventMinutesUntil(at: number, now: number): number {
  return Math.max(0, Math.ceil((at - now) / 60));
}

/** Squared-distance circle test (no sqrt on the presence pass). */
export function insideSkillEventCircle(
  site: { x: number; z: number },
  radius: number,
  px: number,
  pz: number,
): boolean {
  const dx = px - site.x;
  const dz = pz - site.z;
  return dx * dx + dz * dz <= radius * radius;
}

/** Inside the arena, or near enough to be offered the join prompt. */
export function withinSkillEventPrompt(site: { x: number; z: number }, px: number, pz: number) {
  return insideSkillEventCircle(site, SKILL_EVENT_RADIUS + SKILL_EVENT_PROMPT_MARGIN, px, pz);
}

/** Does a circle of `radius` at (x, z) (a King of the Hill circle, a rift
 *  portal) come too close to any arena? The hill's and the rift portal's spot
 *  pickers refuse such a spot, so they never share ground with an event,
 *  whenever each happens to run. */
export function spotTouchesSkillArena(
  sites: readonly { x: number; z: number }[],
  x: number,
  z: number,
  radius: number,
): boolean {
  const reach = radius + SKILL_EVENT_RADIUS + SKILL_EVENT_HILL_GAP;
  for (const site of sites) {
    const dx = site.x - x;
    const dz = site.z - z;
    if (dx * dx + dz * dz < reach * reach) return true;
  }
  return false;
}

/** The arenas an event may use: never one in the zone of an announced or
 *  standing hill (`hillZoneId`, null: no hill), so a player never has to
 *  choose between two fights in one zone, and never one a live rift portal
 *  stands near. Falls back past the hill rule (never past the portal rule)
 *  when that would leave none. */
export function skillEventSitesAvoiding(
  sites: readonly SkillEventSite[],
  hillZoneId: string | null,
  portals: readonly { x: number; z: number }[] = [],
): readonly SkillEventSite[] {
  const clearOfPortals = sites.filter((site) =>
    portals.every((p) => !spotTouchesSkillArena([site], p.x, p.z, SKILL_EVENT_PORTAL_RADIUS)),
  );
  if (hillZoneId === null) return clearOfPortals;
  const open = clearOfPortals.filter((site) => site.zoneId !== hillZoneId);
  return open.length > 0 ? open : clearOfPortals;
}

/** The honor one participant earns when the event ends: the winner's award,
 *  everyone else's participation award. Kills are paid as they happen. */
export function skillEventResultHonor(pid: number, winnerPid: number | null): number {
  return pid === winnerPid ? SKILL_EVENT_WIN_HONOR : SKILL_EVENT_PARTICIPATION_HONOR;
}
