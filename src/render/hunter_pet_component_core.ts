import { ABILITIES } from '../sim/data';

export type HunterPetComponent = 'clap' | 'cleave';
const CLAP_LABEL = `${ABILITIES.unleash_beast.name} Clap`;
export const HUNTER_CLAP_RADIUS =
  ABILITIES.unleash_beast.effects.find((effect) => effect.type === 'unleashBeast')?.radius ?? 0;

/** These damage components are secondary contacts, never another command. */
export function hunterPetComponent(label: string | null | undefined): HunterPetComponent | null {
  if (label === CLAP_LABEL) return 'clap';
  if (label === 'Frenzy Cleave') return 'cleave';
  return null;
}

/** Victims of one instantaneous clap arrive together, sometimes across a
 * display-frame boundary. The short window is below any legal repeat command. */
export class HunterClapContacts {
  private times = new Map<number, number>();
  reset(): void {
    this.times.clear();
  }
  admit(petId: number, now: number): boolean {
    const previous = this.times.get(petId);
    if (previous !== undefined && now >= previous && now - previous < 0.15) return false;
    if (!this.times.has(petId) && this.times.size >= 64) {
      const first = this.times.keys().next().value;
      if (first !== undefined) this.times.delete(first);
    }
    this.times.set(petId, now);
    return true;
  }
}
