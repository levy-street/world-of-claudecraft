// [dev] The solo Nythraxis practice raid and its mechanic pokes.
//
// A lone tester cannot see most of the redo: Bone Spike, Gravefire, and Soul
// Rend never pick the aggro holder, the wardstones want three different
// channelers, and Bone Storm wants a raid to charge. `/dev nythraxisraid`
// builds the sanctioned ten-player practice roster (the Varkhul and Ignivar
// idiom: nine anchored, invulnerable dev bots spread across the hall) and
// zones the tester in on the requested difficulty; `/dev nyx <mechanic>`
// forces the next cast of one mechanic, jumps a phase, completes the ward
// channels with three bots, or runs the enrage clock down, so every mechanic
// can be watched on demand instead of waiting on its cadence.
//
// Dev-gated through handleDevChat (never in production). The pokes only move
// timers and health the driver already owns; nothing here bypasses the
// encounter's own rules (a forced sigil still waits out the major gap, a
// forced Rage still waits out a live sigil).

import { NYTHRAXIS_PHASE_TWO_HP } from './encounters/nythraxis';
import {
  enterDungeon,
  freeInstance,
  instanceAt,
  leaveDungeon,
  nythraxisInstanceSealed,
} from './instances/dungeons';
import { nythraxisEnrageSeconds } from './nythraxis_enrage_clock';
import { NYTHRAXIS_PHASE_THREE_HP } from './nythraxis_kings_wrath';
import { resetRaidDevBot, reviveRaidDevBotInPlace } from './raid_dev_bot';
import type { SimContext } from './sim_context';
import { DT, type DungeonDifficulty, type Entity, NYTHRAXIS_BOSS_ID } from './types';

export const NYTHRAXIS_ARENA_ID = 'nythraxis_boss_arena';
const NYTHRAXIS_DEV_BOT_COUNT = 9;

// Instance-local spots inside the compact hall (NYTHRAXIS_LAYOUT: x within
// +/-25, z 52 to 104; the boss dais at (0, 96); wardstones at (0, 66) and
// (+/-16, 76)). Every spot is at least 6 yd from a wardstone (the sigil and
// Soulfire clearance) and 24 yd from the boss spawn, outside his 22 yd aggro
// radius, so forming the raid never pulls; spread so a Grave Eruption, a
// Gravefire line, and a Bone Storm charge each have real targets across the
// front half of the floor.
export const NYTHRAXIS_DEV_FORMATION = [
  { x: -18, z: 58 },
  { x: 18, z: 58 },
  { x: -8, z: 56 },
  { x: 8, z: 56 },
  { x: -21, z: 68 },
  { x: 21, z: 68 },
  { x: -10, z: 72 },
  { x: 10, z: 72 },
  { x: 0, z: 59 },
] as const;

export type NythraxisDevRaidResult =
  | { ok: true; allies: number; reused: boolean; difficulty: DungeonDifficulty }
  | { ok: false; message: string };

function botName(index: number): string {
  return `NythraxisBot${index + 1}`;
}

function expectedBotNames(): string[] {
  return Array.from({ length: NYTHRAXIS_DEV_BOT_COUNT }, (_, index) => botName(index));
}

function arenaInstanceOf(ctx: SimContext, pid: number) {
  const player = ctx.entities.get(pid);
  if (player?.kind !== 'player') return null;
  const instance = instanceAt(ctx, player.pos);
  if (!instance || instance.dungeonId !== NYTHRAXIS_ARENA_ID) return null;
  if (instance.partyKey !== ctx.instanceKeyFor(pid)) return null;
  return instance;
}

