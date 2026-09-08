import type { AbilityVfxFullSpec } from '../ability_vfx_core';
import { SIGNATURE_ABILITIES, substanceOf } from './signature_core';

export type ElementalForm =
  | 'pyre'
  | 'glacier'
  | 'thunder'
  | 'tide'
  | 'rift'
  | 'judgement'
  | 'fault'
  | 'grove';
export type ContactElement = 'fire' | 'ice' | 'water' | 'storm' | 'shadow' | 'other';
export type ElementalReaction = 'steam' | 'conduction' | 'confluence';

/** Presentation taxonomy only; these forms never author a damage volume. */
export function elementalPerformance(id: string, spec: AbilityVfxFullSpec, tier: number) {
  const hero = SIGNATURE_ABILITIES[id];
  const material = substanceOf(spec);
  const form: ElementalForm =
    hero === 'execution'
      ? 'fault'
      : spec.palette === 'storm'
        ? 'thunder'
        : material === 'fire'
          ? 'pyre'
          : material === 'ice'
            ? 'glacier'
            : material === 'water'
              ? 'tide'
              : material === 'light'
                ? 'judgement'
                : material === 'shadow' || material === 'arcane'
                  ? 'rift'
                  : material === 'nature'
                    ? 'grove'
                    : 'fault';
  const repeated = spec.filler || spec.archetype === 'dot' || spec.archetype === 'beam';
  return {
    form,
    enabled: tier < 2 && !repeated && (tier === 0 || !!hero),
    size:
      (hero ? 1.35 : spec.finisher ? 0.94 : 0.58) * Math.min(1.35, Math.max(0.65, spec.power ?? 1)),
    duration:
      form === 'glacier'
        ? 2.65
        : form === 'rift'
          ? 2.4
          : form === 'tide' || form === 'grove'
            ? 2.1
            : form === 'thunder'
              ? 0.85
              : 1.7,
    detail: tier === 0,
    element: (hero === 'execution'
      ? 'other'
      : spec.palette === 'storm'
        ? 'storm'
        : ['fire', 'ice', 'water', 'shadow'].includes(material)
          ? material
          : 'other') as ContactElement,
  };
}

export function reactionBetween(a: ContactElement, b: ContactElement): ElementalReaction | null {
  if (
    (a === 'fire' && (b === 'ice' || b === 'water')) ||
    (b === 'fire' && (a === 'ice' || a === 'water'))
  )
    return 'steam';
  if ((a === 'storm' && b === 'water') || (b === 'storm' && a === 'water')) return 'conduction';
  return a === 'shadow' && b === 'shadow' ? 'confluence' : null;
}

interface Contact {
  x: number;
  z: number;
  end: number;
  element: ContactElement;
}

/** A bounded visual memory of recent contacts. Consuming a pair prevents a
 * stationary spam stack from producing one secondary burst per frame. */
export class ElementalContactMemory {
  private readonly contacts: Contact[] = Array.from({ length: 24 }, () => ({
    x: 0,
    z: 0,
    end: 0,
    element: 'other',
  }));
  private time = 0;
  advance(dt: number): void {
    if (Number.isFinite(dt)) this.time += Math.max(0, dt);
  }
  touch(x: number, z: number, element: ContactElement): ElementalReaction | null {
    if (![x, z].every(Number.isFinite) || element === 'other') return null;
    let free = this.contacts[0];
    for (const contact of this.contacts) {
      if (contact.end < free.end) free = contact;
      if (contact.end <= this.time || Math.hypot(contact.x - x, contact.z - z) > 2.1) continue;
      const reaction = reactionBetween(contact.element, element);
      if (reaction) {
        contact.end = 0;
        return reaction;
      }
      // Refresh an existing patch instead of filling the pool at one point.
      if (contact.element === element) {
        contact.end = this.time + 3.4;
        return null;
      }
    }
    free.x = x;
    free.z = z;
    free.end = this.time + 3.4;
    free.element = element;
    return null;
  }
  clear(): void {
    for (const contact of this.contacts) contact.end = 0;
    this.time = 0;
  }
}
