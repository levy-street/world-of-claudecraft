// Pet commands & lifecycle (P1b), extracted from the Sim monolith.
//
// This module owns the player-driven hunter/warlock pet command surface (abandon/
// rename/revive/attack/taunt/feed/heal/setPetMode/setPetAutoTaunt) plus the
// create/destroy/persist plumbing those commands and other systems call: the live
// pet lookup (petOf), persistence (serializePet/restorePet, including the mid-delve
// stash fallback), level scaling (syncPetLevel), taming (cleanPetName/tameError/
// completeTame), warlock summons (summonPet/createDemonPet), the two distinct
// despawn paths (despawnPersistentPet = friendly tame/summon teardown; despawnPet =
// summoned-demon hard despawn that ALSO scrubs player targets), the Demon Heal
// channel tick (applyDemonHealTick), the non-player stat-aura HP bookkeeping
// (nonPlayerAuraHp/applyNonPlayerStatAura/clearNonPlayerStatAuras, shared with the
// Sim applyAura/respawn paths), the /pet and /pettaunt readouts, and the delve
// pet-park round-trip (stowPetForDelve/restorePetFromDelveStash + the delvePetStash
// snapshot map, exposed as a live SimContext view).
//
// The pet AI per-tick brain (updatePet/petFollow/petPickTarget/petRangedAttack +
// syncPetAspect) is P1a (src/sim/pet/pet_ai.ts); it STAYS on Sim/its own module and
// is reached through the seam. This slice is the command + lifecycle half.
//
// PRIME DIRECTIVE: this is a MOVE, not a rewrite. Every function below is the former
// `Sim` method verbatim, with `this.X` rewritten to `ctx.X` (the SimContext seam) or
// to a sibling function in this module. Statement order, branch order, the
// `return`-vs-fallthrough early exits, and EVERY rng draw position are preserved
// exactly so the parity gate's full-state trace AND rng draw-order log stay
// byte-identical. The slice's only rng draws are the `ctx.retargetMob` calls inside
// the threat-scrub loops of despawnPet/despawnPersistentPet/completeTame; their
// entity-iteration order and guards are unchanged. In-place Entity mutation
// (`pet.hp = ...`, `pet.auras = pet.auras.filter(...)`, `m.threat.delete(...)`,
// `r.meta.lastActiveTick = ...`, `delvePetStash.set/delete`) is intentional under
// the refactor's immutability waiver.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts). data/entity/threat/types are imported
// directly (already pure); everything that touches not-yet-extracted Sim state
// routes through the seam.

import { DUNGEON_X_THRESHOLD, ITEMS, isDelvePos, MOBS } from '../data';
import { createMob } from '../entity';
import type { PetState } from '../sim';
import type { SimContext } from '../sim_context';
import { addThreat, clearThreat } from '../threat';
import {
  type Aura,
  DEMON_HEAL_CAST_ID,
  dist2d,
  type Entity,
  isPetClass,
  PET_GROWL_INTERVAL,
  type PetMode,
} from '../types';

