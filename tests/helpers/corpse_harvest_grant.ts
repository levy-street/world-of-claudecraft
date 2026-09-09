// Grant-completion fixtures isolate yield and attribution math from cast ticks.
// They build inputs through the real snapshot helper and call the same grant
// function used by timed completion. Public admission is tested separately in
// corpse_harvest_command.test.ts; this driver does not simulate it.

import { MOBS } from '../../src/sim/data';
import {
  grantCorpseHarvest,
  snapshotCorpseHarvestGrantInputs,
} from '../../src/sim/professions/corpse_harvest_grant';
import type { PlayerMeta, Sim } from '../../src/sim/sim';
import type { Entity } from '../../src/sim/types';

export function grantCorpseHarvestOnMob(
  sim: Sim,
  mob: Entity,
  meta: PlayerMeta,
  chosen: readonly string[] | undefined,
): boolean {
  const componentTags = MOBS[mob.templateId]?.componentTags ?? [];
  const inputs = snapshotCorpseHarvestGrantInputs(meta, componentTags, chosen ?? []);
  return grantCorpseHarvest(sim.ctx, mob, meta, inputs);
}
