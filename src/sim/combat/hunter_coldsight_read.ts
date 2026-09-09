// Six valid Fevered Draw pulses grant a ten-second shot choice.
// Accepted casts reserve it until completion or cancellation, without new RNG.
import type { ResolvedAbility } from '../sim';
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';

export const COLDSIGHT_READ_AURA_ID = 'hunter_coldsight_read';
export const COLDSIGHT_READ_DURATION_SEC = 10;
export const COLDSIGHT_READ_LONG_DRAW_MULT = 1.5; // aimed_shot ("Long Draw")
export const COLDSIGHT_READ_FELL_SHOT_MULT = 1.75; // arcane_shot ("Fell Shot")

export const FEVERED_DRAW_ABILITY_ID = 'rapid_fire';
export const FEVERED_DRAW_PULSE_COUNT = 6; // rapid_fire's authored channel.ticks
const FEVERED_DRAW_PROGRESS_AURA_ID = 'hunter_coldsight_fevered_draw_progress';

// Not player-visible and never meant to expire on its own: only an explicit
// consume (completion or interrupt) removes it. Mirrors the LONG_STATE_DURATION
// precedent in hunter_shared.ts for state that must survive until its own
// consumer clears it, rather than a ticking window that could race a
// legitimately in-flight cast.
const RESERVATION_TIMEOUT_SEC = 86_400;

const COLDSIGHT_READ_MULT_BY_ABILITY: Record<string, number> = {
  aimed_shot: COLDSIGHT_READ_LONG_DRAW_MULT,
  arcane_shot: COLDSIGHT_READ_FELL_SHOT_MULT,
};

function reservedAuraIdFor(abilityId: string): string | null {
  return abilityId in COLDSIGHT_READ_MULT_BY_ABILITY
    ? `hunter_coldsight_read_reserved_${abilityId}`
    : null;
}

// The three internal bookkeeping markers this module rides on `kind:
// 'internal_cd'` with the 86400s RESERVATION_TIMEOUT_SEC (the progress
// counter plus the two per-ability reserved-cast markers): never player-
// visible, since none of them describe a real cooldown or a real ten-second
// opportunity window. Deliberately exact-id, not "every internal_cd": the
// actual armed COLDSIGHT_READ_AURA_ID (10s, a genuine buff) is excluded on
// purpose, and every OTHER internal_cd marker (Heating Up, Stormsurge Ready,
// ...) is untouched. Consumed by src/ui/auras_view.ts at the aura strip fill
// seam so the buff bar/target/focus frames never render these as misleading
// 1-day buffs with an "Internal Cooldown" tooltip.
const COLDSIGHT_INTERNAL_MARKER_IDS: ReadonlySet<string> = new Set([
  FEVERED_DRAW_PROGRESS_AURA_ID,
  ...Object.keys(COLDSIGHT_READ_MULT_BY_ABILITY).map((id) => reservedAuraIdFor(id) as string),
]);

/** Pure exact-id check: is `auraId` one of the three Coldsight Read internal
 *  markers above? Used by the aura view fill seam, never a broad
 *  `kind === 'internal_cd'` hide. */
export function isColdsightInternalMarkerAuraId(auraId: string): boolean {
  return COLDSIGHT_INTERNAL_MARKER_IDS.has(auraId);
}

function isMarksmanshipHunter(ctx: SimContext, hunter: Entity): boolean {
  if (hunter.kind !== 'player') return false;
  const meta = ctx.players.get(hunter.id);
  return meta?.cls === 'hunter' && ctx.playerMods(meta).spec === 'marksmanship';
}

function removeAuraById(ctx: SimContext, entity: Entity, id: string): void {
  const index = entity.auras.findIndex((aura) => aura.id === id);
  if (index < 0) return;
  const [aura] = entity.auras.splice(index, 1);
  ctx.emit({ type: 'aura', targetId: entity.id, name: aura.name, gained: false });
}

