// Boss support mechanics (M5), extracted from the Sim monolith: the per-tick
// template-driven boss kit (summonAdds waves, enrage, desperateHeal, the Mend/
// Ward/Rally/War Cadence support pulses, the channeled escalating heal) plus
// the add-wave spawner it fires. Driven by mob/locomotion.ts updateMob via
// ctx.updateBossMechanics; the add spawner is also reached by the delve boss
// scripts (delves/drowned_litany_boss.ts, delves/runs.ts) via ctx.spawnBossAdds.
// Sim keeps thin same-named private delegates because several suites reach the
// methods on the facade by cast (mob_rally / mob_ward_allies / mob_mend_ally /
// mob_desperate_heal / mob_warcry / delves / sloomtooth_drowned /
// summon_threat_seed), the resetNythraxisEncounter precedent.
import { isLockedOut, isSilenced } from '../combat/cc';
import { isRiftPos, MOBS } from '../data';
import { onBossAddsSummonedForDeeds } from '../deeds';
import { findDelveObject } from '../delves/runs';
import { createMob } from '../entity';
import {
  applyDungeonMobTuning,
  mobLevelForDungeonDifficulty,
  mobTemplateForDungeonDifficulty,
} from '../instances/difficulty';
import { riftMechanicSuppressed, riftRankTemplate, riftRankTuningFor } from '../rift/ranks';
import { riftInstanceAtPos } from '../rift/runs';
import type { SimContext } from '../sim_context';
import { addThreat, SUMMONED_ADD_THREAT_SEED, threatEntries } from '../threat';
import { DT, dist2d, type Entity, LEASH_DISTANCE } from '../types';
import { mobCombatProfile } from './combat_profile';
import { NYTHRAXIS_SPIRIT_MENDING_CAST_ID } from './healer_channel';
import { findNearbyAllies } from './nearby_allies';
import { emitMobYell } from './yells';

