// Talent application, extracted from the Sim monolith (G1a).
//
// This module owns the sim-side talent METHOD layer: validate a staged allocation,
// re-bake the flat `TalentModifiers` struct, and manage specs + the named loadouts.
// The declarative trees + the pure helpers (`computeTalentModifiers`/
// `validateAllocation`/`talentsFor`) live in `content/talents` and are imported, never
// touched here.
//
// PRIME DIRECTIVE: this is a MOVE, not a rewrite. Every function below is the former
// `Sim` method verbatim, with `this.X` rewritten to `ctx.X` (the SimContext seam) or to
// a sibling function in this module. Statement order, branch order, validation order,
// and the in-place mutation (the refactor's immutability waiver: `r.meta.talents = ...`,
// `loadouts.push`, `meta.talentMods = ...`) are preserved
// exactly so the parity gate's full-state trace AND rng draw-order log stay byte-
// identical. Talent application draws NO rng.
//
// HOT-PATH INVARIANT: `recomputeTalents` is the SOLE place a talent tree is walked.
// The flat `meta.talentMods` struct is baked once per allocation change and read on the
// combat/stat hot path; never walk the tree per-tick, never add a second recompute site.
//
// FIESTA COUPLING: the stat pass reads modifiers through `ctx.playerMods(meta)` =
// `meta.fiestaMods ?? meta.talentMods`, NOT raw `meta.talentMods`, so a recompute during
// an active Fiesta bout keeps the augment overlay. The `ctx.playerMods(meta)` call is
// moved verbatim; do not "simplify" it to `meta.talentMods`.
//
// STATE STAYS ON Sim. The back-compat talent getters (`talents`/`talentSpec`/...),
// `playerMods`, `refreshKnownAbilities`, and `resolvedAbility` remain on `Sim`; this
// module reaches the ones it needs through SimContext. `Sim` keeps thin wrapper methods
// that delegate here (passing `this.ctx`), so the `IWorld`/server-command surface
// (`sim.applyTalents(...)` etc.) is unchanged.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts).

import { stripTemporalEchoes } from '../combat/chronomancy';
import { abilitiesKnownAt } from '../content/classes';
import {
  cloneAllocation,
  computeTalentModifiers,
  MAX_LOADOUTS,
  ROW_LEVELS,
  repairAllocation,
  rowForLevel,
  rowsPicked,
  rowsUnlockedAtLevel,
  SAVED_LOADOUT_BAR_SLOTS,
  type SavedLoadout,
  type TalentAllocation,
  type TalentModifiers,
  type TalentRowLevel,
  talentsFor,
  validateAllocation,
} from '../content/talents';
import { ABILITIES } from '../data';
import { recalcPlayerStats } from '../entity';
import { despawnPersistentPet, petOf } from '../pet/pet_commands';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type Entity, isFormAuraKind } from '../types';

function cleanRemovedProcState(
  ctx: SimContext,
  player: Entity,
  previous: TalentModifiers,
  next: TalentModifiers,
): void {
  const nextIds = new Set(next.procs.map((proc) => proc.id));
  const removedIds = new Set(
    previous.procs.map((proc) => proc.id).filter((procId) => !nextIds.has(procId)),
  );
  if (
    removedIds.size === 0 &&
    !(previous.global.cheatDeathIcd > 0 && next.global.cheatDeathIcd <= 0)
  )
    return;

  if (player.procState) {
    for (const procId of removedIds) {
      delete player.procState.counters[procId];
      delete player.procState.icds[procId];
    }
    if (previous.global.cheatDeathIcd > 0 && next.global.cheatDeathIcd <= 0) {
      delete player.procState.icds.cheat_death;
    }
  }

  for (const entity of ctx.entities.values()) {
    for (let index = entity.auras.length - 1; index >= 0; index--) {
      const aura = entity.auras[index];
      if (aura.sourceId !== player.id || !removedIds.has(aura.id)) continue;
      ctx.applyNonPlayerStatAura(entity, aura, -1);
      entity.auras.splice(index, 1);
      ctx.emit({ type: 'aura', targetId: entity.id, name: aura.name, gained: false });
    }
  }
}