// The three internal markers never emit: apply/remove them by direct
// entity.auras mutation instead of ctx.applyAura/removeAuraById, so the real
// armed COLDSIGHT_READ_AURA_ID (which keeps using the emitting helpers above)
// is the only Coldsight event a player ever sees.
function upsertMarkerSilently(entity: Entity, aura: Aura): void {
  const index = entity.auras.findIndex((existing) => existing.id === aura.id);
  if (index >= 0) entity.auras.splice(index, 1);
  entity.auras.push(aura);
}

function removeMarkerSilently(entity: Entity, id: string): void {
  const index = entity.auras.findIndex((aura) => aura.id === id);
  if (index >= 0) entity.auras.splice(index, 1);
}

// Channel start (castAbility's `ability.channel` branch): resets the pulse
// counter so a fresh Fevered Draw always starts from zero.
export function coldsightFeveredDrawChannelStart(
  ctx: SimContext,
  hunter: Entity,
  abilityId: string,
): void {
  if (abilityId !== FEVERED_DRAW_ABILITY_ID) return;
  if (!isMarksmanshipHunter(ctx, hunter)) return;
  upsertMarkerSilently(hunter, {
    id: FEVERED_DRAW_PROGRESS_AURA_ID,
    name: 'Fevered Draw',
    kind: 'internal_cd',
    remaining: RESERVATION_TIMEOUT_SEC,
    duration: RESERVATION_TIMEOUT_SEC,
    value: 0,
    sourceId: hunter.id,
    school: 'physical',
  });
}

// Every REAL fired pulse (updateCasting's fireChannelTick, both the per-tick
// path and the completion-time flush): increments the counter tracking. A
// pushback-shortened channel fires fewer real pulses, so the counter falls
// short and coldsightFeveredDrawCompleted below refuses to grant.
export function coldsightFeveredDrawPulse(
  _ctx: SimContext,
  hunter: Entity,
  abilityId: string,
): void {
  if (abilityId !== FEVERED_DRAW_ABILITY_ID) return;
  const aura = hunter.auras.find((a) => a.id === FEVERED_DRAW_PROGRESS_AURA_ID);
  if (aura) aura.value += 1;
}

// Natural channel completion only (updateCasting's fixed-count flush, never
// cancelCast): grants the opportunity if, and only if, every pulse fired and
// the target is still alive. A target dying mid-channel already cancels the
// cast before this point (applyChannelTick's dead-target guard), so this is
// a defensive re-check, not the only guard.
export function coldsightFeveredDrawCompleted(
  ctx: SimContext,
  hunter: Entity,
  completedAbilityId: string | null,
  target: Entity | null,
): void {
  const progress = hunter.auras.find((a) => a.id === FEVERED_DRAW_PROGRESS_AURA_ID);
  if (progress) removeMarkerSilently(hunter, FEVERED_DRAW_PROGRESS_AURA_ID);
  if (completedAbilityId !== FEVERED_DRAW_ABILITY_ID) return;
  if ((progress?.value ?? 0) < FEVERED_DRAW_PULSE_COUNT) return;
  if (!target || target.dead) return;
  if (!isMarksmanshipHunter(ctx, hunter)) return;
  ctx.applyAura(hunter, {
    id: COLDSIGHT_READ_AURA_ID,
    name: 'Coldsight Read',
    kind: 'hunter_coldsight_read',
    remaining: COLDSIGHT_READ_DURATION_SEC,
    duration: COLDSIGHT_READ_DURATION_SEC,
    value: 0,
    sourceId: hunter.id,
    school: 'physical',
  });
}

// Pure read: is the opportunity currently armed (not yet reserved)?
export function coldsightReadArmed(hunter: Entity): boolean {
  return hunter.auras.some((aura) => aura.id === COLDSIGHT_READ_AURA_ID);
}