export function updateBossMechanics(ctx: SimContext, mob: Entity): void {
  if (mob.dead || mob.hp <= 0) return;
  const tmpl = MOBS[mob.templateId];
  if (
    !tmpl ||
    (!tmpl.summonAdds &&
      !tmpl.enrage &&
      !tmpl.desperateHeal &&
      !tmpl.mendAlly &&
      !tmpl.wardAllies &&
      !tmpl.channelHeal &&
      !tmpl.rally &&
      !tmpl.warcry)
  )
    return;
  const hpFrac = mob.hp / Math.max(1, mob.maxHp);
  // Rank-gated rift boss kits: a mechanic listed in the template's
  // rankMechanics past the spawn's budget never fires (rift/ranks.ts).
  // Inert for every non-rift mob (no riftMechanicLimit on the entity).
  if (tmpl.summonAdds && !riftMechanicSuppressed(mob, 'summonAdds')) {
    const thresholds = tmpl.summonAdds.atHpPct;
    while (mob.firedSummons < thresholds.length && hpFrac <= thresholds[mob.firedSummons]) {
      mob.firedSummons++;
      if (tmpl.yells?.summon) emitMobYell(ctx, mob, tmpl.yells.summon, tmpl.battleYells?.range);
      const run = ctx.delveRunForMob(mob.id);
      if (
        run &&
        findDelveObject(ctx, run, 'cracked_grave') &&
        ctx.startDelveRaiseDeadChannel(run, mob, tmpl.summonAdds.mobId, tmpl.summonAdds.count)
      )
        continue;
      spawnBossAdds(ctx, mob, tmpl.summonAdds.mobId, tmpl.summonAdds.count);
    }
  }
  // Delve bosses enrage on Heroic only (PRD delves.md §7.4: "Heroic: optional
  // enrage below 20% HP"). World bosses have no delve run, so they enrage as
  // before. Only resolved for enrage-capable templates, so the lookup is rare.
  const enrageRun = tmpl.enrage ? ctx.delveRunForMob(mob.id) : null;
  const enrageAllowed = !enrageRun || enrageRun.tierId === 'heroic';
  if (tmpl.enrage && enrageAllowed && !mob.enraged && hpFrac <= tmpl.enrage.belowHpPct) {
    mob.enraged = true;
    if (tmpl.yells?.enrage) emitMobYell(ctx, mob, tmpl.yells.enrage, tmpl.battleYells?.range);
    ctx.emit({ type: 'aura', targetId: mob.id, name: 'Enrage', gained: true });
    if (!tmpl.quietMechanics)
      ctx.emit({
        type: 'log',
        text: `${mob.name} becomes enraged!`,
        color: '#ff6666',
        entityId: mob.id,
      });
    ctx.emit({
      type: 'spellfx',
      sourceId: mob.id,
      targetId: mob.id,
      school: 'fire',
      fx: 'nova',
    });
  }
  if (
    tmpl.desperateHeal &&
    !riftMechanicSuppressed(mob, 'desperateHeal') &&
    !mob.healedThisPull &&
    hpFrac <= tmpl.desperateHeal.belowHpPct
  ) {
    mob.healedThisPull = true;
    const heal = Math.min(mob.maxHp - mob.hp, Math.round(mob.maxHp * tmpl.desperateHeal.healPct));
    if (heal > 0) {
      mob.hp += heal;
      ctx.emit({ type: 'heal', targetId: mob.id, amount: heal });
      ctx.emit({
        type: 'log',
        text: `${mob.name} draws on a desperate second wind!`,
        color: '#66ff99',
        entityId: mob.id,
      });
      ctx.emit({
        type: 'spellfx',
        sourceId: mob.id,
        targetId: mob.id,
        school: 'nature',
        fx: 'nova',
      });
    }
  }
  // Support "Mend": periodically heal every wounded friendly mob in range
  // (including the caster). Telegraphed via createMob seeding mendTimer to a
  // full interval, so the first cast never lands the instant combat opens.
  if (tmpl.mendAlly) {
    mob.mendTimer -= DT;
    if (mob.mendTimer <= 0) {
      mob.mendTimer = tmpl.mendAlly.every;
      const wounded = findNearbyAllies(
        ctx.grid,
        mob,
        tmpl.mendAlly.radius,
        (ally) => ally.hp < ally.maxHp, // only wounded same-faction mobs
      );
      if (wounded.length > 0) {
        const school = tmpl.mendAlly.school ?? 'nature';
        ctx.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
        ctx.emit({
          type: 'log',
          text: `${mob.name} channels ${tmpl.mendAlly.name}.`,
          color: '#66ff99',
          entityId: mob.id,
        });
        for (const ally of wounded) {
          const amount = Math.round(
            ctx.rng.range(tmpl.mendAlly.healMin, tmpl.mendAlly.healMax) *
              (mob.mechanicHealMult ?? 1),
          );
          ctx.applyHeal(mob, ally, amount, tmpl.mendAlly.name);
        }
      }
    }
  }
  // Support "Ward": the defensive twin of Mend. Periodically wrap every living
  // friendly mob in range (including the caster) in an absorb shield. Unlike
  // Mend it targets healthy allies too: a barrier pre-empts the next blows.
  // Refreshes each interval, replacing any partially-soaked ward (same aura id).
  if (tmpl.wardAllies && !ctx.isStunned(mob)) {
    mob.wardTimer -= DT;
    if (mob.wardTimer <= 0) {
      mob.wardTimer = tmpl.wardAllies.every;
      const allies = findNearbyAllies(ctx.grid, mob, tmpl.wardAllies.radius);
      if (allies.length > 0) {
        const school = tmpl.wardAllies.school ?? 'holy';
        ctx.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
        ctx.emit({
          type: 'log',
          text: `${mob.name} channels ${tmpl.wardAllies.name}.`,
          color: '#aad4ff',
          entityId: mob.id,
        });
        for (const ally of allies) {
          ctx.applyAura(ally, {
            id: `ward_${mob.templateId}`,
            name: tmpl.wardAllies.name,
            kind: 'absorb',
            remaining: tmpl.wardAllies.duration,
            duration: tmpl.wardAllies.duration,
            value: Math.round(tmpl.wardAllies.amount * (mob.mechanicHealMult ?? 1)),
            sourceId: mob.id,
            school,
          });
        }
      }
    }
  }
  // Channeled ESCALATING heal ("Hierophant's Mending"): heal the strongest
  // friendly mob in range (its protectee, the raid boss) for a base amount plus
  // a ramp that grows each uninterrupted tick. Any stun/incapacitate/silence
  // (isStunned covers stun/incap/polymorph) breaks the channel and RESETS the
  // ramp, so a raid that fails to lock the caster down watches the boss heal for
  // more and more. The caster is CC-able by design (ccImmune: false).
  if (tmpl.channelHeal) {
    const ch = tmpl.channelHeal;
    // Stun, a true silence, OR a school lockout (a real interrupt: Kick / Pummel /
    // Counterspell lands a lockout of the channel's school) all break the channel
    // and reset the ramp. This is what makes the interruptible cast bar honest.
    const interrupted =
      ctx.isStunned(mob) || isSilenced(mob) || isLockedOut(mob, ch.school ?? 'shadow');
    if (interrupted) {
      // Clear the (scripted) channel bar so a stunned/interrupted healer is not
      // left rendering a frozen cast; updateHealerHold re-arms it once free.
      if (mob.castingAbility === NYTHRAXIS_SPIRIT_MENDING_CAST_ID) {
        mob.castingAbility = null;
        mob.castTotal = 0;
        mob.castRemaining = 0;
        mob.channeling = false;
      }
      if (mob.channelRamp > 0) {
        mob.channelRamp = 0;
        if (!tmpl.quietMechanics)
          ctx.emit({
            type: 'log',
            text: `${ch.name} is interrupted!`,
            color: '#ffcc66',
            entityId: mob.id,
          });
      }
      mob.channelTimer = ch.every;
    } else {
      mob.channelTimer -= DT;
      if (mob.channelTimer <= 0) {
        mob.channelTimer = ch.every;
        const candidates = findNearbyAllies(
          ctx.grid,
          mob,
          ch.radius,
          (ally) => ally.id !== mob.id, // same-faction, not self
        );
        let protectee: Entity | null = null;
        for (const ally of candidates) {
          if (!protectee || ally.maxHp > protectee.maxHp) protectee = ally; // the boss = biggest pool
        }
        if (protectee && protectee.hp < protectee.maxHp) {
          const amount = Math.round(
            Math.min(ch.maxHeal, ch.baseHeal + mob.channelRamp) * (mob.mechanicHealMult ?? 1),
          );
          const school = ch.school ?? 'shadow';
          ctx.emit({
            type: 'spellfx',
            sourceId: mob.id,
            targetId: protectee.id,
            school,
            fx: 'beam',
          });
          // Reuse the existing "{name} channels {mechanic}." log shape (localized
          // by the broad channels rule in sim_i18n.ts); the heal amount surfaces
          // through the heal event + beam above, so no bespoke number string ships.
          // quietMechanics healers (the Nythraxis spirit adds) stay silent: the
          // beam + heal event are enough, no per-tick chat line.
          if (!tmpl.quietMechanics)
            ctx.emit({
              type: 'log',
              text: `${mob.name} channels ${ch.name}.`,
              color: '#66ff99',
              entityId: mob.id,
            });
          ctx.applyHeal(mob, protectee, amount, ch.name);
        }
        // The ramp grows each uninterrupted tick (capped so base+ramp never
        // exceeds maxHeal), so an ignored channel heals more and more over time.
        mob.channelRamp = Math.min(ch.maxHeal - ch.baseHeal, mob.channelRamp + ch.rampAdd);
      }
    }
  }

  // Commander "Rally": periodically empower every friendly mob in range
  // (including the caster) with a refreshing attack-power buff. The offensive
  // twin of mendAlly (same telegraphed timer, same same-faction ally scan),
  // but it grants buff_ap (folded by effectiveAttackPower) instead of healing.
  if (tmpl.rally) {
    mob.rallyTimer -= DT;
    if (mob.rallyTimer <= 0) {
      mob.rallyTimer = tmpl.rally.every;
      const allies = findNearbyAllies(ctx.grid, mob, tmpl.rally.radius);
      if (allies.length > 0) {
        const school = tmpl.rally.school ?? 'physical';
        ctx.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
        if (!tmpl.quietMechanics)
          ctx.emit({
            type: 'log',
            text: `${mob.name} unleashes ${tmpl.rally.name}!`,
            color: '#ffcc33',
            entityId: mob.id,
          });
        for (const ally of allies) {
          ctx.applyAura(ally, {
            id: `rally_${mob.templateId}`,
            name: tmpl.rally.name,
            kind: 'buff_ap',
            remaining: tmpl.rally.duration,
            duration: tmpl.rally.duration,
            value: tmpl.rally.ap,
            sourceId: mob.id,
            school,
          });
        }
      }
    }
  }
  // Support "War Cadence": periodically quicken every nearby friendly mob's
  // swings (including the caster) by re-applying a refreshing buff_haste aura.
  // Same telegraph as Mend; rides swingIntervalMult's existing buff_haste fold.
  if (tmpl.warcry) {
    mob.warcryTimer -= DT;
    if (mob.warcryTimer <= 0) {
      mob.warcryTimer = tmpl.warcry.every;
      const allies = findNearbyAllies(ctx.grid, mob, tmpl.warcry.radius);
      if (allies.length > 0) {
        const school = tmpl.warcry.school ?? 'physical';
        const auraId = `warcry_${mob.templateId}`;
        ctx.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
        ctx.emit({
          type: 'log',
          text: `${mob.name} channels ${tmpl.warcry.name}.`,
          color: '#ffd27f',
          entityId: mob.id,
        });
        for (const ally of allies) {
          const existing = ally.auras.find((a) => a.id === auraId);
          if (existing) {
            existing.remaining = tmpl.warcry.duration; // refresh on each pulse; never stack
            continue;
          }
          ally.auras.push({
            id: auraId,
            name: tmpl.warcry.name,
            kind: 'buff_haste',
            remaining: tmpl.warcry.duration,
            duration: tmpl.warcry.duration,
            value: tmpl.warcry.hasteMult,
            sourceId: mob.id,
            school,
          });
          ctx.emit({ type: 'aura', targetId: ally.id, name: tmpl.warcry.name, gained: true });
        }
      }
    }
  }
}