// Reconcile the abilityCharges recharge pools with the freshly resolved caps.
// A cap that just rose above 1 while the ability sat on a plain cooldown turns
// that running cooldown into a recharge with ONE use spent (the respec neither
// wipes the timer nor grants a free reset); an existing pool keeps its SPENT
// count under the new cap, so shrinking the cap never refunds uses early. The
// plain `cooldowns` entry mirrors the recharge only while the pool is empty
// (the updateTimers/cast-gate contract).
function normalizeAbilityCharges(
  player: Entity,
  meta: PlayerMeta,
  previousCaps: ReadonlyMap<string, number>,
): void {
  for (const ability of meta.known) {
    const nextCap = ability.charges ?? 1;
    const previousCap = previousCaps.get(ability.def.id) ?? 1;
    if (
      nextCap > 1 &&
      previousCap <= 1 &&
      player.cooldowns.has(ability.def.id) &&
      !player.abilityCharges?.[ability.def.id]
    ) {
      player.abilityCharges ??= {};
      player.abilityCharges[ability.def.id] = {
        charges: nextCap - 1,
        maxCharges: nextCap,
        recharge: player.cooldowns.get(ability.def.id) ?? ability.cooldown,
        rechargeLength: ability.cooldown,
      };
      player.cooldowns.delete(ability.def.id); // uses are stored, so the pool is open
    }
  }
  if (!player.abilityCharges) return;
  for (const [abilityId, state] of Object.entries(player.abilityCharges)) {
    const ability = meta.known.find((known) => known.def.id === abilityId);
    if (!ability || ability.cooldown <= 0) {
      delete player.abilityCharges[abilityId];
      player.cooldowns.delete(abilityId);
      continue;
    }
    const maxCharges = ability.charges ?? 1;
    const spent = Math.min(Math.max(0, state.maxCharges - state.charges), maxCharges);
    if (maxCharges <= 1) {
      // The cap collapsed to a plain cooldown: keep the running recharge as the
      // ordinary cooldown entry and drop the pool bookkeeping entirely.
      if (spent > 0 && state.recharge > 0) player.cooldowns.set(abilityId, state.recharge);
      else player.cooldowns.delete(abilityId);
      delete player.abilityCharges[abilityId];
      continue;
    }
    state.maxCharges = maxCharges;
    state.rechargeLength = ability.cooldown;
    state.charges = maxCharges - spent;
    if (spent <= 0) {
      state.recharge = 0;
      player.cooldowns.delete(abilityId);
    } else if (state.charges > 0) {
      player.cooldowns.delete(abilityId);
    }
  }
  if (Object.keys(player.abilityCharges).length === 0) player.abilityCharges = undefined;
}

