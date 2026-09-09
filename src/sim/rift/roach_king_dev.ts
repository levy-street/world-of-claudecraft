// Dev-only direct route to the live encounter. Uses the normal rift lifecycle,
// so previewing a boss exercises the actual floor, rank tuning and reward path.
import type { SimContext } from '../sim_context';
import type { RiftTier } from '../types';
import { RIFT_RANK_BASE_LEVEL } from './ranks';
import { descendRift, enterRift, instancePlayerIds, riftInstanceAtPos } from './runs';

export function handleRoachKingDevCommand(ctx: SimContext, raw: string, pid: number): boolean {
  const match = /^\/dev\s+roachking(?:\s+([CBAS]))?\s*$/i.exec(raw);
  if (!match || !ctx.devCommands) return false;
  const player = ctx.entities.get(pid);
  if (!player || player.dead) return true;
  // Do not tear down an existing live run as an incidental preview action.
  if (riftInstanceAtPos(ctx, player.pos)) return true;
  const rank = (match[1]?.toUpperCase() ?? 'C') as RiftTier;
  let seed = 42;
  while (
    ctx.riftInstances.some((candidate) => candidate.partyKey !== null && candidate.seed === seed)
  )
    seed++;
  enterRift(ctx, seed, RIFT_RANK_BASE_LEVEL[rank], pid);
  const inst = riftInstanceAtPos(ctx, player.pos);
  if (!inst) return true;
  while (inst.floorIndex < inst.floorCount - 1) {
    inst.descentOpen = true;
    descendRift(ctx, pid);
  }
  const boss = inst.bossId === null ? undefined : ctx.entities.get(inst.bossId);
  if (!boss) return true;
  // A focused boss preview clears only this new floor's supporting trash.
  for (const id of inst.mobIds) if (id !== boss.id) ctx.dropEntity(id);
  inst.mobIds = [boss.id];
  for (const memberId of instancePlayerIds(ctx, inst)) {
    const member = ctx.entities.get(memberId);
    if (!member || member.dead) continue;
    member.pos = ctx.groundPos(boss.pos.x, boss.pos.z - 24);
    member.prevPos = { ...member.pos };
    member.targetId = boss.id;
    ctx.rebucket(member);
  }
  return true;
}
