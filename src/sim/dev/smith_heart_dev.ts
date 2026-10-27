// /dev heart: playtest helpers for the Smith's Heart raid
// (ALLOW_DEV_COMMANDS only: handleDevChat is reached through the
// ctx.devCommands gate like every /dev branch, and the raid's own door is
// dev-only too, encounters/smith_heart/entry.ts).
//
//   /dev heart                       this help line
//   /dev heart enter [normal]        claim a fresh run and step in at the Cleft
//   /dev heart tp <area|boss>        jump inside the run (enters first)
//   /dev heart kill <what>           kill a vein's fight (hammer: the whole
//                                    Hammer Council; breath, quench,
//                                    heat), the final boss (final), all four
//                                    guardians (guardians), one pack (pack h1
//                                    to h3, r1 to r8, b1 to b3, q1 to q3, f1
//                                    to f3), every pack (trash), or all
//   /dev heart gates                 open every gate of this run
//   /dev heart portal                force the seal's portal open for this run
//   /dev heart seal                  print the gating readout (mask, slabOpen,
//                                    sealLit, ringClear, portalOpen, awake)
//   /dev heart arrival               replay the arrival scene: the heart goes
//                                    back to sleep a moment and wakes again
//                                    (with a living player in the Heart)
//   /dev heart reset                 free the run and claim a fresh one
//   /dev heart council               the Hammer Council's readout
//   /dev heart council <what>        pull (all three onto you), reset (whole
//                                    again, the five columns too), heroic
//                                    [on|off] or mythic [on|off] (this run's
//                                    council; one tier at a time), energy <n>,
//                                    wrath, weight, wake, rock, bolt, song,
//                                    resonance [n] (force one mechanic now),
//                                    soul guardian|slabwright|singer (that
//                                    member's soul takes a pillar now),
//                                    soulpip <n> (leave every soul pillar at
//                                    n pips; 0 bursts them)
//   /dev heart kill guardian|slabwright|singer|council
//                                    one council member (to test each order of
//                                    the inheritance) or all three (= hammer)
//   /dev heart breath                the Guardian of the Breath's readout
//   /dev heart breath <what>         pull (onto the Cornice and pull it),
//                                    reset (whole again, the wind still),
//                                    heroic [on|off] or mythic [on|off] (this
//                                    run's fight), phase2 (the storm breaks
//                                    now), blow [deg|n|ne|e|se|s|sw|w|nw],
//                                    calm, circle (Thessaly's), inhale, chain,
//                                    eye, conductor, tornado, gust [deg] (a
//                                    phase-2 gust); our names work too: fork,
//                                    cradle, drawn, gale
//   /dev heart quench                the Guardian of the Quench's readout
//   /dev heart quench <what>         pull (onto the Frozen Lake and pull it),
//                                    reset (whole again, the lake whole),
//                                    heroic [on|off] or mythic [on|off] (this
//                                    run's fight), phase2 (the blades wake
//                                    now, the guardian at half), blades (the
//                                    blades awake at once, no bar), cold <n>
//                                    (set my cold bar), burst (freeze me
//                                    solid now), hole (open a hole under me),
//                                    crack (crack the ice under me), breath
//                                    (Quenching Breath now), echo [strike]
//                                    (a breath, or a strike, echoed by every
//                                    blade), dance (two blades cross)
//   /dev heart heat                  the Guardian of the Heat's readout
//   /dev heart heat <what>           pull (into the Hearth and pull it),
//                                    reset (whole again, the Hearth calm),
//                                    heroic [on|off] or mythic [on|off] (this
//                                    run's fight), heat <n> (set the Hearth's
//                                    heat), crystals (Kindled Crystals rise
//                                    now; shed: through Shed Heat's bar),
//                                    channel (the channel brims and flows),
//                                    overheat (Hearthburst now), burn [n]
//                                    (n stacks of Crystal Burn on me, 5 if
//                                    none), embers (Knell Embers under me)
//
// Areas: cleft, gallery, pit (or hammer), balcony, ring, ringse, ringsw,
// breath, bridge, cornice (or breathboss), quench, ice, lake (or quenchboss),
// heat, forge, anvil (or heatboss), heart or portal (the Seal Dais, beside
// the portal), heartroom or final (the Heart's Arrival Terrace, outside the
// final boss's reach). Each guardian's name lands beside it, on its floor.
// Kills credit through handleDeath, so the gates, the seal and the portal
// follow on the next tick.