// Slice-only tuning consts, moved verbatim from sim.ts with the slice.
const PET_TAUNT_RANGE = 5;
const PET_FEED_DURATION = 5;
const PET_FEED_TICK = 1;
const DEMON_HEAL_MANA_COST = 55;
const DEMON_HEAL_DURATION = 5;
const DEMON_HEAL_TICK = 1;
const TAMED_TARGET_RESPAWN_SECONDS = 60;
const PET_NAME_RE = /^[A-Za-z][A-Za-z '-]{1,15}$/;

// A live pet check fails while inside a delve even for owners with a valid
// equipped pet (it is stowed for the run, see stowPetForDelve/restorePetFromDelveStash),
// so the surfaced error must say why instead of implying the pet was lost.
function noPetError(e: Entity, fallback = 'You have no pet.'): string {
  return isDelvePos(e.pos.x) ? 'Pets are not allowed inside the delves.' : fallback;
}

// -------------------------------------------------------------------------
// Non-player stat-aura HP bookkeeping (shared: the Sim applyAura/aura-expiry +
// respawnMob paths consume applyNonPlayerStatAura/clearNonPlayerStatAuras via the seam).
// -------------------------------------------------------------------------

function nonPlayerAuraHp(aura: Aura): number {
  if (aura.kind === 'buff_sta') return aura.value * 10;
  if (aura.kind === 'buff_allstats') return aura.value * 10;
  return 0;
}

export function applyNonPlayerStatAura(
  ctx: SimContext,
  target: Entity,
  aura: Aura,
  direction: 1 | -1,
): void {
  if (target.kind === 'player') return;
  const hpDelta = nonPlayerAuraHp(aura) * direction;
  if (hpDelta === 0) return;
  const hpFrac = target.maxHp > 0 ? target.hp / target.maxHp : 1;
  target.maxHp = Math.max(1, target.maxHp + hpDelta);
  target.hp = target.dead
    ? 0
    : Math.max(1, Math.min(target.maxHp, Math.round(target.maxHp * hpFrac)));
}

export function clearNonPlayerStatAuras(ctx: SimContext, target: Entity): void {
  if (target.kind === 'player') return;
  for (const aura of target.auras) applyNonPlayerStatAura(ctx, target, aura, -1);
}

// -------------------------------------------------------------------------
// Hunter / warlock pet lifecycle
// -------------------------------------------------------------------------

export function petOf(ctx: SimContext, ownerPid: number, includeDead = false): Entity | null {
  for (const e of ctx.entities.values()) {
    if (
      e.kind === 'mob' &&
      e.ownerId === ownerPid &&
      !ctx.isDelveCompanionMob(e) &&
      (includeDead || !e.dead)
    )
      return e;
  }
  return null;
}

export function serializePet(ctx: SimContext, ownerPid: number): PetState | null {
  const pet = petOf(ctx, ownerPid, true);
  // While the owner is inside a delve their pet is despawned and parked in
  // delvePetStash (stowPetForDelve). It has no live entity, so fall back to the
  // stashed snapshot, otherwise a save taken mid-delve (autosave, disconnect, or
  // shutdown saveAll) would persist pet:null and lose the pet on reload.
  if (!pet) return ctx.delvePetStash.get(ownerPid) ?? null;
  return {
    templateId: pet.templateId,
    name: pet.name,
    level: pet.level,
    hp: pet.dead ? 0 : Math.max(1, Math.min(pet.maxHp, pet.hp)),
    dead: pet.dead,
    mode: pet.petMode,
    autoTaunt: pet.petAutoTaunt,
  };
}

/** A summoned warlock demon (imp/voidwalker/succubus/felhunter/doomguard/infernal,
 * anything in the 'demon' MOBS family) is NOT persisted across logout: classic
 * warlocks re-summon their demon (paying its cost and the 180s summon cooldown) on
 * login rather than getting it back for free, which would let a relog launder the
 * cooldown. serializeCharacter drops a demon snapshot to null at the persistence
 * boundary so a reload forces a fresh summon. Hunter pets (beast/spider family)
 * persist. This lives at the save boundary, NOT inside serializePet, because the
 * in-session delve pet-park (stowPetForDelve) reuses serializePet and must keep
 * preserving demons across a delve. */
export function isDemonPetState(state: PetState | null | undefined): boolean {
  return !!state && MOBS[state.templateId]?.family === 'demon';
}

export function restorePet(ctx: SimContext, owner: Entity, state: PetState): void {
  const template = MOBS[state.templateId];
  if (!template) {
    // The stored pet's creature template was removed or renamed by a content
    // update, so we can no longer rebuild it. Drop the pet (it cannot exist),
    // but tell the owner instead of silently emptying the pet slot. When the
    // saved name is unclean (no localizable proper noun survives), emit the
    // generic, name-free sentence rather than splicing an English "Your pet"
    // that the client matcher would leave untranslated in a non-English locale.
    const lost = cleanPetName(state.name);
    ctx.notice(
      owner.id,
      lost
        ? `${lost} could not be restored and has been lost.`
        : 'Your pet could not be restored and has been lost.',
    );
    return;
  }
  const level = owner.level;
  const pos = ctx.groundPos(owner.pos.x + 2, owner.pos.z + 1);
  const pet = createMob(ctx.nextId++, template, level, pos);
  pet.name = cleanPetName(state.name) ?? template.name;
  pet.ownerId = owner.id;
  pet.petMode = state.mode ?? 'defensive';
  pet.petTauntTimer = 0;
  pet.petAutoTaunt = state.autoTaunt ?? false;
  pet.petManualTauntPending = false;
  pet.hostile = false;
  pet.aiState = state.dead ? 'dead' : 'idle';
  pet.aggroTargetId = null;
  pet.inCombat = false;
  pet.tappedById = null;
  pet.loot = null;
  pet.lootable = false;
  pet.wanderTarget = null;
  clearThreat(pet);
  if (state.dead) {
    pet.dead = true;
    pet.hp = 0;
    pet.corpseTimer = Infinity;
    pet.respawnTimer = Infinity;
  } else {
    pet.hp = Math.max(1, Math.min(pet.maxHp, Math.round(state.hp) || pet.maxHp));
  }
  ctx.addEntity(pet);
}

export function syncPetLevel(ctx: SimContext, owner: Entity): void {
  const pet = petOf(ctx, owner.id, true);
  if (!pet || pet.level === owner.level) return;
  const template = MOBS[pet.templateId];
  if (!template) return;
  const hpFrac = pet.maxHp > 0 ? pet.hp / pet.maxHp : 1;
  const scaled = createMob(-1, template, owner.level, pet.pos);
  pet.level = scaled.level;
  pet.maxHp = scaled.maxHp;
  pet.weapon = scaled.weapon;
  pet.stats.armor = scaled.stats.armor;
  pet.moveSpeed = scaled.moveSpeed;
  pet.scale = scaled.scale;
  pet.color = scaled.color;
  pet.hp = pet.dead ? 0 : Math.max(1, Math.min(pet.maxHp, Math.round(pet.maxHp * hpFrac)));
}

function cleanPetName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  return PET_NAME_RE.test(name) ? name : null;
}