// The ONLY place a talent tree is walked. Re-resolves the flat modifier struct and
// refreshes the stat pass + known-ability resolver that consume it.
function recomputeTalents(ctx: SimContext, meta: PlayerMeta): void {
  const e = ctx.entities.get(meta.entityId);
  const previousMods = meta.talentMods;
  const previousChargeCaps = new Map(
    meta.known.map((ability) => [ability.def.id, ability.charges ?? 1] as const),
  );
  meta.talentMods = computeTalentModifiers(meta.cls, meta.talents, e?.level ?? 20);
  if (e)
    recalcPlayerStats(e, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  // Announce newly granted abilities (spec signature, active nodes): emits `learnAbility`
  // (the HUD places it on the bar + spellbook) and a "You have learned" log. This is a
  // LIVE-action path only (apply/spec-pick/respec/loadout-switch); character LOAD resolves
  // known abilities via its own silent path (refreshKnownAbilities(meta, false) in the
  // addPlayer/restore block), so this never spams on login. refreshKnownAbilities only
  // fires for abilities genuinely new since the last known-set.
  ctx.refreshKnownAbilities(meta, true);
  if (e) {
    cleanRemovedProcState(ctx, e, previousMods, meta.talentMods);
    normalizeAbilityCharges(e, meta, previousChargeCaps);
    stripOrphanedFormAuras(ctx, meta, e);
  }
  // The heavy talent snapshot is wireRev-gated. Every live allocation change
  // reaches this one choke point, while character load uses the silent path in
  // Sim.addPlayer and therefore does not create learned events or a fake rev.
  meta.wireRev++;
}

// Cancel any active form/stance aura whose granting ability fell out of `meta.known`
// (a respec, spec switch, or loadout swap), so the shapeshift's buff cannot outlive the
// ability that grants it. Shapeshift/stance auras are toggled on by casting their
// granting ability and never expire on their own (see the isFormKind toggle in
// combat/effect_dispatch.ts), so without this a dropped ability (e.g. Balance's Moonkin
// Form signature) leaves its buff (spell power, armor, threat mult, ...) folding into
// recalcPlayerStats well into a different spec.
function stripOrphanedFormAuras(ctx: SimContext, meta: PlayerMeta, e: Entity | undefined): void {
  if (!e) return;
  const knownIds = new Set(meta.known.map((k) => k.def.id));
  let changed = false;
  for (let i = e.auras.length - 1; i >= 0; i--) {
    const a = e.auras[i];
    if (isFormAuraKind(a.kind) && !knownIds.has(a.id)) {
      e.auras.splice(i, 1);
      ctx.emit({ type: 'aura', targetId: e.id, name: a.name, gained: false });
      changed = true;
    }
  }
  if (changed) {
    recalcPlayerStats(e, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  }
}

function talentLockReason(ctx: SimContext, p: Entity): string | null {
  if (p.inCombat) return 'You cannot change talents in combat.';
  if (ctx.arenaMatches.has(p.id)) return 'You cannot change talents during an arena match.';
  return null;
}

export function talentPointBudget(ctx: SimContext, pid?: number): { total: number; spent: number } {
  const r = ctx.resolve(pid);
  if (!r) return { total: 0, spent: 0 };
  return { total: rowsUnlockedAtLevel(r.e.level), spent: rowsPicked(r.meta.talents) };
}

function sanitizeTalentAllocation(alloc: TalentAllocation): TalentAllocation {
  return cloneAllocation(alloc);
}

function allocationsEqual(a: TalentAllocation, b: TalentAllocation): boolean {
  if (a.spec !== b.spec) return false;
  return ROW_LEVELS.every((level) => a.rows[level] === b.rows[level]);
}

function markTalentSnapshotDirty(meta: PlayerMeta, revisionBeforeMutation: number): void {
  // An allocation recompute already dirties the heavy talent snapshot. Loadout
  // metadata can also change without a recompute, so cover that path exactly once.
  if (meta.wireRev === revisionBeforeMutation) meta.wireRev++;
}

function commitTalentAllocation(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  alloc: TalentAllocation,
  successText: string | null,
): boolean {
  const lock = talentLockReason(ctx, player);
  if (lock) {
    ctx.error(player.id, lock);
    return false;
  }
  const check = validateAllocation(meta.cls, alloc, player.level);
  if (!check.ok) {
    ctx.error(player.id, check.reason ?? 'Invalid talent build.');
    return false;
  }
  const sanitized = sanitizeTalentAllocation(alloc);
  if (allocationsEqual(meta.talents, sanitized)) return true;

  const previousSpec = meta.talents.spec;
  meta.talents = sanitized;
  recomputeTalents(ctx, meta);
  if (previousSpec !== sanitized.spec) ctx.revalidateOffhandForSpec(player.id);
  // A spec-locked pet outlives its spec otherwise (owner report: the frost
  // Water Elemental kept fighting for a fire mage): if the ability that
  // summons the ACTIVE pet is no longer in the new build's known list, the
  // companion returns home. Tamed hunter pets are never spec-gated, so they
  // are untouched; deterministic, no rng.
  dismissSpecLockedPet(ctx, player, meta);
  // Chronomancy: leaving the healer spec (the new build no longer knows Temporal
  // Echo) clears any Temporal Echo marks this mage placed, so a fire/frost mage
  // never keeps feeding a stale echo. Keyed by sourceId; marks the mage carries
  // from another chronomancer are untouched. No-op for every non-mage build.
  if (!meta.known.some((known) => known.def.id === 'temporal_echo')) {
    stripTemporalEchoes(ctx, player.id);
  }
  if (successText) ctx.emit({ type: 'log', pid: player.id, text: successText, color: '#ffd100' });
  return true;
}

// Commit a whole staged allocation in one shot (the UI's "Apply"). Rejects any
// allocation that fails server-side validation with a reason event (FR-4.5).
export function applyTalentAllocation(
  ctx: SimContext,
  alloc: TalentAllocation,
  pid?: number,
): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  return commitTalentAllocation(ctx, r.meta, r.e, alloc, 'Talents updated.');
}

// The active pet's summoning ability under the OLD build may be gone under
// the new one (Summon Water Elemental is frost-only): send the pet home. The
// summon->pet link is data-driven: any known summonDemon ability whose mobId
// matches the live pet keeps it; no match, no pet.
function dismissSpecLockedPet(ctx: SimContext, e: Entity, meta: PlayerMeta): void {
  const pet = petOf(ctx, e.id);
  if (!pet) return;
  const summons = (def: (typeof ABILITIES)[string]) =>
    def.effects.some(
      (eff) =>
        (eff.type === 'summonDemon' && eff.mobId === pet.templateId) ||
        (eff.type === 'summonPet' && eff.templateId === pet.templateId),
    );
  // A pet no class summon creates (a tamed hunter beast) is never spec-bound.
  const summonable = Object.values(ABILITIES).some((d) => d.class === meta.cls && summons(d));
  if (!summonable) return;
  const known = abilitiesKnownAt(meta.cls, e.level, ctx.playerMods(meta));
  if (known.some((k) => summons(k.def))) return;
  despawnPersistentPet(ctx, pet);
  // The registered despawn line (log.petFadesVoid, localized for every locale
  // in sim_i18n), the same farewell a warlock demon gives.
  ctx.emit({
    type: 'log',
    pid: e.id,
    text: `${pet.name} fades back into the void.`,
    color: '#b894ff',
  });
}

// Legacy incremental API retained for old scripts. The node system is gone, so
// this no longer changes state.
export function spendTalentPoint(ctx: SimContext, nodeId: string, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  ctx.error(r.e.id, 'Invalid talent build.');
  return false;
}

// Choose / change specialization. Choice rows are independent of specialization.
export function setTalentSpec(ctx: SimContext, specId: string | null, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const ct = talentsFor(r.meta.cls);
  if (specId !== null && !ct?.specs.some((s) => s.id === specId)) {
    ctx.error(r.e.id, 'Unknown specialization.');
    return false;
  }
  const cand = cloneAllocation(r.meta.talents);
  cand.spec = specId;
  return applyTalentAllocation(ctx, cand, pid);
}

/** Select or clear one canonical class-wide row through the apply choke point. */
export function selectTalentRow(
  ctx: SimContext,
  level: TalentRowLevel,
  optionId: string | null,
  pid?: number,
): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const row = rowForLevel(r.meta.cls, level);
  if (!row || r.e.level < level) {
    ctx.error(r.e.id, 'Invalid talent build.');
    return false;
  }
  if (optionId !== null && !row.options.some((option) => option.id === optionId)) {
    ctx.error(r.e.id, 'Invalid talent build.');
    return false;
  }
  const cand = cloneAllocation(r.meta.talents);
  if (optionId === null) delete cand.rows[level];
  else cand.rows[level] = optionId;
  return applyTalentAllocation(ctx, cand, pid);
}

