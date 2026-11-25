import { VALKYR_LAND, valkyrFlightElapsed, valkyrVanished } from './paladin_valkyrs_calling_core';

/** The Paladin effects that follow live entity state rather than one event. */
export interface PaladinPresenceFx {
  recallTheFallenChannel(caster: number, target: number | null, progress: number): void;
  mendingLightChannel(caster: number, progress: number): void;
  recallTheFallenListening(): boolean;
  recallTheFallenWatch(id: number, dead: boolean): void;
  solarStepSprint(id: number, steadfast: boolean): void;
  hushbrandHold(target: number, left: number): void;
  wardOfFaithHold(id: number, value: number, remaining: number): void;
  sunderingGavelHold(target: number): void;
  /** The reworked Paladin kit's channels and held auras (paladin_kit.ts). */
  paladinKitPresence?(e: PaladinPresenceEntity): void;
  /** Whether a Valkyr's Calling flight still holds (a cancelled one never lands). */
  valkyrsCallingFlying?(id: number, flying: boolean): void;
}

export interface PaladinPresenceEntity {
  id: number;
  /** The class template: a Paladin is always fed (its casts, its flight). */
  templateId?: string;
  dead: boolean;
  castingAbility: string | null;
  castRemaining: number;
  castTotal: number;
  castTargetId: number | null;
  valkyrsCalling?: { elapsed: number } | null;
  auras: ReadonlyArray<{
    id: string;
    kind: string;
    remaining: number;
    duration: number;
    value?: number;
  }>;
}

/**
 * Once per entity per frame, from the renderer's entity pass. Feeds:
 * - Mending Light: light gathers in the hands through the cast;
 * - Recall the Fallen: the rite follows the live cast, and while a recalled
 *   player may still return, deaths are reported so the return is greeted;
 * - Solar Step: the sprint aura, and Steadfast Step's slow immunity riding on it;
 * - Hushbrand: the lockout aura and the share of it still to run;
 * - Ward of Faith: the absorb left, which its shield plates show;
 * - Sundering Gavel: the stun, which its shackles hold;
 * - the reworked kit (paladin_kit.ts): its channels and held auras.
 * Returns seconds into a Valkyr's Calling flight (null when not flying), which
 * the wings and the body pose read.
 */
export function drivePaladinPresence(
  fx: PaladinPresenceFx,
  e: PaladinPresenceEntity,
  visuallyDead: boolean,
): number | null {
  if (e.castingAbility === 'recall_the_fallen' && e.castTotal > 0)
    fx.recallTheFallenChannel(e.id, e.castTargetId, 1 - e.castRemaining / e.castTotal);
  // Mending Light: light gathers in the hands through the cast.
  if (e.castingAbility === 'holy_light' && e.castTotal > 0)
    fx.mendingLightChannel(e.id, 1 - e.castRemaining / e.castTotal);
  if (fx.recallTheFallenListening()) fx.recallTheFallenWatch(e.id, visuallyDead);
  fx.paladinKitPresence?.(e);
  let solarStep = false,
    steadfast = false,
    hushLeft = -1,
    ward: PaladinPresenceEntity['auras'][number] | null = null,
    gavelStun = false;
  for (const a of e.auras) {
    if (a.id === 'divine_protection' && a.kind === 'absorb') ward = a;
    else if (a.id === 'hammer_of_justice_stun' && a.remaining > 0) gavelStun = true;
    else if (a.id === 'hushbrand_lockout' && a.remaining > 0)
      hushLeft = a.duration > 0 ? a.remaining / a.duration : 1;
    else if (a.id.startsWith('solar_step')) {
      if (a.kind === 'buff_speed') solarStep = true;
      else if (a.kind === 'slow_immunity') steadfast = true;
    }
  }
  if (!e.dead) {
    if (solarStep) fx.solarStepSprint(e.id, steadfast);
    if (hushLeft >= 0) fx.hushbrandHold(e.id, hushLeft);
    if (ward) fx.wardOfFaithHold(e.id, ward.value ?? 0, ward.remaining);
    if (gavelStun) fx.sunderingGavelHold(e.id);
  }
  const flight = valkyrFlightElapsed(e);
  fx.valkyrsCallingFlying?.(e.id, flight !== null && !e.dead);
  return flight;
}

/**
 * Whether one of an entity's auras may be a Paladin's: a holy aura, or one a
 * Paladin put on it (its physical strikes leave marks too). Read inside the
 * renderer's one aura pass per entity, so the presence pass below can skip
 * every body no Paladin has touched without a pass of its own.
 */
export function paladinSourcedAura(
  aura: { school: string; sourceId: number },
  entities: ReadonlyMap<number, { templateId: string }>,
): boolean {
  return aura.school === 'holy' || entities.get(aura.sourceId)?.templateId === 'paladin';
}

/** Bodies fed last frame beyond this many are forgotten at once (despawned
 * while touched): the cost of the miss is one cleanup pass, never a draw. */
const FED_CAP = 2048;

/**
 * drivePaladinPresence for the bodies that need it: a Paladin, or a body
 * wearing a Paladin's aura (`touched`, from paladinSourcedAura), plus one more
 * frame for a body that was fed last frame, so a held effect sees its aura go.
 * Everyone else costs a Set lookup, and the Recall the Fallen death watch,
 * which listens to every body while it runs.
 */
export class PaladinPresenceDriver {
  private readonly fed = new Set<number>();

  drive(
    fx: PaladinPresenceFx,
    e: PaladinPresenceEntity,
    visuallyDead: boolean,
    touched: boolean,
  ): number | null {
    if (touched || e.templateId === 'paladin') {
      if (this.fed.size >= FED_CAP && !this.fed.has(e.id)) this.fed.clear();
      this.fed.add(e.id);
    } else if (!this.fed.delete(e.id)) {
      if (fx.recallTheFallenListening()) fx.recallTheFallenWatch(e.id, visuallyDead);
      return null;
    }
    return drivePaladinPresence(fx, e, visuallyDead);
  }
}

export interface ValkyrFlightBody {
  root: { visible: boolean };
  setValkyrFlight(elapsed: number | null, landAt: number): void;
}

/**
 * Valkyr's Calling on the body: the Paladin is gone into the light between the
 * top of the climb and the return over the target (weapon, shadow and all), and
 * the pose layer brandishes the weapon and plays the slam on landing. Call it
 * after the form pass has set the rig's visibility for the frame.
 */
export function holdValkyrFlight(body: ValkyrFlightBody, elapsed: number | null): void {
  if (valkyrVanished(elapsed)) body.root.visible = false;
  body.setValkyrFlight(elapsed, VALKYR_LAND);
}
