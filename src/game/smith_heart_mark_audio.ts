// The Smith's Heart's personal marks, heard in the marked player's own ear: a
// mechanic chose YOU (a Rush's mark, a slash's mark, an Ember Mark, Drawn
// Lightning...). One sting per element (`heart_mark_<element>`, scripts/sfx/
// smith_heart_mechanic_sfx.mjs), so the raid learns the four by ear. Every
// fight's audio core names its own marks; this module only hears a mark
// ARRIVE on the local player (an aura they did not wear a frame ago). Pure
// detection plus a bounded, allocation-free adapter: a bit per mark.

import type { Entity } from '../sim/types';

export interface HeartMarkSound {
  key: string;
  gain: number;
  rate: number;
}

const S = (key: string, gain = 1, rate = 1): HeartMarkSound => ({ key, gain, rate });

/** The four elements' stings. */
export const HEART_MARK = {
  stone: S('heart_mark_stone'),
  storm: S('heart_mark_storm'),
  frost: S('heart_mark_frost'),
  fire: S('heart_mark_fire'),
} as const;

/** A sting of `element` at its own gain and rate (a second mark of one fight
 *  told apart by pitch). */
export function markSound(base: HeartMarkSound, gain = 1, rate = 1): HeartMarkSound {
  return S(base.key, base.gain * gain, base.rate * rate);
}

interface AuraIdLike {
  id: string;
}

/** The marks `ids` that `auras` carries, a bit each (index in `ids`). Pure. */
export function markMask(ids: readonly string[], auras: readonly AuraIdLike[]): number {
  let mask = 0;
  for (let a = 0; a < auras.length; a++) {
    const i = ids.indexOf(auras[a].id);
    if (i >= 0) mask |= 1 << i;
  }
  return mask;
}

export interface HeartMarkSink {
  playAt(
    key: string,
    x: number,
    y: number,
    z: number,
    opts?: {
      gain?: number;
      cooldown?: number;
      rate?: number;
      jitter?: boolean;
      priority?: boolean;
    },
  ): boolean;
}

/** Hears the marks of one fight arrive on the local player. */
export class HeartMarkEar {
  private readonly ids: string[];
  private mask = 0;

  constructor(private readonly table: Readonly<Record<string, HeartMarkSound>>) {
    this.ids = Object.keys(table);
  }

  /** Every key this ear may play, for preloading. */
  keys(): string[] {
    return this.ids.map((id) => this.table[id].key);
  }

  /** One frame: the local player (null out of the fight or dead). */
  update(me: Entity | null, sink: HeartMarkSink): void {
    const mask = me && !me.dead ? markMask(this.ids, me.auras) : 0;
    const fresh = mask & ~this.mask;
    this.mask = mask;
    if (!me || fresh === 0) return;
    for (let i = 0; i < this.ids.length; i++) {
      if ((fresh & (1 << i)) === 0) continue;
      const s = this.table[this.ids[i]];
      sink.playAt(s.key, me.pos.x, me.pos.y + 1.6, me.pos.z, {
        gain: s.gain,
        rate: s.rate,
        cooldown: 0.4,
        jitter: false,
        priority: true,
      });
    }
  }
}