/** Creates or reuses the practice roster, then zones everyone into the arena. */
export function setupNythraxisDevRaid(
  ctx: SimContext,
  pid: number,
  requestedDifficulty?: DungeonDifficulty,
): NythraxisDevRaidResult {
  const player = ctx.entities.get(pid);
  if (player?.kind !== 'player') return { ok: false, message: 'Player not found.' };
  const current = instanceAt(ctx, player.pos);
  const difficulty =
    requestedDifficulty ??
    (current?.dungeonId === NYTHRAXIS_ARENA_ID ? current.difficulty : 'normal');

  const expectedNames = expectedBotNames();
  const expectedLower = new Set(expectedNames.map((name) => name.toLowerCase()));
  const byName = new Map(
    [...ctx.players.values()].map((meta) => [meta.name.toLowerCase(), meta] as const),
  );
  for (const name of expectedNames) {
    const existing = byName.get(name.toLowerCase());
    if (existing && !existing.isDevBot) {
      return { ok: false, message: `The name ${name} is already used by a real player.` };
    }
  }
  const currentParty = ctx.partyOf(pid);
  if (currentParty) {
    const reusable =
      currentParty.raid &&
      currentParty.leader === pid &&
      currentParty.members.length === NYTHRAXIS_DEV_BOT_COUNT + 1 &&
      currentParty.members.every((memberPid) => {
        if (memberPid === pid) return true;
        const meta = ctx.players.get(memberPid);
        return !!meta?.isDevBot && expectedLower.has(meta.name.toLowerCase());
      });
    if (!reusable) {
      return {
        ok: false,
        message: 'Leave your current group before creating the Nythraxis test raid.',
      };
    }
  }

  const botPids: number[] = [];
  let reused = true;
  for (const name of expectedNames) {
    const existing = byName.get(name.toLowerCase());
    if (existing) {
      const botParty = ctx.partyOf(existing.entityId);
      if (botParty && botParty !== currentParty) {
        return { ok: false, message: `${name} is already assigned to another group.` };
      }
      if (!reviveRaidDevBotInPlace(ctx, existing.entityId)) {
        return { ok: false, message: `${name} disappeared.` };
      }
      botPids.push(existing.entityId);
      continue;
    }
    if (currentParty) {
      return { ok: false, message: 'The existing Nythraxis test raid roster is incomplete.' };
    }
    const botPid = ctx.spawnDevBot(name);
    if (botPid < 0) return { ok: false, message: `Could not create ${name}.` };
    reused = false;
    botPids.push(botPid);
  }

  let party = currentParty;
  if (!party) {
    const units = [pid, ...botPids].map((memberPid) => ({
      partyId: null,
      leaderPid: memberPid,
      members: [memberPid],
    }));
    party = ctx.formDungeonFinderGroup(units, { raid: true });
    if (!party) return { ok: false, message: 'Could not form the Nythraxis test raid.' };
  }

  // Switching difficulty means a fresh claim: the boss is retuned at spawn.
  // Everyone steps out, the old claim is released, and the entry below
  // re-claims at the requested tier. Never while he is engaged.
  const partyKey = ctx.instanceKeyFor(pid);
  const held = ctx.instances.find(
    (candidate) => candidate.dungeonId === NYTHRAXIS_ARENA_ID && candidate.partyKey === partyKey,
  );
  if (held && held.difficulty !== difficulty) {
    if (nythraxisInstanceSealed(ctx, held)) {
      return {
        ok: false,
        message: 'Nythraxis is engaged; wipe or kill him before switching difficulty.',
      };
    }
    for (const memberPid of [pid, ...botPids]) leaveDungeon(ctx, memberPid);
    freeInstance(ctx, held);
  }

  ctx.setDungeonDifficulty(difficulty, pid);
  // Everyone zones in through the dev bypass (no attunement, no group rule);
  // the raid LOCKOUT is deliberately not bypassed (use /dev raid reset).
  for (const memberPid of [pid, ...botPids]) {
    if (!enterDungeon(ctx, NYTHRAXIS_ARENA_ID, memberPid, true)) {
      return { ok: false, message: 'Could not enter the Nythraxis arena (a raid lockout?).' };
    }
  }
  const instance = arenaInstanceOf(ctx, pid);
  if (!instance) return { ok: false, message: 'Could not claim the Nythraxis arena.' };
  const origin = ctx.instanceOriginOf(instance);
  for (let index = 0; index < botPids.length; index++) {
    const spot = NYTHRAXIS_DEV_FORMATION[index];
    if (!resetRaidDevBot(ctx, botPids[index], origin.x + spot.x, origin.z + spot.z)) {
      return { ok: false, message: 'A Nythraxis practice bot disappeared.' };
    }
    instance.enteredBy.add(botPids[index]);
  }
  instance.enteredBy.add(pid);
  return { ok: true, allies: botPids.length, reused, difficulty: instance.difficulty };
}

export const NYTHRAXIS_DEV_MECHANICS = [
  'curse',
  'spike',
  'eruption',
  'sigil',
  'gravefire',
  'rend',
  'rage',
  'storm',
  'wards',
  'phase2',
  'phase3',
  'enrage',
] as const;
export type NythraxisDevMechanic = (typeof NYTHRAXIS_DEV_MECHANICS)[number];

export function isNythraxisDevMechanic(verb: string): verb is NythraxisDevMechanic {
  return (NYTHRAXIS_DEV_MECHANICS as readonly string[]).includes(verb);
}

export type NythraxisDevPokeResult = { ok: true; message: string } | { ok: false; message: string };

function liveBoss(ctx: SimContext, pid: number): Entity | null {
  const instance = arenaInstanceOf(ctx, pid);
  if (!instance) return null;
  for (const mobId of instance.mobIds) {
    const mob = ctx.entities.get(mobId);
    if (mob && mob.templateId === NYTHRAXIS_BOSS_ID && !mob.dead) return mob;
  }
  return null;
}

/**
 * Force one mechanic on the engaged boss. Timers are set to one tick so the
 * cast fires on the driver's next pass, subject to the encounter's own gates
 * (the major gap, a live sigil, the phase). Phase jumps set health to just
 * under the threshold; `wards` completes the three channels with three bots
 * during a Deathless Rage cast; `enrage N` leaves N seconds on the clock.
 */
