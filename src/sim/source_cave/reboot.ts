// Source Cave reboot controller: spawns the one-shot centre button and hands a
// confirmed press to the deterministic encounter state machine. A pressed
// button stays on the dais as an inert prop (lootable = false). Draws no rng.

import { createGroundObject } from '../entity';
import { emitMobYell } from '../mob/yells';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity, type Vec3, YELL_RANGE } from '../types';
import {
  beginSourceCaveEncounter,
  confirmSourceCaveReboot,
  isDormantSourceCaveTargetSafe,
} from './encounter';
import { SOURCE_CAVE_SEAL_RADIUS } from './occupancy';
import { SOURCE_CAVE_DUNGEON_ID } from './runtime';

/** Ground-object template id for the centre reboot button. */
export const SOURCE_CAVE_REBOOT_TEMPLATE = 'source_cave_reboot';

/**
 * Gameplay radius of the visible centre seal. Dormant contributors suppress
 * automatic acquisition only while a player's controller stays inside it.
 */
export const SOURCE_CAVE_REBOOT_SAFE_RADIUS = SOURCE_CAVE_SEAL_RADIUS;

/** Stable sim-side payload localized at the UI boundary. */
export const SOURCE_CAVE_REBOOT_YELL = 'What have you done?!';

/**
 * Staggered reactions from the two strongest non-boss contributors after the
 * boss's own yell (stable sim-side payloads, localized at the UI boundary like
 * SOURCE_CAVE_REBOOT_YELL).
 */
export const SOURCE_CAVE_REBOOT_REACTION_YELLS = [
  "Hey, what's going on?",
  'Guys, the server is down!',
] as const;

// Seconds between the boss yell and each staggered reaction line (sim clock,
// via delayedEvents, so the chorus lands identically on every host).
const SOURCE_CAVE_REACTION_YELL_DELAYS = [1.4, 2.8] as const;

/** Spawn the one-shot centre button at a claimed instance's arena dais. */
export function spawnSourceCaveReboot(ctx: SimContext, inst: InstanceSlot, pos: Vec3): Entity {
  const button = createGroundObject(ctx.nextId++, '', 'Do not push the button', pos);
  button.templateId = SOURCE_CAVE_REBOOT_TEMPLATE;
  button.objectItemId = null;
  button.lootable = true;
  button.respawnTimer = Infinity;
  ctx.addEntity(button);
  inst.objectIds.push(button.id);
  return button;
}

/**
 * Press the button in the caller's claimed cave instance. An incomplete muster
 * gets one confirmation; an accepted press starts the wave encounter and makes
 * every living contributor visibly hostile. The button stays on the dais as an
 * inert, pressed prop; freeInstance despawns it with the slot's objects.
 */
export function activateSourceCaveReboot(ctx: SimContext, button: Entity, pid?: number): boolean {
  if (
    button.kind !== 'object' ||
    button.templateId !== SOURCE_CAVE_REBOOT_TEMPLATE ||
    !button.lootable
  )
    return false;
  const r = ctx.resolve(pid);
  if (!r || r.e.dead) return false;
  const inst = ctx.instances.find(
    (candidate) =>
      candidate.dungeonId === SOURCE_CAVE_DUNGEON_ID &&
      candidate.partyKey !== null &&
      candidate.objectIds.includes(button.id),
  );
  if (!inst) return false;

  if (!confirmSourceCaveReboot(ctx, inst, r.meta.entityId)) return true;

  // One-shot: the !button.lootable guard above makes a second press a no-op.
  button.lootable = false;
  beginSourceCaveEncounter(ctx, inst, r.meta.entityId);

  const livingMobs: Entity[] = [];
  for (const mobId of inst.mobIds) {
    const mob = ctx.entities.get(mobId);
    if (mob?.kind !== 'mob' || mob.dead) continue;
    livingMobs.push(mob);
  }

  const bossTemplateId = ctx.sourceCave?.templates.find((template) => template.boss)?.id;
  const speaker = livingMobs.find((mob) => mob.templateId === bossTemplateId);
  if (speaker) emitMobYell(ctx, speaker, SOURCE_CAVE_REBOOT_YELL);

  // The two strongest non-boss contributors chime in after the boss, staggered.
  // spec.mobs is ordered strongest non-boss FIRST, boss LAST (spec.ts
  // outputOrder), and templates are index-aligned, so templates[0]/[1] are the
  // two reactors; a pre-dead reactor simply stays silent (no re-cast).
  const templates = ctx.sourceCave?.templates ?? [];
  for (let i = 0; i < SOURCE_CAVE_REBOOT_REACTION_YELLS.length; i++) {
    const reactorTemplateId = templates[i]?.id;
    if (!reactorTemplateId || reactorTemplateId === bossTemplateId) continue;
    const reactor = livingMobs.find((mob) => mob.templateId === reactorTemplateId);
    if (!reactor) continue;
    emitDelayedMobYell(
      ctx,
      reactor,
      SOURCE_CAVE_REBOOT_REACTION_YELLS[i],
      SOURCE_CAVE_REACTION_YELL_DELAYS[i],
    );
  }
  return true;
}

// A delayed emitMobYell: per-player 'yell' chat copies scheduled on the sim
// clock via delayedEvents (the Nythraxis dialogue-scheduler idiom). Recipients
// and range resolve at press time (the group is mustered at the centre, and the
// delay is short); the guard drops the line if the reactor died meanwhile.
function emitDelayedMobYell(ctx: SimContext, mob: Entity, text: string, delay: number): void {
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p || dist2d(p.pos, mob.pos) > YELL_RANGE) continue;
    ctx.delayedEvents.push({
      at: ctx.time + delay,
      event: {
        type: 'chat',
        fromPid: mob.id,
        from: mob.name,
        text,
        channel: 'yell',
        entityId: mob.id,
        pid: meta.entityId,
      },
      guard: () => !mob.dead,
    });
  }
}

/**
 * True when a dormant contributor should ignore an automatic target on the
 * intact centre seal. Direct attacks and explicit pet commands wake a dormant
 * wave combatant's cohort; targeting overflow adds that guardian to the pull.
 */
export function isSourceCaveRebootSafeTarget(
  ctx: SimContext,
  mob: Entity,
  target: Entity,
): boolean {
  return isDormantSourceCaveTargetSafe(ctx, mob, target);
}
