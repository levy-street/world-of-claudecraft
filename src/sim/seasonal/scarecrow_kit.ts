// Old Thatchgrin's fight: four reads, each answered a different way.
//
//   GOURDFALL       He rips a lit gourd off his shoulders and hurls it at the sky, and the
//                   sky answers: burning pumpkins rain on his field, one on every fighter
//                   (up to five) and a few on open ground round him. A ground ring marks
//                   each landing spot at its true radius from the cue, and they land one
//                   after another, a cascade rather than one beat. Dodged by MOVING out of
//                   the ring under you, and not into the next.
//   SMOLDERING CHAFF Every pumpkin leaves the stubble burning where it landed: a smaller
//                   patch that scorches anyone standing in it once a second until it
//                   gutters out. Dodged by NOT STANDING in it.
//   THE CALLS       At falling health he throws his arms wide: first his crows burst off
//                   him (Crowcall), then strawlings climb out of the stubble (Chaff Rising),
//                   twice each, once per pull. Answered by turning to the adds.
//   SWELLING GOURD  Twice a pull his patch heaves up a giant pumpkin behind him
//                   (scarecrow_swell.ts): while it lives he shrugs off most of every hit,
//                   and if its fuse runs out it bursts over the whole fight. Answered by
//                   the classic switch: break it, and he reels, stunned and split open.
//
// Telegraphs never overlap: a call or a rain claims the ground for its windup plus
// `spacing`, and a due rain waits for it. Numbers are content (THATCHGRIN_KIT, sourced and
// flagged in content/gourdlight_eve_scarecrow.ts).
//
// Only players in his fight (his hate table, or who hurt him this pull) are aimed at or
// struck, so a passer-by on the road is never caught.
//
// Determinism: every draw is ctx.rng, in a fixed order: the rain's victims (fighters
// sorted by entity id, a partial Fisher-Yates over them), then two draws per open-ground
// pumpkin (bearing, then reach); then one damage roll per player struck, per pumpkin in
// landing order, then per chaff patch in list order. Nothing here runs outside his pull,
// and he only exists while Gourdlight Eve runs, so no shipped trace moves.
import {
  THATCHGRIN_CHAFF_ABILITY,
  THATCHGRIN_GOURD_ABILITY,
  THATCHGRIN_KIT,
  THATCHGRIN_SUMMON_ABILITY,
} from '../content/gourdlight_eve_scarecrow';
import { MOBS } from '../data';
import { levelScaledMechanicDamage } from '../mob/mechanic_level_scale';
import { emitMobYell } from '../mob/yells';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { DT, dist2d } from '../types';
import { scarecrowFighters } from './scarecrow_fighters';
import {
  CHAFF_STRIDE,
  freshScarecrowKit,
  RAIN_STRIDE,
  type ScarecrowState,
} from './scarecrow_state';
import { clearSwellingGourd, tickSwellingGourd } from './scarecrow_swell';

/** Recorded SFX already in the manifest (sfx_manifest.generated.ts). */
export const GOURD_BURST_SFX = 'impact_fire';
export const GOURD_THROW_SFX = 'proj_fire';
export const CALL_SFX = 'spell_nova';

const EPS = 1e-6;
const TAU = Math.PI * 2;

/** Whether the boss is in a live pull (chasing or swinging, never walking home). A stunned
 *  boss is still in his pull: his kit keeps resolving what is already on the ground. */
export function scarecrowEngaged(boss: Entity): boolean {
  return !boss.dead && boss.inCombat && (boss.aiState === 'chase' || boss.aiState === 'attack');
}

export function scarecrowStrike(
  ctx: SimContext,
  boss: Entity,
  p: Entity,
  min: number,
  max: number,
  school: string,
  name: string,
): void {
  const dmg = Math.round(ctx.rng.range(min, max) * (boss.mechanicDamageMult ?? 1));
  ctx.dealDamage(
    boss,
    p,
    levelScaledMechanicDamage(boss, p, dmg),
    false,
    school,
    name,
    'hit',
    true,
  );
}

/** The rain's targeted victims: fighters within reach, in id order, up to `maxTargeted`
 *  of them, picked by partial shuffle. */
export function pickRainVictims(ctx: SimContext, boss: Entity, fighters: Entity[]): Entity[] {
  const r = THATCHGRIN_KIT.rain;
  const pool = fighters.filter((p) => dist2d(p.pos, boss.pos) <= r.maxRange);
  const picks = Math.min(r.maxTargeted, pool.length);
  for (let k = 0; k < picks; k++) {
    const j = ctx.rng.int(k, pool.length - 1);
    const tmp = pool[k];
    pool[k] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, picks);
}

/** How many pumpkins land on open ground for this many fighters in the pull. */
export function rainScatterCount(fighters: number): number {
  const r = THATCHGRIN_KIT.rain;
  return Math.min(r.scatterMax, r.scatterBase + Math.floor(fighters / r.scatterPerFighters));
}

