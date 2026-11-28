import type { SimEvent } from '../sim/types';

/**
 * Presentation-only school for Blightcaller's rot green. The sim keeps these
 * spells in the shadow school (resistances, procs, combat text); only their
 * school-coloured effects swap to `SCHOOL_COLORS.blight`, so every other
 * shadow spell keeps its purple.
 */
export const BLIGHTCRAFT_FX_SCHOOL = 'blight';

/** Presentation-only school for Veinleech's blood red (`SCHOOL_COLORS.leech`). */
export const VEINLEECH_FX_SCHOOL = 'leech';
const VEINLEECH_ID = 'siphon_life';

/**
 * Every spell only Blightcaller (spec id `affliction`) can cast. Pinned against
 * the class table in tests/blightcraft_fx.test.ts, so a new Blightcaller spell
 * has to join (or opt out) here.
 */
export const BLIGHTCRAFT_FX_ABILITIES: ReadonlySet<string> = new Set([
  'corruption',
  'coven',
  'cruel_pact',
  'curse_of_agony',
  'cursed_accomplice',
  'evil_eye',
  'hex_of_violence',
  'hour_of_judgment',
  'litany_of_guilt',
  'maledict_gaze',
  'needle_of_fate',
  'plague_bloom',
  'possess_evil_eye',
  'sentence',
  // Blightcaller's, but drawn blood red rather than green (VEINLEECH_FX_SCHOOL).
  'siphon_life',
  'vicarious_suffering',
]);

/** The school a Blightcaller spell's effects are coloured by. */
export function blightcraftFxSchool(abilityId: string | undefined, school: string): string {
  if (school !== 'shadow' || abilityId === undefined) return school;
  // Veinleech drinks blood: its effects are red, not rot green.
  if (abilityId === VEINLEECH_ID) return VEINLEECH_FX_SCHOOL;
  return BLIGHTCRAFT_FX_ABILITIES.has(abilityId) ? BLIGHTCRAFT_FX_SCHOOL : school;
}

interface FxAura {
  id: string;
  sourceId: number;
}

/**
 * A Blightcaller spell's effect cue with its school swapped to the rot green.
 * Every other event comes back as the same object.
 *
 * A periodic damage tick names no ability, so it counts as Blightcaller's when
 * its caster has a Blightcaller spell's aura (Festerhex, Blackrot) on the target.
 */
export function blightcraftFxEvent(
  ev: SimEvent,
  aurasOf?: (entityId: number) => readonly FxAura[] | undefined,
): SimEvent {
  if (ev.type !== 'spellfx' && ev.type !== 'spellfxAt') return ev;
  let school = blightcraftFxSchool(ev.ability, ev.school);
  // A DoT tick names the aura that ticked; colour it by that DoT.
  if (school === ev.school && ev.type === 'spellfx' && ev.fx === 'tick' && ev.dot) {
    school = blightcraftFxSchool(ev.dot, ev.school);
  }
  if (
    school === ev.school &&
    ev.type === 'spellfx' &&
    ev.fx === 'tick' &&
    ev.school === 'shadow' &&
    ev.ability === undefined &&
    ev.dot === undefined &&
    aurasOf?.(ev.targetId)?.some(
      (aura) => aura.sourceId === ev.sourceId && BLIGHTCRAFT_FX_ABILITIES.has(aura.id),
    )
  ) {
    school = BLIGHTCRAFT_FX_SCHOOL;
  }
  return school === ev.school ? ev : { ...ev, school };
}