export function tameError(ctx: SimContext, p: Entity, target: Entity): string | null {
  if (target.kind !== 'mob' || !target.hostile) return 'You cannot tame that.';
  const template = MOBS[target.templateId];
  if (!template || (template.family !== 'beast' && template.family !== 'spider'))
    return 'Only beasts can be tamed.';
  if (template.elite || template.boss || template.rare) return 'That beast is too strong to tame.';
  if (target.level > p.level) return 'That beast is too high level for you to tame.';
  if (target.spawnPos.x > DUNGEON_X_THRESHOLD) return 'You cannot tame dungeon creatures.';
  if (petOf(ctx, p.id, true)) return 'You already have a pet.';
  return null;
}

export function completeTame(ctx: SimContext, p: Entity, target: Entity): void {
  const err = tameError(ctx, p, target);
  if (err) {
    ctx.error(p.id, err);
    return;
  }
  const template = MOBS[target.templateId];
  const pet = createMob(
    ctx.nextId++,
    template,
    target.level,
    ctx.groundPos(p.pos.x + 2, p.pos.z + 1),
  );
  pet.name = target.name;
  pet.ownerId = p.id;
  pet.petMode = 'defensive';
  pet.petTauntTimer = 0;
  pet.petAutoTaunt = false;
  pet.petManualTauntPending = false;
  pet.hostile = false;
  pet.aiState = 'idle';
  pet.aggroTargetId = null;
  pet.inCombat = false;
  pet.tappedById = null;
  pet.auras = [];
  pet.hp = pet.maxHp;
  pet.loot = null;
  pet.lootable = false;
  pet.wanderTarget = null;
  clearThreat(pet);

  ctx.pendingMobRespawns.push({
    templateId: target.templateId,
    level: target.level,
    pos: { ...target.spawnPos },
    facing: target.facing,
    dungeonId: target.dungeonId,
    timer: TAMED_TARGET_RESPAWN_SECONDS,
  });
  ctx.clearEntityMarker(target.id);
  ctx.dropEntity(target.id);

  // The owned copy is friendly now: nobody keeps swinging at the old target,
  // other mobs forget both the old entity and the new pet starts clean.
  for (const other of ctx.players.values()) {
    const e = ctx.entities.get(other.entityId);
    if (e && e.targetId === target.id) e.autoAttack = false;
  }
  for (const m of ctx.entities.values()) {
    if (m.kind !== 'mob') continue;
    m.threat.delete(target.id);
    if (m.aggroTargetId === target.id && !m.dead && m.aiState !== 'dead') ctx.retargetMob(m);
  }
  ctx.addEntity(pet);
  syncPetLevel(ctx, p);
  ctx.emit({
    type: 'log',
    text: `${pet.name} is now your loyal companion.`,
    color: '#8f8',
    pid: p.id,
  });
  ctx.emit({ type: 'aura', targetId: pet.id, name: 'Tamed', gained: true });
}

