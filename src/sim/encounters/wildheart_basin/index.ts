// The Wildheart Basin encounters (docs/design/dungeon-rework/
// wildheart_basin.md): the Great Saurian's kit and the three bosses' cores
// (the Fanglord Beastmaster and his Great Jaguar, the Gorgebloom, Zulgar),
// one module each. One pass per tick over every live Basin claim, after the
// mob AI (called from instances/dungeons.ts updateInstances, beside the trash
// kit), so a pull or a planted cast owns its tick.

import { sweepOrphanClouds } from '../../mob/trash_kit/wildheart_kit';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import {
  beastState,
  callOfTheHunt,
  startHeel,
  startQuake,
  startStalk,
  thickhideWard,
  tickBeastmaster,
} from './beastmaster';
import { bossEngaged, claimBoss, dropEncounterBody, wildheartClaims } from './claim';
import {
  bloomState,
  rainSeeds,
  startGorge,
  startPollinate,
  startSeedRain,
  startVineLash,
  tickGorgebloom,
} from './gorgebloom';
import {
  breakHowdah,
  enrageSaurian,
  saurianState,
  startStomp,
  startTailSwipe,
  tickSaurian,
  tickSaurianPaused,
} from './great_saurian';
import {
  BEASTMASTER_ID,
  FANGLORD_JAGUAR_ID,
  GORGEBLOOM_ID,
  GREAT_SAURIAN_ID,
  HOWDAH_HEXCALLER_ID,
  SAURIAN_TUNING,
  WILDHEART_SPORE_CLOUD,
  ZULGAR_ID,
} from './ids';
import { silenceDrum, startDrum } from './saurian_drum';
import { sapTotems, throwTotem } from './saurian_totems';
import {
  beginHunt,
  endHunt,
  startAmbush,
  startPulse,
  startSpiritHunt,
  tickZulgar,
  wakeIdol,
  zulgarState,
} from './zulgar';
import { devSunstrike, lightGlyph } from './zulgar_glyphs';
import { startIdolBreath } from './zulgar_idol';
import { devPinNow, startHuntingSpear } from './zulgar_spear';

export { jaguarState, syncPool } from './beastmaster';
export { podSpot, terracePlayers } from './gorgebloom';
export { breakHowdah, saurianState } from './great_saurian';
export * from './ids';
export { drumAboard, drumBeating } from './saurian_drum';
export { SAP_BACKLASH_NAME, SAP_HEAL_NAME, sapTotems, totemSpot } from './saurian_totems';
export { shrinePlayers } from './zulgar';
export { glyphsLit } from './zulgar_glyphs';
export { IDOL_BREATH_FIELD } from './zulgar_idol';
export { isPinned, pinnedBy } from './zulgar_spear';

/** A live fight whose mob lost its target for a moment (a Vanish, the tank
 *  falling) while still in combat and not evading: the fight holds, so a blip
 *  never replays its thresholds (a second howdah rider). Only an evade, a
 *  reset or a death ends it (each tick's `engaged` false). */
function paused(mob: Entity): boolean {
  return (
    mob.wildheartFight !== undefined &&
    !mob.dead &&
    mob.inCombat &&
    mob.aggroTargetId === null &&
    (mob.aiState === 'chase' || mob.aiState === 'attack')
  );
}

/** The Howdah Hexcaller is the Saurian's rider: once the pull is over (the
 *  Saurian down or walking home) a rider that is not fighting climbs away
 *  rather than idling in the ford, where a later Zulgar pull would chain it. */
function sweepIdleRider(ctx: SimContext, inst: InstanceSlot, saurian: Entity | null): void {
  if (saurian && !saurian.dead && (bossEngaged(saurian) || paused(saurian))) return;
  for (const id of [...inst.mobIds]) {
    const e = ctx.entities.get(id);
    if (!e || e.templateId !== HOWDAH_HEXCALLER_ID || e.dead) continue;
    if (e.inCombat && e.aiState !== 'evade' && e.aiState !== 'idle') continue;
    dropEncounterBody(ctx, inst, saurian, id);
  }
}

