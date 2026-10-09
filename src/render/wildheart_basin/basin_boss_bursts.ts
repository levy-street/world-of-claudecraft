// The Wildheart Basin bosses' one-shot bursts (PLACEHOLDER looks), split out
// of basin_boss_fx.ts: what each boss `spellfx` event throws up the moment it
// lands (the quake's shock and pit sand, the jaguar's slash, the Heel!
// landing dust, the roar of Call of the Hunt, the seeds and spits launched
// from the Gorgebloom's maw, pods squelching, the
// jade pulse and transformation, the maul, the sunstrike, the Ambush smoke).
// The Gorgebloom's own body beats (Pollinate, the Vine Lash wave, the Gorge
// bite, a sprout bursting from its pod) are gorgebloom_fx.ts's. Everything draws through the host's pooled
// particles and shock rings; the few bits of boss state a burst reads (a pod's
// last spot, the bonded jaguar) come through `BossBurstHooks`.
//
// Cosmetic only: every burst thins with the effects tier and none of them
// carries a timing a player reacts to (the telegraphs do).

import {
  BEAST_CALL_OF_THE_HUNT,
  BEAST_HEEL,
  BEAST_JAGUAR_BITE,
  BEAST_PIT_QUAKE,
  BEAST_STALKED,
  BEAST_THICKHIDE_WARD,
  BEAST_TUNING,
  BLOOM_SEED_BURROW,
  BLOOM_SEED_RAIN,
  BLOOM_SEED_STOMP,
  BLOOM_SPIT,
  GORGEBLOOM_ID,
  ZULGAR_AMBUSH,
  ZULGAR_AVATAR,
  ZULGAR_MAULED,
  ZULGAR_PREY,
  ZULGAR_PULSE,
  ZULGAR_SUNSTRUCK,
  ZULGAR_TUNING,
  ZULGAR_VANISHED,
} from '../../sim/encounters/wildheart_basin/ids';
import type { Entity, SimEvent } from '../../sim/types';
import { BOSS_SPLASH, type BossSplash, bossBodyHeight } from './basin_boss_fx_core';
import type { BasinFxHost } from './basin_fx_host';
import { SPIT_GLOB_DELAY } from './gorgebloom_fx_core';
import { GORGEBLOOM_CLIP, gorgebloomModelToWorld } from './gorgebloom_model_core';

/** The boss state a burst reads (BasinBossFx implements it). */
export interface BossBurstHooks {
  /** Lob a seed (or a spit) from `from` at `target`, `delay` seconds on. */
  launchSeed(
    from: { x: number; y: number; z: number },
    target: Entity,
    spit: boolean,
    delay: number,
  ): void;
  /** A pod's spot, while drawn or just gone; else where `fallback` stands. */
  podSpot(podId: number, fallback: Entity): { x: number; z: number };
  /** The jaguar bonded to the Beastmaster, while it stands. */
  bondJaguar(): Entity | undefined;
}

const MAW = { x: 0, y: 0, z: 0 };

/** Where a seed (or a spit) leaves: the Gorgebloom model's maw on that clip's
 *  launch frame; any other caster, high on its body. */
function bloomMaw(src: Entity, h: number, spit: boolean): { x: number; y: number; z: number } {
  if (src.templateId === GORGEBLOOM_ID) {
    const p = spit ? GORGEBLOOM_CLIP.spitMaw : GORGEBLOOM_CLIP.seedMaw;
    return gorgebloomModelToWorld(src.pos, src.facing, src.scale || 1, p, MAW);
  }
  MAW.x = src.pos.x;
  MAW.y = src.pos.y + h * (spit ? 0.6 : 0.85);
  MAW.z = src.pos.z;
  return MAW;
}

/** A tinted crown (and its rings) thrown up from the floor at (x, z). */
function splashAt(host: BasinFxHost, x: number, z: number, look: BossSplash): void {
  const y = host.groundY(x, z);
  host.splash.crown(x, y, z, look.crown, look.tint);
  if (look.ripple) host.splash.ripple(x, y + 0.06, z, look.ripple, look.tint);
}