export function summonPet(ctx: SimContext, owner: Entity, templateId: string): void {
  const template = MOBS[templateId];
  if (!template) {
    ctx.error(owner.id, 'That summon is unavailable.');
    return;
  }
  const existing = petOf(ctx, owner.id, true);
  if (existing) {
    despawnPersistentPet(ctx, existing);
    if (existing.templateId === templateId && !existing.dead) {
      ctx.emit({
        type: 'log',
        text: `${existing.name} fades back into the void.`,
        color: '#b894ff',
        pid: owner.id,
      });
      return;
    }
  }

  const pet = createDemonPet(ctx, owner, templateId);
  if (!pet) return;
  ctx.emit({
    type: 'log',
    text: `${pet.name} answers your summons.`,
    color: '#b894ff',
    pid: owner.id,
  });
  ctx.emit({ type: 'aura', targetId: pet.id, name: 'Summoned', gained: true });
}

export function createDemonPet(
  ctx: SimContext,
  owner: Entity,
  mobId: string,
  emit = false,
): Entity | null {
  const template = MOBS[mobId];
  if (!template) return null;
  const pet = createMob(
    ctx.nextId++,
    template,
    owner.level,
    ctx.groundPos(owner.pos.x + 2, owner.pos.z + 1),
  );
  pet.name = template.name;
  pet.ownerId = owner.id;
  pet.petMode = 'defensive';
  pet.petTauntTimer = 0;
  pet.petAutoTaunt = false;
  pet.petManualTauntPending = false;
  pet.hostile = false;
  pet.aiState = 'idle';
  pet.aggroTargetId = null;
  pet.inCombat = false;
  pet.tappedById = null;
  pet.auras = [];
  pet.hp = pet.maxHp;
  pet.loot = null;
  pet.lootable = false;
  pet.wanderTarget = null;
  clearThreat(pet);
  ctx.addEntity(pet);
  if (emit)
    ctx.emit({
      type: 'log',
      text: `${pet.name} answers your summons.`,
      color: '#b894ff',
      pid: owner.id,
    });
  return pet;
}

export function despawnPersistentPet(ctx: SimContext, pet: Entity): void {
  clearNonPlayerStatAuras(ctx, pet);
  pet.auras = [];
  clearThreat(pet);
  for (const m of ctx.entities.values()) {
    if (m.kind !== 'mob' || m.id === pet.id) continue;
    m.threat.delete(pet.id);
    if (m.aggroTargetId === pet.id && !m.dead && m.aiState !== 'dead') ctx.retargetMob(m);
  }
  ctx.dropEntity(pet.id);
}

export function stowPetForSpectate(ctx: SimContext, ownerPid: number): PetState | null {
  const pet = petOf(ctx, ownerPid, true);
  if (!pet) return null;
  const state = serializePet(ctx, ownerPid);
  despawnPersistentPet(ctx, pet);
  return state;
}

export function restorePetAfterSpectate(
  ctx: SimContext,
  ownerPid: number,
  state: PetState | null,
): void {
  if (!state || petOf(ctx, ownerPid, true)) return;
  const owner = ctx.entities.get(ownerPid);
  if (owner) restorePet(ctx, owner, state);
}

export function applyDemonHealTick(ctx: SimContext, owner: Entity): void {
  const pet = petOf(ctx, owner.id);
  if (!pet) {
    ctx.cancelCast(owner);
    return;
  }
  const amount = Math.max(1, Math.ceil(pet.maxHp * 0.08));
  const healed = Math.min(amount, pet.maxHp - pet.hp);
  if (healed <= 0) return;
  pet.hp += healed;
  ctx.emit({
    type: 'heal2',
    sourceId: owner.id,
    targetId: pet.id,
    amount: healed,
    crit: false,
    ability: 'Demon Heal',
  });
  ctx.healingThreat(owner, pet, healed);
}

/** Remove a summoned demon from the world entirely, scrubbing any references
 *  (player targets, other mobs' hate) the way boss adds are despawned. */
