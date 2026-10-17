// Old Thatchgrin's lifecycle: he stands in his pumpkin patch past Boar Meadow for as long
// as Gourdlight Eve runs, and only then. Called once a tick from updateSeasonal.
//
//   - Event open, nobody in the field, respawn due: he stands up (scarecrow_field.ts
//     finds the field against the live world; no field, no boss).
//   - Alive: his health pool grows with the crowd (world_boss.ts scaleWorldBossHp, the
//     same retail-style step every world boss uses), and his kit runs (scarecrow_kit.ts).
//   - Dead: his corpse lies for THATCHGRIN_CORPSE_SECONDS, long enough for every
//     contributor to walk over and take their personal spoils, then it goes and he
//     stands again THATCHGRIN_RESPAWN_SECONDS later.
//   - Event closed: he and his adds leave at once, alive or not.
//
// He is a `worldBoss` template, so the kill reuses the world-boss rules wholesale: personal
// loot rolled for every contributor (damage or threat), the loot lockout written when a
// contributor LOOTS (interaction.ts lootCorpse), expiring on the realm's daily reset, so
// the spoils are once a day per character and the fight is open to anyone who turns up.
//
// Draws no rng (the spawn level is the template maximum, the facing is the field's), so
// raising him moves no draw. He allocates an entity id when he stands, only while the event
// is open.

import { GOURDLIGHT_EVE_ID } from '../content/gourdlight_eve';
import {
  THATCHGRIN_CORPSE_SECONDS,
  THATCHGRIN_DAMAGE_MULT,
  THATCHGRIN_HP_CAP_RATIO,
  THATCHGRIN_HP_MULT,
  THATCHGRIN_HP_STEP_RATIO,
  THATCHGRIN_ID,
  THATCHGRIN_RESPAWN_SECONDS,
} from '../content/gourdlight_eve_scarecrow';
import { MOBS } from '../data';
import { createMob } from '../entity';
import { openWorldMobScale } from '../mob/open_world_tuning';
import type { SimContext } from '../sim_context';
import type { Entity, MobTemplate } from '../types';
import { scaleWorldBossHp, type WorldBossDef } from '../world_boss';
import { resolveScarecrowField } from './scarecrow_field';
import { resetScarecrowKit, tickScarecrowKit } from './scarecrow_kit';
import type { ScarecrowState } from './scarecrow_state';

/** His template on the open-world curve at his level (the Warden ladder a camp spawn of
 *  the Warden would carry: health, melee, armour), then the owner's design multipliers on
 *  health ("very high") and melee ("low"). worldBoss flags untouched. */
export function thatchgrinSpawnTemplate(template: MobTemplate): MobTemplate {
  const s = openWorldMobScale(template.maxLevel);
  const hp = s.health * THATCHGRIN_HP_MULT;
  const dmg = s.damage * THATCHGRIN_DAMAGE_MULT;
  return {
    ...template,
    hpBase: template.hpBase * hp,
    hpPerLevel: template.hpPerLevel * hp,
    dmgBase: template.dmgBase * dmg,
    dmgPerLevel: template.dmgPerLevel * dmg,
    armorPerLevel: template.armorPerLevel * s.armor,
  };
}

function hpDef(st: ScarecrowState, boss: Entity): WorldBossDef {
  const scale = st.hpScale ?? { base: boss.maxHp, perPlayer: 0, max: boss.maxHp };
  return { templateId: THATCHGRIN_ID, pos: boss.spawnPos, intervalSeconds: 0, hpScale: scale };
}

/** Raise him in his field now. Null when his template or his field is missing. */
export function spawnThatchgrin(ctx: SimContext, st: ScarecrowState): Entity | null {
  const template = MOBS[THATCHGRIN_ID];
  const field = resolveScarecrowField(ctx.cfg.seed);
  if (!template || !field) return null;
  const mob = createMob(
    ctx.nextId++,
    thatchgrinSpawnTemplate(template),
    template.maxLevel,
    ctx.groundPos(field.x, field.z),
  );
  mob.facing = field.facing;
  mob.prevFacing = field.facing;
  const base = mob.maxHp;
  st.hpScale = {
    base,
    perPlayer: Math.round(base * THATCHGRIN_HP_STEP_RATIO),
    max: Math.round(base * THATCHGRIN_HP_CAP_RATIO),
  };
  ctx.addEntity(mob);
  st.bossId = mob.id;
  st.kit = null;
  return mob;
}

/** He and everything he called leave the world. */
export function clearThatchgrin(ctx: SimContext, st: ScarecrowState): void {
  const boss = st.bossId !== null ? ctx.entities.get(st.bossId) : undefined;
  if (boss) {
    resetScarecrowKit(ctx, boss, st);
    // the shared despawn (existence checks, targets cleared), then whatever a corpse kept
    ctx.despawnSummonedAdds(boss);
    for (const addId of boss.summonedIds) if (ctx.entities.has(addId)) ctx.dropEntity(addId);
    ctx.dropEntity(boss.id);
  }
  st.bossId = null;
  st.kit = null;
  st.hpScale = null;
}

export function updateScarecrow(ctx: SimContext, active: string | null): void {
  const st = ctx.seasonal.scarecrow;
  if (active !== GOURDLIGHT_EVE_ID) {
    if (st.bossId !== null) clearThatchgrin(ctx, st);
    st.respawnAt = 0;
    return;
  }
  if (st.bossId !== null) {
    const boss = ctx.entities.get(st.bossId);
    if (!boss || boss.templateId !== THATCHGRIN_ID) {
      st.bossId = null;
      st.kit = null;
      st.respawnAt = ctx.time + THATCHGRIN_RESPAWN_SECONDS;
    } else if (boss.dead) {
      if (st.kit) resetScarecrowKit(ctx, boss, st);
      // The world-boss window is fifteen minutes; his field turns over sooner.
      if (boss.corpseTimer > THATCHGRIN_CORPSE_SECONDS)
        boss.corpseTimer = THATCHGRIN_CORPSE_SECONDS;
      if (boss.corpseTimer <= 0) {
        clearThatchgrin(ctx, st);
        st.respawnAt = ctx.time + THATCHGRIN_RESPAWN_SECONDS;
      }
      return;
    } else {
      scaleWorldBossHp(ctx, boss, hpDef(st, boss));
      tickScarecrowKit(ctx, boss, st);
      return;
    }
  }
  if (ctx.time >= st.respawnAt) spawnThatchgrin(ctx, st);
}