/** One tick of every Wildheart Basin encounter. */
export function tickWildheartEncounters(ctx: SimContext): void {
  for (const inst of wildheartClaims(ctx)) {
    const saurian = claimBoss(ctx, inst, GREAT_SAURIAN_ID);
    if (saurian && !paused(saurian)) tickSaurian(ctx, inst, saurian, bossEngaged(saurian));
    else if (saurian?.wildheartFight?.kind === 'saurian')
      // A blip with no target holds the fight, but its totems still mend.
      tickSaurianPaused(ctx, saurian, saurian.wildheartFight);
    sweepIdleRider(ctx, inst, saurian);
    const bm = claimBoss(ctx, inst, BEASTMASTER_ID);
    const jaguar = claimBoss(ctx, inst, FANGLORD_JAGUAR_ID);
    // The pair holds its fight while either body fights (the jaguar keeps
    // hunting while the master's tank is down for a moment).
    const jaguarIn = jaguar !== null && bossEngaged(jaguar);
    if (bm && (jaguarIn || !paused(bm)))
      tickBeastmaster(ctx, inst, bm, jaguar, jaguarIn || bossEngaged(bm));
    const bloom = claimBoss(ctx, inst, GORGEBLOOM_ID);
    if (bloom && !paused(bloom)) tickGorgebloom(ctx, inst, bloom, bossEngaged(bloom));
    const zulgar = claimBoss(ctx, inst, ZULGAR_ID);
    if (zulgar && !paused(zulgar)) tickZulgar(ctx, inst, zulgar, bossEngaged(zulgar));
    sweepOrphanClouds(ctx, inst, WILDHEART_SPORE_CLOUD);
  }
}

const HELP =
  'Mechanics: tail, stomp, totem, sap, drum, silence, howdah, enrage (the Great Saurian); quake, stalk, hunt, ward, heel (the Beastmaster); seeds, pods, pollinate, lash, gorge (the Gorgebloom); pulse, spirit, prey, endhunt, ambush, glyphs, sunstrike, spear, pin, idol, breath (Zulgar).';

/** A dev trigger cuts whatever bar is running so the mechanic always shows. */
function cutBar(boss: { castingAbility: string | null; castRemaining: number }): void {
  if (boss.castingAbility === null) return;
  boss.castingAbility = null;
  boss.castRemaining = 0;
}

function saurianTrigger(ctx: SimContext, inst: InstanceSlot, what: string): string {
  const saurian = claimBoss(ctx, inst, GREAT_SAURIAN_ID);
  if (!saurian || !bossEngaged(saurian)) return 'Pull the Great Saurian first.';
  const st = saurianState(saurian, false);
  if (what === 'howdah') {
    if (st.howdahBroken) return 'The howdah is already broken.';
    breakHowdah(ctx, saurian, st);
    return 'The howdah breaks: the Howdah Hexcaller leaps down.';
  }
  if (what === 'enrage') {
    if (!st.enraged) enrageSaurian(ctx, saurian, st);
    return 'The Great Saurian enrages.';
  }
  if (what === 'totem') {
    if (st.howdahBroken) return 'The howdah is broken: the rider throws no more totems.';
    const totem = throwTotem(ctx, inst, saurian, st);
    if (totem) st.totemTimer = SAURIAN_TUNING.totemEvery;
    return totem
      ? 'The rider hurls a Sunbone Sap Totem onto the ford.'
      : 'Three totems already stand (or no spot round it is fit).';
  }
  if (what === 'sap') {
    const standing = sapTotems(ctx, st);
    if (standing.length === 0) return 'No Sap Totem stands (trigger totem throws one).';
    for (const row of st.totems) row.next = 0;
    return `${standing.length} Sap Totem${standing.length === 1 ? '' : 's'} mend the Great Saurian now.`;
  }
  if (what === 'drum') {
    if (st.howdahBroken) return 'The howdah is broken: the drum went down with it.';
    startDrum(ctx, saurian, st);
    return 'The howdah drum beats: the Stomp comes twice as often (heroic only in a real run).';
  }
  if (what === 'silence') {
    return silenceDrum(ctx, saurian, st)
      ? 'The drummer loses his beat.'
      : 'No drum beats (trigger drum starts it; heroic carries it from the pull).';
  }
  cutBar(saurian);
  if (what === 'stomp') {
    startStomp(saurian, st);
    return 'The Great Saurian rears for an Earthshaking Stomp.';
  }
  startTailSwipe(saurian, st);
  return 'The Great Saurian draws back its tail.';
}