export function despawnPet(ctx: SimContext, pet: Entity): void {
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e) continue;
    if (e.targetId === pet.id) e.targetId = null;
  }
  for (const m of ctx.entities.values()) {
    if (m.kind !== 'mob' || m.id === pet.id) continue;
    m.threat.delete(pet.id);
    if (m.aggroTargetId === pet.id && !m.dead && m.aiState !== 'dead') ctx.retargetMob(m);
  }
  ctx.dropEntity(pet.id);
}

// -------------------------------------------------------------------------
// Public pet commands (the IWorld surface; Sim keeps same-named thin delegates)
// -------------------------------------------------------------------------

export function abandonPet(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  if (r.meta.cls !== 'hunter') {
    ctx.error(r.e.id, 'Only hunters can abandon pets.');
    return;
  }
  const pet = petOf(ctx, r.e.id, true);
  if (!pet) {
    ctx.error(r.e.id, noPetError(r.e));
    return;
  }
  ctx.emit({ type: 'log', text: `You abandon ${pet.name}.`, color: '#f66', pid: r.e.id });
  despawnPersistentPet(ctx, pet);
}

export function renamePet(ctx: SimContext, name: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  if (!isPetClass(r.meta.cls)) {
    ctx.error(r.e.id, 'Only pet classes can rename pets.');
    return;
  }
  const pet = petOf(ctx, r.e.id, true);
  if (!pet) {
    ctx.error(r.e.id, noPetError(r.e));
    return;
  }
  const clean = cleanPetName(name);
  if (!clean) {
    ctx.error(
      r.e.id,
      'Pet name must be 2-16 letters/spaces/hyphen/apostrophe and start with a letter.',
    );
    return;
  }
  pet.name = clean;
  ctx.emit({ type: 'log', text: `Your pet is now named ${clean}.`, color: '#8f8', pid: r.e.id });
}

export function revivePet(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  if (!isPetClass(r.meta.cls)) {
    ctx.error(r.e.id, 'Only pet classes can revive pets.');
    return;
  }
  const pet = petOf(ctx, r.e.id, true);
  if (!pet) {
    ctx.error(r.e.id, noPetError(r.e));
    return;
  }
  if (!pet.dead) {
    ctx.error(r.e.id, 'Your pet is already alive.');
    return;
  }
  pet.dead = false;
  pet.hostile = false;
  pet.ownerId = r.e.id;
  pet.aiState = 'idle';
  pet.aggroTargetId = null;
  pet.inCombat = false;
  pet.corpseTimer = 0;
  pet.respawnTimer = 0;
  pet.loot = null;
  pet.lootable = false;
  pet.tappedById = null;
  clearThreat(pet);
  pet.pos = ctx.groundPos(r.e.pos.x + 2, r.e.pos.z + 1);
  pet.prevPos = { ...pet.pos };
  ctx.rebucket(pet);
  pet.hp = Math.max(1, Math.round(pet.maxHp * 0.35));
  ctx.emit({
    type: 'log',
    text: `${pet.name} returns to your side.`,
    color: '#8f8',
    pid: r.e.id,
  });
}

export function petAttack(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  if (!isPetClass(r.meta.cls)) {
    ctx.error(r.e.id, 'Only pet classes can command pets.');
    return;
  }
  r.meta.lastActiveTick = ctx.tickCount; // commanding the pet is a deliberate action
  const pet = petOf(ctx, r.e.id);
  if (!pet) {
    ctx.error(r.e.id, noPetError(r.e, 'You have no living pet.'));
    return;
  }
  const target = r.e.targetId !== null ? ctx.entities.get(r.e.targetId) : null;
  if (!target || target.dead || !ctx.isHostileTo(pet, target)) {
    ctx.error(r.e.id, 'Your pet needs a hostile target.');
    return;
  }
  pet.aggroTargetId = target.id;
  pet.inCombat = true;
  if (target.kind === 'mob' && target.hostile) addThreat(target, pet.id, 1);
}