import {
  SMITH_HEART_COUNCIL_PACK,
  SMITH_HEART_DUNGEON,
  SMITH_HEART_FINAL_BOSS,
  SMITH_HEART_GUARDIANS,
} from '../content/smith_heart';
import { SMITH_HEART_ANCHORS } from '../content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../data';
import {
  breathDevTrigger,
  breathGuardian,
  breathReadout,
  COUNCIL_TEMPLATE_IDS,
  councilBodies,
  councilDevTrigger,
  councilReadout,
  councilState,
  heatDevTrigger,
  heatGuardian,
  heatReadout,
  quenchDevTrigger,
  quenchGuardian,
  quenchReadout,
  replaySmithHeartArrivalForDev,
  SMITH_HEART_AWAKE_BIT,
  setSmithHeartPortalDevOpen,
  smithHeartProgress,
  smithHeartSealMaskOf,
} from '../encounters/smith_heart';
import { setDungeonGatesDevOpen } from '../instances/dungeon_gates';
import { enterDungeon, freeInstance, leaveDungeon } from '../instances/dungeons';
import { instanceHalfWidthOf } from '../instances/instance_footprint';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import { displacePlayerForDev } from './dev_displace';

const A = SMITH_HEART_ANCHORS;

/** `/dev heart tp` targets (instance-local). Boss aliases share the anchor
 *  that stands beside the boss on its floor. */
export const SMITH_HEART_DEV_AREAS: Readonly<Record<string, { x: number; z: number }>> = {
  cleft: A.cleft,
  gallery: A.gallery,
  pit: A.pit,
  hammer: A.pit,
  balcony: A.balcony,
  ring: A.ring,
  ringse: A.ringSouthEast,
  ringsw: A.ringSouthWest,
  breath: A.breath,
  bridge: A.bridge,
  cornice: A.cornice,
  breathboss: A.cornice,
  quench: A.quench,
  ice: A.ice,
  lake: A.lake,
  quenchboss: A.lake,
  heat: A.heat,
  forge: A.forge,
  anvil: A.anvil,
  heatboss: A.anvil,
  heart: A.portal,
  portal: A.portal,
  heartroom: A.heartRoom,
  final: A.heartRoom,
};

/** `/dev heart kill` boss names to template ids. */
const BOSS_ALIASES: Readonly<Record<string, string>> = {
  ...SMITH_HEART_GUARDIANS,
  guardian: SMITH_HEART_GUARDIANS.hammer,
  slabwright: 'heart_slabwright',
  singer: 'heart_seam_singer',
  final: SMITH_HEART_FINAL_BOSS,
};

/** The four vein fights' bodies: the Hammer's is the whole council. */
const GUARDIAN_IDS: ReadonlySet<string> = new Set([
  ...Object.values(SMITH_HEART_GUARDIANS),
  ...COUNCIL_TEMPLATE_IDS,
]);
const COUNCIL_IDS: ReadonlySet<string> = new Set(COUNCIL_TEMPLATE_IDS);

const HELP =
  '[dev] /dev heart enter [normal] | tp <cleft|gallery|pit|hammer|balcony|ring|ringse|ringsw|breath|bridge|cornice|breathboss|quench|ice|lake|quenchboss|heat|forge|anvil|heatboss|heart|portal|heartroom|final> | kill <hammer|guardian|slabwright|singer|council|breath|quench|heat|final|guardians|pack <id>|trash|all> | gates | portal | seal | arrival | reset | council [pull|reset|heroic [on|off]|mythic [on|off]|energy <n>|wrath|weight|wake|rock|bolt|song|resonance [n]|soul <guardian|slabwright|singer>|soulpip <n>] | breath [pull|reset|heroic [on|off]|mythic [on|off]|phase2|blow [deg|n|e|s|w]|calm|circle|inhale|chain|eye|conductor|tornado|gust [deg]] | quench [pull|reset|heroic [on|off]|mythic [on|off]|phase2|blades|cold <n>|burst|hole|crack|breath|echo [strike]|dance] | heat [pull|reset|heroic [on|off]|mythic [on|off]|heat <n>|crystals|shed|channel|overheat|burn [n]|embers]';

/** Where `/dev heart breath pull` sets the player down: on the Cornice, a
 *  few strides west of the guardian. */
const BREATH_PULL_SPOT = { x: -14, z: 198 } as const;
/** Where `/dev heart quench pull` sets the player down: on the Frozen Lake,
 *  a few strides south of the guardian. */
const QUENCH_PULL_SPOT = { x: 198, z: -11 } as const;
/** Where `/dev heart heat pull` sets the player down: on the Hearth's floor,
 *  a few strides east of the guardian (the door's side of the channel). */
const HEAT_PULL_SPOT = { x: -202, z: 8 } as const;