export function spawnBossAdds(ctx: SimContext, boss: Entity, mobId: string, count: number): void {
  const template = MOBS[mobId];
  if (!template) return;
  ctx.emit({
    type: 'log',
    text: `${boss.name} calls for aid!`,
    color: '#ff6666',
    entityId: boss.id,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'nova',
  });
  // adds spawned inside a claimed instance despawn with it
  const delveRun = ctx.delveRunForMob(boss.id);
  const inst = ctx.instances.find((i) => {
    if (i.partyKey === null) return false;
    const o = ctx.instanceOriginOf(i);
    return Math.abs(boss.pos.x - o.x) < 120 && Math.abs(boss.pos.z - o.z) < 250;
  });
  const [topThreatId] = threatEntries(boss, 1)[0] ?? [];
  const victimId = boss.aggroTargetId ?? topThreatId ?? null;
  let victim = victimId !== null ? (ctx.entities.get(victimId) ?? null) : null;
  if (!victim || victim.dead || victim.kind !== 'player') {
    // Fallback so freshly-summoned adds always have a nearby enemy to charge even if
    // the boss's own target just died or dropped: pick the closest live player.
    let best: Entity | null = null;
    let bestD = Infinity;
    ctx.playerGrid.forEachInRadius(boss.pos.x, boss.pos.z, LEASH_DISTANCE, (pl, d2) => {
      if (pl.kind === 'player' && !pl.dead && d2 < bestD) {
        bestD = d2;
        best = pl;
      }
    });
    victim = best;
  }
  // World bosses erupt their adds from directly underneath them (centered, a tight
  // 1yd cluster spread only enough to not stack on one point); ordinary summoners keep
  // the wider 3.5yd ring beside the boss.
  const spawnRadius = MOBS[boss.templateId]?.worldBoss ? 1 : 3.5;
  // A rift boss's adds always match the dungeon: spawn at the BOSS's own
  // level (the floor level, ~20s), never a roll of the template band, and at
  // EVERY rank take the rift add tuning (rift/ranks.ts). The rank derives
  // from the instance descriptor, so all hosts agree.
  const riftInst = isRiftPos(boss.pos.x) ? riftInstanceAtPos(ctx, boss.pos) : null;
  const riftTuning = riftInst ? riftRankTuningFor(riftInst.baseLevel) : null;
  for (let k = 0; k < count; k++) {
    const ang = (k / count) * Math.PI * 2 + 0.7;
    const pos = ctx.groundPos(
      boss.pos.x + Math.sin(ang) * spawnRadius,
      boss.pos.z + Math.cos(ang) * spawnRadius,
    );
    // The band roll stays even when a rift overrides the level below, so the
    // rng draw count and order never depend on where the boss stands.
    const rolledLevel = ctx.rng.int(template.minLevel, template.maxLevel);
    const difficulty = inst?.difficulty ?? 'normal';
    let addTemplate = mobTemplateForDungeonDifficulty(template, inst?.dungeonId ?? '', difficulty, {
      summonedAdd: true,
    });
    let level = mobLevelForDungeonDifficulty(inst?.dungeonId ?? '', difficulty, rolledLevel);
    if (riftInst && riftTuning) {
      level = boss.level;
      // The add wave lands on top of the boss's own output, so BOTH its
      // auto-attack (via the template transform) and its mechanics (via
      // mechanicDamageMult below) take the softer addDamageMultiplier, while
      // its pool rides the trash health line: wave pressure, not extra bosses.
      addTemplate = riftRankTemplate(template, riftTuning, 'add');
    }
    const add = createMob(ctx.nextId++, addTemplate, level, pos);
    applyDungeonMobTuning(add, inst?.dungeonId ?? '', difficulty, { summonedAdd: true });
    if (riftTuning) {
      add.mechanicDamageMult = riftTuning.addDamageMultiplier;
      add.mechanicHealMult = riftTuning.healthMultiplier;
    }
    // The add is anchored where it ERUPTED (createMob already set spawnPos to the
    // spawn point beside the boss): a boss kited far from HIS original spawn must
    // not hatch adds that are instantly past their own leash and evade home without
    // ever swinging. Kited from here, the chase-case leash check walks it back to
    // this eruption point, not the boss's distant home.
    add.tappedById = boss.tappedById;
    // Slain adds unravel with their corpse (mob/locomotion.ts) rather than
    // respawning at the eruption point, which is wherever the fight dragged.
    add.summonedAdd = true;
    ctx.addEntity(add);
    boss.summonedIds.push(add.id);
    inst?.mobIds.push(add.id);
    delveRun?.mobIds.push(add.id);
    if (victim && !victim.dead && victim.kind === 'player') {
      add.aggroTargetId = victim.id;
      add.inCombat = true;
      add.aiState =
        dist2d(add.pos, victim.pos) > mobCombatProfile(add).meleeRange ? 'chase' : 'attack';
      // Same seeding aggroMob does on a normal pull: the leash measures from the
      // eruption point until a hostile player action refreshes it.
      add.leashAnchor = { ...add.pos };
      // A REAL tank lead, not a token point: healing threat on the tank splits
      // to every mob aware of him, so a 1-point seed sent every summon wave at
      // the healer (one add swing one-shots a cloth pool). 750 covers roughly
      // ten seconds of normal healing; sustained DPS focus can still rip an
      // add loose, and taunt or tank threat answers it.
      addThreat(add, victim.id, SUMMONED_ADD_THREAT_SEED);
    }
    // Book of Deeds kill-order tasks track every add this attempt summoned.
    onBossAddsSummonedForDeeds(ctx, boss, [add.id]);
  }
}