/** Seconds from the cue to the i-th landing (they cascade, the targeted ones first). */
export function rainLandingAt(i: number): number {
  const r = THATCHGRIN_KIT.rain;
  return r.windup + i * r.stagger;
}

/** Gourdfall now: every ring goes down at once on its spot, each with its own landing
 *  time. Draws the victim picks, then the open-ground spots. */
export function startGourdfall(ctx: SimContext, boss: Entity, st: ScarecrowState): boolean {
  const kit = st.kit;
  if (!kit) return false;
  const r = THATCHGRIN_KIT.rain;
  const fighters = scarecrowFighters(ctx, boss);
  const victims = pickRainVictims(ctx, boss, fighters);
  if (victims.length === 0) return false;
  const spots: { x: number; z: number; targetId?: number }[] = victims.map((v) => ({
    x: v.pos.x,
    z: v.pos.z,
    targetId: v.id,
  }));
  const scatter = rainScatterCount(fighters.length);
  for (let k = 0; k < scatter; k++) {
    const bearing = ctx.rng.range(0, TAU);
    const reach = ctx.rng.range(r.scatterMin, r.scatterReach);
    spots.push({
      x: boss.pos.x + Math.sin(bearing) * reach,
      z: boss.pos.z + Math.cos(bearing) * reach,
    });
  }
  kit.rain = [];
  spots.forEach((spot, i) => {
    const landAt = rainLandingAt(i);
    kit.rain.push(spot.x, spot.z, landAt);
    ctx.emit({
      type: 'spellfxAt',
      sourceId: boss.id,
      ...(spot.targetId !== undefined ? { targetId: spot.targetId } : {}),
      x: spot.x,
      z: spot.z,
      school: r.school,
      fx: 'runeCircle',
      radius: r.radius,
      duration: landAt,
      ability: THATCHGRIN_GOURD_ABILITY,
    });
  });
  // The throw clip and its whoosh (the renderer flies a lit gourd from his hand up into
  // the sky on the release frame, then drops a burning pumpkin onto each ring, timed to
  // land on that ring's last frame).
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: r.school,
    fx: 'windup',
    ability: THATCHGRIN_GOURD_ABILITY,
  });
  kit.rainTimer = r.every;
  kit.spacing = rainLandingAt(spots.length - 1) + THATCHGRIN_KIT.spacing;
  return true;
}

function landPumpkin(
  ctx: SimContext,
  boss: Entity,
  st: ScarecrowState,
  x: number,
  z: number,
  loud: boolean,
): void {
  const kit = st.kit;
  if (!kit) return;
  const r = THATCHGRIN_KIT.rain;
  const c = THATCHGRIN_KIT.chaff;
  ctx.emit({
    type: 'spellfxAt',
    sourceId: boss.id,
    x,
    z,
    school: r.school,
    fx: 'nova',
    radius: r.radius,
    ability: THATCHGRIN_GOURD_ABILITY,
    ...(loud ? { sfxKey: GOURD_BURST_SFX } : {}),
  });
  for (const p of scarecrowFighters(ctx, boss)) {
    if (dist2d(p.pos, { x, y: 0, z }) > r.radius) continue;
    scarecrowStrike(ctx, boss, p, r.min, r.max, r.school, r.name);
  }
  // The stubble catches where it burst; the renderer burns it for exactly as long.
  kit.chaff.push(x, z, c.seconds, c.interval);
  ctx.emit({
    type: 'spellfxAt',
    sourceId: boss.id,
    x,
    z,
    school: c.school,
    fx: 'tick',
    radius: c.radius,
    duration: c.seconds,
    ability: THATCHGRIN_CHAFF_ABILITY,
  });
}

/** Count every pumpkin in the air down; land the ones whose time has come, in list order
 *  (the list is in landing order, so a tick that lands two lands them in order). */
function tickRain(ctx: SimContext, boss: Entity, st: ScarecrowState): void {
  const kit = st.kit;
  if (!kit || kit.rain.length === 0) return;
  const kept: number[] = [];
  const due: number[] = [];
  for (let i = 0; i + RAIN_STRIDE - 1 < kit.rain.length; i += RAIN_STRIDE) {
    const left = kit.rain[i + 2] - DT;
    if (left <= EPS) due.push(kit.rain[i], kit.rain[i + 1]);
    else kept.push(kit.rain[i], kit.rain[i + 1], left);
  }
  kit.rain = kept;
  for (let i = 0; i + 1 < due.length; i += 2) {
    // every other burst carries the blast sound, so a cascade never stacks nine at once
    const loud = kit.rainLanded % 2 === 0;
    kit.rainLanded++;
    landPumpkin(ctx, boss, st, due[i], due[i + 1], loud);
  }
}

