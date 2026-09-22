// Slumber: a mob who sleeps through the night (MobTemplate.slumber).
//
// The Mirefen world boss is meant to be a DAYTIME event. At dusk he stops being a fight
// and becomes a landmark: once whatever he was doing is over, he walks home to the
// crater he rose from, lies down, and is neutral until sunrise, when he wakes with a yell
// the whole zone hears. A raid that finds him after dark finds a sleeping giant they
// cannot hurt and a reason to come back in the morning; a raid that pulled him before
// sunset gets to finish the pull, because a boss who blinks out mid-fight because a
// clock ticked over is the one thing this must never do.
//
// Why NEUTRAL rather than immune: `hostile` is the one bit every attack path already
// consults (Sim.isHostileTo), so a sleeping boss is unattackable the same way a vendor
// is, with no new branch in the damage hub, no floating "Immune" word to localize, and a
// yellow nameplate that reads as exactly what he is. The hostility safety net in
// mob/locomotion.ts runs AFTER this module's early return, so it never re-arms him.
//
// Determinism (sim core): no clock read of its own; night comes from ctx.dayNightPhase(),
// the host-injected day/night clock behind the seam. A host with no such clock (tests,
// the RL env) has no night, so every mob here is permanently awake and the module is
// inert. Draws no rng.

import { MOBS, zoneAt } from '../data';
import { isDaylightPhase } from '../day_night';
import type { SimContext } from '../sim_context';
import { clearThreat } from '../threat';
import { type Aura, DT, dist2d, type Entity, type MobTemplate } from '../types';
import { highestThreatTarget } from './targeting';
import { emitMobYell } from './yells';

/** Aura id of the slumber (the frame shows it as a buff; the HUD keys its tooltip on it). */
export const SLUMBER_AURA_ID = 'slumber';

type SlumberDef = NonNullable<MobTemplate['slumber']>;

/**
 * What the dispatcher should do after this tick:
 *  - 'awake':  run the ordinary mob AI (day, or a fight still running after dusk).
 *  - 'homing': he is walking home to bed; nothing else this tick (no aggro scan).
 *  - 'asleep': he is in bed; nothing else this tick.
 *  - 'rising': just woke, standing up (slumber.riseSeconds); hostile, but the AI waits.
 */
export type SlumberTick = 'awake' | 'homing' | 'asleep' | 'rising';

/** Night, for a slumbering template: a clocked host past sunset. Clockless is day. */
function slumberNight(ctx: SimContext): boolean {
  const phase = ctx.dayNightPhase();
  return phase !== null && !isDaylightPhase(phase);
}

/**
 * The per-tick driver. Called from the mob dispatcher before any AI runs, every alive
 * tick, so the sleep state exists in every state the mob can be alive in.
 */
export function tickSlumber(ctx: SimContext, mob: Entity): SlumberTick {
  const def = MOBS[mob.templateId]?.slumber;
  if (!def) return 'awake';
  const night = slumberNight(ctx);
  if (mob.asleep) {
    if (night) {
      holdAsleep(mob, def);
      return 'asleep';
    }
    wake(ctx, mob, def);
    return rise(ctx, mob);
  }
  if (mob.slumberRise !== undefined && mob.slumberRise > 0) return rise(ctx, mob);
  if (!night) return 'awake';
  // Night, and he is up. A running fight is fought to its end: the pull decides when
  // the day ends, not the clock. An evade walk home is already a walk home.
  if (
    mob.inCombat ||
    mob.threat.size > 0 ||
    mob.aiState === 'chase' ||
    mob.aiState === 'attack' ||
    mob.aiState === 'flee' ||
    mob.aiState === 'evade'
  ) {
    return 'awake';
  }
  // Idle after dark: walk home, and lie down once in bed.
  if (dist2d(mob.pos, mob.spawnPos) > def.bedRadius) {
    if (!ctx.isRooted(mob)) {
      ctx.moveToward(mob, mob.spawnPos, mob.moveSpeed * ctx.moveSpeedMult(mob));
    }
    mob.aiState = 'idle';
    return 'homing';
  }
  fallAsleep(ctx, mob, def);
  return 'asleep';
}

/**
 * The rise: count the hold down and keep the AI off him while the body stands up. The
 * renderer plays the wake one-shot on the asleep-to-awake edge; if the ordinary AI ran the
 * same tick, the first wander step or aggro chase would slide the sleeping pose across
 * the ground while it played, the exact skate the boss's clips were authored to remove.
 * He is hostile the whole time: a raid that is waiting for him can open on him, and the
 * threat they build is waiting for the AI when the hold ends.
 */
