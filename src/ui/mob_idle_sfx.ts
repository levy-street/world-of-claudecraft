import { MOBS } from '../sim/data';
import type { Entity, Vec3 } from '../sim/types';
import { dist2d } from '../sim/types';
import { mobVoiceFamily, shouldPlayMobVoiceSfxForEntity } from './combat_sfx';

// Idle mob-voice bark trigger tuning. See docs/design/sound_effects.md for
// the design writeup; the short version: a shared periodic sweep (not
// per-mob-per-frame) picks which nearby mobs attempt an idle bark, damped by
// how many same-family mobs are clustered together so a pack does not all
// bark in the same sweep. MOB_IDLE_BASE_CHANCE started at 0.35 (generous, on
// the theory that the mastered idle takes are quiet even boosted) and was
// tuned down by ear in-game to 0.17, which felt right around both the wolf
// camps and the ogre war-camp.
export const MOB_IDLE_CHECK_INTERVAL_MS = 2500;
export const MOB_IDLE_SCAN_RADIUS = 40;
export const MOB_IDLE_BASE_CHANCE = 0.17;
export const MOB_IDLE_PER_ENTITY_COOLDOWN_MS = 12_000;
export const MOB_IDLE_KEY_COOLDOWN_S = 3;
export const MOB_IDLE_GAIN = 0.55;

/** Same-family cluster damping: a lone mob barks at the full base chance, a
 *  cluster of N mobs of the same family each roll at roughly 1/sqrt(N) of
 *  it, so a dense pack does not all bark in the same sweep while still
 *  sounding "populated" rather than silent. */
export function idleDensityFactor(sameFamilyCount: number): number {
  if (sameFamilyCount <= 1) return 1;
  return 1 / Math.sqrt(sameFamilyCount);
}

/** Whether `e` is even eligible to be considered for an idle bark this
 *  sweep: a living, unowned, non-dummy mob, not currently chasing/being
 *  chased (`aggroTargetId`, mirrored on both hosts and correctly cleared on
 *  leash/evade, unlike the aggro-voice-dedupe `mobAggroed` set in hud.ts,
 *  which is a different concern: idle barks defer to the reactive
 *  aggro/attack/hurt/death vocalizations, but only while combat is actually
 *  live), not muted (the Nythraxis mute list, shouldPlayMobVoiceSfxForEntity),
 *  and within earshot of the player. `ownerId === null` excludes tamed/
 *  summoned pets and delve companions (owned mob entities that stand next to
 *  you all session and would otherwise bark at point-blank range); the dummy
 *  check excludes the Training Dummy (a stationary practice target, not a
 *  living creature). Pulled out of hud.ts's sweep so the exclusion logic is
 *  testable without a running Hud/DOM. */
export function isIdleBarkCandidate(e: Entity, playerPos: Vec3): boolean {
  return (
    e.kind === 'mob' &&
    !e.dead &&
    e.ownerId === null &&
    !MOBS[e.templateId]?.dummy &&
    e.aggroTargetId === null &&
    shouldPlayMobVoiceSfxForEntity(e) &&
    dist2d(playerPos, e.pos) <= MOB_IDLE_SCAN_RADIUS
  );
}

export interface IdleBarkCandidate {
  id: number;
  templateId: string;
  x: number;
  y: number;
  z: number;
}

/** Pure selection: which of `candidates` (already filtered by the caller to
 *  non-combat, in-range, non-muted, alive mobs) should attempt an idle bark
 *  this sweep. Deliberately does NOT stamp `lastBarkAt`: a mob that rolls a
 *  bark but loses the shared per-key playback cooldown to another mob of the
 *  same cue (see sfx.playAt's own `cooldown` option, the backstop against
 *  two mobs barking the identical clip in the same instant) must get another
 *  chance next sweep rather than being silently benched for
 *  MOB_IDLE_PER_ENTITY_COOLDOWN_MS for a bark that never actually played.
 *  The caller stamps `lastBarkAt` itself, only when `sfx.playAt` returns
 *  true. */
export function pickIdleBarkCandidates(
  candidates: readonly IdleBarkCandidate[],
  now: number,
  lastBarkAt: ReadonlyMap<number, number>,
  rng: () => number,
): IdleBarkCandidate[] {
  const familyCounts = new Map<string, number>();
  for (const c of candidates) {
    const family = mobVoiceFamily(c.templateId);
    if (!family) continue;
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
  }

  const picked: IdleBarkCandidate[] = [];
  for (const c of candidates) {
    const family = mobVoiceFamily(c.templateId);
    if (!family) continue;
    const last = lastBarkAt.get(c.id);
    if (last !== undefined && now - last < MOB_IDLE_PER_ENTITY_COOLDOWN_MS) continue;
    const chance = MOB_IDLE_BASE_CHANCE * idleDensityFactor(familyCounts.get(family) ?? 1);
    if (rng() < chance) picked.push(c);
  }
  return picked;
}
