// The Guardian of the Heat's channel (docs/design/raid/smith_heart.md section
// 7.4): the wellspring's pour, made part of the fight. A seam of the first
// flame runs across the Hearth's floor from its north wall to its south lip
// (`HEARTH_CHANNEL`), through the hall's middle.
//
//   still     a dull seam (the whole fight: its bed on the floor)
//   brimming  4 s of warning: the seam lights from its head down (raid
//             warning, every client sees the state on the object)
//   flowing   6 s of the first flame running down it: anyone within 3 yd of
//             its line burns every half second, so the floor is split in two
//             and a crystal's soaker can be cut off from their partner
//
// First flow 20 s after the pull (warning at 16), then one every 26 s, the
// wellspring's own rhythm. Zero rng but the damage rolls, in player order.

import { HEARTH_CHANNEL } from '../../content/smith_heart_layout';
import { DT, type Entity } from '../../types';
import { inChannel } from './heat_geometry';
import {
  channelTemplate,
  HEAT_CUES,
  HEAT_NAMES,
  type HeatChannelState,
  HEAT_TUNING as T,
} from './heat_ids';
import {
  at,
  cueAt,
  dropFightObject,
  fireHit,
  type HeatScope,
  livePlayers,
  raidWarn,
  roll,
  spawnFightObject,
} from './heat_scope';
import type { HeatChannel } from './heat_state';
import { heatSay } from './heat_voice';

const MID_Z = (HEARTH_CHANNEL.z0 + HEARTH_CHANNEL.z1) / 2;

/** A fresh channel (no object yet: the pull lays it). */
export function freshChannel(): HeatChannel {
  return {
    objectId: null,
    state: 'still',
    remaining: T.channelFirst - T.channelWarn,
    tick: 0,
    flows: 0,
  };
}

function setState(s: HeatScope, state: HeatChannelState, seconds: number): void {
  const ch = s.st.channel;
  ch.state = state;
  ch.remaining = seconds;
  const obj = ch.objectId !== null ? s.ctx.entities.get(ch.objectId) : undefined;
  if (obj) obj.templateId = channelTemplate(state, seconds);
}

/** Lay the channel's object at the pull (its bed, still). */
export function layChannel(s: HeatScope): void {
  const ch = s.st.channel;
  if (ch.objectId !== null) return;
  const obj = spawnFightObject(
    s.ctx,
    s.inst,
    channelTemplate('still', ch.remaining),
    HEAT_NAMES.channel,
    HEARTH_CHANNEL.x,
    MID_Z,
    T.channelHalf,
  );
  // Along the channel (sim convention: facing 0 runs +z).
  obj.facing = 0;
  ch.objectId = obj.id;
}

/** Start the brimming now (the dev trigger: the flow follows in 4 s). */
export function brimNow(s: HeatScope): void {
  setState(s, 'warn', T.channelWarn);
  raidWarn(s, s.boss, 'channel', 'The Hearth overflows! The channel will split the floor!');
  if (s.st.channel.flows === 0) heatSay(s, s.boss, 'channel');
}

/** The players in the flowing fire now. */
export function inFlow(s: HeatScope): Entity[] {
  const out: Entity[] = [];
  for (const p of livePlayers(s)) {
    const here = at(s, p);
    if (inChannel(here.x, here.z, T.channelHalf)) out.push(p);
  }
  return out;
}

/** One tick of the channel. Returns who the fire struck this tick. */
export function stepChannel(s: HeatScope): Entity[] {
  const ch = s.st.channel;
  ch.remaining -= DT;
  if (ch.state === 'flow') {
    if (ch.remaining <= 1e-9) {
      setState(s, 'still', T.channelEvery - T.channelWarn - T.channelFlow);
      return [];
    }
    ch.tick -= DT;
    if (ch.tick > 1e-9) return [];
    ch.tick += T.channelTick;
    const hit = inFlow(s);
    for (const p of hit) fireHit(s, p, roll(s, T.channelMin, T.channelMax), HEAT_NAMES.channel);
    return hit;
  }
  if (ch.remaining > 1e-9) return [];
  if (ch.state === 'still') {
    brimNow(s);
    return [];
  }
  // Brimming done: it flows.
  setState(s, 'flow', T.channelFlow);
  ch.flows++;
  // Its first burn on the next tick, then every half second.
  ch.tick = DT;
  cueAt(s, HEAT_CUES.flow, HEARTH_CHANNEL.x, HEARTH_CHANNEL.z1, T.channelHalf);
  return [];
}

/** The channel's object off the floor. */
export function clearChannel(s: Pick<HeatScope, 'ctx' | 'inst' | 'st'>): void {
  dropFightObject(s.ctx, s.inst, s.st.channel.objectId);
  s.st.channel = freshChannel();
}