// Free respec (out of combat): wipe choice rows. Spec is retained.
export function respecTalents(ctx: SimContext, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  return commitTalentAllocation(
    ctx,
    r.meta,
    r.e,
    { spec: r.meta.talents.spec, rows: {} },
    'Talents reset.',
  );
}

// Save the current build (talents + spec + the given action-bar slot map) as a
// named loadout. A same-named loadout is overwritten; otherwise appended up to
// MAX_LOADOUTS. Returns the loadout index (-1 on failure).
export function saveTalentLoadout(
  ctx: SimContext,
  name: string,
  bar: (string | null)[],
  pidOrAlloc?: number | TalentAllocation,
  allocMaybe?: TalentAllocation,
): number {
  const pid = typeof pidOrAlloc === 'number' ? pidOrAlloc : undefined;
  const alloc = typeof pidOrAlloc === 'object' ? pidOrAlloc : allocMaybe;
  const r = ctx.resolve(pid);
  if (!r) return -1;
  const revisionBeforeMutation = r.meta.wireRev;
  if (alloc && !commitTalentAllocation(ctx, r.meta, r.e, alloc, null)) return -1;
  const clean = (name || 'Build').toString().slice(0, 24);
  const safeBar = Array.isArray(bar)
    ? bar.slice(0, SAVED_LOADOUT_BAR_SLOTS).map((b) => (typeof b === 'string' ? b : null))
    : [];
  const lo: SavedLoadout = { name: clean, alloc: cloneAllocation(r.meta.talents), bar: safeBar };
  const existing = r.meta.loadouts.findIndex((l) => l.name === clean);
  if (existing >= 0) {
    r.meta.loadouts = r.meta.loadouts.map((saved, index) => (index === existing ? lo : saved));
    r.meta.activeLoadout = existing;
    markTalentSnapshotDirty(r.meta, revisionBeforeMutation);
    ctx.emit({ type: 'log', pid: r.e.id, text: `Saved build "${clean}".`, color: '#ffd100' });
    return existing;
  }
  if (r.meta.loadouts.length >= MAX_LOADOUTS) {
    ctx.error(r.e.id, `You can save at most ${MAX_LOADOUTS} loadouts.`);
    return -1;
  }
  r.meta.loadouts = [...r.meta.loadouts, lo];
  r.meta.activeLoadout = r.meta.loadouts.length - 1;
  markTalentSnapshotDirty(r.meta, revisionBeforeMutation);
  ctx.emit({ type: 'log', pid: r.e.id, text: `Saved build "${clean}".`, color: '#ffd100' });
  return r.meta.activeLoadout;
}