function beastTrigger(ctx: SimContext, inst: InstanceSlot, what: string): string {
  const bm = claimBoss(ctx, inst, BEASTMASTER_ID);
  const jaguar = claimBoss(ctx, inst, FANGLORD_JAGUAR_ID);
  if (!bm || !jaguar || bm.dead || !(bossEngaged(bm) || bossEngaged(jaguar)))
    return 'Pull the Fanglord Beastmaster first.';
  const st = beastState(ctx, bm, jaguar, false);
  if (what === 'stalk') {
    return startStalk(ctx, inst, bm, jaguar, st) ? 'The Great Jaguar stalks new prey.' : 'No prey.';
  }
  if (what === 'hunt') {
    callOfTheHunt(ctx, bm, jaguar, st);
    return 'The Beastmaster sounds the Call of the Hunt.';
  }
  if (what === 'ward') {
    thickhideWard(ctx, inst, bm, jaguar, st);
    return 'Thickhide Ward shields the Great Jaguar.';
  }
  if (what === 'heel') {
    cutBar(jaguar);
    return startHeel(ctx, bm, jaguar, st)
      ? 'Heel! The jaguar crouches to leap home.'
      : 'The jaguar cannot leap now.';
  }
  cutBar(bm);
  startQuake(bm, st);
  return 'The Beastmaster raises a Beast Pit Quake.';
}

function bloomTrigger(ctx: SimContext, inst: InstanceSlot, what: string): string {
  const bloom = claimBoss(ctx, inst, GORGEBLOOM_ID);
  if (!bloom || !bossEngaged(bloom)) return 'Pull the Gorgebloom first.';
  const st = bloomState(bloom, false);
  if (what === 'pods') return `${rainSeeds(ctx, inst, bloom, st)} Seedpods land on the loam.`;
  if (what === 'pollinate')
    return `Pollinate takes ${startPollinate(ctx, inst, bloom, st)} players.`;
  cutBar(bloom);
  if (what === 'lash')
    return startVineLash(ctx, inst, bloom, st) ? 'The Gorgebloom draws a Vine Lash.' : 'No target.';
  if (what === 'gorge')
    return startGorge(ctx, bloom, st) ? 'The Gorgebloom opens wide to Gorge.' : 'No target.';
  startSeedRain(bloom, st);
  return 'The Gorgebloom gathers a Seed Rain.';
}