export function pokeNythraxisDevMechanic(
  ctx: SimContext,
  pid: number,
  verb: NythraxisDevMechanic,
  arg?: number,
): NythraxisDevPokeResult {
  const boss = liveBoss(ctx, pid);
  if (!boss) return { ok: false, message: 'Enter the Nythraxis arena first (/dev nythraxisraid).' };
  const st = boss.nythraxis;
  if (st?.phase === 'transition') {
    return { ok: false, message: 'Wait for the transition to end; nothing new fires during it.' };
  }
  if (!st || !boss.inCombat || st.phase === 'dead') {
    return { ok: false, message: 'Pull Nythraxis first; the pokes act on the live encounter.' };
  }
  const wardPhase = st.phase === 2 || st.phase === 3;
  const difficulty = arenaInstanceOf(ctx, pid)?.difficulty ?? 'normal';
  switch (verb) {
    case 'curse':
      st.dreadCurseTimer = DT;
      return { ok: true, message: 'Dread Curse: next tick (the boss must be in melee reach).' };
    case 'spike':
      st.boneSpikeTimer = DT;
      return { ok: true, message: 'Bone Spike: next tick.' };
    case 'eruption':
      st.eruptionTimer = DT;
      return { ok: true, message: 'Grave Eruption: next tick.' };
    case 'sigil':
      if (st.sigil)
        return { ok: false, message: 'A sigil is already up; bind it or let it lapse.' };
      st.sigilTimer = DT;
      st.majorGapTimer = 0;
      return { ok: true, message: 'Binding Sigil: next tick.' };
    case 'gravefire':
      if (!wardPhase)
        return { ok: false, message: 'Gravefire is a phase 2 mechanic (/dev nyx phase2).' };
      st.gravefireTimer = DT;
      return { ok: true, message: 'Gravefire: next tick.' };
    case 'rend':
      if (!wardPhase)
        return { ok: false, message: 'Soul Rend is a phase 2 mechanic (/dev nyx phase2).' };
      st.soulRendTimer = DT;
      return { ok: true, message: 'Soul Rend: next tick (it waits out a Rage cast).' };
    case 'rage':
      if (!wardPhase)
        return { ok: false, message: 'Deathless Rage is a phase 2 mechanic (/dev nyx phase2).' };
      st.deathlessTimer = DT;
      st.majorGapTimer = 0;
      return {
        ok: true,
        message: 'Deathless Rage: next tick (it waits out live Soul Rend marks and a live sigil).',
      };
    case 'storm':
      if (st.phase !== 3)
        return { ok: false, message: 'Bone Storm is a phase 3 mechanic (/dev nyx phase3).' };
      st.boneStormTimer = DT;
      st.majorGapTimer = 0;
      return { ok: true, message: 'Bone Storm: next tick (it waits out any other major).' };
    case 'wards': {
      if (st.deathlessCastRemaining <= 0) {
        return { ok: false, message: 'No Deathless Rage is casting; /dev nyx rage first.' };
      }
      const bots = [...ctx.players.values()]
        .filter((meta) => meta.isDevBot && /^NythraxisBot\d$/.test(meta.name))
        .map((meta) => meta.entityId)
        .filter((botPid) => !ctx.entities.get(botPid)?.dead)
        .slice(0, st.wardChannels.length);
      if (bots.length < st.wardChannels.length) {
        return { ok: false, message: 'Not enough practice bots to channel every wardstone.' };
      }
      st.wardChannels.forEach((channel, index) => {
        channel.playerId = bots[index];
        channel.remaining = 0;
        channel.complete = true;
      });
      return {
        ok: true,
        message: 'Three bots completed the wardstones: the Rage interrupts next tick.',
      };
    }
    case 'phase2':
      if (st.phase !== 1) return { ok: false, message: 'Already past phase 1.' };
      boss.hp = Math.max(1, Math.floor(boss.maxHp * (NYTHRAXIS_PHASE_TWO_HP - 0.01)));
      return { ok: true, message: 'Health set to 69%: the transition starts next tick.' };
    case 'phase3':
      if (st.phase !== 2)
        return { ok: false, message: 'Phase 3 is entered from phase 2 (/dev nyx phase2).' };
      boss.hp = Math.max(1, Math.floor(boss.maxHp * (NYTHRAXIS_PHASE_THREE_HP - 0.01)));
      return {
        ok: true,
        message: "Health set to 29%: The King's Wrath begins once no major is in flight.",
      };
    case 'enrage': {
      const secondsLeft = Math.max(0, Math.min(arg ?? 15, nythraxisEnrageSeconds(difficulty)));
      st.enrageElapsed = nythraxisEnrageSeconds(difficulty) - secondsLeft;
      st.enrageStacks = 0;
      return { ok: true, message: `The Crown Endures in ${secondsLeft} s.` };
    }
  }
}