export function petTaunt(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  if (!isPetClass(r.meta.cls)) {
    ctx.error(r.e.id, 'Only pet classes can command pets.');
    return;
  }
  r.meta.lastActiveTick = ctx.tickCount; // commanding the pet is a deliberate action
  const pet = petOf(ctx, r.e.id);
  if (!pet) {
    ctx.error(r.e.id, noPetError(r.e, 'You have no living pet.'));
    return;
  }
  if (pet.petTauntTimer > 0) {
    ctx.error(r.e.id, 'Pet taunt is not ready.');
    return;
  }
  const target =
    pet.aggroTargetId !== null
      ? (ctx.entities.get(pet.aggroTargetId) ?? null)
      : r.e.targetId !== null
        ? (ctx.entities.get(r.e.targetId) ?? null)
        : null;
  if (target?.kind !== 'mob' || target.dead || !target.hostile || target.ownerId !== null) {
    ctx.error(r.e.id, 'Your pet needs a hostile target.');
    return;
  }
  pet.aggroTargetId = target.id;
  pet.inCombat = true;
  addThreat(target, pet.id, 1);
  if (dist2d(pet.pos, target.pos) > PET_TAUNT_RANGE) {
    pet.petManualTauntPending = true;
    return;
  }
  ctx.applyTaunt(pet, target);
  pet.petManualTauntPending = false;
  pet.petTauntTimer = PET_GROWL_INTERVAL;
}

export function feedPet(ctx: SimContext, itemId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  if (r.meta.cls !== 'hunter') {
    ctx.error(r.e.id, 'Only hunters can feed pets.');
    return;
  }
  const pet = petOf(ctx, r.e.id);
  if (!pet) {
    ctx.error(r.e.id, noPetError(r.e, 'You have no living pet.'));
    return;
  }
  const item = ITEMS[itemId];
  if (item?.kind !== 'food' || !item.foodHp) {
    ctx.error(r.e.id, 'Your pet can only eat food.');
    return;
  }
  if (ctx.countItem(itemId, r.e.id) <= 0) {
    ctx.error(r.e.id, "You don't have that item.");
    return;
  }
  if (pet.hp >= pet.maxHp) {
    ctx.error(r.e.id, 'Your pet is already at full health.');
    return;
  }
  ctx.removeItem(itemId, 1, r.e.id);
  pet.auras = pet.auras.filter((a) => a.id !== 'feed_pet');
  ctx.applyAura(pet, {
    id: 'feed_pet',
    name: 'Fed',
    kind: 'hot',
    value: Math.max(1, Math.ceil(item.foodHp / PET_FEED_DURATION)),
    duration: PET_FEED_DURATION,
    remaining: PET_FEED_DURATION,
    sourceId: r.e.id,
    school: 'nature',
    tickInterval: PET_FEED_TICK,
    tickTimer: PET_FEED_TICK,
  });
  ctx.emit({ type: 'log', text: `You feed ${pet.name}.`, color: '#8f8', pid: r.e.id });
}

export function healPet(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  if (r.meta.cls !== 'warlock') {
    ctx.error(r.e.id, 'Only warlocks can channel demon healing.');
    return;
  }
  if (r.e.dead) {
    ctx.error(r.e.id, 'You are dead.');
    return;
  }
  if (ctx.isStunned(r.e)) {
    ctx.error(r.e.id, 'You are stunned.');
    return;
  }
  if (r.e.castingAbility) {
    ctx.error(r.e.id, 'You are busy.');
    return;
  }
  const pet = petOf(ctx, r.e.id);
  if (!pet) {
    ctx.error(r.e.id, noPetError(r.e, 'You have no living demon.'));
    return;
  }
  if (pet.hp >= pet.maxHp) {
    ctx.error(r.e.id, 'Your demon is already at full health.');
    return;
  }
  if (r.e.resource < DEMON_HEAL_MANA_COST) {
    ctx.error(r.e.id, 'Not enough mana!');
    return;
  }
  ctx.spendResource(r.e, DEMON_HEAL_MANA_COST);
  r.e.castingAbility = DEMON_HEAL_CAST_ID;
  r.e.castTotal = DEMON_HEAL_DURATION;
  r.e.castRemaining = DEMON_HEAL_DURATION;
  r.e.castTargetId = null;
  r.e.channeling = true;
  r.e.channelTickEvery = DEMON_HEAL_TICK;
  r.e.channelTickTimer = DEMON_HEAL_TICK;
  r.e.gcdRemaining = Math.max(r.e.gcdRemaining, ctx.playerGcdFor(r.meta.cls));
  ctx.emit({
    type: 'log',
    text: `You channel healing into ${pet.name}.`,
    color: '#b894ff',
    pid: r.e.id,
  });
  ctx.emit({
    type: 'castStart',
    entityId: r.e.id,
    ability: DEMON_HEAL_CAST_ID,
    time: DEMON_HEAL_DURATION,
  });
}