/** Burn whoever stands in a patch once per interval; drop the patches that guttered out. */
function tickChaff(ctx: SimContext, boss: Entity, st: ScarecrowState): void {
  const kit = st.kit;
  if (!kit || kit.chaff.length === 0) return;
  const c = THATCHGRIN_KIT.chaff;
  const kept: number[] = [];
  let players: Entity[] | null = null;
  for (let i = 0; i + CHAFF_STRIDE - 1 < kit.chaff.length; i += CHAFF_STRIDE) {
    const x = kit.chaff[i];
    const z = kit.chaff[i + 1];
    const remaining = kit.chaff[i + 2] - DT;
    let burn = kit.chaff[i + 3] - DT;
    if (burn <= EPS) {
      burn += c.interval;
      players ??= scarecrowFighters(ctx, boss);
      for (const p of players) {
        if (p.dead || dist2d(p.pos, { x, y: 0, z }) > c.radius) continue;
        scarecrowStrike(ctx, boss, p, c.min, c.max, c.school, c.name);
      }
    }
    if (remaining > EPS) kept.push(x, z, remaining, burn);
  }
  kit.chaff = kept;
}

/** Arms wide: the call's windup starts (its bark and its clip), the adds land after it. */
export function startCall(ctx: SimContext, boss: Entity, st: ScarecrowState): boolean {
  const kit = st.kit;
  if (!kit) return false;
  const call = THATCHGRIN_KIT.calls[kit.callsFired];
  if (!call) return false;
  kit.callWindup = THATCHGRIN_KIT.callWindup;
  kit.spacing = THATCHGRIN_KIT.callWindup + THATCHGRIN_KIT.spacing;
  const tmpl = MOBS[boss.templateId];
  if (tmpl?.yells?.summon) emitMobYell(ctx, boss, tmpl.yells.summon);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'nature',
    fx: 'windup',
    ability: THATCHGRIN_SUMMON_ABILITY,
  });
  return true;
}

function landCall(ctx: SimContext, boss: Entity, st: ScarecrowState): void {
  const kit = st.kit;
  if (!kit) return;
  const call = THATCHGRIN_KIT.calls[kit.callsFired];
  kit.callsFired++;
  if (!call) return;
  ctx.emit({
    type: 'spellfxAt',
    sourceId: boss.id,
    x: boss.pos.x,
    z: boss.pos.z,
    school: 'nature',
    fx: 'burst',
    radius: 4,
    ability: THATCHGRIN_SUMMON_ABILITY,
    sfxKey: CALL_SFX,
  });
  ctx.spawnBossAdds(boss, call.mobId, call.count);
}

/** Drop a pull's kit: its telegraphs, its burning ground, its gourd. Adds go with the pull. */
export function resetScarecrowKit(ctx: SimContext, boss: Entity | null, st: ScarecrowState): void {
  if (!st.kit) return;
  clearSwellingGourd(ctx, boss, st);
  st.kit = null;
  if (boss && !boss.dead) ctx.despawnSummonedAdds(boss);
}

/** Whether a stun holds him (a stunned scarecrow starts nothing new; what is already on
 *  the ground still resolves). */
function stunned(boss: Entity): boolean {
  return boss.auras.some((a) => a.kind === 'stun');
}

/** One tick of his fight (called by scarecrow.ts while he lives). */
export function tickScarecrowKit(ctx: SimContext, boss: Entity, st: ScarecrowState): void {
  if (!scarecrowEngaged(boss)) {
    resetScarecrowKit(ctx, boss, st);
    return;
  }
  if (!st.kit || st.kit.bossId !== boss.id)
    st.kit = freshScarecrowKit(boss.id, THATCHGRIN_KIT.rain.first);
  const kit = st.kit;
  // Aftermath first: what is already on the ground resolves wherever he has walked.
  tickChaff(ctx, boss, st);
  tickRain(ctx, boss, st);
  // The gourd's fuse runs on its own clock, stunned or not: a burst is never delayed.
  tickSwellingGourd(ctx, boss, st);
  if (kit.callWindup > 0) {
    kit.callWindup -= DT;
    if (kit.callWindup <= EPS) {
      kit.callWindup = 0;
      landCall(ctx, boss, st);
    }
  }
  if (kit.spacing > 0) kit.spacing = Math.max(0, kit.spacing - DT);
  if (kit.rainTimer > 0) kit.rainTimer = Math.max(0, kit.rainTimer - DT);
  if (stunned(boss)) return;
  if (kit.rain.length > 0 || kit.callWindup > 0 || kit.spacing > 0) return;
  // A due call outranks a due rain: the health thresholds are the fight's beats.
  const call = THATCHGRIN_KIT.calls[kit.callsFired];
  const hpFrac = boss.hp / Math.max(1, boss.maxHp);
  if (call && hpFrac <= call.atHpPct) {
    startCall(ctx, boss, st);
    return;
  }
  if (kit.rainTimer <= 0) startGourdfall(ctx, boss, st);
}
