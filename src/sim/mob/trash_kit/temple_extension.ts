// The Drowned Temple's kit extension (kit_extension.ts): routes the Temple's
// own key block (MobTemplate.trashKit.temple) into the shared driver. The
// casts (the Prism Glare, the Arcing Spark) ride the driver's cast machinery;
// the rest is per-tick upkeep (the Shrine Vigil, the heroic Moonset Oath, the
// heroic Lullaby Echo, the Spiral Whirlpool, the heroic Swollen Tide). The
// second wave adds the Siren's Call of the Shallows (a cast whose drag and
// sight break run in the upkeep, temple_lure.ts) and the ray's heroic
// Heartpearl (temple_pearl.ts).

import type { TrashKitCast, TrashKitDef } from '../../types';
import type { TrashKitExtension } from './kit_extension';
import { TEMPLE_SPIRAL_WHIRLPOOL } from './temple_cast_ids';
import {
  endLullabyEcho,
  endOath,
  endVigil,
  stepLullabyEcho,
  stepOath,
  stepVigil,
} from './temple_choir';
import { dropDraw, landLure, lureTarget, stepLure } from './temple_lure';
import { stepPearl } from './temple_pearl';
import {
  gazeReady,
  landGaze,
  landSpark,
  sparkTarget,
  stepMerge,
  stepWhirlpool,
} from './temple_tide';

/** The Temple's cast keys, in priority order: the spark, the gaze, then the
 *  song (the second wave, last so no shipped cast's timing moves). */
const TEMPLE_CAST_KEYS = ['spark', 'gaze', 'lure'] as const;
type TempleCastKey = (typeof TEMPLE_CAST_KEYS)[number];

function isTempleKey(key: string): key is TempleCastKey {
  return (TEMPLE_CAST_KEYS as readonly string[]).includes(key);
}

export const TEMPLE_KIT_EXTENSION: TrashKitExtension = {
  castKeys: TEMPLE_CAST_KEYS,
  castDef(kit: TrashKitDef, key: string): TrashKitCast | undefined {
    return isTempleKey(key) ? kit.temple?.[key] : undefined;
  },
  // The gaze is a look, not a spell: a stun breaks it, a silence does not.
  isPhysical: (key) => key === 'gaze',
  ready(_ctx, _inst, mob, kit, key, st, players) {
    if (key === 'gaze') return { ok: gazeReady(mob, kit, players), target: null };
    if (key === 'lure') {
      const victim = lureTarget(mob, kit, st, players);
      return victim ? { ok: true, target: victim } : { ok: false, target: null };
    }
    const target = sparkTarget(mob, kit, st, players);
    return target ? { ok: true, target } : { ok: false, target: null };
  },
  land(ctx, inst, mob, kit, key, targetId, players) {
    if (key === 'gaze') landGaze(ctx, inst, mob, kit, players);
    else if (key === 'lure') landLure(ctx, mob, kit, targetId, inst.difficulty === 'heroic');
    else landSpark(ctx, mob, kit, targetId, players);
  },
  broken(ctx, mob, key, targetId) {
    // A kicked or stunned song lets its victim go at once.
    if (key === 'lure') dropDraw(ctx, mob, targetId);
  },
  step(ctx, inst, mob, kit, st, players) {
    const t = kit.temple;
    if (!t) return false;
    if (t.vigil) stepVigil(ctx, inst, mob, kit);
    if (t.guard) stepOath(ctx, inst, mob, kit);
    if (t.lullabyEcho) stepLullabyEcho(ctx, mob, kit, st, players());
    if (t.whirlpool) stepWhirlpool(ctx, inst, mob, kit, st, players());
    if (t.merge) stepMerge(ctx, inst, mob, kit);
    if (t.lure) stepLure(ctx, mob, kit, st, inst.difficulty === 'heroic');
    if (t.pearl) stepPearl(ctx, inst, mob, kit, st);
    return false;
  },
  endPull(ctx, inst, mob, st) {
    endLullabyEcho(ctx, st);
    endVigil(ctx, inst, mob);
    endOath(ctx, inst, mob);
    if (mob.auras.some((a) => a.id === TEMPLE_SPIRAL_WHIRLPOOL))
      mob.auras = mob.auras.filter((a) => a.id !== TEMPLE_SPIRAL_WHIRLPOOL);
  },
};