export function setPetMode(ctx: SimContext, mode: PetMode, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  if (!isPetClass(r.meta.cls)) {
    ctx.error(r.e.id, 'Only pet classes can command pets.');
    return;
  }
  r.meta.lastActiveTick = ctx.tickCount; // commanding the pet is a deliberate action
  const pet = petOf(ctx, r.e.id, true);
  if (!pet) {
    ctx.error(r.e.id, noPetError(r.e));
    return;
  }
  pet.petMode = mode;
  if (mode === 'passive') {
    pet.aggroTargetId = null;
    pet.inCombat = false;
    pet.autoAttack = false;
    pet.petManualTauntPending = false;
  }
  ctx.emit({ type: 'log', text: `${pet.name} is now ${mode}.`, color: '#ffd100', pid: r.e.id });
}

export function setPetAutoTaunt(ctx: SimContext, enabled: boolean, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  if (!isPetClass(r.meta.cls)) {
    ctx.error(r.e.id, 'Only pet classes can command pets.');
    return;
  }
  r.meta.lastActiveTick = ctx.tickCount; // commanding the pet is a deliberate action
  const pet = petOf(ctx, r.e.id, true);
  if (!pet) {
    ctx.error(r.e.id, noPetError(r.e));
    return;
  }
  pet.petAutoTaunt = enabled;
}

// -------------------------------------------------------------------------
// Readouts (/pettaunt, /pet) — return strings the Sim command handlers surface.
// -------------------------------------------------------------------------

// Self-only readout of the controlled pet's Growl cooldown and autocast state.
// Distinct from /pet (vitals) and /cooldowns (the player's own ability map,
// which never holds this timer).
export function petTauntReadout(ctx: SimContext, owner: Entity): string {
  const pet = petOf(ctx, owner.id);
  if (!pet) return 'You do not have a pet.';
  if (pet.petTauntTimer <= 0) {
    return pet.petAutoTaunt
      ? `Your pet's Growl is ready. Auto-taunt is on.`
      : `Your pet's Growl is ready. Auto-taunt is off.`;
  }
  const seconds = Math.ceil(pet.petTauntTimer);
  return pet.petAutoTaunt
    ? `Your pet's Growl is on cooldown. Auto-taunt is on. Ready in ${seconds}s.`
    : `Your pet's Growl is on cooldown. Auto-taunt is off. Ready in ${seconds}s.`;
}

// Self-only readout of the player's active pet: name, level, beast family,
// and current health. Reads live pet state via petOf() so it stays accurate
// regardless of how the pet was acquired (tame, summon).
export function petReadout(ctx: SimContext, owner: Entity): string {
  const pet = petOf(ctx, owner.id);
  if (!pet) return 'You do not have a pet.';
  const family = MOBS[pet.templateId]?.family;
  const kind = family ? ` ${family}` : '';
  const pct = pet.maxHp > 0 ? Math.round((pet.hp / pet.maxHp) * 100) : 0;
  return `Your pet: ${pet.name} (level ${pet.level}${kind}) — HP ${pet.hp}/${pet.maxHp} (${pct}%).`;
}

// -------------------------------------------------------------------------
// Delve pet parking: stow on enter, restore on exit. delvePetStash is a live
// SimContext view of the Sim-owned snapshot map; serializePet falls back to it.
// -------------------------------------------------------------------------

export function stowPetForDelve(ctx: SimContext, pid: number): void {
  const meta = ctx.players.get(pid);
  if (!meta || !isPetClass(meta.cls)) return;
  const pet = petOf(ctx, pid, true);
  if (!pet) return;
  const state = serializePet(ctx, pid);
  if (state) ctx.delvePetStash.set(pid, state);
  if (MOBS[pet.templateId]?.family === 'demon') despawnPet(ctx, pet);
  else despawnPersistentPet(ctx, pet);
}

export function restorePetFromDelveStash(ctx: SimContext, pid: number): void {
  const state = ctx.delvePetStash.get(pid);
  if (!state) return;
  const e = ctx.entities.get(pid);
  // If the owner entity is not registered yet (transfer/load ordering), leave the
  // stash entry in place so a later call (e.g. the next tick) can still restore it
  // instead of silently losing the pet.
  if (!e) return;
  ctx.delvePetStash.delete(pid);
  if (petOf(ctx, pid, true)) return;
  restorePet(ctx, e, state);
}
