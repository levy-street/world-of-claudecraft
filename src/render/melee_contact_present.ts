/** The target-side presentation of a landed melee blow (moved out of Renderer.handleEvent's
 *  damage arm so it can be held until the blade lands, contact_queue.ts): the warrior contact
 *  recoil for an ability strike, the victim's flinch and the impact spark. */
import type { SimEvent } from '../sim/types';
import type { CharacterVisual } from './characters/visual';
import { damageContact } from './impact_contact';

type DamageEvent = Extract<SimEvent, { type: 'damage' }>;

export interface MeleeContactHost {
  /** The target's live visual (null when it has none on screen). */
  targetVisual(id: number): CharacterVisual | null;
  /** The victim flinch (rate-limited inside the visual). */
  triggerHit(id: number): void;
  meleeSpark(id: number, crit: boolean): void;
  playerId(): number;
  reducedMotion(): boolean;
}

export function presentMeleeContact(
  host: MeleeContactHost,
  ev: DamageEvent,
  warrior: boolean,
): void {
  if (warrior && ev.ability) {
    damageContact(
      host.targetVisual(ev.targetId),
      ev,
      ev.sourceId === host.playerId(),
      host.reducedMotion(),
    );
  }
  // landed blows flinch the victim (rate-limited inside the visual)
  host.triggerHit(ev.targetId);
  if (ev.school === 'physical') host.meleeSpark(ev.targetId, ev.crit);
}
