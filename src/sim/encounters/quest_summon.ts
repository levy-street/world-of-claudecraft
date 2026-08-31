// The shared quest-mob summon: one guarded spawn used by every "call the
// named foe out" beat (the Nythraxis chain's graveside ambushes, the Proving
// Shore's tide-pool miniboss). Lifted verbatim from nythraxis.ts when the
// island grew its own summon; the double-summon guard, the summoner tap, and
// the opening aggro all live here so every summon behaves identically.
import { MOBS } from '../data';
import { createMob } from '../entity';
import type { SimContext } from '../sim_context';
import { dist2d, type Vec3 } from '../types';

export function summonQuestMob(
  ctx: SimContext,
  templateId: string,
  pos: Vec3,
  ownerPid: number,
  // perOwner scopes the duplicate guard to THIS summoner's tap: on a shared
  // site (the island tide pool) every quest holder raises their own copy
  // instead of queueing behind a stranger's. Omitted, the guard stays
  // site-wide, the original Nythraxis behavior. hardDespawnSeconds gives a
  // summon a fixed lifetime that combat and retargeting cannot clear.
  opts?: { perOwner?: boolean; hardDespawnSeconds?: number },
): void {
  const existing = [...ctx.entities.values()].some(
    (e) =>
      e.kind === 'mob' &&
      e.templateId === templateId &&
      !e.dead &&
      dist2d(e.pos, pos) < 18 &&
      (!opts?.perOwner || e.tappedById === ownerPid),
  );
  if (existing) return;
  const template = MOBS[templateId];
  if (!template) return;
  const mob = createMob(ctx.nextId++, template, template.maxLevel, ctx.groundPos(pos.x, pos.z + 3));
  mob.facing = Math.PI;
  mob.prevFacing = mob.facing;
  mob.tappedById = ownerPid;
  if (opts?.hardDespawnSeconds !== undefined) {
    mob.hardDespawnTimer = opts.hardDespawnSeconds;
    // A hard-lifetime summon was created by this script, not placed by a camp.
    // Give it the established escort-wave lifecycle: death never schedules an
    // ordinary wild respawn, and the corpse drops once its loot window decays.
    mob.runScoped = true;
    mob.summonedAdd = true;
  }
  ctx.addEntity(mob);
  const owner = ctx.entities.get(ownerPid);
  if (owner && owner.kind === 'player' && !owner.dead) ctx.aggroMob(mob, owner, false);
  const inst = ctx.instances.find((i) => {
    if (i.partyKey === null) return false;
    const origin = ctx.instanceOriginOf(i);
    return Math.abs(mob.pos.x - origin.x) < 120 && Math.abs(mob.pos.z - origin.z) < 250;
  });
  if (inst) inst.mobIds.push(mob.id);
  ctx.emit({ type: 'log', text: `${template.name} awakens!`, color: '#ff6666' });
  emitQuestMobDialogue(ctx, templateId, mob.id);
}

export function emitQuestMobDialogue(ctx: SimContext, templateId: string, entityId: number): void {
  const text =
    templateId === 'fallen_captain_aldren'
      ? 'Fallen Captain Aldren yells, "None shall disturb the king\'s rest! For Thornpeak!"'
      : templateId === 'corrupted_priest_malric'
        ? 'Corrupted Priest Malric yells, "Death shall never claim my king! The ritual must endure!"'
        : templateId === 'deathstalker_voss'
          ? 'Deathstalker Voss yells, "You will not reach him! The king must endure!"'
          : templateId === 'mister_crabs'
            ? 'Mister Crabs yells, "MINE! The pearl is mine, and mine she stays!"'
            : null;
  if (text) ctx.emit({ type: 'log', text, color: '#ff9999', entityId });
}
