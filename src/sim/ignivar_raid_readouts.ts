// IWorld combat-facet readouts for the Ignivar raid: project the live
// encounter state carried on the boss entities (entity.ignivar /
// entity.varkhul) into the presentation arrays render/ui consume through the
// seam. Every collector is a pure read over the SimContext views (no rng, no
// mutation, no tick-phase work); Sim keeps thin getters that delegate here so
// the IWorld surface resolves unchanged.
import { type ActiveIgnivarMeteorWarning, activeIgnivarMeteorWarnings } from './ignivar_meteors';
import { VARKHUL_BOSS_ID } from './ignivar_raid_ids';
import { activeIgnivarTrashMeteorWarning } from './mob/ignivar_trash_automata';
import type { SimContext } from './sim_context';
import { IGNIVAR_BOSS_ID } from './types';
import {
  type ActiveVarkhulAnvilMeteorWarning,
  activeVarkhulAnvilMeteorWarnings,
} from './varkhul_anvil_meteors';
import {
  type ActiveVarkhulAssembly,
  activeVarkhulAssembly,
  inactiveVarkhulAssembly,
  VARKHUL_ASSEMBLY_FORGE_LOCAL_POS,
} from './varkhul_assembly';
import {
  type ActiveVarkhulCinderFire,
  type ActiveVarkhulCinderOrbProjectile,
  activeVarkhulCinderFires,
  activeVarkhulCinderOrbProjectiles,
} from './varkhul_cinder_orbs';
import {
  activeVarkhulForgePortalTelegraphs,
  type VarkhulForgePortalTelegraph,
} from './varkhul_forge_intermission';
import {
  type ActiveVarkhulForgestormWarning,
  activeVarkhulForgestormWarnings,
} from './varkhul_forgestorm';

export type { ActiveIgnivarMeteorWarning } from './ignivar_meteors';
export type { ActiveVarkhulAnvilMeteorWarning } from './varkhul_anvil_meteors';
export type { ActiveVarkhulAssembly } from './varkhul_assembly';
export type {
  ActiveVarkhulCinderFire,
  ActiveVarkhulCinderOrbProjectile,
} from './varkhul_cinder_orbs';
export type { VarkhulForgePortalTelegraph } from './varkhul_forge_intermission';
export type { ActiveVarkhulForgestormWarning } from './varkhul_forgestorm';

export function collectActiveIgnivarMeteors(ctx: SimContext): ActiveIgnivarMeteorWarning[] {
  const warnings: ActiveIgnivarMeteorWarning[] = [];
  for (const entity of ctx.entities.values()) {
    if (entity.templateId === IGNIVAR_BOSS_ID && entity.ignivar) {
      warnings.push(...activeIgnivarMeteorWarnings(entity.id, entity.ignivar));
    }
    const trashWarning = activeIgnivarTrashMeteorWarning(entity);
    if (trashWarning) warnings.push(trashWarning);
  }
  return warnings;
}

export function collectActiveVarkhulForgestormWarnings(
  ctx: SimContext,
): ActiveVarkhulForgestormWarning[] {
  const warnings: ActiveVarkhulForgestormWarning[] = [];
  for (const entity of ctx.entities.values()) {
    if (entity.templateId !== VARKHUL_BOSS_ID || !entity.varkhul) continue;
    warnings.push(...activeVarkhulForgestormWarnings(entity.id, entity.varkhul));
  }
  return warnings;
}

export function collectActiveVarkhulAnvilMeteors(
  ctx: SimContext,
): ActiveVarkhulAnvilMeteorWarning[] {
  const warnings: ActiveVarkhulAnvilMeteorWarning[] = [];
  for (const entity of ctx.entities.values()) {
    if (entity.templateId !== VARKHUL_BOSS_ID || entity.dead || !entity.varkhul) continue;
    for (const batch of entity.varkhul.anvilMeteorBatches ?? []) {
      warnings.push(...activeVarkhulAnvilMeteorWarnings(entity.id, batch));
    }
  }
  return warnings;
}

export function collectActiveVarkhulAssemblies(ctx: SimContext): ActiveVarkhulAssembly[] {
  const assemblies: ActiveVarkhulAssembly[] = [];
  for (const entity of ctx.entities.values()) {
    if (entity.templateId !== VARKHUL_BOSS_ID || entity.dead) continue;
    const instance = ctx.instances.find((candidate) => candidate.mobIds.includes(entity.id));
    const origin = instance ? ctx.instanceOriginOf(instance) : null;
    const forge = origin
      ? ctx.groundPos(
          origin.x + VARKHUL_ASSEMBLY_FORGE_LOCAL_POS.x,
          origin.z + VARKHUL_ASSEMBLY_FORGE_LOCAL_POS.z,
        )
      : entity.pos;
    // Pre-pull the boss carries engage staging state but the assembly set
    // piece has not entered the fight: keep the inactive readout until he
    // actually engages, exactly as when the encounter had never ticked.
    const active =
      entity.varkhul && (entity.varkhul.engage?.phase ?? 'done') !== 'forging'
        ? activeVarkhulAssembly(entity.id, entity.varkhul, forge, entity.pos, (id) =>
            ctx.entities.get(id),
          )
        : inactiveVarkhulAssembly(entity.id, instance?.difficulty ?? 'normal', forge);
    if (active) assemblies.push(active);
  }
  return assemblies;
}

export function collectActiveVarkhulForgePortalTelegraphs(
  ctx: SimContext,
): VarkhulForgePortalTelegraph[] {
  const telegraphs: VarkhulForgePortalTelegraph[] = [];
  for (const entity of ctx.entities.values()) {
    if (entity.templateId !== VARKHUL_BOSS_ID || entity.dead || !entity.varkhul) continue;
    const instance = ctx.instances.find((candidate) => candidate.mobIds.includes(entity.id));
    if (!instance) continue;
    telegraphs.push(
      ...activeVarkhulForgePortalTelegraphs(
        entity.id,
        entity.varkhul,
        ctx.instanceOriginOf(instance),
      ),
    );
  }
  return telegraphs;
}

export function collectActiveVarkhulCinderFires(ctx: SimContext): ActiveVarkhulCinderFire[] {
  const fires: ActiveVarkhulCinderFire[] = [];
  for (const entity of ctx.entities.values()) {
    if (entity.templateId !== VARKHUL_BOSS_ID || entity.dead || !entity.varkhul) continue;
    fires.push(...activeVarkhulCinderFires(entity.id, entity.varkhul));
  }
  return fires;
}

export function collectActiveVarkhulCinderOrbProjectiles(
  ctx: SimContext,
): ActiveVarkhulCinderOrbProjectile[] {
  const projectiles: ActiveVarkhulCinderOrbProjectile[] = [];
  for (const entity of ctx.entities.values()) {
    if (entity.templateId !== VARKHUL_BOSS_ID || entity.dead || !entity.varkhul) continue;
    projectiles.push(...activeVarkhulCinderOrbProjectiles(entity.id, entity.varkhul));
  }
  return projectiles;
}