// Cast accept (castAbility, after every validation/cost gate has passed):
// swaps the armed aura for a reservation tied to THIS specific ability, so a
// same-tick second cast of the OTHER eligible ability cannot steal it and
// consumeColdsightReadReservation below cannot apply the wrong multiplier.
// A rejected cast never reaches this call, so it never consumes anything.
export function coldsightReserveRead(ctx: SimContext, hunter: Entity, abilityId: string): void {
  const reservedId = reservedAuraIdFor(abilityId);
  if (!reservedId) return;
  if (!coldsightReadArmed(hunter)) return;
  removeAuraById(ctx, hunter, COLDSIGHT_READ_AURA_ID); // the real buff being spent: stays visible
  upsertMarkerSilently(hunter, {
    id: reservedId,
    name: 'Coldsight Read',
    kind: 'internal_cd',
    remaining: RESERVATION_TIMEOUT_SEC,
    duration: RESERVATION_TIMEOUT_SEC,
    value: COLDSIGHT_READ_MULT_BY_ABILITY[abilityId],
    sourceId: hunter.id,
    school: 'physical',
  });
}

// cancelCast: an accepted cast that is later interrupted has already spent
// the opportunity (reserved above); this only clears the now-dead marker so
// it can never resurface for a later, unrelated cast.
export function coldsightVoidReservationOnCancel(
  _ctx: SimContext,
  hunter: Entity,
  cancelledAbilityId: string | null,
): void {
  if (cancelledAbilityId === FEVERED_DRAW_ABILITY_ID) {
    removeMarkerSilently(hunter, FEVERED_DRAW_PROGRESS_AURA_ID);
  }
  const reservedId = cancelledAbilityId ? reservedAuraIdFor(cancelledAbilityId) : null;
  if (reservedId) removeMarkerSilently(hunter, reservedId);
}

// applyAbility, alongside `res = consumeOverload(ctx, p, res);`: bakes the
// reserved multiplier as a directDamage `damageMult` rider (composed with any
// existing damageMult), so it lands on the COMPLETE hit (base + AP, applied
// before crit in effect_dispatch's directDamage case) rather than only the
// authored min/max roll. No extra damage packet, no second proc trigger:
// onHunterPrimaryDamage and any fractional echo it grants see one already
// enlarged hit, exactly like every other pre-baked modifier.
export function consumeColdsightReadReservation(
  _ctx: SimContext,
  hunter: Entity,
  res: ResolvedAbility,
): ResolvedAbility {
  const reservedId = reservedAuraIdFor(res.def.id);
  if (!reservedId) return res;
  const aura = hunter.auras.find((a) => a.id === reservedId);
  if (!aura) return res;
  const mult = aura.value || 1;
  removeMarkerSilently(hunter, reservedId);
  if (mult === 1) return res;
  return {
    ...res,
    effects: res.effects.map((eff) =>
      eff.type === 'directDamage' ? { ...eff, damageMult: (eff.damageMult ?? 1) * mult } : eff,
    ),
  };
}

// Respec choke point (progression/talents.ts recomputeTalents), mirroring
// cleanRogueEngineState/cleanDruidEngineState: leaving marksmanship drops every Coldsight Read marker outright. Death already
// clears all of these generically (resurrection.ts aurasSurvivingDeath).
export function cleanColdsightReadState(ctx: SimContext, hunter: Entity): void {
  for (let index = hunter.auras.length - 1; index >= 0; index--) {
    const aura = hunter.auras[index];
    if (aura.sourceId !== hunter.id) continue;
    if (aura.id === COLDSIGHT_READ_AURA_ID) {
      // The real armed buff: a respec losing it is a genuine expiry, not a
      // marker leak, so it keeps the fade a player would expect to see.
      hunter.auras.splice(index, 1);
      ctx.emit({ type: 'aura', targetId: hunter.id, name: aura.name, gained: false });
    } else if (isColdsightInternalMarkerAuraId(aura.id)) {
      hunter.auras.splice(index, 1);
    }
  }
}