function log(ctx: SimContext, pid: number, text: string): void {
  ctx.emit({ type: 'log', text, pid });
}

/** The live Smith's Heart claim whose slot holds the player, or null. Reads
 *  the raid's own claim half width (instances/instance_footprint.ts: the
 *  field runs past |x| 250, wider than the generic envelope). */
function claimFor(ctx: SimContext, pid: number): InstanceSlot | null {
  const e = ctx.entities.get(pid);
  if (!e) return null;
  const index = DUNGEONS[SMITH_HEART_DUNGEON].index;
  for (const inst of ctx.instances) {
    if (inst.dungeonId !== SMITH_HEART_DUNGEON) continue;
    if (inst.partyKey === null || inst.exitId === null) continue;
    const o = instanceOrigin(index, inst.slot);
    const half = instanceHalfWidthOf(SMITH_HEART_DUNGEON);
    if (Math.abs(e.pos.x - o.x) < half && Math.abs(e.pos.z - o.z) < 250) return inst;
  }
  return null;
}

function ensureInside(ctx: SimContext, pid: number): InstanceSlot | null {
  const inside = claimFor(ctx, pid);
  if (inside) return inside;
  if (!enterDungeon(ctx, SMITH_HEART_DUNGEON, pid, true)) return null;
  return claimFor(ctx, pid);
}

/** Kill the placements a `/dev heart kill` names. Returns how many fell, or
 *  -1 when `what` names nothing. */
export function killSmithHeartMatching(
  ctx: SimContext,
  pid: number,
  inst: InstanceSlot,
  named: string,
): number {
  let what = named;
  const packArg = /^pack\s+(\S+)$/.exec(what);
  const packId = packArg ? packArg[1] : null;
  // The Hammer's vein is its whole fight: `hammer` kills the three.
  if (what === 'hammer') what = 'council';
  const boss = BOSS_ALIASES[what];
  const spawns = DUNGEONS[SMITH_HEART_DUNGEON].spawns;
  if (
    what !== 'all' &&
    what !== 'trash' &&
    what !== 'guardians' &&
    what !== 'council' &&
    boss === undefined &&
    (packId === null || !spawns.some((s) => s.packId === packId))
  ) {
    return -1;
  }
  const killer = ctx.entities.get(pid) ?? null;
  let killed = 0;
  spawns.forEach((spawn, i) => {
    const hit =
      what === 'all' ||
      (what === 'trash' &&
        spawn.packId !== undefined &&
        spawn.packId !== SMITH_HEART_COUNCIL_PACK) ||
      (what === 'guardians' && GUARDIAN_IDS.has(spawn.mobId)) ||
      (what === 'council' && COUNCIL_IDS.has(spawn.mobId)) ||
      (boss !== undefined && spawn.mobId === boss) ||
      (packId !== null && spawn.packId === packId);
    if (!hit) return;
    const mob = ctx.entities.get(inst.mobIds[i]);
    if (!mob || mob.dead) return;
    ctx.handleDeath(mob, killer);
    killed++;
  });
  return killed;
}

/** Is this claim's heart awake (its seal markers carry the arrival)? */
function heartAwake(ctx: SimContext, inst: InstanceSlot): boolean {
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    const m = e ? smithHeartSealMaskOf(e.templateId) : null;
    if (m !== null) return (m & SMITH_HEART_AWAKE_BIT) !== 0;
  }
  return false;
}

/** The `/dev heart seal` readout line for one claim. */
export function smithHeartSealReadout(ctx: SimContext, inst: InstanceSlot): string {
  const p = smithHeartProgress(ctx, inst);
  return `[dev] Heart seal: mask ${p.mask}, slabOpen ${p.slabOpen}, sealLit ${p.sealLit}, ringClear ${p.ringClear}, portalOpen ${p.portalOpen}, awake ${heartAwake(ctx, inst)}.`;
}