/** Play the burst of one boss spellfx event; true when it was one of theirs. */
export function playBasinBossBurst(
  host: BasinFxHost,
  ev: Extract<SimEvent, { type: 'spellfx' }>,
  src: Entity,
  target: Entity | undefined,
  hooks: BossBurstHooks,
): boolean {
  const { x, z } = src.pos;
  const gy = host.groundY(x, z);
  const h = bossBodyHeight(src.templateId, src.scale || 1);
  switch (ev.ability) {
    case BEAST_PIT_QUAKE: {
      // The pit's sand heaves up in a wall racing out to the ring's edge.
      splashAt(host, x, z, BOSS_SPLASH.quake);
      host.shockRing(x, z, 0xffe0b0, BEAST_TUNING.quakeRadius * 1.05, 0.8);
      host.shockRing(x, z, 0xff6a2a, BEAST_TUNING.quakeRadius, 0.6);
      host.puff(x, gy + 0.4, z, 55, {
        speed: 7,
        up: 2,
        life: 1.5,
        size: [2, 5.5],
        color: [0.74, 0.6, 0.4],
        alpha: 0.65,
        drag: 2.2,
        radius: BEAST_TUNING.quakeRadius * 0.6,
        dir: [0, 0.5, 0],
        spread: 1,
      });
      host.puff(x, gy + 0.3, z, 26, {
        speed: 3,
        up: 7,
        life: 1.1,
        size: [0.35, 0.15],
        color: [0.62, 0.5, 0.34],
        alpha: 1,
        gravity: 14,
        drag: 0.3,
        radius: BEAST_TUNING.quakeRadius * 0.45,
      });
      if (!host.reducedMotion()) host.shake(0.4);
      return true;
    }
    case BEAST_HEEL: {
      // The jaguar lands at its master's side.
      splashAt(host, x, z, BOSS_SPLASH.landing);
      host.shockRing(x, z, 0xffe0b0, 4, 0.5);
      host.puff(x, gy + 0.4, z, 30, {
        speed: 6,
        up: 1.2,
        life: 1.1,
        size: [1.4, 3.8],
        color: [0.72, 0.6, 0.42],
        alpha: 0.6,
        drag: 2.4,
        radius: 1.5,
      });
      if (!host.reducedMotion()) host.shake(0.15);
      return true;
    }
    case BEAST_JAGUAR_BITE: {
      if (!target) return true;
      const th = bossBodyHeight(target.templateId, target.scale || 1);
      const dx = target.pos.x - x;
      const dz = target.pos.z - z;
      const d = Math.hypot(dx, dz) || 1;
      host.puff(target.pos.x, target.pos.y + th * 0.55, target.pos.z, 18, {
        speed: 6,
        life: 0.35,
        size: [0.9, 0.15],
        color: [1, 0.28, 0.2],
        alpha: 1,
        glow: true,
        dir: [dx / d, 0.15, dz / d],
        spread: 0.6,
      });
      host.puff(target.pos.x, target.pos.y + th * 0.5, target.pos.z, 10, {
        speed: 2.5,
        up: 1.5,
        life: 0.8,
        size: [0.18, 0.1],
        color: [0.6, 0.04, 0.05],
        alpha: 1,
        gravity: 10,
      });
      return true;
    }
    case BEAST_STALKED:
    case ZULGAR_PREY: {
      if (!target) return true;
      const th = bossBodyHeight(target.templateId, target.scale || 1);
      const red = ev.ability === BEAST_STALKED;
      const col: [number, number, number] = red ? [1, 0.25, 0.2] : [0.4, 1, 0.66];
      host.puff(target.pos.x, target.pos.y + th + 0.9, target.pos.z, 1, {
        speed: 0,
        life: 0.45,
        size: [3.2, 0.6],
        color: col,
        alpha: 0.9,
        glow: true,
      });
      host.puff(target.pos.x, target.pos.y + 0.2, target.pos.z, 16, {
        speed: 0.4,
        up: 3,
        life: 0.9,
        size: [0.35, 0.1],
        color: col,
        alpha: 0.9,
        glow: true,
        radius: 0.9,
      });
      return true;
    }
    case BEAST_CALL_OF_THE_HUNT: {
      host.shockRing(x, z, 0xff3a24, 7, 0.7);
      host.puff(x, src.pos.y + h * 0.85, z, 30, {
        speed: 7,
        up: 2,
        life: 0.8,
        size: [1.2, 0.3],
        color: [1, 0.3, 0.18],
        alpha: 0.9,
        glow: true,
      });
      const cat = hooks.bondJaguar();
      if (cat && !cat.dead) {
        const ch = bossBodyHeight(cat.templateId, cat.scale || 1);
        host.puff(cat.pos.x, cat.pos.y + ch * 0.7, cat.pos.z, 18, {
          speed: 5,
          up: 1.5,
          life: 0.7,
          size: [1, 0.25],
          color: [1, 0.3, 0.18],
          alpha: 0.9,
          glow: true,
        });
      }
      if (!host.reducedMotion()) host.shake(0.2);
      return true;
    }
    case BEAST_THICKHIDE_WARD: {
      const on = target ?? src;
      const th = bossBodyHeight(on.templateId, on.scale || 1);
      host.puff(on.pos.x, on.pos.y + th * 0.5, on.pos.z, 30, {
        speed: 3,
        up: 0.8,
        life: 0.9,
        size: [1, 0.25],
        color: [1, 0.72, 0.32],
        alpha: 0.9,
        glow: true,
        radius: th * 0.5,
      });
      return true;
    }
    case BLOOM_SEED_RAIN: {
      // The six pods leave the model's maw on its spit frame (the bar's end).
      if (target) hooks.launchSeed(bloomMaw(src, h, false), target, false, 0);
      return true;
    }
    case BLOOM_SPIT: {
      // The glob leaves the maw a beat after the spit lands (the quick clip).
      if (target) hooks.launchSeed(bloomMaw(src, h, true), target, true, SPIT_GLOB_DELAY);
      return true;
    }
    case BLOOM_SEED_STOMP: {
      const at = hooks.podSpot(ev.targetId, target ?? src);
      const py = host.groundY(at.x, at.z);
      // Squelch: the pod bursts in a crown of yellow-green pulp.
      splashAt(host, at.x, at.z, BOSS_SPLASH.podStomp);
      host.puff(at.x, py + 0.3, at.z, 18, {
        speed: 3.5,
        up: 3,
        life: 0.9,
        size: [0.3, 0.12],
        color: [0.55, 0.06, 0.1],
        alpha: 1,
        gravity: 12,
      });
      host.puff(at.x, py + 0.4, at.z, 14, {
        speed: 1.6,
        up: 1,
        life: 1.6,
        size: [1, 2.8],
        color: [0.72, 0.76, 0.3],
        alpha: 0.55,
        radius: 0.6,
        drag: 1.6,
      });
      return true;
    }
    case BLOOM_SEED_BURROW: {
      const at = hooks.podSpot(ev.targetId, target ?? src);
      const py = host.groundY(at.x, at.z);
      host.puff(at.x, py + 0.3, at.z, 26, {
        speed: 3,
        up: 5,
        life: 1.1,
        size: [0.45, 0.2],
        color: [0.42, 0.3, 0.18],
        alpha: 1,
        gravity: 12,
        radius: 0.6,
      });
      host.puff(at.x, py + 0.3, at.z, 12, {
        speed: 1.5,
        up: 1,
        life: 1.4,
        size: [1.2, 3],
        color: [0.5, 0.4, 0.26],
        alpha: 0.5,
        drag: 2,
      });
      return true;
    }
    case ZULGAR_PULSE: {
      splashAt(host, x, z, BOSS_SPLASH.pulse);
      host.shockRing(x, z, 0x5fe0a0, ZULGAR_TUNING.pulseRadius, 0.9);
      host.shockRing(x, z, 0xd8fff0, ZULGAR_TUNING.pulseRadius * 0.9, 0.7);
      host.puff(x, gy + 0.4, z, 44, {
        speed: 1,
        up: 3,
        life: 1.2,
        size: [0.5, 0.12],
        color: [0.4, 1, 0.66],
        alpha: 0.9,
        glow: true,
        radius: ZULGAR_TUNING.pulseRadius * 0.85,
      });
      if (!host.reducedMotion()) host.shake(0.3);
      return true;
    }
    case ZULGAR_AVATAR: {
      host.shockRing(x, z, 0x5fe0a0, 9, 0.9);
      host.puff(x, src.pos.y + h * 0.5, z, 1, {
        speed: 0,
        life: 0.6,
        size: [h * 1.4, h * 2.2],
        color: [0.5, 1, 0.75],
        alpha: 0.9,
        glow: true,
      });
      host.puff(x, src.pos.y + h * 0.5, z, 60, {
        speed: 8,
        up: 1,
        life: 1,
        size: [0.8, 0.2],
        color: [0.4, 1, 0.66],
        alpha: 1,
        glow: true,
        radius: h * 0.3,
      });
      host.puff(x, gy + 0.5, z, 30, {
        speed: 4,
        up: 1.5,
        life: 1.6,
        size: [2, 5],
        color: [0.3, 0.42, 0.34],
        alpha: 0.5,
        drag: 2,
        radius: 2,
      });
      if (!host.reducedMotion()) host.shake(0.45);
      return true;
    }
    case ZULGAR_MAULED: {
      if (!target) return true;
      const th = bossBodyHeight(target.templateId, target.scale || 1);
      host.puff(target.pos.x, target.pos.y + th * 0.4, target.pos.z, 26, {
        speed: 7,
        life: 0.45,
        size: [1.2, 0.2],
        color: [1, 0.2, 0.16],
        alpha: 1,
        glow: true,
      });
      host.puff(target.pos.x, target.pos.y + th * 0.4, target.pos.z, 18, {
        speed: 3,
        up: 2,
        life: 0.9,
        size: [0.22, 0.1],
        color: [0.6, 0.04, 0.05],
        alpha: 1,
        gravity: 10,
      });
      if (!host.reducedMotion()) host.shake(0.25);
      return true;
    }
    case ZULGAR_SUNSTRUCK: {
      const on = target ?? src;
      const r = on.kind === 'object' ? on.scale || 2 : 2;
      const sy = host.groundY(on.pos.x, on.pos.z);
      splashAt(host, on.pos.x, on.pos.z, BOSS_SPLASH.sunstruck);
      host.shockRing(on.pos.x, on.pos.z, 0xffd860, r * 1.8, 0.7);
      host.puff(on.pos.x, sy + 1, on.pos.z, 1, {
        speed: 0,
        life: 0.5,
        size: [r * 3, r * 4.5],
        color: [1, 0.9, 0.55],
        alpha: 1,
        glow: true,
      });
      host.puff(on.pos.x, sy + 0.3, on.pos.z, 50, {
        speed: 2,
        up: 6,
        life: 1.1,
        size: [0.5, 0.12],
        color: [1, 0.86, 0.45],
        alpha: 1,
        glow: true,
        radius: r,
      });
      return true;
    }
    case ZULGAR_VANISHED:
    case ZULGAR_AMBUSH: {
      const landing = ev.ability === ZULGAR_AMBUSH;
      if (landing) {
        splashAt(host, x, z, BOSS_SPLASH.ambush);
        host.shockRing(x, z, 0xff6a2a, ZULGAR_TUNING.ambushRadius, 0.6);
        host.shockRing(x, z, 0x5fe0a0, ZULGAR_TUNING.ambushRadius * 1.2, 0.8);
      }
      host.puff(x, gy + 0.6, z, landing ? 40 : 55, {
        speed: landing ? 7 : 3,
        up: landing ? 1.5 : 2.5,
        life: 1.6,
        size: [2, 6],
        color: [0.18, 0.26, 0.22],
        alpha: 0.65,
        drag: 2,
        radius: landing ? ZULGAR_TUNING.ambushRadius * 0.5 : 1.5,
      });
      host.puff(x, src.pos.y + h * 0.5, z, 24, {
        speed: 5,
        up: 1,
        life: 0.8,
        size: [0.7, 0.15],
        color: [0.4, 1, 0.66],
        alpha: 1,
        glow: true,
        radius: h * 0.25,
      });
      if (landing && !host.reducedMotion()) host.shake(0.5);
      return true;
    }
    default:
      return false;
  }
}
