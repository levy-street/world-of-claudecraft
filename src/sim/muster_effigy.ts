// The Straw Foreman: the muster's training effigy, and the lesson it teaches.
//
// The Balgath fight has one idea a player must learn before the real thing: a braced pike
// through the eye blinds him, his hide comes off, and for a short window everyone's blows
// finally land. The drill yard in the command camp teaches exactly that on a target that
// cannot hurt anyone:
//
//   - THE EFFIGY is a practice dummy (MobTemplate.dummy: never moves, aggros or swings,
//     heals back to full after a quiet spell) wearing a PLANK HIDE: a permanent `buff_dr`
//     aura that turns away the same share of every blow Barrowhide does on the real one
//     (both numbers are read off Balgath's own eyeWard, so a retune of the boss retunes
//     the lesson with it).
//   - THE LANTERN in its eye is the target. A Barrowglass Thrust that finds no living boss in
//     reach finds the effigy instead (lance_trial.ts, one lookup shared with the HUD's
//     prompt, lance_guidance.ts). It puts the lantern out FOR THAT PLAYER ONLY and opens
//     THEIR window for Balgath's own blindSeconds: while it is open the plank hide ignores
//     their blows (and their pet's), and every blow they land counts toward the drill.
//     Nobody else's lantern goes out and nobody else's window opens, so a whole raid can
//     drill on the one effigy at once without robbing each other: the per-player state is
//     a window map on the muster army, keyed by player id, and the client reads its OWN
//     window off an inert self-aura (EFFIGY_OPENED_AURA_ID), which is also the countdown on
//     the player's buff bar. The effigy's own entity never changes state.
//   - THE PIKE goes back on landing: a thrust into the lantern with the muster's LENT pike
//     hands it back to the rack (muster_pike.ts reclaim, which also puts the player's own
//     weapon back in their hands), because the second half of the lesson is hitting it
//     with that weapon. Skerrit's own pike is the player's to keep, so it stays in hand.
//
// The drillmaster's mallet (the other half of the yard, the shockwaves) is muster_drill.ts.
//
// The shared ids, names and mirrored numbers are the pure leaf muster_effigy_core.ts.
//
// State: the window map and the effigy's id live on MusterArmyState (Sim-owned, a live
// SimContext view). Draws no rng; every rule is arithmetic on the sim clock.

import { MUSTER_EFFIGY_POST, MUSTER_EFFIGY_TEMPLATE_ID } from './content/mirefen_muster';
import {
  MUSTER_EFFIGY_BLINDED_EVENT,
  MUSTER_EFFIGY_WINDOW_HIT_EVENT,
} from './content/mirefen_muster_quests';
import { MOBS } from './data';
import { createMob } from './entity';
import type { MusterArmyState } from './mirefen_muster';
import {
  EFFIGY_OPENED_AURA_ID,
  EFFIGY_OPENED_NAME,
  EFFIGY_WARD_AURA_ID,
  EFFIGY_WARD_NAME,
  EFFIGY_WARD_REDUCTION,
  EFFIGY_WINDOW_SECONDS,
} from './muster_effigy_core';
import { isLentGear, reclaimMusterPike } from './muster_pike';
import { onQuestEventForQuests } from './quests/quest_credit';
import type { SimContext } from './sim_context';
import { type Aura, dist2d, type Entity } from './types';

export { EFFIGY_OPENED_AURA_ID, EFFIGY_WARD_AURA_ID, EFFIGY_WINDOW_SECONDS };

/** Spawn the effigy at its post (called once, when the muster is raised). */
export function raiseMusterEffigy(ctx: SimContext, army: MusterArmyState): void {
  const template = MOBS[MUSTER_EFFIGY_TEMPLATE_ID];
  if (!template || army.effigyId !== null) return;
  const pos = ctx.groundPos(MUSTER_EFFIGY_POST.x, MUSTER_EFFIGY_POST.z);
  const mob = createMob(ctx.nextId++, template, template.maxLevel, pos);
  mob.facing = MUSTER_EFFIGY_POST.facing;
  mob.prevFacing = MUSTER_EFFIGY_POST.facing;
  mob.idleStationary = true;
  ctx.addEntity(mob);
  army.effigyId = mob.id;
  mob.auras.push(plankHide(mob));
}

/** The live effigy, or null (not raised, or between a felling and its respawn). */
export function musterEffigy(ctx: SimContext, army: MusterArmyState): Entity | null {
  if (army.effigyId === null) return null;
  const e = ctx.entities.get(army.effigyId);
  return e && !e.dead ? e : null;
}

/** Is this entity the drill yard's effigy? */
export function isMusterEffigy(e: Entity | null | undefined): boolean {
  return !!e && e.kind === 'mob' && e.templateId === MUSTER_EFFIGY_TEMPLATE_ID;
}

/** The effigy, when it stands within `range` of this player; null otherwise. */
export function effigyInReach(
  ctx: SimContext,
  army: MusterArmyState,
  p: Entity,
  range: number,
): { mob: Entity; distance: number } | null {
  const mob = musterEffigy(ctx, army);
  if (!mob) return null;
  const distance = dist2d(mob.pos, p.pos);
  return distance <= range ? { mob, distance } : null;
}

/** Seconds left on this player's own window on the effigy (0 when the lantern is lit). */
export function effigyWindowRemaining(ctx: SimContext, army: MusterArmyState, pid: number): number {
  return Math.max(0, (army.effigyWindows.get(pid) ?? 0) - ctx.time);
}