function rise(ctx: SimContext, mob: Entity): SlumberTick {
  if (mob.slumberRise === undefined || mob.slumberRise <= 0) return 'awake';
  mob.slumberRise = Math.max(0, mob.slumberRise - DT);
  if (mob.slumberRise <= 0) {
    // The hold is over on THIS tick, so hand the AI the hate table the raid built while
    // he stood up, before the idle stomp below can outlive the hold. The stomp is what
    // makes this necessary: dealDamage puts an attacked mob straight into 'chase', and
    // holding him idle every tick overwrote that, so when the hold ended he was an idle
    // mob with a full threat table. The idle scan is capped at MAX_AGGRO_RADIUS, so he
    // would then re-acquire only an attacker who happened to be inside 20 yards, and a
    // raid opens on a world boss from further out than that. Engaging from the table (not
    // from a scan) is the same rule retargetMob already uses after a target dies.
    const opener = highestThreatTarget(ctx, mob);
    if (opener) {
      mob.aggroTargetId = opener.id;
      mob.aiState = 'chase';
      mob.inCombat = true;
      mob.despawnTimer = undefined;
      return 'rising';
    }
  }
  mob.aiState = 'idle';
  return 'rising';
}

function fallAsleep(ctx: SimContext, mob: Entity, def: SlumberDef): void {
  mob.asleep = true;
  if (mob.slumberRise !== undefined) mob.slumberRise = 0;
  mob.hostile = false;
  mob.aiState = 'idle';
  mob.inCombat = false;
  mob.aggroTargetId = null;
  mob.forcedTargetId = null;
  mob.forcedTargetTimer = 0;
  clearThreat(mob);
  // A night's sleep is a full recovery, so dawn always opens on a whole boss.
  mob.hp = mob.maxHp;
  holdAsleep(mob, def);
  if (def.sleepYell) emitMobYell(ctx, mob, def.sleepYell, def.yellRange);
  // Anchorless log => broadcast to every connected player as a system notice, exactly
  // like the "rises over" spawn line; localized by the sim_i18n RULE matched on this
  // literal shape. It is the "he is gone for the night" the whole realm wants to know.
  ctx.emit({ type: 'log', text: `${mob.name} sleeps until dawn.`, color: '#ffd100' });
}

/** Re-assert the sleeping invariants every tick (the aura is presentation of the state,
 *  reconciled rather than trusted, the same discipline as mob/eye_ward.ts). */
function holdAsleep(mob: Entity, def: SlumberDef): void {
  mob.hostile = false;
  mob.aiState = 'idle';
  mob.inCombat = false;
  // Whole all night, not just at the edges: a lingering tick from before dusk or a source
  // that never consults isHostileTo must not carve into a sleeper nobody can fight.
  mob.hp = mob.maxHp;
  if (!mob.auras.some((a) => a.id === SLUMBER_AURA_ID)) mob.auras.push(slumberAura(mob, def));
}

function wake(ctx: SimContext, mob: Entity, def: SlumberDef): void {
  mob.asleep = false;
  mob.hostile = true;
  mob.slumberRise = def.riseSeconds ?? 0;
  mob.auras = mob.auras.filter((a) => a.id !== SLUMBER_AURA_ID);
  mob.hp = mob.maxHp;
  // Threat can be seeded onto a neutral sleeper by sources that never consult hostility
  // (a heal's awareness threat, a mass-threat effect); dawn opens on a boss aggroed on
  // nobody, never on someone who slept past him.
  clearThreat(mob);
  emitMobYell(ctx, mob, def.wakeYell, def.yellRange);
  // The daily call to arms, realm-wide (same channel as the spawn announcement).
  ctx.emit({
    type: 'log',
    text: `${mob.name} wakes over ${zoneAt(mob.pos.x, mob.pos.z).name}!`,
    color: '#ffd100',
  });
}

/**
 * The slumber aura: a value-zero damage-reduction buff, chosen because every HUD already
 * classifies that kind as a benign buff (the ward uses the same kind), and value 0 is a
 * mitigation of nothing. It exists so the target frame can SAY he is asleep; the state
 * itself is `mob.asleep`, and this is re-derived from it every tick.
 */
function slumberAura(mob: Entity, def: SlumberDef): Aura {
  return {
    id: SLUMBER_AURA_ID,
    name: def.auraName,
    kind: 'buff_dr',
    value: 0,
    remaining: 3600,
    duration: 3600,
    permanent: true,
    sourceId: mob.id,
    school: 'physical',
  };
}
