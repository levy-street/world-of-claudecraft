import { createMob } from '../../src/sim/entity';
import { openWorldMobScale } from '../../src/sim/mob/open_world_tuning';
import type { MobTemplate } from '../../src/sim/types';

// v0.45.7 (28946ac800), src/sim/mob/open_world_tuning.ts. This release
// postdates the wiki worktree and changes health while retaining the damage curve.
export function releasedCampStats(mob: MobTemplate, level: number) {
  const pos = { x: 0, y: 0, z: 0 };
  if (
    mob.dummy ||
    mob.ambient ||
    mob.friendlyPracticeTarget ||
    mob.worldBoss ||
    mob.requiresQuestId ||
    mob.xpMult === 0
  )
    return createMob(1, mob, level, pos);
  const levelHealth = 1 + Math.min(15, Math.max(0, level - 5)) * 0.15;
  const health = mob.elite
    ? Math.max(1, ((40 + 18 * level) * levelHealth) / (mob.hpBase + mob.hpPerLevel * (level - 1)))
    : levelHealth;
  const damage = mob.elite ? 1 : openWorldMobScale(level).damage;
  const entity = createMob(
    1,
    {
      ...mob,
      hpBase: mob.hpBase * health,
      hpPerLevel: mob.hpPerLevel * health,
      dmgBase: mob.dmgBase * damage,
      dmgPerLevel: mob.dmgPerLevel * damage,
    },
    level,
    pos,
  );
  if (damage !== 1) entity.mechanicDamageMult = damage;
  if (health !== 1) entity.mechanicHealMult = health;
  return entity;
}