// Apply a saved loadout's talents (out of combat). The action bar is restored
// client-side from the loadout's stored slot map. Re-validated server-side.
export function switchTalentLoadout(ctx: SimContext, index: number, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  if (!Number.isSafeInteger(index) || index < 0 || index >= MAX_LOADOUTS) return false;
  const lo = r.meta.loadouts[index];
  if (!lo) {
    ctx.error(r.e.id, 'No such loadout.');
    return false;
  }
  const revisionBeforeMutation = r.meta.wireRev;
  if (!commitTalentAllocation(ctx, r.meta, r.e, lo.alloc, null)) return false;
  r.meta.activeLoadout = index;
  markTalentSnapshotDirty(r.meta, revisionBeforeMutation);
  ctx.emit({
    type: 'log',
    pid: r.e.id,
    text: `Loadout "${lo.name}" applied.`,
    color: '#ffd100',
  });
  return true;
}

export function deleteTalentLoadout(ctx: SimContext, index: number, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (
    !r ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= MAX_LOADOUTS ||
    index >= r.meta.loadouts.length
  ) {
    return false;
  }
  const lock = talentLockReason(ctx, r.e);
  if (lock) {
    ctx.error(r.e.id, lock);
    return false;
  }
  const wasActive = r.meta.activeLoadout === index;
  const revisionBeforeMutation = r.meta.wireRev;
  const name = r.meta.loadouts[index].name;
  const loadouts = r.meta.loadouts.filter((_, savedIndex) => savedIndex !== index);
  let activeLoadout = r.meta.activeLoadout;
  if (wasActive) {
    activeLoadout = loadouts.length > 0 ? Math.min(index, loadouts.length - 1) : -1;
    const next = activeLoadout >= 0 ? loadouts[activeLoadout] : null;
    if (next) {
      // This is an AUTO-apply (no user gate), so repair against the level budget
      // first: switchTalentLoadout validates on its path, but here a stale or
      // tampered next loadout would otherwise be baked into live mods wholesale.
      const repaired = repairAllocation(r.meta.cls, next.alloc, r.e.level);
      if (!commitTalentAllocation(ctx, r.meta, r.e, repaired, null)) return false;
    }
  } else if (activeLoadout > index) activeLoadout -= 1;
  r.meta.loadouts = loadouts;
  r.meta.activeLoadout = activeLoadout;
  markTalentSnapshotDirty(r.meta, revisionBeforeMutation);
  ctx.emit({ type: 'log', pid: r.e.id, text: `Deleted build "${name}".`, color: '#ffd100' });
  return true;
}
