// The Guardian of the Quench's cold, forced for a playtest (`/dev heart
// quench <verb>`, routed here by quench.ts quenchDevTrigger; dev-gated by its
// one caller, sim/dev/smith_heart_dev.ts):
//
//   immune    seal me in a Cold Coffin's stasis (8 s): the bar still rises,
//             no warmth given or taken, and a freeze cracks it
//   splash    my ice shatters now (frozen and shattered at once): the
//             splash, its shards and every struck ally's alert
//   chain     every other player on the lake to <n> cold (default 70), then
//             I freeze: the chain, and its bound
//   huddle    every other player on the lake gathered round me (a ring of
//             2.5 yd): the huddle's warmth with nobody else at the keys
//   temper    Tempering Strike tempers me <n> times (default 1): the
//             Rime-Tempered stacks, their cold floor, the swap alert
//
// Zero rng: the shatter's hit is the fight's own roll.

import { displacePlayerForDev } from '../../dev/dev_displace';
import type { Entity } from '../../types';
import { chillOf, freezePlayer, shatter } from './quench_cold';
import { QUENCH_TUNING as T } from './quench_ids';
import { putMarker, type QuenchScope } from './quench_scope';
import { temper } from './quench_temper';

/** The stasis Cold Coffin casts (content/classes.ts ice_block): its id,
 *  kind and duration, self-sourced and breakable as the real one is. */
function coffin(me: Entity): void {
  putMarker(me, 'ice_block', 'Cold Coffin', 8, me.id, { school: 'frost' });
  const a = me.auras[me.auras.length - 1];
  a.kind = 'stasis';
  delete a.undispellable;
}

/** A cold verb for `me`: the reply, or null when the verb is not one. */
export function quenchColdDev(
  s: QuenchScope,
  me: Entity,
  verb: string,
  arg: string | undefined,
): string | null {
  if (verb === 'immune' || verb === 'coffin') {
    coffin(me);
    return 'You are sealed in a Cold Coffin: your cold keeps rising (no warmth while it lasts).';
  }
  if (verb === 'splash' || verb === 'shatter') {
    freezePlayer(s, me);
    const hit = shatter(s, me);
    return `Your ice shatters now: the splash struck ${hit.length} player(s).`;
  }
  if (verb === 'chain') {
    const n = arg === undefined ? 70 : Number(arg);
    if (!Number.isFinite(n)) return null;
    let k = 0;
    for (const p of s.players) {
      if (p.id === me.id || p.dead) continue;
      const c = chillOf(s, p.id);
      if (c.frozen > 0) continue;
      c.cold = Math.max(0, Math.min(T.coldMax - 0.01, n));
      k++;
    }
    freezePlayer(s, me);
    return `You freeze with ${k} other(s) at ${Math.round(n)} cold: watch the chain (it stays bounded).`;
  }
  if (verb === 'temper') {
    const n = arg === undefined ? 1 : Number(arg);
    if (!Number.isInteger(n) || n < 1) return null;
    let stacks = 0;
    for (let i = 0; i < n && !me.dead; i++) stacks = temper(s, me);
    if (chillOf(s, me.id).frozen > 0) return 'The rime takes you: frozen solid, the stacks spent.';
    return stacks > 0
      ? `Rime-Tempered x${stacks}: your cold holds at ${Math.min(T.coldMax, stacks * s.rules.temperCold)} or more.`
      : 'The rime took you: frozen solid.';
  }
  if (verb === 'huddle') {
    const others = s.players.filter((p) => p.id !== me.id && !p.dead);
    others.forEach((p, i) => {
      const a = (i / Math.max(1, others.length)) * Math.PI * 2;
      displacePlayerForDev(s.ctx, p, me.pos.x + Math.sin(a) * 2.5, me.pos.z + Math.cos(a) * 2.5);
    });
    return `${others.length} player(s) huddle round you.`;
  }
  return null;
}