/** Handles `/dev heart ...`; returns false for any other line. */
export function handleSmithHeartDevChat(ctx: SimContext, raw: string, pid: number): boolean {
  const m = /^\/dev\s+heart(?:\s+(\S+))?(?:\s+(.*?))?\s*$/i.exec(raw);
  if (!m) return false;
  const verb = (m[1] ?? '').toLowerCase();
  const arg = (m[2] ?? '').toLowerCase().replace(/\s+/g, ' ');
  if (verb === 'enter') {
    // The blockout has one tier; heroic waits for phase 2.
    ctx.setDungeonDifficulty('normal', pid);
    if (enterDungeon(ctx, SMITH_HEART_DUNGEON, pid, true))
      log(ctx, pid, "[dev] Entering the Smith's Heart (normal).");
    return true;
  }
  if (verb === 'tp') {
    const area = SMITH_HEART_DEV_AREAS[arg];
    if (!area) {
      ctx.error(pid, HELP);
      return true;
    }
    const inst = ensureInside(ctx, pid);
    const e = ctx.entities.get(pid);
    if (!inst || !e) {
      ctx.error(pid, "[dev] Could not enter the Smith's Heart.");
      return true;
    }
    // groundPos reads the authored field's floor height for the instance.
    const o = instanceOrigin(DUNGEONS[SMITH_HEART_DUNGEON].index, inst.slot);
    displacePlayerForDev(ctx, e, o.x + area.x, o.z + area.z);
    log(ctx, pid, `[dev] Smith's Heart: ${arg}.`);
    return true;
  }
  if (verb === 'kill') {
    const what = arg || 'all';
    const inst = ensureInside(ctx, pid);
    if (!inst) return true;
    const n = killSmithHeartMatching(ctx, pid, inst, what);
    if (n < 0) {
      ctx.error(pid, HELP);
      return true;
    }
    log(ctx, pid, `[dev] Killed ${n} Smith's Heart mob${n === 1 ? '' : 's'} (${what}).`);
    return true;
  }
  if (verb === 'gates') {
    const inst = ensureInside(ctx, pid);
    if (!inst) return true;
    setDungeonGatesDevOpen(inst, true);
    log(ctx, pid, "[dev] Every Smith's Heart gate is open for this run.");
    return true;
  }
  if (verb === 'portal') {
    const inst = ensureInside(ctx, pid);
    if (!inst) return true;
    setSmithHeartPortalDevOpen(inst, true);
    log(ctx, pid, "[dev] The heart seal's portal is forced open for this run.");
    return true;
  }
  if (verb === 'seal') {
    const inst = claimFor(ctx, pid);
    if (!inst) {
      ctx.error(pid, "[dev] Not inside a Smith's Heart run (/dev heart enter).");
      return true;
    }
    log(ctx, pid, smithHeartSealReadout(ctx, inst));
    return true;
  }
  if (verb === 'arrival') {
    const inst = claimFor(ctx, pid);
    if (!inst) {
      ctx.error(pid, "[dev] Not inside a Smith's Heart run (/dev heart enter).");
      return true;
    }
    replaySmithHeartArrivalForDev(ctx, inst);
    log(ctx, pid, '[dev] The heart sleeps a moment; it wakes again with the raid in the Heart.');
    return true;
  }
  if (verb === 'council') {
    const inst = ensureInside(ctx, pid);
    if (!inst) return true;
    if (!arg) {
      log(ctx, pid, councilReadout(ctx, inst));
      return true;
    }
    const pullAll = (): number => {
      const me = ctx.entities.get(pid);
      const bodies = councilBodies(ctx, inst);
      if (!me || !bodies) return 0;
      let n = 0;
      for (const b of [bodies.guardian, bodies.slabwright, bodies.singer]) {
        if (b && !b.dead && ctx.aggroMob(b, me, false)) n++;
      }
      return n;
    };
    if (arg === 'pull') {
      log(ctx, pid, `[dev] The Hammer Council wakes (${pullAll()} pulled).`);
      return true;
    }
    // A mechanic forced on a council nobody has pulled pulls it first (an
    // unpulled council resets its fight on the next tick).
    const verbName = arg.split(' ')[0];
    const bodies = councilBodies(ctx, inst);
    if (
      verbName !== 'reset' &&
      verbName !== 'heroic' &&
      verbName !== 'mythic' &&
      bodies &&
      !councilState(bodies)
    )
      pullAll();
    const reply = councilDevTrigger(ctx, inst, arg);
    if (reply === null) {
      ctx.error(pid, HELP);
      return true;
    }
    log(ctx, pid, `[dev] ${reply}`);
    return true;
  }
  if (verb === 'breath') {
    const inst = ensureInside(ctx, pid);
    if (!inst) return true;
    if (!arg) {
      log(ctx, pid, breathReadout(ctx, inst));
      return true;
    }
    const me = ctx.entities.get(pid);
    const boss = breathGuardian(ctx, inst);
    const pull = (): boolean => {
      if (!me || !boss || boss.dead) return false;
      return ctx.aggroMob(boss, me, false);
    };
    const verbName = arg.split(' ')[0];
    if (verbName === 'pull') {
      const o = instanceOrigin(DUNGEONS[SMITH_HEART_DUNGEON].index, inst.slot);
      if (me) displacePlayerForDev(ctx, me, o.x + BREATH_PULL_SPOT.x, o.z + BREATH_PULL_SPOT.z);
      log(
        ctx,
        pid,
        pull()
          ? '[dev] The Guardian of the Breath wakes on the Storm Cornice.'
          : '[dev] The Guardian of the Breath cannot be pulled (fallen, or not in this run).',
      );
      return true;
    }
    // A mechanic forced on a guardian nobody pulled pulls it first (an
    // unpulled guardian resets its fight on the next tick).
    if (
      verbName !== 'reset' &&
      verbName !== 'heroic' &&
      verbName !== 'mythic' &&
      boss &&
      !boss.dead &&
      !boss.inCombat
    )
      pull();
    const reply = breathDevTrigger(ctx, inst, arg);
    if (reply === null) {
      ctx.error(pid, HELP);
      return true;
    }
    log(ctx, pid, `[dev] ${reply}`);
    return true;
  }
  if (verb === 'quench') {
    const inst = ensureInside(ctx, pid);
    if (!inst) return true;
    if (!arg) {
      log(ctx, pid, quenchReadout(ctx, inst, pid));
      return true;
    }
    const me = ctx.entities.get(pid);
    const boss = quenchGuardian(ctx, inst);
    const pull = (): boolean => {
      if (!me || !boss || boss.dead) return false;
      return ctx.aggroMob(boss, me, false);
    };
    const verbName = arg.split(' ')[0];
    if (verbName === 'pull') {
      const o = instanceOrigin(DUNGEONS[SMITH_HEART_DUNGEON].index, inst.slot);
      if (me) displacePlayerForDev(ctx, me, o.x + QUENCH_PULL_SPOT.x, o.z + QUENCH_PULL_SPOT.z);
      log(
        ctx,
        pid,
        pull()
          ? '[dev] The Guardian of the Quench wakes on the Frozen Lake.'
          : '[dev] The Guardian of the Quench cannot be pulled (fallen, or not in this run).',
      );
      return true;
    }
    // A mechanic forced on a guardian nobody pulled pulls it first (an
    // unpulled guardian resets its fight on the next tick).
    if (
      verbName !== 'reset' &&
      verbName !== 'heroic' &&
      verbName !== 'mythic' &&
      boss &&
      !boss.dead &&
      !boss.inCombat
    )
      pull();
    const reply = quenchDevTrigger(ctx, inst, arg, pid);
    if (reply === null) {
      ctx.error(pid, HELP);
      return true;
    }
    log(ctx, pid, `[dev] ${reply}`);
    return true;
  }
  if (verb === 'heat') {
    const inst = ensureInside(ctx, pid);
    if (!inst) return true;
    if (!arg) {
      log(ctx, pid, heatReadout(ctx, inst, pid));
      return true;
    }
    const me = ctx.entities.get(pid);
    const boss = heatGuardian(ctx, inst);
    const pull = (): boolean => {
      if (!me || !boss || boss.dead) return false;
      return ctx.aggroMob(boss, me, false);
    };
    const verbName = arg.split(' ')[0];
    if (verbName === 'pull') {
      const o = instanceOrigin(DUNGEONS[SMITH_HEART_DUNGEON].index, inst.slot);
      if (me) displacePlayerForDev(ctx, me, o.x + HEAT_PULL_SPOT.x, o.z + HEAT_PULL_SPOT.z);
      log(
        ctx,
        pid,
        pull()
          ? '[dev] The Guardian of the Heat wakes in the Hearth.'
          : '[dev] The Guardian of the Heat cannot be pulled (fallen, or not in this run).',
      );
      return true;
    }
    // A mechanic forced on a guardian nobody pulled pulls it first (an
    // unpulled guardian resets its fight on the next tick).
    if (
      verbName !== 'reset' &&
      verbName !== 'heroic' &&
      verbName !== 'mythic' &&
      boss &&
      !boss.dead &&
      !boss.inCombat
    )
      pull();
    const reply = heatDevTrigger(ctx, inst, arg, pid);
    if (reply === null) {
      ctx.error(pid, HELP);
      return true;
    }
    log(ctx, pid, `[dev] ${reply}`);
    return true;
  }
  if (verb === 'reset') {
    const inst = claimFor(ctx, pid);
    if (inst) {
      leaveDungeon(ctx, pid);
      freeInstance(ctx, inst);
    }
    if (enterDungeon(ctx, SMITH_HEART_DUNGEON, pid, true))
      log(ctx, pid, "[dev] Smith's Heart reset: a fresh run.");
    return true;
  }
  ctx.error(pid, HELP);
  return true;
}