function zulgarTrigger(ctx: SimContext, inst: InstanceSlot, what: string): string {
  const z = claimBoss(ctx, inst, ZULGAR_ID);
  if (!z || !bossEngaged(z)) return 'Pull Zulgar first.';
  const st = zulgarState(ctx, inst, z, false);
  if (what === 'endhunt') {
    if (st.phase !== 'hunt') return 'Zulgar is not hunting.';
    endHunt(ctx, inst, z, st);
    return 'The hunt ends.';
  }
  if (what === 'ambush') {
    if (st.phase === 'final') return 'The idol is awake: the hunt never ends.';
    if (st.phase === 'hunt') endHunt(ctx, inst, z, st);
    if (st.phase !== 'ambush') startAmbush(ctx, z, st);
    return 'Zulgar vanishes for an Ambush.';
  }
  if (what === 'glyphs') {
    let lit = 0;
    for (let i = 0; i < st.glyphs.length; i++) if (lightGlyph(ctx, st, i, null)) lit++;
    return `${lit} sun glyphs catch light (they strike only while he hunts).`;
  }
  if (what === 'sunstrike') {
    devSunstrike(ctx, inst, z, st);
    return 'Zulgar is Sunstruck.';
  }
  if (what === 'idol') {
    if (st.phase === 'final') return 'The idol is already awake.';
    cutBar(z);
    wakeIdol(ctx, inst, z, st);
    return 'The Idol Wakes: the final phase begins.';
  }
  if (what === 'breath') {
    if (st.phase !== 'final') {
      cutBar(z);
      wakeIdol(ctx, inst, z, st);
    }
    const side = startIdolBreath(ctx, inst, z, st);
    if (side === null) return 'The idol is already drawing breath.';
    // Named by the screen, not the rose: the Basin's own gates call +x east
    // while the HUD compass reads it west, so "left, facing the idol" is the
    // one wording nobody can misread.
    return `The stone jaguar draws breath over the ${side === 1 ? 'left' : 'right'} half (facing the idol).`;
  }
  if (st.phase !== 'fight') return 'Zulgar is already hunting.';
  cutBar(z);
  if (what === 'spear')
    return startHuntingSpear(ctx, inst, z, st) ? 'Zulgar hefts a Hunting Spear.' : 'No target.';
  if (what === 'pin') {
    const victim = devPinNow(ctx, inst, z, st);
    return victim ? `A Hunting Spear pins ${victim.name}.` : 'No target.';
  }
  if (what === 'prey') return `Spirit of the Hunt marks ${beginHunt(ctx, inst, z, st)} Prey.`;
  if (what === 'spirit') {
    startSpiritHunt(ctx, z, st);
    return 'The jaguar spirit rises in Zulgar.';
  }
  startPulse(z, st);
  return 'Zulgar gathers a Wildheart Pulse.';
}

const SAURIAN_TRIGGERS = new Set([
  'tail',
  'stomp',
  'totem',
  'sap',
  'drum',
  'silence',
  'howdah',
  'enrage',
]);
const BEAST_TRIGGERS = new Set(['quake', 'stalk', 'hunt', 'ward', 'heel']);
const BLOOM_TRIGGERS = new Set(['seeds', 'pods', 'pollinate', 'lash', 'gorge']);
const ZULGAR_TRIGGERS = new Set([
  'pulse',
  'spirit',
  'prey',
  'endhunt',
  'ambush',
  'glyphs',
  'sunstrike',
  'spear',
  'pin',
  'idol',
  'breath',
]);

/** Every `/dev wildheart trigger` mechanic name (the help line and tests). */
export const WILDHEART_DEV_TRIGGERS: readonly string[] = [
  ...SAURIAN_TRIGGERS,
  ...BEAST_TRIGGERS,
  ...BLOOM_TRIGGERS,
  ...ZULGAR_TRIGGERS,
];

/** `/dev wildheart trigger <mechanic>`: fire an engaged encounter's mechanic
 *  now. Returns the log line. */
export function wildheartDevTrigger(ctx: SimContext, inst: InstanceSlot, what: string): string {
  if (SAURIAN_TRIGGERS.has(what)) return saurianTrigger(ctx, inst, what);
  if (BEAST_TRIGGERS.has(what)) return beastTrigger(ctx, inst, what);
  if (BLOOM_TRIGGERS.has(what)) return bloomTrigger(ctx, inst, what);
  if (ZULGAR_TRIGGERS.has(what)) return zulgarTrigger(ctx, inst, what);
  return HELP;
}