/** The player a blow belongs to: the player themself, or a pet's owner. */
function owningPlayerId(ctx: SimContext, source: Entity): number | null {
  if (source.kind === 'player') return source.id;
  if (source.ownerId !== null && ctx.players.has(source.ownerId)) return source.ownerId;
  return null;
}

/**
 * Does this blow ignore the plank hide? True exactly when its owner's window on the effigy
 * is open. Called from the damage path's buff_dr loop for the plank hide aura only.
 */
export function effigyHideBypassed(ctx: SimContext, source: Entity | null): boolean {
  if (!source) return false;
  const pid = owningPlayerId(ctx, source);
  return pid !== null && effigyWindowRemaining(ctx, ctx.musterArmy, pid) > 0;
}

/**
 * Put the lantern out for one player: open their window, tell them, credit the drill.
 * Returns false (no side effects) while their window is already open: poking a lantern
 * that is already out is not a second lesson.
 */
export function blindMusterEffigy(ctx: SimContext, pid: number, effigy: Entity): boolean {
  const army = ctx.musterArmy;
  const meta = ctx.players.get(pid);
  const p = ctx.entities.get(pid);
  if (!meta || !p || effigy.dead) return false;
  if (effigyWindowRemaining(ctx, army, pid) > 0) return false;
  army.effigyWindows.set(pid, ctx.time + EFFIGY_WINDOW_SECONDS);
  p.auras = p.auras.filter((a) => a.id !== EFFIGY_OPENED_AURA_ID);
  ctx.applyAura(p, openedAura(pid));
  // Same event the real blind fires, flagged, so the HUD's banner and the reticle's burst
  // ride the one path; the thrust tally (a real eye put out) is deliberately not bumped.
  ctx.emit({
    type: 'lanceBlind',
    pid,
    count: meta.lanceThrusts ?? 0,
    targetId: effigy.id,
    effigy: true,
  });
  ctx.notice(
    pid,
    'The lantern gutters out and the planks fall away! Hit it with your own weapon: every blow lands in full.',
  );
  onQuestEventForQuests(ctx, meta, MUSTER_EFFIGY_BLINDED_EVENT);
  // The lent pike goes back to the rack, and the player's own weapon back in their hands:
  // the second half of the lesson is hitting it with that weapon.
  if (isLentGear(meta.equipment.mainhand)) {
    reclaimMusterPike(ctx, army.lent, pid, 'drill');
  }
  return true;
}

/**
 * A blow landed on the effigy (the damage path's tail, amount already applied). Counts
 * toward the drill while the blow's owner has their window open; the thrust itself is not
 * a blow with their own weapon, so it never counts.
 */
export function noteEffigyBlow(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
  amount: number,
  abilityId: string | null | undefined,
): void {
  if (amount <= 0 || !source || !isMusterEffigy(target)) return;
  if (abilityId === 'lance_thrust') return;
  const pid = owningPlayerId(ctx, source);
  if (pid === null || effigyWindowRemaining(ctx, ctx.musterArmy, pid) <= 0) return;
  const meta = ctx.players.get(pid);
  if (meta) onQuestEventForQuests(ctx, meta, MUSTER_EFFIGY_WINDOW_HIT_EVENT);
}

/**
 * One pass, from the muster army: keep the plank hide on the effigy, and close every
 * window that ran out (or whose player is gone or dead), taking its timer aura with it.
 */
export function tickMusterEffigy(ctx: SimContext, army: MusterArmyState): void {
  const effigy = musterEffigy(ctx, army);
  if (effigy && !effigy.auras.some((a) => a.id === EFFIGY_WARD_AURA_ID)) {
    effigy.auras.push(plankHide(effigy));
  }
  if (army.effigyWindows.size === 0) return;
  for (const [pid, until] of army.effigyWindows) {
    const p = ctx.entities.get(pid);
    const open = until > ctx.time && !!p && !p.dead && ctx.players.has(pid);
    if (open) continue;
    army.effigyWindows.delete(pid);
    if (p) p.auras = p.auras.filter((a) => a.id !== EFFIGY_OPENED_AURA_ID);
  }
}

/** Forget a player's window at once (the dev reset). */
export function closeEffigyWindow(ctx: SimContext, army: MusterArmyState, pid: number): void {
  army.effigyWindows.delete(pid);
  const p = ctx.entities.get(pid);
  if (p) p.auras = p.auras.filter((a) => a.id !== EFFIGY_OPENED_AURA_ID);
}

function plankHide(effigy: Entity): Aura {
  return {
    id: EFFIGY_WARD_AURA_ID,
    name: EFFIGY_WARD_NAME,
    kind: 'buff_dr',
    value: EFFIGY_WARD_REDUCTION,
    remaining: 3600,
    duration: 3600,
    permanent: true,
    sourceId: effigy.id,
    school: 'physical',
  };
}

function openedAura(pid: number): Aura {
  return {
    id: EFFIGY_OPENED_AURA_ID,
    name: EFFIGY_OPENED_NAME,
    // Inert: no combat reader keys on this kind. The window's truth is the map above;
    // this is only its face on the buff bar and the renderer's cue for this one viewer.
    kind: 'internal_cd',
    value: EFFIGY_WARD_REDUCTION,
    remaining: EFFIGY_WINDOW_SECONDS,
    duration: EFFIGY_WINDOW_SECONDS,
    sourceId: pid,
    school: 'physical',
    undispellable: true,
  };
}
