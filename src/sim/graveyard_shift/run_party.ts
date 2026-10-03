// The adventurer party of a Graveyard Shift run: real players with no client,
// spawned after the owner becomes Morthen and removed by the run's teardown.
// They carry no PlayerMeta flag (never isDevBot: its consumers auto-accept
// invites and auto-reply to whispers); run membership is the roster on the run
// plus the adventurer marker aura the hostility rule keys on. Never a
// characterId, so the tutorial sweep and persistence never see them.

import { freshBotSteer } from '../bots/steer';
import { instanceOriginOf } from '../instances/dungeons';
import { Rng } from '../rng';
import type { SimContext } from '../sim_context';
import { settleTeleportArrival } from '../teleport_arrival';
import type { PlayerClass } from '../types';
import { type BotRole, botSeed } from './bot_brain';
import { adventurerMarkerAura } from './hostility';
import { GRAVEYARD_SHIFT_ARRIVAL, GRAVEYARD_SHIFT_BOT_SPOTS } from './run_layout';
import type { GraveyardShiftBot, GraveyardShiftRun } from './run_state';

export type GraveyardShiftRole = BotRole;

// Fixed prototype composition, the concept's classic five (names IP-checked
// with the concept). The mage stays the first damage dealer: tests find it by
// role.
export const GRAVEYARD_SHIFT_PARTY: readonly {
  role: GraveyardShiftRole;
  cls: PlayerClass;
  name: string;
}[] = [
  { role: 'tank', cls: 'warrior', name: 'Bulwarkbro' },
  { role: 'healer', cls: 'priest', name: 'Mendolyn' },
  { role: 'dps', cls: 'mage', name: 'Pyrotechnic' },
  { role: 'dps', cls: 'hunter', name: 'Arrowsmith' },
  { role: 'dps', cls: 'rogue', name: 'Stabbyjoe' },
];

// The party fights at Morthen's level.
export const GRAVEYARD_SHIFT_PARTY_LEVEL = 10;

export function spawnGraveyardShiftParty(ctx: SimContext, run: GraveyardShiftRun): void {
  const origin = instanceOriginOf(run.slot);
  GRAVEYARD_SHIFT_PARTY.forEach((member, index) => {
    const pid = ctx.addPlayer(member.cls, member.name, { bot: true, tutorialGreetingSent: true });
    const e = ctx.entities.get(pid);
    if (!e) return;
    ctx.setPlayerLevel(GRAVEYARD_SHIFT_PARTY_LEVEL, pid);
    const spot = GRAVEYARD_SHIFT_BOT_SPOTS[index];
    e.pos = ctx.groundPos(origin.x + spot.x, origin.z + spot.z);
    e.prevPos = { ...e.pos };
    ctx.rebucket(e);
    settleTeleportArrival(e);
    // Facing Morthen's arrival point.
    e.facing = Math.atan2(GRAVEYARD_SHIFT_ARRIVAL.x - spot.x, GRAVEYARD_SHIFT_ARRIVAL.z - spot.z);
    e.prevFacing = e.facing;
    e.auras.push(adventurerMarkerAura(pid));
    const bot: GraveyardShiftBot = {
      pid,
      role: member.role,
      cls: member.cls,
      brain: {
        rng: new Rng(botSeed(run.seed, index)),
        steer: freshBotSteer(),
        goalId: null,
        seenCast: null,
        kickAt: null,
        healTargetId: null,
        healAt: 0,
      },
      deaths: 0,
      diedTick: null,
      returning: false,
    };
    run.bots.push(bot);
  });
}

export function removeGraveyardShiftParty(ctx: SimContext, run: GraveyardShiftRun): void {
  for (const bot of run.bots) if (ctx.players.has(bot.pid)) ctx.removePlayer(bot.pid);
  run.bots.length = 0;
}
